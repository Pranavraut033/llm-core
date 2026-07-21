/**
 * `@pranavraut033/llm-core/react` — thin React hooks binding the
 * framework-agnostic controllers in `@pranavraut033/llm-core/core` to React
 * lifecycle via `useSyncExternalStore`. No logic is duplicated here; each
 * hook just subscribes to a controller and binds its actions.
 *
 * `react` is an optional peer dependency of this package — importing this
 * entry point (only) requires it to be installed.
 */

export { useCompletion } from "./useCompletion";
export type { UseCompletionResult } from "./useCompletion";

export { useChat } from "./useChat";
export type { UseChatResult } from "./useChat";

export { useObject } from "./useObject";
export type { UseObjectResult } from "./useObject";

export { useModels } from "./useModels";
export type { UseModelsResult } from "./useModels";
