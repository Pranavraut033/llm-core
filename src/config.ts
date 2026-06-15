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
   * Resolve the API key (or other credential) for a given provider.
   * Called only for providers whose registered metadata has
   * `requiresAuth: true`. May return `undefined`/`null` if no key is
   * configured — the factory will throw a descriptive error in that case.
   */
  keyResolver: (
    type: ProviderId
  ) => string | undefined | null | Promise<string | undefined | null>;

  /**
   * Optional sink invoked with usage info collected during a call.
   * Individual `runLLM`/`runStructuredLLM` calls can also pass their own
   * `onUsage` via `LLMGenerationOptions`; this is a convenient default.
   */
  onUsage?: (usage: LLMUsageInfo) => void | Promise<void>;

  /** Optional logger; defaults to a no-op logger if not provided. */
  logger?: Logger;
}
