/**
 * Lazy, memoized resolution of a controller's `ProviderSource` into a live
 * `LLMProvider`. A live instance resolves immediately; a
 * `{ providerId, config }` pair is resolved via the existing
 * `getProviderInstance` on first action call and cached per-controller so
 * repeated actions reuse the same instance instead of re-resolving
 * credentials on every call.
 */
import { getProviderInstance } from "../providers/factory";
import { LLMProvider } from "../providers/LLMProvider";
import { ProviderId } from "../providerType";
import { ProviderSource } from "./types";

export function createProviderResolver(
  source: ProviderSource
): () => Promise<LLMProvider> {
  if (source instanceof LLMProvider) {
    return () => Promise.resolve(source);
  }

  const { providerId, config } = source;
  const cache = new Map<ProviderId, Promise<LLMProvider>>();

  return () => {
    const cached = cache.get(providerId);
    if (cached) return cached;

    const pending = getProviderInstance(providerId, config).catch((err) => {
      // Don't poison the cache with a rejected promise — a transient
      // failure (e.g. key not yet configured) shouldn't permanently break
      // this controller.
      cache.delete(providerId);
      throw err;
    });
    cache.set(providerId, pending);
    return pending;
  };
}
