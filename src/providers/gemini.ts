import z, { ZodTypeAny } from "zod";

import { ProviderRuntimeConfig } from "../config";
import { classifyProviderError, ProviderSDKNotInstalledError } from "../errors";
import { createConsoleLogger } from "../logger";
import { ResolvedPrompt } from "../prompts/types";
import { BUILTIN_PROVIDERS, ProviderId } from "../providerType";
import { LLMUsageInfo } from "../tokens/usageTypes";
import {
  ContentPart,
  contentToText,
  EmbeddingOptions,
  EmbeddingResult,
  LLMGenerationOptions,
  LLMResult,
  LLMStreamEvent,
  PromptMessage,
  ToolCall,
  ToolDefinition,
} from "../types";
import { LLMProvider, StructureResult } from "./LLMProvider";

import type {
  Content,
  FunctionCallingConfigMode as FunctionCallingConfigModeEnum,
  FunctionDeclaration,
  GenerateContentResponse,
  GenerateContentResponseUsageMetadata,
  GoogleGenAI,
  Part,
  Schema,
  Type as SchemaTypeEnum,
} from "@google/genai";

/**
 * The pinned `@google/genai` SDK version's `ThinkingConfig` type only
 * declares `includeThoughts` — `thinkingBudget` is a real, documented
 * Gemini API field that newer SDK versions type but this one doesn't.
 * Extend locally rather than casting to `any`.
 */
type GeminiThinkingConfig = {
  includeThoughts?: boolean;
  thinkingBudget?: number;
};

/**
 * `@google/genai`'s `FunctionCallingConfigModeEnum` and `Type` are runtime
 * (string) enums, not pure types — importing them as values would defeat
 * the point of lazily loading the SDK, since merely importing this module
 * would then require `@google/genai` to be installed. Both are declared
 * `type`-only above; these local mirrors of their (stable, documented)
 * string values stand in for the enum at every call site below, cast to
 * the real enum types so callers see no difference.
 */
const FunctionCallingConfigModeValues = {
  MODE_UNSPECIFIED: "MODE_UNSPECIFIED",
  AUTO: "AUTO",
  ANY: "ANY",
  NONE: "NONE",
} as const as Record<
  "MODE_UNSPECIFIED" | "AUTO" | "ANY" | "NONE",
  FunctionCallingConfigModeEnum
>;

const SchemaType = {
  TYPE_UNSPECIFIED: "TYPE_UNSPECIFIED",
  STRING: "STRING",
  NUMBER: "NUMBER",
  INTEGER: "INTEGER",
  BOOLEAN: "BOOLEAN",
  ARRAY: "ARRAY",
  OBJECT: "OBJECT",
} as const as Record<
  | "TYPE_UNSPECIFIED"
  | "STRING"
  | "NUMBER"
  | "INTEGER"
  | "BOOLEAN"
  | "ARRAY"
  | "OBJECT",
  SchemaTypeEnum
>;

export class GeminiProvider extends LLMProvider {
  /**
   * Not set eagerly — real client construction is deferred to `getClient`
   * so importing/registering `GeminiProvider` never requires the
   * `@google/genai` package to be installed.
   */
  private client?: GoogleGenAI;
  private apiKey: string;
  private clientPromise: Promise<GoogleGenAI> | null = null;

  constructor(apiKey: string, runtimeConfig?: ProviderRuntimeConfig) {
    super(runtimeConfig, createConsoleLogger("Gemini"));
    this.apiKey = apiKey;
  }

  /**
   * Lazily constructs (and caches) the real `@google/genai` client on
   * first use.
   */
  private async getClient(): Promise<GoogleGenAI> {
    if (this.client) return this.client;
    if (!this.clientPromise) {
      this.clientPromise = import("@google/genai")
        .then(({ GoogleGenAI: GoogleGenAICtor }) => {
          const client = new GoogleGenAICtor({ apiKey: this.apiKey });
          this.client = client;
          return client;
        })
        .catch((err: unknown) => {
          throw new ProviderSDKNotInstalledError(
            "@google/genai",
            this.providerType,
            err
          );
        });
    }
    return this.clientPromise;
  }

  private textGenModelRegex =
    /^models\/gemini-\d+(\.\d+)?-(pro|flash)(-(latest|lite|preview)){0,2}$/;

