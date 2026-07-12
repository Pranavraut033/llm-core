import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { ProviderRuntimeConfig } from "../config";
import { classifyProviderError } from "../errors";
import { createConsoleLogger } from "../logger";
import { ResolvedPrompt } from "../prompts/types";
import { BUILTIN_PROVIDERS, ProviderId } from "../providerType";
import { LLMUsageInfo } from "../tokens/usageTypes";
import {
  ContentPart,
  contentToText,
  LLMGenerationOptions,
  LLMResult,
  LLMStreamEvent,
  PromptMessage,
  ToolDefinition,
} from "../types";
import { LLMProvider, StructureResult } from "./LLMProvider";

export class AnthropicProvider extends LLMProvider {
  public get providerType(): ProviderId {
    return BUILTIN_PROVIDERS.ANTHROPIC;
  }
  public get streamSupported(): boolean {
    return true;
  }

  async validateConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const models = await this.fetchModels();
      return {
        success: true,
        message: `Connected successfully. Found ${models.length} available models.`,
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

  // In your Claude adapter
  private toClaudeTool(tool: ToolDefinition): Anthropic.Tool {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: {
        ...tool.parameters,
        type: "object",
      } satisfies Anthropic.Tool["input_schema"],
    };
  }

  private client: Anthropic;

  constructor(apiKey: string, runtimeConfig?: ProviderRuntimeConfig) {
    super(runtimeConfig, createConsoleLogger("Anthropic"));
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  }

