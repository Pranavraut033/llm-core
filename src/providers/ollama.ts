import z from "zod";

import { ProviderRuntimeConfig } from "../config";
import { classifyProviderError } from "../errors";
import { createConsoleLogger } from "../logger";
import { ResolvedPrompt } from "../prompts/types";
import { BUILTIN_PROVIDERS } from "../providerType";
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

interface OllamaToolCall {
  /** Present on Ollama >=0.9 — a stable per-call id, e.g. "call_xxxxx". */
  id?: string;
  function: {
    name: string;
    arguments: Record<string, unknown>;
    /** Stable position of this call within the full turn, even when tool
     *  calls are split one-per-chunk across a stream. */
    index?: number;
  };
}

interface OllamaChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
  /** Base64-encoded images (no media-type field) — Ollama's `/api/chat` convention. */
  images?: string[];
}

interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ToolDefinition["parameters"];
  };
}

interface OllamaChatResponse {
  message?: {
    role: string;
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaModel {
  name: string;
}

interface OllamaEmbedResponse {
  embeddings?: number[][];
  /** Present on some Ollama versions; absent on others — best-effort only. */
  prompt_eval_count?: number;
}

export class OllamaProvider extends LLMProvider {
  private baseUrl: string;
  public readonly providerType = BUILTIN_PROVIDERS.OLLAMA;

  constructor(
    baseUrl: string = "http://localhost:11434",
    runtimeConfig?: ProviderRuntimeConfig
  ) {
    super(runtimeConfig, createConsoleLogger("Ollama"));
    this.baseUrl = baseUrl;
  }

  private toOllamaMessages(messages: PromptMessage[]): OllamaChatMessage[] {
    return messages.map((message) => {
      if (message.role === "tool") {
        return {
          role: "tool",
          content: message.content,
          ...(message.toolName ? { tool_name: message.toolName } : {}),
        };
      }
      if (message.role === "assistant" && message.toolCalls?.length) {
        return {
          role: "assistant",
          content:
            typeof message.content === "string"
              ? message.content
              : this.toOllamaContentAndImages(message.content).content,
          tool_calls: message.toolCalls.map((toolCall) => ({
            function: {
              name: toolCall.name,
              arguments: (toolCall.arguments ?? {}) as Record<string, unknown>,
            },
          })),
        };
      }
      if (typeof message.content === "string") {
        return { role: message.role, content: message.content };
      }
      const { content, images } = this.toOllamaContentAndImages(
        message.content
      );
      return {
        role: message.role,
        content,
        ...(images.length ? { images } : {}),
      };
    });
  }

  /**
   * Flattens a `ContentPart[]` into Ollama's `/api/chat` shape: text parts
   * (and any degraded placeholders) join into `content`; base64 image parts
   * collect into the sibling `images` array (no media-type field — Ollama's
   * local API convention). Ollama has no native support for image URLs or
   * documents of any kind — both degrade to a text placeholder with a
   * logged warning rather than crashing.
   */
  private toOllamaContentAndImages(content: ContentPart[]): {
    content: string;
    images: string[];
  } {
    const textPieces: string[] = [];
    const images: string[] = [];

    for (const part of content) {
      if (part.type === "text") {
        textPieces.push(part.text);
        continue;
      }
      if (part.type === "image") {
        if ("url" in part.image) {
          this.logger.warn(
            "Ollama's local /api/chat has no image-URL support — degrading to a text placeholder",
            { part }
          );
          textPieces.push(`[image: ${part.image.url}]`);
        } else {
          images.push(part.image.data);
        }
        continue;
      }
      // part.type === "document"
      this.logger.warn(
        "Ollama has no document content-part support — degrading to a text placeholder",
        { part }
      );
      textPieces.push(
        "url" in part.document
          ? `[document: ${part.document.url}]`
          : `[document attached: ${part.document.filename ?? part.document.mediaType}]`
      );
    }

    return { content: textPieces.join("\n"), images };
  }

  private toOllamaTool(tool: ToolDefinition): OllamaTool {
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    };
  }

  /**
   * Ollama has no tool_choice concept — "none" is honored by omitting tools
   * entirely; "auto"/"required"/named-tool all degrade to the model's own
   * judgment since there's no server-side way to force a call.
   */
  private resolveOllamaTools(
    tools: ToolDefinition[] | undefined,
    toolChoice: LLMGenerationOptions["toolChoice"]
  ): OllamaTool[] | undefined {
    if (!tools?.length || toolChoice === "none") return undefined;
    return tools.map((tool) => this.toOllamaTool(tool));
  }

  /**
   * Prefers Ollama's own `id`/`function.index` when present. Falling back
   * to the local array position (as we used to) breaks in streaming: when
   * a model emits multiple tool calls one-per-chunk, every chunk's array
   * has length 1, so a local index always resolves to 0 and collides.
   */
  private extractToolCalls(
    message: OllamaChatResponse["message"]
  ): ToolCall[] | undefined {
    const calls = message?.tool_calls;
    if (!calls?.length) return undefined;
    return calls.map((call, index) => ({
      id: call.id ?? `${call.function.name}_${call.function.index ?? index}`,
      name: call.function.name,
      arguments: call.function.arguments ?? {},
    }));
  }

  /**
   * Ollama has no numeric thinking budget (no equivalent of Anthropic's
   * `budget_tokens`/Gemini's `thinkingConfig`) — thinking and content share
   * the same `num_predict` pool, so an unbounded "thinking" phase can
   * consume the entire budget and leave zero tokens for content (observed:
   * done_reason "length" with empty content on a hybrid-reasoning model
   * like qwen3.5 with no maxTokens set). Nothing in this package surfaces
   * thinking text to callers either, so there's no upside to leaving it on
   * by default — `think` defaults to false and only turns on when the
   * caller explicitly opts in via a positive `thinkingBudget`.
   */
  private resolveThink(options: LLMGenerationOptions): boolean {
    return options.thinkingBudget !== undefined && options.thinkingBudget > 0;
  }

  /**
   * Ollama allocates its KV-cache per request sized by `num_ctx`, which
   * defaults (unset) to a small value — 2048-4096 depending on version —
   * regardless of what the model itself supports. That default is silent:
   * once prompt + output tokens hit it, generation stops early
   * (done_reason: "length") with no error, no matter how high
   * `num_predict`/maxTokens is set. Observed live: a real resume + job
   * description + JSON-schema prompt for ATS analysis was cut off mid-JSON
   * at ~360 output tokens even with maxTokens=8192, because the *context
   * window* — not the output budget — was the actual ceiling. Every
   * resume-builder prompt (resume + job description + schema) is well
   * past Ollama's tiny default, so a low num_ctx isn't a real constraint
   * worth respecting by default — it's a footgun.
   */
  private static readonly DEFAULT_NUM_CTX = 8192;

  /**
   * Sampling passthrough params supported inside Ollama's request `options`
   * object.
   */
  private toOllamaSamplingOptions(options: LLMGenerationOptions): {
    top_p?: number;
    top_k?: number;
    seed?: number;
    stop?: string[];
    frequency_penalty?: number;
    presence_penalty?: number;
    num_ctx: number;
  } {
    return {
      num_ctx: OllamaProvider.DEFAULT_NUM_CTX,
      ...(options.topP !== undefined ? { top_p: options.topP } : {}),
      ...(options.topK !== undefined ? { top_k: options.topK } : {}),
      ...(options.seed !== undefined ? { seed: options.seed } : {}),
      ...(options.stopSequences?.length ? { stop: options.stopSequences } : {}),
      ...(options.frequencyPenalty !== undefined
        ? { frequency_penalty: options.frequencyPenalty }
        : {}),
      ...(options.presencePenalty !== undefined
        ? { presence_penalty: options.presencePenalty }
        : {}),
    };
  }

  private async callOllama(
    messages: OllamaChatMessage[],
    model: string,
    options: {
      temperature?: number;
      maxTokens?: number;
      /** "json" for loose mode, or a JSON Schema object for Ollama's
       *  native grammar-constrained structured output (>=0.5). */
      format?: "json" | object;
      tools?: OllamaTool[];
      think?: boolean;
      sampling?: ReturnType<OllamaProvider["toOllamaSamplingOptions"]>;
      signal?: AbortSignal;
    } = {}
  ): Promise<OllamaChatResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: options.signal,
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        format: options.format,
        tools: options.tools,
        think: options.think,
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens,
          ...options.sampling,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw Object.assign(new Error(`Ollama API error: ${error}`), {
        status: response.status,
      });
    }

