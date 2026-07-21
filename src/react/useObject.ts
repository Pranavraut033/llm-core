/**
 * `useObject` — a thin React binding over `createObject`
 * (`../core/createObject`). No duplicated logic: the controller owns all
 * state, this hook just subscribes to it via `useSyncExternalStore` and
 * binds its action.
 */
import { useMemo, useSyncExternalStore } from "react";
import { ZodTypeAny } from "zod";

import {
  createObject,
  CreateObjectOptions,
  ObjectController,
  ObjectSnapshot,
} from "../core";

export interface UseObjectResult<
  TSchema extends ZodTypeAny = ZodTypeAny,
> extends ObjectSnapshot<TSchema> {
  /** Resolves `resolvedPrompt` against `zodSchema`, updating the snapshot. */
  generate: ObjectController<TSchema>["generate"];
}

export function useObject<TSchema extends ZodTypeAny = ZodTypeAny>(
  opts: CreateObjectOptions
): UseObjectResult<TSchema> {
  const controller = useMemo(
    () => createObject<TSchema>(opts),
    // Re-create the controller only when the provider/model identity
    // changes — `generationOptions`/`onUsage` are read fresh by the
    // controller's closures on each `generate()` call.
    [opts.provider, opts.model]
  );

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot
  );

  return {
    ...snapshot,
    generate: controller.generate,
  };
}
