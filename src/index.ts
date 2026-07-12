/**
 * @resume-builder/llm-core
 *
 * Domain-agnostic multi-provider LLM core: provider registry/factory,
 * generic LLM/tool types, an injectable token usage tracker, and a
 * Handlebars-based prompt-template system generic over a host-defined
 * context and purpose vocabulary.
 *
 * - Providers (and their SDKs) are NOT registered by default — import
 *   `@resume-builder/llm-core/providers/register-builtins` to register the
 *   6 built-in providers (OpenAI, Gemini, Grok, Perplexity, Ollama,
 *   Anthropic), or register your own via `LLMProvider.register`.
 * - The prompt-template system lives under `@resume-builder/llm-core/prompts`.
 */

export * from "./types";
export * from "./providerType";
export * from "./config";
export {
  LLMError,
  AuthError,
  RateLimitError,
  ContextLengthError,
  TimeoutError,
  AbortError,
  ProviderError,
  classifyProviderError,
} from "./errors";
export type { LLMErrorOptions } from "./errors";
export { textOnly } from "./streamUtils";
export type { Logger } from "./logger";
export { createConsoleLogger, noopLogger } from "./logger";

export * from "./tokens/usageTypes";
export {
  generateRequestId,
  estimateTokenCount,
  mergeLLMUsageInfo,
  trackTokenUsage,
} from "./tokens/tokenTracker";
export {
  computeCostUSD,
  normalizeModelId,
  MODEL_PRICING,
} from "./tokens/pricing";
export type { ModelPricing } from "./tokens/pricing";

export { getModelInfo, MODEL_CATALOG } from "./models/modelCatalog";
export type { ModelInfo, ModelCapabilities } from "./models/modelCatalog";

export {
  ProviderRegistry,
  getRegistry,
  getAvailableProviders,
  getAvailableProviderTypes,
  getProviderInstance,
  LLMProvider,
} from "./providers";
export type { ProviderMetadata, StructureResult } from "./providers";
