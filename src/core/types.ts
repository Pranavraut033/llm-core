/**
 * Shared types for the framework-agnostic reactive controller layer
 * (`src/core/`). No React (or any framework) import anywhere in this
 * module — controllers are plain observable stores shaped for
 * `useSyncExternalStore` compatibility: `{ getSnapshot(), subscribe(cb), ...actions }`.
 */
import { LLMCoreConfig } from "../config";
import { LLMProvider } from "../providers/LLMProvider";
import { ProviderId } from "../providerType";
import { LLMUsageInfo } from "../tokens/usageTypes";
import { LLMGenerationOptions } from "../types";

/**
 * Either a live, already-constructed `LLMProvider`, or a
 * `{ providerId, config }` pair a controller resolves lazily (and caches)
 * via `getProviderInstance` on first action call.
 */
export type ProviderSource =
  LLMProvider | { providerId: ProviderId; config: LLMCoreConfig };

/**
 * The subset of `LLMGenerationOptions` a controller's caller may still
 * configure — `model` (top-level controller option), `stream` (controller
 * decides), and `signal` (controller derives its own from `stop()`) are
 * excluded so callers can't fight the controller's own plumbing.
 */
export type ControllerGenerationOptions = Omit<
  LLMGenerationOptions,
  "model" | "stream" | "signal"
>;

export interface ControllerBaseOptions {
  /** A live provider instance, or a `{ providerId, config }` pair resolved lazily on first action call. */
  provider: ProviderSource;
  /** Model id passed through to every provider call this controller makes. */
  model: string;
  /** Extra generation options (temperature, tools, etc.) applied to every call. */
  generationOptions?: ControllerGenerationOptions;
  /** Invoked with the accumulated usage once a call completes. */
  onUsage?: (usage: LLMUsageInfo) => void | Promise<void>;
}

export type Listener = () => void;

/** The `useSyncExternalStore`-compatible shape every controller implements. */
export interface Store<TSnapshot> {
  getSnapshot(): TSnapshot;
  subscribe(listener: Listener): () => void;
}
