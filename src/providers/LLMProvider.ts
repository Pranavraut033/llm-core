/**
 * Base LLM Provider with shared plumbing for streaming/non-streaming
 * completions, structured (Zod) output, token usage estimation, and
 * temperature resolution.
 *
 * Providers should register themselves using the static register() method
 * to allow dynamic provider discovery and instantiation.
 */
import z, { ZodTypeAny } from "zod";

import { ResolvedPrompt } from "../prompts/types";
import { ProviderId } from "../providerType";
import { LLMUsageInfo } from "../tokens/usageTypes";
import { LLMGenerationOptions, LLMResult, PromptMessage } from "../types";
import { ProviderRegistry, ProviderMetadata } from "./registry";

export type StructureResult<TSchema extends ZodTypeAny> = {
  result: z.infer<TSchema>;
  usage: LLMUsageInfo;
};

export abstract class LLMProvider {
  abstract get providerType(): ProviderId;
  abstract get streamSupported(): boolean;

  abstract fetchModels(): Promise<string[]>;
  abstract validateConnection(): Promise<{ success: boolean; message: string }>;

  abstract runLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions & { stream: true }
  ): AsyncGenerator<string>;

  abstract runLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions & { stream?: false; onUsage?: never }
  ): Promise<LLMResult<string>>;

  abstract runLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions
  ): Promise<LLMResult<string>> | AsyncGenerator<string>;

  abstract runStructuredLLM<TSchema extends ZodTypeAny>(
    template: ResolvedPrompt,
    options: LLMGenerationOptions,
    zodSchema: TSchema,
    schemaName: string
  ): Promise<StructureResult<TSchema>>;

  /**
   * Returns 0.7 for standard chat models and undefined for reasoning models
   * or unsupported providers to avoid API parameter errors.
   * * Supported Providers: OpenAI, xAI (Grok), Gemini, Perplexity (Sonar).
   */
  getDefaultTemperature(modelId: string): number | undefined {
    if (!modelId || typeof modelId !== "string") return undefined;

    const m = modelId.toLowerCase();

    // 1. PROVIDER CHECK
    // Ensures we only return values for your specific requested stack.
    const isSupportedProvider = /gpt|o1|o3|o4|gemini|grok|sonar|pplx/.test(m);
    if (!isSupportedProvider) return undefined;

    // 2. REASONING MODEL EXCLUSIONS (The "No-Temperature" Zone)
    // These models in 2026 either error out or ignore temperature entirely.

    // OpenAI: o1, o3, o4 series AND the gpt-5 reasoning family (except 'chat' variants)
    const isOpenAIReasoning = /^(o1|o3|o4|gpt-5(?!.*-chat))/.test(m);

    // xAI: Grok-4 reasoning and specialized logic variants
    const isGrokReasoning = m.includes("grok") && m.includes("reasoning");

    // Perplexity: Sonar reasoning and Deep Research models
    const isSonarReasoning =
      m.includes("sonar") &&
      (m.includes("reasoning") || m.includes("research"));

    // Gemini: Thinking/Reasoning modes
    const isGeminiThinking = m.includes("gemini") && m.includes("thinking");

    if (
      isOpenAIReasoning ||
      isGrokReasoning ||
      isSonarReasoning ||
      isGeminiThinking
    ) {
      return undefined;
    }

    // 3. DEFAULT FOR STANDARD MODELS
    // Returns 0.7 for gpt-4o, gpt-5-chat-latest, grok-3, gemini-2.0-flash, sonar-pro, etc.
    return 0.7;
  }

  /**
   * Helper to only include temperature when the model supports it.
   */
  protected getTemperatureConfig(
    modelId?: string,
    temperature?: number
  ): { temperature?: number } {
    const resolved = this.resolveTemperature(modelId ?? "", temperature);
    return resolved === undefined ? {} : { temperature: resolved };
  }

  generateText(
    systemPrompt: string,
    userPrompt: string,
    options: LLMGenerationOptions & { stream: true }
  ): AsyncGenerator<string>;

  generateText(
    systemPrompt: string,
    userPrompt: string,
    options: LLMGenerationOptions & { stream?: false; onUsage?: never }
  ): Promise<LLMResult<string>>;

  /**
   * Generate text from system and user prompts
   * Default implementation uses runPrompt - override for custom behavior
   */
  generateText(
    systemPrompt: string,
    userPrompt: string,
    options: LLMGenerationOptions
  ): Promise<LLMResult<string>> | AsyncGenerator<string> {
    // Default implementation using runPrompt - providers can override
    return this.runLLM(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      {
        ...options,
        ...this.getTemperatureConfig(options.model, options.temperature),
      }
    );
  }

  /**
   * Normalize token usage from provider-specific format to LLMUsageInfo
   */
  protected estimateTokenUsage({
    inputPrompt,
    outputText,
    model,
    purpose,
    provider,
  }: {
    inputPrompt: string;
    outputText: string;
    model: string;
    purpose?: string;
    provider: ProviderId;
  }): LLMUsageInfo {
    const inputTokens = inputPrompt ? Math.ceil(inputPrompt.length / 4) : 0;
    const outputTokens = outputText ? Math.ceil(outputText.length / 4) : 0;

    return {
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
      model,
      purpose: purpose ?? "generate_text",
      provider,
    } satisfies LLMUsageInfo;
  }

  /**
   * Register this provider with the registry
   * Should be called at module load time from provider implementations
   *
   * @param type - Provider id
   * @param metadata - Provider metadata (name, auth requirement, etc.)
   * @param constructor - Constructor function that returns provider instance
   */
  static register(
    type: ProviderId,
    metadata: Omit<ProviderMetadata, "type">,
    constructor: (apiKey?: string) => LLMProvider
  ): void {
    ProviderRegistry.getInstance().register(type, metadata, constructor);
  }

  /**
   * Convert ResolvedPrompt to array of PromptMessages
   */
  protected toPromptMessages(resolved: ResolvedPrompt): PromptMessage[] {
    const withMessages = resolved as ResolvedPrompt & {
      messages?: PromptMessage[];
    };

    if (Array.isArray(withMessages.messages) && withMessages.messages.length) {
      return withMessages.messages;
    }

    const messages: PromptMessage[] = [];
    if (resolved.systemPrompt) {
      messages.push({ role: "system", content: resolved.systemPrompt });
    }
    if (resolved.userPrompt) {
      messages.push({ role: "user", content: resolved.userPrompt });
    }
    return messages;
  }

  protected combinePromptText(resolved: ResolvedPrompt): string {
    const withMessages = resolved as ResolvedPrompt & {
      messages?: PromptMessage[];
    };
    const messageContent = withMessages.messages?.map((m) => m.content) ?? [];

    return [
      resolved.systemPrompt ?? "",
      resolved.userPrompt ?? "",
      ...messageContent,
    ]
      .filter(Boolean)
      .join("\n");
  }

  protected resolveTemperature(
    model: string,
    temperature?: number
  ): number | undefined {
    return temperature ?? this.getDefaultTemperature(model);
  }
}
