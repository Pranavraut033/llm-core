/**
 * @pranavraut033/llm-core
 *
 * Domain-agnostic multi-provider LLM core: provider registry/factory,
 * generic LLM/tool types, an injectable token usage tracker, and a
 * Handlebars-based prompt-template system generic over a host-defined
 * context and purpose vocabulary.
 *
 * - Providers (and their SDKs) are NOT registered by default — import
 *   `@pranavraut033/llm-core/providers/register-builtins` to register the
 *   10 built-in providers (OpenAI, Gemini, Grok, Groq, Perplexity, Ollama,
 *   Anthropic, DeepSeek, Mistral, OpenRouter), or register your own via `LLMProvider.register`.
 * - The prompt-template system lives under `@pranavraut033/llm-core/prompts`.
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
  ProviderSDKNotInstalledError,
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
  isProviderSDKAvailable,
} from "./providers";
export type { ProviderMetadata, StructureResult } from "./providers";
