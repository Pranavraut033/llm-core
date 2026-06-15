import {
  GenerateContentResponse,
  GenerateContentResponseUsageMetadata,
  GoogleGenAI,
  Schema,
  Type as SchemaType,
} from "@google/genai";
import z, { ZodTypeAny } from "zod";

import { createConsoleLogger } from "../logger";
import { ResolvedPrompt } from "../prompts/types";
import { BUILTIN_PROVIDERS, ProviderId } from "../providerType";
import { LLMUsageInfo } from "../tokens/usageTypes";
import { LLMGenerationOptions, LLMResult, PromptMessage } from "../types";
import { LLMProvider, StructureResult } from "./LLMProvider";

const logger = createConsoleLogger("Gemini");

export class GeminiProvider extends LLMProvider {
  private client: GoogleGenAI;
  private apiKey: string;

  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
    this.client = new GoogleGenAI({ apiKey });
  }

  private textGenModelRegex =
    /^models\/gemini-\d+(\.\d+)?-(pro|flash)(-(latest|lite|preview)){0,2}$/;

  get providerType(): ProviderId {
    return BUILTIN_PROVIDERS.GEMINI;
  }

  get streamSupported(): boolean {
    return false; // Gemini's streaming API is not stable, so we disable it for now
  }

  runLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions & { stream: true }
  ): AsyncGenerator<string>;

  runLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions & { stream?: false; onUsage?: never }
  ): Promise<LLMResult<string>>;

  runLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions
  ): Promise<LLMResult<string>> | AsyncGenerator<string> {
    // Gemini doesn't have separate system messages, combine them

    if (options.stream) {
      return this.runStreamedLLM(messages, options);
    }

    return this.client.models
      .generateContent({
        model: options.model,
        contents: this.toGeminiMessages(messages),
      })
      .then((response) => {
        const content = response.text || "";
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

        return { result: content, usage };
      })
      .catch((err: unknown) => {
        const error = err as Record<string, unknown>;
        logger.error("runLLM failed", { error: err, message: error?.message });
        throw new Error(
          `Gemini runLLM failed: ${String(error?.message) || err}`
        );
      });
  }

  toGeminiSchema(zodSchema: ZodTypeAny): Schema {
    const jsonSchema = z.toJSONSchema(zodSchema);
    return this.convertJsonSchemaToGemini(jsonSchema);
  }

  private convertJsonSchemaToGemini(schema: Record<string, unknown>): Schema {
    // Handle $ref, allOf, anyOf, oneOf — not supported by Gemini, flatten if possible
    if (
      schema.allOf &&
      Array.isArray(schema.allOf) &&
      schema.allOf.length === 1
    ) {
      return this.convertJsonSchemaToGemini(
        schema.allOf[0] as Record<string, unknown>
      );
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

    switch (schema.type) {
      case "string":
        geminiSchema.type = SchemaType.STRING;
        if (schema.enum) geminiSchema.enum = schema.enum as string[];
        break;

      case "number":
      case "integer":
        geminiSchema.type =
          schema.type === "integer" ? SchemaType.INTEGER : SchemaType.NUMBER;
        break;

      case "boolean":
        geminiSchema.type = SchemaType.BOOLEAN;
        break;

      case "array":
        geminiSchema.type = SchemaType.ARRAY;
        if (schema.items) {
          geminiSchema.items = this.convertJsonSchemaToGemini(
            schema.items as Record<string, unknown>
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
                  value as Record<string, unknown>
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
        // Unknown or missing type (e.g. anyOf, oneOf, $ref not resolved) — fall back to string
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
        (usage.totalTokenCount ?? 0) - (usage.promptTokenCount ?? 0),
      totalTokens: usage.totalTokenCount ?? 0,
      provider: this.providerType,
      model,
      purpose,
    };
  }

  toGeminiMessages(messages: PromptMessage[]): string {
    return messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
  }

  private async *runStreamedLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions
  ): AsyncGenerator<string> {
    const response = await this.client.models.generateContentStream({
      model: options.model,
      contents: this.toGeminiMessages(messages),
      config: {
        temperature: options.temperature,
        maxOutputTokens: options.maxTokens,
      },
    });

    let outputText = "";
    let finalUsage: GenerateContentResponse["usageMetadata"] | undefined;

    for await (const chunk of response) {
      if (chunk.usageMetadata) finalUsage = chunk.usageMetadata;
      const text = chunk.text;
      if (text) {
        outputText += text;
        yield text;
      }
    }

    options.onUsage?.(
      finalUsage
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
          })
    );
  }

  async fetchModels(): Promise<string[]> {
    try {
      logger.debug("Fetching models from Gemini API");
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
        .filter((name: string) => this.textGenModelRegex.test(name));

      return textGenerationModels;
    } catch (error) {
      logger.error("Error fetching models", { error });
      return ["gemini-2.5-flash", "gemini-2.0-pro", "gemini-1.5-pro"]; // fallback
    }
  }

  protected getProviderName(): string {
    return "Gemini";
  }

  async runStructuredLLM<TSchema extends ZodTypeAny>(
    template: ResolvedPrompt,
    options: LLMGenerationOptions,
    zodSchema: TSchema,
    _schemaName?: string
  ): Promise<StructureResult<TSchema>> {
    const promptText = this.combinePromptText(template);
    try {
      const response = await this.client.models.generateContent({
        model: options.model,
        contents: promptText,
        config: {
          responseMimeType: "application/json",
          responseSchema: this.toGeminiSchema(zodSchema),
        },
      });

      const content = response.text;
      if (!content) throw new Error("No response from Gemini");

      const result: z.infer<TSchema> = zodSchema.parse(JSON.parse(content));
      const usage = this.estimateTokenUsage({
        inputPrompt: promptText,
        outputText: content,
        model: options.model,
        purpose: template.purpose,
        provider: this.providerType,
      });

      return { result, usage };
    } catch (err: unknown) {
      const error = err as Record<string, unknown>;
      logger.error("runStructuredLLM failed", {
        error: err,
        message: error?.message,
      });
      throw new Error(
        `Gemini runStructuredLLM failed: ${String(error?.message ?? err)}`
      );
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
  },
  (apiKey?: string) => {
    if (!apiKey) {
      throw new Error("Gemini API key is required");
    }
    return new GeminiProvider(apiKey);
  }
);