  get providerType(): ProviderId {
    return BUILTIN_PROVIDERS.GEMINI;
  }

  get streamSupported(): boolean {
    return true;
  }

  /**
   * `@google/genai` 0.3.1's request config has no `abortSignal` (only a
   * `httpOptions.timeout`) — verified against the pinned SDK's `.d.ts`.
   * Races the SDK promise against the signal instead so cancellation still
   * works from the caller's side, without an SDK-native abort.
   */
  private raceWithSignal<T>(
    promise: Promise<T>,
    signal: AbortSignal
  ): Promise<T> {
    if (signal.aborted) {
      return Promise.reject(signal.reason ?? new Error("Aborted"));
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(signal.reason ?? new Error("Aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (err: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(err);
        }
      );
    });
  }

  runLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions & { stream: true }
  ): AsyncGenerator<LLMStreamEvent>;

  runLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions & { stream?: false; onUsage?: never }
  ): Promise<LLMResult<string>>;

  runLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions
  ): Promise<LLMResult<string>> | AsyncGenerator<LLMStreamEvent> {
    if (options.stream) {
      return this.runStreamedLLM(messages, options);
    }

    const { contents, systemInstruction } = this.toGeminiRequest(messages);
    const hasTools = Boolean(options.tools?.length);
    const toolConfig = this.toGeminiToolConfig(options.toolChoice, hasTools);

    return this.getClient()
      .then((client) =>
        this.withResilience(
          (signal) =>
            this.raceWithSignal(
              client.models.generateContent({
                model: options.model,
                contents,
                config: {
                  temperature: options.temperature,
                  maxOutputTokens: options.maxTokens,
                  ...this.toGeminiSamplingConfig(options),
                  ...(systemInstruction ? { systemInstruction } : {}),
                  ...(hasTools
                    ? {
                        tools: [
                          {
                            functionDeclarations: options.tools!.map((tool) =>
                              this.toGeminiTool(tool)
                            ),
                          },
                        ],
                      }
                    : {}),
                  ...(toolConfig ? { toolConfig } : {}),
                },
              }),
              signal
            ),
          {
            signal: options.signal,
            timeoutMs: options.timeoutMs,
            maxRetries: options.maxRetries,
          }
        )
      )
      .then((response) => {
        const content = response.text || "";
        const toolCalls = this.extractToolCalls(response);
        const usage = response.usageMetadata
          ? this.normalizeUsage({
              usage: response.usageMetadata,
              model: options.model,
              purpose: "generate_text",
            })
          : this.estimateTokenUsage({
              inputPrompt: this.toGeminiMessages(messages),
              outputText: content,
              model: options.model,
              purpose: "generate_text",
              provider: this.providerType,
            });

        this.notifyUsage(usage, options.onUsage);

        return { result: content, toolCalls, usage };
      })
      .catch((err: unknown) => {
        this.logger.error("runLLM failed", { error: err });
        throw classifyProviderError(err, this.providerType);
      });
  }

  /**
   * Sampling/reasoning passthrough params supported by Gemini's
   * `GenerateContentConfig`. No penalties/seed/reasoning_effort on Gemini.
   */
  private toGeminiSamplingConfig(options: LLMGenerationOptions): {
    topP?: number;
    topK?: number;
    stopSequences?: string[];
    thinkingConfig?: GeminiThinkingConfig;
  } {
    return {
      ...(options.topP !== undefined ? { topP: options.topP } : {}),
      ...(options.topK !== undefined ? { topK: options.topK } : {}),
      ...(options.stopSequences?.length
        ? { stopSequences: options.stopSequences }
        : {}),
      ...(options.thinkingBudget !== undefined
        ? { thinkingConfig: { thinkingBudget: options.thinkingBudget } }
        : {}),
    };
  }

  private toGeminiTool(tool: ToolDefinition): FunctionDeclaration {
    return {
      name: tool.name,
      description: tool.description,
      parameters: this.convertJsonSchemaToGemini(tool.parameters),
    };
  }

  private toGeminiToolConfig(
    toolChoice: LLMGenerationOptions["toolChoice"],
    hasTools: boolean
  ):
    | {
        functionCallingConfig: {
          mode: FunctionCallingConfigModeEnum;
          allowedFunctionNames?: string[];
        };
      }
    | undefined {
    if (!toolChoice || !hasTools) return undefined;
    if (toolChoice === "auto")
      return {
        functionCallingConfig: { mode: FunctionCallingConfigModeValues.AUTO },
      };
    if (toolChoice === "none")
      return {
        functionCallingConfig: { mode: FunctionCallingConfigModeValues.NONE },
      };
    if (toolChoice === "required")
      return {
        functionCallingConfig: { mode: FunctionCallingConfigModeValues.ANY },
      };
    return {
      functionCallingConfig: {
        mode: FunctionCallingConfigModeValues.ANY,
        allowedFunctionNames: [toolChoice.name],
      },
    };
  }

  private extractToolCalls(
    response: GenerateContentResponse
  ): ToolCall[] | undefined {
    const calls = response.functionCalls;
    if (!calls?.length) return undefined;
    return calls.map((call, index) => ({
      id: call.id ?? `${call.name ?? "call"}_${index}`,
      name: call.name ?? "",
      arguments: call.args ?? {},
    }));
  }

  /**
   * Converts flattened PromptMessages into Gemini's multi-turn Content[]
   * shape, translating assistant toolCalls into functionCall parts and
   * tool-result messages into functionResponse parts so tool-call loops
   * survive a round trip through this provider.
   */
  private toGeminiRequest(messages: PromptMessage[]): {
    contents: Content[];
    systemInstruction?: string;
  } {
    const systemInstruction = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n")
      .trim();

    const contents: Content[] = [];

    for (const message of messages) {
      if (message.role === "system") continue;

      if (message.role === "tool") {
        const part: Part = {
          functionResponse: {
            name: message.toolName ?? message.toolCallId,
            response: { output: message.content },
          },
        };
        const last = contents[contents.length - 1];
        if (last?.role === "user" && last.parts) {
          last.parts.push(part);
        } else {
          contents.push({ role: "user", parts: [part] });
        }
        continue;
      }

      if (message.role === "assistant" && message.toolCalls?.length) {
        const parts: Part[] = [];
        if (typeof message.content === "string") {
          if (message.content) parts.push({ text: message.content });
        } else {
          parts.push(...this.toGeminiParts(message.content));
        }
        for (const toolCall of message.toolCalls) {
          parts.push({
            functionCall: {
              name: toolCall.name,
              args: (toolCall.arguments ?? {}) as Record<string, unknown>,
            },
          });
        }
        contents.push({ role: "model", parts });
        continue;
      }

      contents.push({
        role: message.role === "assistant" ? "model" : "user",
        parts:
          typeof message.content === "string"
            ? [{ text: message.content }]
            : this.toGeminiParts(message.content),
      });
    }

    return { contents, systemInstruction: systemInstruction || undefined };
  }

  /**
   * Maps a multimodal `content` array to Gemini `Part[]`. Base64 image/
   * document parts map to `inlineData`; URL parts map to `fileData` (Gemini
   * has no `mimeType`-less variant, but the SDK's `FileData.mimeType` is
   * optional so a URL part with no known media type is still valid).
   */
  private toGeminiParts(content: ContentPart[]): Part[] {
    return content.map((part) => this.toGeminiPart(part));
  }

  private toGeminiPart(part: ContentPart): Part {
    if (part.type === "text") return { text: part.text };
    if (part.type === "image") {
      return "url" in part.image
        ? { fileData: { fileUri: part.image.url } }
        : {
            inlineData: {
              mimeType: part.image.mediaType,
              data: part.image.data,
            },
          };
    }
    // part.type === "document"
    return "url" in part.document
      ? { fileData: { fileUri: part.document.url } }
      : {
          inlineData: {
            mimeType: part.document.mediaType,
            data: part.document.data,
          },
        };
  }

  toGeminiSchema(zodSchema: ZodTypeAny): Schema {
    const jsonSchema = z.toJSONSchema(zodSchema);
    return this.convertJsonSchemaToGemini(jsonSchema);
  }

  /**
   * Resolves a local JSON-Schema `$ref` (`#/$defs/Name` or
   * `#/definitions/Name`, the two shapes Zod's `z.toJSONSchema` and most
   * hand-written schemas use) against the accumulated defs map. Returns
   * `undefined` on any unresolvable ref so the caller can fall back to the
   * STRING default instead of crashing.
   */
  private resolveJsonSchemaRef(
    ref: string,
    defs: Record<string, unknown>
  ): Record<string, unknown> | undefined {
    const match = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(ref);
    if (!match) return undefined;
    const def = defs[match[1]];
    return def && typeof def === "object"
      ? (def as Record<string, unknown>)
      : undefined;
  }

  private convertJsonSchemaToGemini(
    schema: Record<string, unknown>,
    defs: Record<string, unknown> = {}
  ): Schema {
    // Thread any $defs/definitions declared on this node into the map so
    // nested $ref's (including ones declared alongside the root schema)
    // resolve correctly regardless of recursion depth.
    const localDefs =
      schema.$defs && typeof schema.$defs === "object"
        ? (schema.$defs as Record<string, unknown>)
        : schema.definitions && typeof schema.definitions === "object"
          ? (schema.definitions as Record<string, unknown>)
          : undefined;
    const mergedDefs = localDefs ? { ...defs, ...localDefs } : defs;

    if (typeof schema.$ref === "string") {
      const resolved = this.resolveJsonSchemaRef(schema.$ref, mergedDefs);
      if (resolved) {
        return this.convertJsonSchemaToGemini(resolved, mergedDefs);
      }
      // Unresolvable ref — fall through to the default STRING fallback
      // below rather than crashing.
    }

    // Handle allOf — not supported by Gemini, flatten if possible
    if (
      schema.allOf &&
      Array.isArray(schema.allOf) &&
      schema.allOf.length === 1
    ) {
      return this.convertJsonSchemaToGemini(
        schema.allOf[0] as Record<string, unknown>,
        mergedDefs
      );
    }

    // anyOf/oneOf: Gemini has no union type. The common nullable-union
    // pattern (`anyOf: [T, {type:"null"}]`, which is what Zod's
    // `.nullable()`/`.optional()` emit) collapses to `T` with `nullable:
    // true`. A genuine multi-type union Gemini can't express is handled
    // best-effort by converting the first non-null branch.
    const union = (schema.anyOf ?? schema.oneOf) as
      Record<string, unknown>[] | undefined;
    if (Array.isArray(union) && union.length > 0) {
      const isNullBranch = (branch: Record<string, unknown>) =>
        branch.type === "null";
      const hasNullBranch = union.some(isNullBranch);
      const nonNullBranches = union.filter((branch) => !isNullBranch(branch));

      if (nonNullBranches.length > 0) {
        const converted = this.convertJsonSchemaToGemini(
          nonNullBranches[0],
          mergedDefs
        );
        if (hasNullBranch) converted.nullable = true;
        return converted;
      }
    }

    const geminiSchema: Schema = {};

    if (schema.description) {
      geminiSchema.description = schema.description as string;
    }

    if (schema.enum) {
      geminiSchema.type = SchemaType.STRING;
      geminiSchema.enum = (schema.enum as unknown[]).map(String);
      return geminiSchema;
    }

    // `type` as an array (e.g. `["string","null"]`) is the same nullable
    // pattern as the anyOf/oneOf case above, just expressed differently.
    const schemaType = schema.type;
    if (Array.isArray(schemaType)) {
      const types = schemaType as string[];
      const nonNullTypes = types.filter((t) => t !== "null");
      const isNullable = types.length !== nonNullTypes.length;
      const converted = this.convertJsonSchemaToGemini(
        { ...schema, type: nonNullTypes[0] },
        mergedDefs
      );
      if (isNullable) converted.nullable = true;
      return converted;
    }

    switch (schemaType) {
      case "string":
        geminiSchema.type = SchemaType.STRING;
        if (schema.enum) geminiSchema.enum = schema.enum as string[];
        break;

      case "number":
      case "integer":
        geminiSchema.type =
          schemaType === "integer" ? SchemaType.INTEGER : SchemaType.NUMBER;
        break;

      case "boolean":
        geminiSchema.type = SchemaType.BOOLEAN;
        break;

      case "array":
        geminiSchema.type = SchemaType.ARRAY;
        if (schema.items) {
          geminiSchema.items = this.convertJsonSchemaToGemini(
            schema.items as Record<string, unknown>,
            mergedDefs
          );
        }
        break;

      case "object":
        geminiSchema.type = SchemaType.OBJECT;
        if (schema.properties) {
          geminiSchema.properties = Object.fromEntries(
            Object.entries(schema.properties as Record<string, unknown>).map(
              ([key, value]) => [
                key,
                this.convertJsonSchemaToGemini(
                  value as Record<string, unknown>,
                  mergedDefs
                ),
              ]
            )
          );
        }
        if (Array.isArray(schema.required)) {
          geminiSchema.required = schema.required as string[];
        }
        if (!schema.properties) {
          // Treat as free-form object — Gemini doesn't support additionalProperties,
          // so we omit properties entirely and leave type as OBJECT
        }
        break;

      case "null":
        // Gemini has no null type — fall back to string
        geminiSchema.type = SchemaType.STRING;
        break;

      default:
        // Unknown or missing type (e.g. an unresolved $ref) — fall back to string
        geminiSchema.type = SchemaType.STRING;
        break;
    }

    return geminiSchema;
  }

  normalizeUsage({
    usage,
    model,
    purpose,
  }: {
    usage: GenerateContentResponseUsageMetadata;
    model: string;
    purpose: string;
  }): LLMUsageInfo {
    return {
      promptTokens: usage.promptTokenCount ?? 0,
      completionTokens:
        usage.candidatesTokenCount ??
        (usage.totalTokenCount ?? 0) - (usage.promptTokenCount ?? 0),
      totalTokens: usage.totalTokenCount ?? 0,
      provider: this.providerType,
      model,
      purpose,
    };
  }

  toGeminiMessages(messages: PromptMessage[]): string {
    return messages
      .map((m) => `${m.role}: ${contentToText(m.content)}`)
      .join("\n\n");
  }

  private async *runStreamedLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions
  ): AsyncGenerator<LLMStreamEvent> {
    const { contents, systemInstruction } = this.toGeminiRequest(messages);
    const hasTools = Boolean(options.tools?.length);
    const toolConfig = this.toGeminiToolConfig(options.toolChoice, hasTools);
    const client = await this.getClient();

    const response = await client.models.generateContentStream({
      model: options.model,
      contents,
      config: {
        temperature: options.temperature,
        maxOutputTokens: options.maxTokens,
        ...this.toGeminiSamplingConfig(options),
        ...(systemInstruction ? { systemInstruction } : {}),
        ...(hasTools
          ? {
              tools: [
                {
                  functionDeclarations: options.tools!.map((tool) =>
                    this.toGeminiTool(tool)
                  ),
                },
              ],
            }
          : {}),
        ...(toolConfig ? { toolConfig } : {}),
      },
    });

    let outputText = "";
    let finalUsage: GenerateContentResponse["usageMetadata"] | undefined;

    for await (const chunk of response) {
      // The pinned `@google/genai` SDK has no native abortSignal for
      // streaming requests — best-effort mid-stream cancellation by
      // checking the caller's signal between chunks instead.
      if (options.signal?.aborted) {
        throw classifyProviderError(
          Object.assign(new Error("The operation was aborted."), {
            name: "AbortError",
          }),
          this.providerType
        );
      }

      if (chunk.usageMetadata) finalUsage = chunk.usageMetadata;
      const text = chunk.text;
      if (text) {
        outputText += text;
        yield { type: "text", delta: text };
      }
      for (const toolCall of this.extractToolCalls(chunk) ?? []) {
        yield { type: "tool_call", toolCall };
      }
    }

    const usage = finalUsage
      ? this.normalizeUsage({
          usage: finalUsage,
          model: options.model,
          purpose: "generate_text",
        })
      : this.estimateTokenUsage({
          inputPrompt: this.toGeminiMessages(messages),
          outputText,
          model: options.model,
          purpose: "generate_text",
          provider: this.providerType,
        });

    this.notifyUsage(usage, options.onUsage);
    yield { type: "usage", usage };
    yield { type: "done" };
  }

  async fetchModels(): Promise<string[]> {
    try {
      this.logger.debug("Fetching models from Gemini API");
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models",
        { headers: { "x-goog-api-key": this.apiKey } }
      );
      const data = await response.json();

      if (!data.models || !Array.isArray(data.models)) {
        throw new Error("Invalid response from Gemini models API");
      }

      const textGenerationModels = data.models
        .map((model: { name: string }) => model.name)
        .filter((name: string) => this.textGenModelRegex.test(name))
        .map((name: string) => name.replace(/^models\//, ""));

      return textGenerationModels;
    } catch (error) {
      this.logger.error("Error fetching models", { error });
      return ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"]; // fallback
    }
  }

  protected getProviderName(): string {
    return "Gemini";
  }

  /**
   * `@google/genai@0.3.1`'s `models.embedContent` (the actual method the
   * pinned SDK exposes — there is no separate `embed`/`embedText`) returns
   * `{ embeddings?: ContentEmbedding[] }`, each with `values?: number[]` and
   * no token-usage field at all (that's Vertex-only). Usage is estimated
   * from the input text, following `estimateTokenUsage`'s pattern.
   */
  async embed(options: EmbeddingOptions): Promise<EmbeddingResult> {
    try {
      const inputs =
        typeof options.input === "string" ? [options.input] : options.input;
      const client = await this.getClient();

      const response = await client.models.embedContent({
        model: options.model,
        contents: inputs,
      });

      const embeddings = (response.embeddings ?? []).map(
        (embedding) => embedding.values ?? []
      );

      const usage = this.estimateTokenUsage({
        inputPrompt: inputs.join("\n"),
        outputText: "",
        model: options.model,
        purpose: "embed",
        provider: this.providerType,
      });

      this.notifyUsage(usage);

      return { embeddings, usage };
    } catch (error) {
      this.logger.error("embed failed", { error });
      throw classifyProviderError(error, this.providerType);
    }
  }

  async runStructuredLLM<TSchema extends ZodTypeAny>(
    template: ResolvedPrompt,
    options: LLMGenerationOptions,
    zodSchema: TSchema,
    _schemaName?: string
  ): Promise<StructureResult<TSchema>> {
    const promptText = this.combinePromptText(template);
    try {
      const client = await this.getClient();
      const response = await this.withResilience(
        (signal) =>
          this.raceWithSignal(
            client.models.generateContent({
              model: options.model,
              contents: promptText,
              config: {
                responseMimeType: "application/json",
                responseSchema: this.toGeminiSchema(zodSchema),
                ...this.toGeminiSamplingConfig(options),
              },
            }),
            signal
          ),
        {
          signal: options.signal,
          timeoutMs: options.timeoutMs,
          maxRetries: options.maxRetries,
        }
      );

      const content = response.text;
      if (!content) throw new Error("No response from Gemini");

      const result: z.infer<TSchema> = zodSchema.parse(JSON.parse(content));
      const usage = response.usageMetadata
        ? this.normalizeUsage({
            usage: response.usageMetadata,
            model: options.model,
            purpose: template.purpose,
          })
        : this.estimateTokenUsage({
            inputPrompt: promptText,
            outputText: content,
            model: options.model,
            purpose: template.purpose,
            provider: this.providerType,
          });

      this.notifyUsage(usage, options.onUsage);

      return { result, usage };
    } catch (err: unknown) {
      this.logger.error("runStructuredLLM failed", { error: err });
      throw classifyProviderError(err, this.providerType);
    }
  }

  async validateConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models",
        { headers: { "x-goog-api-key": this.apiKey } }
      );
      const data = await response.json();

      if (!response.ok || !data.models) {
        throw new Error(data.error?.message || "Failed to fetch models");
      }

      const modelCount = data.models.length;
      return {
        success: true,
        message: `Connected successfully. Found ${modelCount} available models.`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Connection failed: ${errorMessage}`,
      };
    }
  }
}
/**
 * Register Gemini provider
 */
LLMProvider.register(
  BUILTIN_PROVIDERS.GEMINI,
  {
    name: "Google Gemini",
    requiresAuth: true,
    description:
      "Google's flagship AI family, deeply integrated with Search, Docs, and Android. Gemini 2.5 Pro leads on long-context reasoning and multimodal tasks across image, audio, and video.",
    requiredPeerDependency: "@google/genai",
  },
  (apiKey?: string, runtimeConfig?: ProviderRuntimeConfig) => {
    if (!apiKey) {
      throw new Error("Gemini API key is required");
    }
    return new GeminiProvider(apiKey, runtimeConfig);
  }
);
