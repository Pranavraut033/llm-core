/**
 * Base LLM Provider with shared plumbing for streaming/non-streaming
 * completions, structured (Zod) output, token usage estimation, and
 * temperature resolution.
 *
 * Providers should register themselves using the static register() method
 * to allow dynamic provider discovery and instantiation.
 */
import z, { ZodTypeAny } from "zod";

import { ProviderRuntimeConfig } from "../config";
import { AbortError, classifyProviderError, RateLimitError } from "../errors";
import { Logger, noopLogger } from "../logger";
import { ResolvedPrompt } from "../prompts/types";
import { ProviderId } from "../providerType";
import { LLMUsageInfo } from "../tokens/usageTypes";
import {
  contentToText,
  LLMGenerationOptions,
  LLMResult,
  LLMStreamEvent,
  PromptMessage,
} from "../types";
import { ProviderRegistry, ProviderMetadata } from "./registry";

export type StructureResult<TSchema extends ZodTypeAny> = {
  result: z.infer<TSchema>;
  usage: LLMUsageInfo;
};

export abstract class LLMProvider {
  /** Injected via `LLMCoreConfig.logger`; falls back to the subclass's own tagged console logger. */
  protected logger: Logger;
  /** Injected via `LLMCoreConfig.onUsage`; fires as a default when a call site doesn't pass its own `onUsage`. */
  private onUsageSink?: (usage: LLMUsageInfo) => void | Promise<void>;

  constructor(runtimeConfig?: ProviderRuntimeConfig, fallbackLogger?: Logger) {
    this.logger = runtimeConfig?.logger ?? fallbackLogger ?? noopLogger;
    this.onUsageSink = runtimeConfig?.onUsage;
  }

  /**
   * Report usage to whichever sink applies: the per-call `onUsage` (from
   * `LLMGenerationOptions`) if given, otherwise the config-level default.
   */
  protected notifyUsage(
    usage: LLMUsageInfo,
    explicitSink?: (usage: LLMUsageInfo) => void
  ): void {
    (explicitSink ?? this.onUsageSink)?.(usage);
  }

  /**
   * Base delay (ms) for `withResilience`'s exponential backoff (attempt 0
   * waits this long, attempt 1 waits 2x, etc.), unless a `RateLimitError`
   * carries its own `retryAfterMs`. A protected instance field (rather than
   * a hardcoded constant) so tests can override it to keep retry tests fast.
   */
  protected resilienceBackoffBaseMs = 500;

  /**
   * Wrap an SDK call with cancellation (`AbortSignal`), a timeout, and
   * retry-with-backoff for retryable failures (rate limits, 5xx). `fn`
   * receives the composed signal to forward into the underlying SDK/fetch
   * call so cancellation actually reaches the network request.
   *
   * - If the caller's `signal` is already aborted, rejects with
   *   `AbortError` immediately, without invoking `fn`.
   * - On throw, the error is classified via `classifyProviderError`. If the
   *   composed signal is what caused the failure, it's classified as
   *   `TimeoutError` (when `timeoutMs` elapsed) or `AbortError` (user
   *   cancellation) regardless of how the SDK itself represents that
   *   failure — some SDKs don't distinguish the two in their own error
   *   shape.
   * - Otherwise, retries (exponential backoff, honoring
   *   `RateLimitError.retryAfterMs` when present) while the classified
   *   error is `retryable` and attempts remain (`maxRetries`, default 2).
   *   Never retries `AbortError`/`TimeoutError`/`AuthError`/
   *   `ContextLengthError` — `retryable` is already `false` for those.
   */
  protected async withResilience<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    options: {
      signal?: AbortSignal;
      timeoutMs?: number;
      maxRetries?: number;
      provider?: ProviderId;
    }
  ): Promise<T> {
    const { signal: callerSignal, timeoutMs, maxRetries = 2 } = options;
    const provider = options.provider ?? this.providerType;

    if (callerSignal?.aborted) {
      throw new AbortError("The operation was aborted.", { provider });
    }

    const signals: AbortSignal[] = [];
    if (callerSignal) signals.push(callerSignal);
    if (timeoutMs !== undefined) signals.push(AbortSignal.timeout(timeoutMs));

    const composedSignal: AbortSignal | undefined =
      signals.length === 0
        ? undefined
        : signals.length === 1
          ? signals[0]
          : AbortSignal.any(signals);

    let attempt = 0;
    for (;;) {
      try {
        return await fn(composedSignal ?? new AbortController().signal);
      } catch (err) {
        if (composedSignal?.aborted) {
          const reason = composedSignal.reason as { name?: string } | undefined;
          if (reason?.name === "TimeoutError") {
            throw classifyProviderError(
              Object.assign(new Error("The operation timed out."), {
                name: "TimeoutError",
              }),
              provider
            );
          }
          throw classifyProviderError(
            Object.assign(new Error("The operation was aborted."), {
              name: "AbortError",
            }),
            provider
          );
        }

        const classified = classifyProviderError(err, provider);

        if (!classified.retryable || attempt >= maxRetries) {
          throw classified;
        }

        const backoffMs =
          classified instanceof RateLimitError &&
          classified.retryAfterMs !== undefined
            ? classified.retryAfterMs
            : this.resilienceBackoffBaseMs * 2 ** attempt;

        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        attempt++;
      }
    }
  }

  abstract get providerType(): ProviderId;
  abstract get streamSupported(): boolean;

  abstract fetchModels(): Promise<string[]>;
  abstract validateConnection(): Promise<{ success: boolean; message: string }>;

  abstract runLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions & { stream: true }
  ): AsyncGenerator<LLMStreamEvent>;

  abstract runLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions & { stream?: false; onUsage?: never }
  ): Promise<LLMResult<string>>;

  abstract runLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions
  ): Promise<LLMResult<string>> | AsyncGenerator<LLMStreamEvent>;

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
  ): AsyncGenerator<LLMStreamEvent>;

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
  ): Promise<LLMResult<string>> | AsyncGenerator<LLMStreamEvent> {
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
    constructor: (
      apiKey?: string,
      runtimeConfig?: ProviderRuntimeConfig
    ) => LLMProvider
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
    const messageContent =
      withMessages.messages?.map((m) => contentToText(m.content)) ?? [];

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
