/**
 * `OpenAICompatibleProvider` base class, exported as its own entry point
 * because it (transitively) requires the `openai` package — an optional
 * peer dependency. Import this subpath only if you have `openai` installed
 * and want to build a custom OpenAI-compatible provider.
 */
export { OpenAICompatibleProvider } from "./openaiCompatibleProvider";
export type {
  OpenAIClientConfig,
  OpenAITool,
  OpenAIMessageTool,
} from "./openaiCompatibleProvider";
