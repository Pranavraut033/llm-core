import { Logger } from "./logger";
import { ProviderId } from "./providerType";
import { LLMUsageInfo } from "./tokens/usageTypes";

/**
 * Configuration injected into `getProviderInstance` (and, by extension,
 * any provider it constructs).
 *
 * This package never reads API keys or persists usage data itself — both
 * are the host application's responsibility, supplied here.
 */
export interface LLMCoreConfig {
  /**
   * Resolve the API key (or other credential/config, e.g. a local provider's
   * base URL) for a given provider. Called for every provider on
   * instantiation; a missing return value is only a hard error for
   * providers whose registered metadata has `requiresAuth: true` — for
   * others (e.g. Ollama) it's treated as "use the provider's default".
   */
  keyResolver: (
    type: ProviderId
  ) => string | undefined | null | Promise<string | undefined | null>;

  /**
   * Optional sink invoked with usage info collected during a call, in
   * addition to whatever `onUsage` an individual `runLLM`/`runStructuredLLM`
   * call passes via `LLMGenerationOptions` — this is a convenient default
   * so hosts don't have to thread `onUsage` through every call site.
   */
  onUsage?: (usage: LLMUsageInfo) => void | Promise<void>;

  /** Optional logger; defaults to a no-op logger if not provided. */
  logger?: Logger;
}

/**
 * The subset of `LLMCoreConfig` that's actually forwarded into a provider
 * instance at construction time (`keyResolver` is consumed by the factory
 * itself, not the provider).
 */
export type ProviderRuntimeConfig = Pick<LLMCoreConfig, "logger" | "onUsage">;
