/**
 * OpenAI-compatible provider base.
 * Hosts shared OpenAI client setup plus helpers for structured outputs and usage normalization
 * so OpenAI-like providers (OpenAI, Grok, Perplexity) avoid duplication.
 */
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { CompletionUsage } from "openai/resources/completions.mjs";

import { LLMProvider, StructureResult } from "./LLMProvider";
import { ProviderRuntimeConfig } from "../config";
import { classifyProviderError } from "../errors";
import { Logger } from "../logger";
import { ResolvedPrompt } from "../prompts/types";
import { LLMUsageInfo } from "../tokens/usageTypes";
import { contentToText } from "../types";

import type {
  ContentPart,
  LLMGenerationOptions,
  LLMResult,
  LLMStreamEvent,
  PromptMessage,
  ToolCall,
  ToolDefinition,
} from "../types";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ZodTypeAny } from "zod";

export type OpenAIClientConfig = {
  apiKey: string;
  baseURL?: string;
};

export type OpenAITool = OpenAI.Chat.Completions.ChatCompletionTool;
export type OpenAIMessageTool =
  OpenAI.Chat.Completions.ChatCompletionMessageToolCall;

export abstract class OpenAICompatibleProvider extends LLMProvider {
  protected readonly client: OpenAI;

  protected constructor(
    config: OpenAIClientConfig,
    runtimeConfig?: ProviderRuntimeConfig,
    fallbackLogger?: Logger
  ) {
    super(runtimeConfig, fallbackLogger);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      dangerouslyAllowBrowser: true,
    });
  }

  get streamSupported(): boolean {
    return true;
  }

  protected normalizeUsage(
    usage: CompletionUsage,
    model: string,
    purpose: string = "generate_text"
  ): LLMUsageInfo {
    return {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      provider: this.providerType,
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
      cacheReadTokens: usage.prompt_tokens_details?.cached_tokens,
      model,
      purpose,
    } satisfies LLMUsageInfo;
  }

  protected toChatMessages(
    messages: PromptMessage[]
  ): ChatCompletionMessageParam[] {
    return messages.map((message): ChatCompletionMessageParam => {
      if (message.role === "tool") {
        return {
          role: "tool",
          content: message.content,
          tool_call_id: message.toolCallId,
        };
      }
      if (message.role === "assistant" && message.toolCalls?.length) {
        return {
          role: "assistant",
          content: this.toOpenAIAssistantContent(message.content),
          tool_calls: message.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }
      if (message.role === "user") {
        return {
          role: "user",
          content: this.toOpenAIUserContent(message.content),
        };
      }
      if (message.role === "assistant") {
        return {
          role: "assistant",
          content: this.toOpenAIAssistantContent(message.content),
        };
      }
      return { role: message.role, content: message.content };
    });
  }

  /**
   * Maps a `user` message's content to the chat-completions multi-part
   * shape. Images map natively to `image_url` (accepting both a URL part
   * and a base64 `data`+`mediaType` part, built into a `data:` URL).
   * Documents have no generic content-part in this SDK's stable chat-
   * completions types — degrade to a `text` part carrying the URL (or a
   * generic placeholder for base64 documents) and log a warning rather
   * than crash.
   */
  private toOpenAIUserContent(
    content: string | ContentPart[]
  ): OpenAI.Chat.Completions.ChatCompletionUserMessageParam["content"] {
    if (typeof content === "string") return content;
    return content.map(
      (part): OpenAI.Chat.Completions.ChatCompletionContentPart => {
        if (part.type === "text") {
          return { type: "text", text: part.text };
        }
        if (part.type === "image") {
          const url =
            "url" in part.image
              ? part.image.url
              : `data:${part.image.mediaType};base64,${part.image.data}`;
          return { type: "image_url", image_url: { url } };
        }
        // part.type === "document"
        this.logger.warn(
          "OpenAI-compatible chat-completions has no generic document content part in this SDK's stable types — degrading to a text placeholder",
          { part }
        );
        const text =
          "url" in part.document
            ? `[document: ${part.document.url}]`
            : `[document attached: ${part.document.filename ?? part.document.mediaType}]`;
        return { type: "text", text };
      }
    );
  }

  /**
   * Assistant message content only supports `text`/`refusal` parts in the
   * chat-completions dialect — image/document parts can't be echoed back as
   * assistant content, so they degrade to a text placeholder with a warning.
   */
  private toOpenAIAssistantContent(
    content: string | ContentPart[]
  ): OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam["content"] {
    if (typeof content === "string") return content;
    return content.map((part) => {
      if (part.type === "text") {
        return { type: "text" as const, text: part.text };
      }
      this.logger.warn(
        "OpenAI-compatible assistant messages only support text content parts — degrading non-text part to a placeholder",
        { part }
      );
      return {
        type: "text" as const,
        text: part.type === "image" ? "[image]" : "[document]",
      };
    });
  }

  /**
   * Some OpenAI models (o1, o3, o4 reasoning series) require `max_completion_tokens`
   * instead of the legacy `max_tokens` parameter.
   */
  protected resolveTokenParam(
    model: string,
    maxTokens: number | undefined
  ): { max_completion_tokens?: number } | { max_tokens?: number } {
    if (/^o\d/i.test(model)) {
      return { max_completion_tokens: maxTokens };
    }
    return { max_tokens: maxTokens };
  }

  /**
   * Sampling/reasoning passthrough params supported by the OpenAI
   * chat-completions dialect. `reasoning_effort` is only meaningful for
   * reasoning models — sent whenever provided and left to the API to
   * reject if misused on a non-reasoning model, per Cluster A's spec.
   */
  protected toOpenAISamplingParams(options: LLMGenerationOptions): {
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    seed?: number;
    stop?: string[];
    reasoning_effort?: OpenAI.Chat.Completions.ChatCompletionCreateParams["reasoning_effort"];
  } {
    return {
      ...(options.topP !== undefined ? { top_p: options.topP } : {}),
      ...(options.frequencyPenalty !== undefined
        ? { frequency_penalty: options.frequencyPenalty }
        : {}),
      ...(options.presencePenalty !== undefined
        ? { presence_penalty: options.presencePenalty }
        : {}),
      ...(options.seed !== undefined ? { seed: options.seed } : {}),
      ...(options.stopSequences?.length ? { stop: options.stopSequences } : {}),
      ...(options.reasoningEffort !== undefined
        ? { reasoning_effort: options.reasoningEffort }
        : {}),
    };
  }

  /**
   * Extension hook for subclasses to surface provider-specific fields off
   * the raw chat-completion response (e.g. Perplexity's `citations` /
   * `search_results`) without widening this base class's contract. Default
   * is a no-op so OpenAI/Grok are unaffected. Only wired into the
   * non-streaming `runLLM` path — streaming citation deltas are out of
   * scope for now.
   */
  protected extractExtraResultFields(_completion: unknown): Partial<LLMResult> {
    return {};
  }

  protected toOpenAIToolChoice(
    toolChoice: LLMGenerationOptions["toolChoice"],
    hasTools: boolean
  ): OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined {
    if (!toolChoice || !hasTools) return undefined;
    if (
      toolChoice === "auto" ||
      toolChoice === "none" ||
      toolChoice === "required"
    )
      return toolChoice;
    return { type: "function", function: { name: toolChoice.name } };
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
    const model = options.model;
    const temperature = this.resolveTemperature(model, options.temperature);

    if (options.stream === true) {
      return this.runStreamedLLM(messages, options);
    }

    return this.withResilience(
      (signal) =>
        this.client.chat.completions.create(
          {
            model,
            messages: this.toChatMessages(messages),
            temperature,
            ...this.resolveTokenParam(model, options.maxTokens),
            ...this.toOpenAISamplingParams(options),
            tools: options.tools?.map((tool) => this.toOpenAITool(tool)),
            tool_choice: this.toOpenAIToolChoice(
              options.toolChoice,
              Boolean(options.tools?.length)
            ),
          },
          { signal }
        ),
      {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        maxRetries: options.maxRetries,
      }
    )
      .then((completion) => {
        const content = completion.choices[0]?.message?.content ?? "";
        const rawToolCalls = completion.choices[0]?.message?.tool_calls?.filter(
          (tc): tc is OpenAIMessageTool => tc.type === "function"
        );

        const usage = completion.usage
          ? this.normalizeUsage(completion.usage, model, "generate_text")
          : this.estimateTokenUsage({
              inputPrompt: messages
                .map((m) => contentToText(m.content))
                .join("\n"),
              outputText: content,
              model,
              purpose: "generate_text",
              provider: this.providerType,
            });

        this.notifyUsage(usage, options.onUsage);

        return {
          result: content,
          toolCalls: rawToolCalls?.length
            ? rawToolCalls.map((tc) => this.fromOpenAIToolCall(tc))
            : undefined,
          usage,
          ...this.extractExtraResultFields(completion),
        };
      })
      .catch((err: unknown) => {
        throw classifyProviderError(err, this.providerType);
      });
  }

  fromOpenAIToolCall(raw: OpenAIMessageTool): ToolCall {
    if (raw.type !== "function")
      throw new Error(`Unexpected tool call type: ${raw.type}`);

    return {
      id: raw.id,
      name: raw.function.name,
      arguments: JSON.parse(raw.function.arguments),
    };
  }

  private async *runStreamedLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions
  ): AsyncGenerator<LLMStreamEvent> {
    const model = options.model;
    const temperature = this.resolveTemperature(model, options.temperature);

    const stream = this.client.chat.completions.stream(
      {
        model,
        messages: this.toChatMessages(messages),
        temperature,
        ...this.resolveTokenParam(model, options.maxTokens),
        ...this.toOpenAISamplingParams(options),
        tools: options.tools?.map((tool) => this.toOpenAITool(tool)),
        tool_choice: this.toOpenAIToolChoice(
          options.toolChoice,
          Boolean(options.tools?.length)
        ),
        stream_options: { include_usage: true },
      },
      options.signal ? { signal: options.signal } : undefined
    );

    let finalUsage: OpenAI.CompletionUsage | undefined;
    let outputText = "";
    // Tool call arguments arrive as incremental JSON-string fragments keyed
    // by the delta's `index`; accumulate until the stream ends.
    const toolCallsByIndex = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    for await (const part of stream) {
      if (part.usage) finalUsage = part.usage;
      const delta = part.choices[0]?.delta;

      const text = delta?.content;
      if (text) {
        outputText += text;
        yield { type: "text", delta: text };
      }

      for (const toolCallDelta of delta?.tool_calls ?? []) {
        const existing = toolCallsByIndex.get(toolCallDelta.index);
        const entry = existing ?? { id: "", name: "", arguments: "" };
        if (toolCallDelta.id) entry.id = toolCallDelta.id;
        if (toolCallDelta.function?.name)
          entry.name = toolCallDelta.function.name;
        if (toolCallDelta.function?.arguments)
          entry.arguments += toolCallDelta.function.arguments;
        toolCallsByIndex.set(toolCallDelta.index, entry);
      }
    }

    for (const toolCall of toolCallsByIndex.values()) {
      yield {
        type: "tool_call",
        toolCall: {
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments ? JSON.parse(toolCall.arguments) : {},
        },
      };
    }

    const usage = finalUsage
      ? this.normalizeUsage(finalUsage, model, "generate_text")
      : this.estimateTokenUsage({
          inputPrompt: messages.map((m) => contentToText(m.content)).join("\n"),
          outputText,
          model,
          purpose: "generate_text",
          provider: this.providerType,
        });

    this.notifyUsage(usage, options.onUsage);
    yield { type: "usage", usage };
    yield { type: "done" };
  }

  async runStructuredLLM<TSchema extends ZodTypeAny>(
    template: ResolvedPrompt,
    options: LLMGenerationOptions,
    zodSchema: TSchema,
    schemaName: string
  ): Promise<StructureResult<TSchema>> {
    const messages = this.toPromptMessages(template);
    const promptTextForEstimation = this.combinePromptText(template);

    const completion = await this.withResilience(
      (signal) =>
        this.client.chat.completions.parse(
          {
            model: options.model,
            messages: this.toChatMessages(messages),
            response_format: zodResponseFormat(zodSchema, schemaName),
            temperature: this.resolveTemperature(
              options.model,
              options.temperature
            ),
            ...this.resolveTokenParam(options.model, options.maxTokens),
            ...this.toOpenAISamplingParams(options),
          },
          { signal }
        ),
      {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        maxRetries: options.maxRetries,
      }
    ).catch((err: unknown) => {
      throw classifyProviderError(err, this.providerType);
    });

    const parsed = completion.choices[0]?.message?.parsed;

    if (!parsed) {
      throw new Error("Failed to parse structured response");
    }

    const usage = completion.usage
      ? this.normalizeUsage(completion.usage, options.model, template.purpose)
      : this.estimateTokenUsage({
          inputPrompt:
            promptTextForEstimation ??
            messages.map((m) => contentToText(m.content)).join("\n"),
          outputText: JSON.stringify(parsed),
          model: options.model,
          purpose: template.purpose,
          provider: this.providerType,
        });

    this.notifyUsage(usage, options.onUsage);

    return { result: parsed, usage };
  }

  toOpenAITool(tool: ToolDefinition): OpenAITool {
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        strict: tool.strict ?? false,
        parameters: tool.strict
          ? { ...tool.parameters, additionalProperties: false }
          : tool.parameters,
      },
    };
  }
  /**
   * Validate connection by making a simple API call
   */
  async validateConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const result = await this.fetchModels();
      const modelCount = result.length;
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