    return (await response.json()) as OllamaChatResponse;
  }

  /**
   * Build usage from Ollama's real eval counts when available, falling back
   * to the chars/4 estimate otherwise.
   */
  private usageFromOllama(
    counts: { prompt_eval_count?: number; eval_count?: number },
    inputPrompt: string,
    outputText: string,
    model: string,
    purpose: string
  ): LLMUsageInfo {
    if (
      counts.prompt_eval_count !== undefined &&
      counts.eval_count !== undefined
    ) {
      return {
        promptTokens: counts.prompt_eval_count,
        completionTokens: counts.eval_count,
        totalTokens: counts.prompt_eval_count + counts.eval_count,
        model,
        purpose,
        provider: this.providerType,
      };
    }
    return this.estimateTokenUsage({
      inputPrompt,
      outputText,
      model,
      purpose,
      provider: this.providerType,
    });
  }

  get streamSupported(): boolean {
    return true;
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
    if (options.stream === true) {
      return this.runStreamedLLM(messages, options);
    }

    const inputPrompt = messages
      .map((m) => contentToText(m.content))
      .join("\n\n");

    return this.withResilience(
      (signal) =>
        this.callOllama(this.toOllamaMessages(messages), options.model, {
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          tools: this.resolveOllamaTools(options.tools, options.toolChoice),
          think: this.resolveThink(options),
          sampling: this.toOllamaSamplingOptions(options),
          signal,
        }),
      {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        maxRetries: options.maxRetries,
      }
    )
      .then((data) => {
        const content = data.message?.content ?? "";
        const toolCalls = this.extractToolCalls(data.message);
        if (!content && !toolCalls) {
          throw new Error("No response from Ollama");
        }

        const usage = this.usageFromOllama(
          data,
          inputPrompt,
          content,
          options.model,
          "generate_text"
        );

        this.notifyUsage(usage, options.onUsage);

        return { result: content, toolCalls, usage };
      })
      .catch((err: unknown) => {
        this.logger.error("runLLM failed", { error: err });
        throw classifyProviderError(err, this.providerType);
      });
  }

  private async *runStreamedLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions
  ): AsyncGenerator<LLMStreamEvent> {
    const inputPrompt = messages
      .map((m) => contentToText(m.content))
      .join("\n\n");

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: options.signal,
      body: JSON.stringify({
        model: options.model,
        messages: this.toOllamaMessages(messages),
        stream: true,
        tools: this.resolveOllamaTools(options.tools, options.toolChoice),
        think: this.resolveThink(options),
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens,
          ...this.toOllamaSamplingOptions(options),
        },
      }),
    });

    if (!response.ok || !response.body) {
      const error = await response.text();
      throw Object.assign(new Error(`Ollama API error: ${error}`), {
        status: response.status,
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let outputText = "";
    let finalCounts: Pick<
      OllamaChatResponse,
      "prompt_eval_count" | "eval_count"
    > = {};

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk: OllamaChatResponse = JSON.parse(line);
        const text = chunk.message?.content;
        if (text) {
          outputText += text;
          yield { type: "text", delta: text };
        }
        for (const toolCall of this.extractToolCalls(chunk.message) ?? []) {
          yield { type: "tool_call", toolCall };
        }
        if (chunk.done) {
          finalCounts = {
            prompt_eval_count: chunk.prompt_eval_count,
            eval_count: chunk.eval_count,
          };
        }
      }
    }

    const usage = this.usageFromOllama(
      finalCounts,
      inputPrompt,
      outputText,
      options.model,
      "generate_text"
    );

    this.notifyUsage(usage, options.onUsage);
    yield { type: "usage", usage };
    yield { type: "done" };
  }

  async runStructuredLLM<TSchema extends z.ZodTypeAny>(
    template: ResolvedPrompt,
    options: LLMGenerationOptions,
    zodSchema: TSchema
  ): Promise<StructureResult<TSchema>> {
    const promptText = this.combinePromptText(template);
    const schemaJson = z.toJSONSchema(zodSchema);

    try {
      const data = await this.withResilience(
        (signal) =>
          this.callOllama(
            [{ role: "user", content: promptText }],
            options.model,
            {
              temperature: options.temperature,
              maxTokens: options.maxTokens,
              // Native grammar-constrained structured output (Ollama >=0.5)
              // — passing the JSON Schema directly guarantees the response
              // matches it, rather than format:"json" + hoping the model
              // follows a schema pasted into the prompt.
              format: schemaJson,
              think: this.resolveThink(options),
              sampling: this.toOllamaSamplingOptions(options),
              signal,
            }
          ),
        {
          signal: options.signal,
          timeoutMs: options.timeoutMs,
          maxRetries: options.maxRetries,
        }
      );

      const content = data.message?.content;
      if (!content) throw new Error("No response from Ollama");

      const result = zodSchema.parse(JSON.parse(content));
      const usage = this.usageFromOllama(
        data,
        promptText,
        content,
        options.model,
        template.purpose
      );

      this.notifyUsage(usage, options.onUsage);

      return { result, usage };
    } catch (err: unknown) {
      this.logger.error("runStructuredLLM failed", { error: err });
      throw classifyProviderError(err, this.providerType);
    }
  }

  async fetchModels(): Promise<string[]> {
    try {
      this.logger.debug("Fetching models from Ollama API");
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) throw new Error("Ollama API error");
      const data = await response.json();
      return data.models.map((model: OllamaModel) => model.name);
    } catch (error) {
      this.logger.warn("Ollama not available, falling back to default models", {
        error,
      });
      return ["llama2", "llama3", "mistral", "neural-chat"];
    }
  }

  protected getProviderName(): string {
    return "Ollama";
  }

  /**
   * Ollama's `/api/embed` endpoint accepts `input` as either a single
   * string or an array of strings and returns `{ embeddings: number[][] }`.
   * It doesn't reliably report real token usage the way `/api/chat` does —
   * `prompt_eval_count` is used when present, otherwise usage is estimated
   * from the input text (no completion tokens either way).
   */
  async embed(options: EmbeddingOptions): Promise<EmbeddingResult> {
    try {
      const response = await fetch(`${this.baseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: options.model,
          input: options.input,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw Object.assign(new Error(`Ollama API error: ${error}`), {
          status: response.status,
        });
      }

      const data = (await response.json()) as OllamaEmbedResponse;
      const embeddings = data.embeddings ?? [];

      const inputText =
        typeof options.input === "string"
          ? options.input
          : options.input.join("\n");

      const usage: LLMUsageInfo =
        data.prompt_eval_count !== undefined
          ? {
              promptTokens: data.prompt_eval_count,
              completionTokens: 0,
              totalTokens: data.prompt_eval_count,
              model: options.model,
              purpose: "embed",
              provider: this.providerType,
            }
          : this.estimateTokenUsage({
              inputPrompt: inputText,
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

  async validateConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      const modelCount = data.models?.length ?? 0;
      return {
        success: true,
        message: `Connected to Ollama successfully. Found ${modelCount} available models.`,
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
 * Register Ollama provider
 */
LLMProvider.register(
  BUILTIN_PROVIDERS.OLLAMA,
  {
    name: "Ollama",
    requiresAuth: false,
    isLocal: true,
    description:
      "Open-source tool for running LLMs locally on your own machine — no cloud, no data sharing, no API costs. Supports models like Llama 3, Mistral, Gemma, and many others via a simple CLI.",
  },
  (baseUrl, runtimeConfig) => new OllamaProvider(baseUrl, runtimeConfig)
);
