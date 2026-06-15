import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { createConsoleLogger } from "../logger";
import { ResolvedPrompt } from "../prompts/types";
import { BUILTIN_PROVIDERS, ProviderId } from "../providerType";
import { LLMUsageInfo } from "../tokens/usageTypes";
import {
  LLMGenerationOptions,
  LLMResult,
  PromptMessage,
  ToolDefinition,
} from "../types";
import { LLMProvider, StructureResult } from "./LLMProvider";

const logger = createConsoleLogger("Anthropic");
export class AnthropicProvider extends LLMProvider {
  public get providerType(): ProviderId {
    return BUILTIN_PROVIDERS.ANTHROPIC;
  }
  public get streamSupported(): boolean {
    return true;
  }

  validateConnection(): Promise<{ success: boolean; message: string }> {
    throw new Error("Method not implemented.");
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

  constructor(apiKey: string) {
    super();
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

  private toAnthropicRequest(
    messages: PromptMessage[],
    options: LLMGenerationOptions
  ): Anthropic.Messages.MessageCreateParams {
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n")
      .trim();

    const requestMessages = messages
      .filter((message) => message.role !== "system")
      .map((message): { role: "user" | "assistant"; content: string } => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
      }));

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
      return { type: "tool", name: tc.name } as const;
    })();

    return {
      model: options.model,
      max_tokens: options.maxTokens ?? 2048,
      messages: requestMessages,
      ...(system ? { system } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      tools: options.tools?.map((tool) => this.toClaudeTool(tool)),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      stream: !!options.stream,
    };
  }

  isResponseStream(
    result: unknown
  ): result is AsyncIterable<Anthropic.Messages.RawMessageStreamEvent> {
    return typeof result === "object" && result !== null && "choices" in result;
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
    if (options.stream === true) {
      return this.runStreamedLLM(messages, options);
    }
    const promptText = messages.map((message) => message.content).join("\n\n");

    return this.client.messages
      .create({ ...this.toAnthropicRequest(messages, options), stream: false })
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

        return {
          result: content,
          toolCalls,
          usage,
        };
      })
      .catch((err: unknown) => {
        const error = err as Record<string, unknown>;
        logger.error("runLLM failed", {
          error: err,
          message: error?.message,
        });
        throw new Error(
          `Anthropic runLLM failed: ${String(error?.message) || err}`
        );
      });
  }

  private async *runStreamedLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions
  ): AsyncGenerator<string> {
    const promptText = messages.map((message) => message.content).join("\n\n");
    const stream = this.client.messages.stream({
      ...this.toAnthropicRequest(messages, options),
    });
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
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield event.delta.text;
      }

      if (event.type === "message_delta") {
        finalUsage.output_tokens = event.usage.output_tokens;
        finalUsage.server_tool_use = event.usage.server_tool_use;
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
            inputPrompt: promptText,
            outputText: "",
            model: options.model,
            purpose: "generate_text",
            provider: this.providerType,
          })
    );
  }

  async runStructuredLLM<TSchema extends z.ZodType>(
    template: ResolvedPrompt,
    options: LLMGenerationOptions,
    zodSchema: TSchema,
    _schemaName?: string
  ): Promise<StructureResult<TSchema>> {
    const messages = this.toPromptMessages(template);
    const promptTextForEstimation = this.combinePromptText(template);

    const response = await this.client.messages.parse({
      ...this.toAnthropicRequest(messages, options),
      stream: false, // Structured parsing doesn't support streaming
      output_config: {
        format: zodOutputFormat(zodSchema),
      },
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      throw new Error("Failed to parse structured response from Anthropic");
    }

    const usage = response.usage
      ? this.normalizeUsage({
          usage: response.usage,
          model: options.model,
          purpose: "generate_text",
        })
      : this.estimateTokenUsage({
          inputPrompt: promptTextForEstimation,
          outputText: JSON.stringify(parsed),
          model: options.model,
          purpose: "generate_text",
          provider: this.providerType,
        });

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
  (apiKey?: string) => {
    if (!apiKey) {
      throw new Error("Anthropic API key is required");
    }
    return new AnthropicProvider(apiKey);
  }
);
