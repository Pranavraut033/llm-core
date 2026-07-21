/**
 * `useCompletion` — a thin React binding over `createCompletion`
 * (`../core/createCompletion`). No duplicated logic: the controller owns
 * all state, this hook just subscribes to it via `useSyncExternalStore`
 * and binds its actions.
 */
import { useMemo, useSyncExternalStore } from "react";

import {
  CompletionSnapshot,
  createCompletion,
  CreateCompletionOptions,
} from "../core";

export interface UseCompletionResult extends CompletionSnapshot {
  /** Streams a completion for `input`, accumulating deltas into `text`. */
  complete(input: string): Promise<void>;
  /** Aborts the in-flight `complete()` call, if any. */
  stop(): void;
}

export function useCompletion(
  opts: CreateCompletionOptions
): UseCompletionResult {
  const controller = useMemo(
    () => createCompletion(opts),
    // Re-create the controller only when the provider/model identity
    // changes — `generationOptions`/`onUsage`/`systemPrompt` are read
    // fresh by the controller's closures on each `complete()` call.
    [opts.provider, opts.model]
  );

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot
  );

  return {
    ...snapshot,
    complete: controller.complete,
    stop: controller.stop,
  };
}
