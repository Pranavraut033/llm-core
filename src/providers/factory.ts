/**
 * Unified Provider Factory
 *
 * Single source of truth for provider instantiation.
 * Uses registry to look up providers instead of hard-coded switch statements.
 *
 * Unlike the original app-internal factory, this package does NOT force any
 * provider registration as a side effect — call
 * `import "@resume-builder/llm-core/providers/register-builtins"` (or
 * register your own providers via `LLMProvider.register`) before calling
 * `getProviderInstance`.
 */

import { LLMCoreConfig } from "../config";
import { ProviderId } from "../providerType";
import { LLMProvider } from "./LLMProvider";
import { getRegistry } from "./registry";

/**
 * Get a provider instance by type.
 *
 * Resolves the API key (for auth-required providers) via
 * `config.keyResolver` — the package never reads from storage directly.
 */
export async function getProviderInstance(
  type: ProviderId,
  config: LLMCoreConfig
): Promise<LLMProvider> {
  const registry = getRegistry();

  // Verify provider is registered
  if (!registry.has(type)) {
    const available = registry.getAvailableTypes().join(", ");
    throw new Error(
      `Provider ${type} is not registered. Available: ${available}`
    );
  }

  // Get metadata to check if auth is required
  const metadata = registry.getMetadata(type);
  if (!metadata) {
    throw new Error(`No metadata found for provider ${type}`);
  }

  // Retrieve API key if provider requires auth
  let apiKey: string | undefined;
  if (metadata.requiresAuth) {
    try {
      const key = await config.keyResolver(type);
      apiKey = key || undefined;
      if (!apiKey) {
        throw new Error(
          `No API key configured for ${metadata.name}. Please set it in settings.`
        );
      }
    } catch (error) {
      throw new Error(
        `Failed to retrieve API key for ${metadata.name}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Create and return provider instance
  return registry.getInstance(type, apiKey);
}
