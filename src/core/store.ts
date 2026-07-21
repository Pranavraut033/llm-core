/**
 * Minimal, dependency-free pub-sub used by every controller in `src/core/`
 * to implement the `useSyncExternalStore`-compatible `subscribe`/
 * `getSnapshot` shape. No framework import — this is the "vanilla state
 * machine" the reactive core is built on.
 */
import { Listener } from "./types";

export interface Emitter {
  subscribe(listener: Listener): () => void;
  emit(): void;
}

export function createEmitter(): Emitter {
  const listeners = new Set<Listener>();

  return {
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(): void {
      for (const listener of listeners) listener();
    },
  };
}
