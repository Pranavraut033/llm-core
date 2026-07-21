/**
 * Provider registry, factory, and base class exports.
 *
 * This barrel does NOT register any providers as a side effect — import
 * `@resume-builder/llm-core/providers/register-builtins` (or register your
 * own providers via `LLMProvider.register`) before calling
 * `getProviderInstance`.
 *
 * It also avoids importing any provider SDK (`openai`, `@anthropic-ai/sdk`,
 * `@google/genai`) so it can be used even if none of those optional peer
 * dependencies are installed. The `OpenAICompatibleProvider` base class
 * (which requires the `openai` package) is exported separately from
 * `@resume-builder/llm-core/providers/openai-compatible`.
 */

export {
  ProviderRegistry,
  getRegistry,
  getAvailableProviders,
  getAvailableProviderTypes,
} from "./registry";
export type { ProviderMetadata } from "./registry";

export { getProviderInstance } from "./factory";

export { LLMProvider } from "./LLMProvider";
export type { StructureResult } from "./LLMProvider";

export { isProviderSDKAvailable } from "./sdkAvailability";