  private extractTextResponse(response: unknown): string {
    if (!response || typeof response !== "object") return "";

    const content = (response as { content?: unknown }).content;
    if (!Array.isArray(content)) return "";

    return content
      .map((block) => {
        if (!block || typeof block !== "object") return "";
        const text = (block as { type?: string; text?: unknown }).text;
        const type = (block as { type?: string }).type;
        return type === "text" && typeof text === "string" ? text : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  private extractToolCalls(
    response: Anthropic.Message
  ): import("../types").ToolCall[] | undefined {
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );
    if (toolUseBlocks.length === 0) return undefined;
    return toolUseBlocks.map((block) => ({
      id: block.id,
      name: block.name,
      arguments: block.input as Record<string, unknown>,
    }));
  }

  private normalizeUsage({
    usage,
    model,
    purpose,
  }: {
    usage: Anthropic.Usage;
    model: string;
    purpose: string;
  }): LLMUsageInfo {
    return {
      promptTokens: usage.input_tokens,
      cacheCreationTokens: usage.cache_creation_input_tokens ?? undefined,
      cacheReadTokens: usage.cache_read_input_tokens ?? undefined,
      completionTokens: usage.output_tokens,
      totalTokens: usage.input_tokens + usage.output_tokens,
      provider: this.providerType,
      model,
      purpose,
    } satisfies LLMUsageInfo;
  }

  /**
   * Maps a multimodal `content` array to Anthropic content blocks. Images
   * map to `image` blocks (base64 or URL source); documents map natively to
   * Anthropic's `document` blocks (Anthropic supports PDF documents, unlike
   * the other three providers). Plain-string content bypasses this entirely
   * — callers keep passing `content` through as-is for the string case, so
   * existing string-content requests are byte-for-byte unchanged.
   */
  private toAnthropicContentBlocks(
    content: ContentPart[]
  ): Anthropic.Messages.ContentBlockParam[] {
    return content.map((part) => this.toAnthropicContentBlock(part));
  }

  private toAnthropicContentBlock(
    part: ContentPart
  ): Anthropic.Messages.ContentBlockParam {
    if (part.type === "text") {
      return { type: "text", text: part.text };
    }
    if (part.type === "image") {
      const source: Anthropic.Messages.ImageBlockParam["source"] =
        "url" in part.image
          ? { type: "url", url: part.image.url }
          : {
              type: "base64",
              media_type: part.image
                .mediaType as Anthropic.Messages.Base64ImageSource["media_type"],
              data: part.image.data,
            };
      return { type: "image", source };
    }
    // part.type === "document"
    const source: Anthropic.Messages.DocumentBlockParam["source"] =
      "url" in part.document
        ? { type: "url", url: part.document.url }
        : {
            type: "base64",
            media_type: "application/pdf",
            data: part.document.data,
          };
    return { type: "document", source };
  }

  protected toAnthropicRequest(
    messages: PromptMessage[],
    options: LLMGenerationOptions
  ): Anthropic.Messages.MessageCreateParams {
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n")
      .trim();

    const requestMessages: Anthropic.Messages.MessageParam[] = [];

    for (const message of messages) {
      if (message.role === "system") continue;

      if (message.role === "tool") {
        const block: Anthropic.Messages.ToolResultBlockParam = {
          type: "tool_result",
          tool_use_id: message.toolCallId,
          content: message.content,
        };
        const last = requestMessages[requestMessages.length - 1];
        if (last?.role === "user" && Array.isArray(last.content)) {
          last.content.push(block);
        } else {
          requestMessages.push({ role: "user", content: [block] });
        }
        continue;
      }

      if (message.role === "assistant" && message.toolCalls?.length) {
        const blocks: Anthropic.Messages.ContentBlockParam[] = [];
        if (typeof message.content === "string") {
          if (message.content)
            blocks.push({ type: "text", text: message.content });
        } else {
          blocks.push(...this.toAnthropicContentBlocks(message.content));
        }
        for (const toolCall of message.toolCalls) {
          blocks.push({
            type: "tool_use",
            id: toolCall.id,
            name: toolCall.name,
            input: (toolCall.arguments ?? {}) as Record<string, unknown>,
          });
        }
        requestMessages.push({ role: "assistant", content: blocks });
        continue;
      }

      requestMessages.push({
        role: message.role === "assistant" ? "assistant" : "user",
        content:
          typeof message.content === "string"
            ? message.content
            : this.toAnthropicContentBlocks(message.content),
      });
    }

    if (requestMessages.length === 0) {
      requestMessages.push({
        role: "user",
        content: "Please follow the system instructions.",
      });
    }

    const temperature = this.resolveTemperature(
      options.model,
      options.temperature
    );

    const toolChoice = (() => {
      const tc = options.toolChoice;
      if (!tc || !options.tools?.length) return undefined;
      if (tc === "none") return { type: "none" } as const;
      if (tc === "auto") return { type: "auto" } as const;
      if (tc === "required") return { type: "any" } as const;
      return { type: "tool", name: tc.name } as const;
    })();

    // Prompt caching: stamp `cache_control: {type:"ephemeral"}` on the
    // system prompt and/or the last tool definition when opted in. `true`
    // caches both breakpoints; "system"/"tools" caches only that one.
    const cacheSystem =
      options.cacheControl === true || options.cacheControl === "system";
    const cacheTools =
      options.cacheControl === true || options.cacheControl === "tools";

    const systemParam:
      | string
      | Anthropic.Messages.TextBlockParam[]
      | undefined = system
      ? cacheSystem
        ? [
            {
              type: "text",
              text: system,
              cache_control: { type: "ephemeral" },
            },
          ]
        : system
      : undefined;

    const tools = options.tools?.map((tool) => this.toClaudeTool(tool));
    if (cacheTools && tools && tools.length > 0) {
      tools[tools.length - 1] = {
        ...tools[tools.length - 1],
        cache_control: { type: "ephemeral" },
      };
    }

    return {
      model: options.model,
      max_tokens: options.maxTokens ?? 2048,
      messages: requestMessages,
      ...(systemParam !== undefined ? { system: systemParam } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(options.topP !== undefined ? { top_p: options.topP } : {}),
      ...(options.topK !== undefined ? { top_k: options.topK } : {}),
      ...(options.stopSequences?.length
        ? { stop_sequences: options.stopSequences }
        : {}),
      ...(options.thinkingBudget !== undefined
        ? {
            thinking: {
              type: "enabled" as const,
              budget_tokens: options.thinkingBudget,
            },
          }
        : {}),
      tools,
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      stream: !!options.stream,
    };
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
    const promptText = messages
      .map((message) => contentToText(message.content))
      .join("\n\n");

    return this.withResilience(
      (signal) =>
        this.client.messages.create(
          { ...this.toAnthropicRequest(messages, options), stream: false },
          { signal }
        ),
      {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        maxRetries: options.maxRetries,
      }
    )
      .then((response) => {
        const content = this.extractTextResponse(response);
        const toolCalls = this.extractToolCalls(response);
        const usage = response.usage
          ? this.normalizeUsage({
              usage: response.usage,
              model: options.model,
              purpose: "generate_text",
            })
          : this.estimateTokenUsage({
              inputPrompt: promptText,
              outputText: content,
              model: options.model,
              purpose: "generate_text",
              provider: this.providerType,
            });

        this.notifyUsage(usage, options.onUsage);

        return {
          result: content,
          toolCalls,
          usage,
        };
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
    const stream = this.client.messages.stream(
      {
        ...this.toAnthropicRequest(messages, options),
      },
      options.signal ? { signal: options.signal } : undefined
    );
    const finalUsage: Anthropic.Messages.Usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      server_tool_use: null,
      service_tier: null,
    };

    // Tool-use blocks stream in as `content_block_start` (id/name) followed
    // by `content_block_delta` input_json_delta fragments, keyed by index.
    const toolUseByIndex = new Map<
      number,
      { id: string; name: string; json: string }
    >();

    for await (const event of stream) {
      if (event.type === "message_start") {
        finalUsage.input_tokens = event.message.usage.input_tokens;
        finalUsage.cache_creation = event.message.usage.cache_creation;
        finalUsage.cache_creation_input_tokens =
          event.message.usage.cache_creation_input_tokens;
        finalUsage.cache_read_input_tokens =
          event.message.usage.cache_read_input_tokens;
        finalUsage.inference_geo = event.message.usage.inference_geo;
        finalUsage.server_tool_use = event.message.usage.server_tool_use;
        finalUsage.service_tier = event.message.usage.service_tier;
      }

      if (
        event.type === "content_block_start" &&
        event.content_block.type === "tool_use"
      ) {
        toolUseByIndex.set(event.index, {
          id: event.content_block.id,
          name: event.content_block.name,
          json: "",
        });
      }

      if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          yield { type: "text", delta: event.delta.text };
        }
        if (event.delta.type === "input_json_delta") {
          const entry = toolUseByIndex.get(event.index);
          if (entry) entry.json += event.delta.partial_json;
        }
      }

      if (event.type === "content_block_stop") {
        const entry = toolUseByIndex.get(event.index);
        if (entry) {
          yield {
            type: "tool_call",
            toolCall: {
              id: entry.id,
              name: entry.name,
              arguments: entry.json ? JSON.parse(entry.json) : {},
            },
          };
          toolUseByIndex.delete(event.index);
        }
      }

      if (event.type === "message_delta") {
        finalUsage.output_tokens = event.usage.output_tokens;
        finalUsage.server_tool_use = event.usage.server_tool_use;
      }
    }

    const usage = this.normalizeUsage({
      usage: finalUsage,
      model: options.model,
      purpose: "generate_text",
    });

    this.notifyUsage(usage, options.onUsage);
    yield { type: "usage", usage };
    yield { type: "done" };
  }

  async runStructuredLLM<TSchema extends z.ZodType>(
    template: ResolvedPrompt,
    options: LLMGenerationOptions,
    zodSchema: TSchema,
    _schemaName?: string
  ): Promise<StructureResult<TSchema>> {
    const messages = this.toPromptMessages(template);
    const promptTextForEstimation = this.combinePromptText(template);

    const response = await this.withResilience(
      (signal) =>
        this.client.messages.parse(
          {
            ...this.toAnthropicRequest(messages, options),
            stream: false, // Structured parsing doesn't support streaming
            output_config: {
              format: zodOutputFormat(zodSchema),
            },
          },
          { signal }
        ),
      {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        maxRetries: options.maxRetries,
      }
    ).catch((err: unknown) => {
      this.logger.error("runStructuredLLM failed", { error: err });
      throw classifyProviderError(err, this.providerType);
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      throw new Error("Failed to parse structured response from Anthropic");
    }

    const usage = response.usage
      ? this.normalizeUsage({
          usage: response.usage,
          model: options.model,
          purpose: template.purpose,
        })
      : this.estimateTokenUsage({
          inputPrompt: promptTextForEstimation,
          outputText: JSON.stringify(parsed),
          model: options.model,
          purpose: template.purpose,
          provider: this.providerType,
        });

    this.notifyUsage(usage, options.onUsage);

    return {
      result: parsed,
      usage,
    };
  }

  async fetchModels(): Promise<string[]> {
    const response = await this.client.models.list();
    const data = response.data;

    return data.map((model) => model.id);
  }

  protected getProviderName(): string {
    return "Anthropic";
  }
}

/**
 * Register Anthropic provider
 */
LLMProvider.register(
  BUILTIN_PROVIDERS.ANTHROPIC,
  {
    name: "Anthropic (Claude)",
    requiresAuth: true,
    description:
      "Safety-focused AI lab behind Claude, emphasizing Constitutional AI and responsible deployment. Current models include Claude Opus 4.6 and Sonnet 4.6 — strong at reasoning, coding, and nuanced writing.",
  },
  (apiKey?: string, runtimeConfig?: ProviderRuntimeConfig) => {
    if (!apiKey) {
      throw new Error("Anthropic API key is required");
    }
    return new AnthropicProvider(apiKey, runtimeConfig);
  }
);
