/**
 * `@pranavraut033/llm-core/core` — a framework-agnostic reactive
 * controller layer wrapping the provider methods (`generateText`/`runLLM`/
 * `runStructuredLLM`). Every controller is a plain observable store shaped
 * for `useSyncExternalStore` compatibility: `{ getSnapshot(), subscribe(cb), ...actions }`.
 * No React (or any framework) import in this entry point — see
 * `@pranavraut033/llm-core/react` for the React bindings.
 */

export { createCompletion } from "./createCompletion";
export type {
  CompletionController,
  CompletionSnapshot,
  CreateCompletionOptions,
} from "./createCompletion";

export { createChat } from "./createChat";
export type {
  ChatController,
  ChatMessage,
  ChatSnapshot,
  CreateChatOptions,
} from "./createChat";

export { createObject } from "./createObject";
export type {
  ObjectController,
  ObjectSnapshot,
  CreateObjectOptions,
} from "./createObject";

export { createProviderResolver } from "./providerResolution";
export { createEmitter } from "./store";
export type { Emitter } from "./store";
export type {
  ControllerBaseOptions,
  ControllerGenerationOptions,
  Listener,
  ProviderSource,
  Store,
} from "./types";
