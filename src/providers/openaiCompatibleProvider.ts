/**
 * OpenAI-compatible provider base.
 * Hosts shared OpenAI client setup plus helpers for structured outputs and usage normalization
 * so OpenAI-like providers (OpenAI, Grok, Perplexity) avoid duplication.
 */
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { CompletionUsage } from "openai/resources/completions.mjs";

import { LLMProvider, StructureResult } from "./LLMProvider";
import { ResolvedPrompt } from "../prompts/types";
import { LLMUsageInfo } from "../tokens/usageTypes";

import type {
  LLMGenerationOptions,
  LLMResult,
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

  protected constructor(config: OpenAIClientConfig) {
    super();
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
      model,
      purpose,
    } satisfies LLMUsageInfo;
  }

  protected toChatMessages(
    messages: PromptMessage[]
  ): ChatCompletionMessageParam[] {
    return messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }

  isResponseStream(
    result: unknown
  ): result is AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> {
    return typeof result === "object" && result !== null && "choices" in result;
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
    const model = options.model;
    const temperature = this.resolveTemperature(model, options.temperature);

    if (options.stream === true) {
      return this.runStreamedLLM(messages, options);
    }

    return this.client.chat.completions
      .create({
        model,
        messages: this.toChatMessages(messages),
        temperature,
        ...this.resolveTokenParam(model, options.maxTokens),
        tools: options.tools?.map((tool) => this.toOpenAITool(tool)),
      })
      .then((completion) => {
        const content = completion.choices[0]?.message?.content ?? "";
        let toolCall: OpenAIMessageTool | undefined = undefined;

        if (
          completion.choices[0]?.message?.tool_calls?.[0]?.type === "function"
        ) {
          toolCall = completion.choices[0]?.message?.tool_calls?.[0];
        }
        const usage = completion.usage
          ? this.normalizeUsage(completion.usage, model, "generate_text")
          : this.estimateTokenUsage({
              inputPrompt: messages.map((m) => m.content).join("\n"),
              outputText: content,
              model,
              purpose: "generate_text",
              provider: this.providerType,
            });

        return {
          result: content,
          toolCalls: toolCall ? [this.fromOpenAIToolCall(toolCall)] : undefined,
          usage,
        };
      })
      .catch((err: unknown) => {
        const error =
          err instanceof Error
            ? err
            : new Error(`OpenAI-compatible runLLM failed: ${String(err)}`);

        throw error;
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
  ): AsyncGenerator<string> {
    const model = options.model;
    const temperature = this.resolveTemperature(model, options.temperature);

    const stream = this.client.chat.completions.stream({
      model,
      messages: this.toChatMessages(messages),
      temperature,
      ...this.resolveTokenParam(model, options.maxTokens),
      tools: options.tools?.map((tool) => this.toOpenAITool(tool)),
      stream_options: { include_usage: true },
    });

    let finalUsage: OpenAI.CompletionUsage | undefined;
    let outputText = "";

    for await (const part of stream) {
      if (part.usage) finalUsage = part.usage;
      const chunk = part.choices[0]?.delta?.content;
      if (chunk) {
        outputText += chunk;
        yield chunk;
      }
    }

    options.onUsage?.(
      finalUsage
        ? this.normalizeUsage(finalUsage, model, "generate_text")
        : this.estimateTokenUsage({
            inputPrompt: messages.map((m) => m.content).join("\n"),
            outputText,
            model,
            purpose: "generate_text",
            provider: this.providerType,
          })
    );
  }

  async runStructuredLLM<TSchema extends ZodTypeAny>(
    template: ResolvedPrompt,
    options: LLMGenerationOptions,
    zodSchema: TSchema,
    schemaName: string
  ): Promise<StructureResult<TSchema>> {
    const messages = this.toPromptMessages(template);
    const promptTextForEstimation = this.combinePromptText(template);

    const completion = await this.client.chat.completions.parse({
      model: options.model,
      messages: this.toChatMessages(messages),
      response_format: zodResponseFormat(zodSchema, schemaName),
      temperature: this.resolveTemperature(options.model, options.temperature),
      ...this.resolveTokenParam(options.model, options.maxTokens),
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
            messages.map((m) => m.content).join("\n"),
          outputText: JSON.stringify(parsed),
          model: options.model,
          purpose: template.purpose,
          provider: this.providerType,
        });

    return { result: parsed, usage };
  }

  toOpenAITool(tool: ToolDefinition): OpenAITool {
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        strict: tool.strict ?? false,
        parameters: {
          ...tool.parameters,
          additionalProperties: tool.strict ? false : undefined,
        },
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
