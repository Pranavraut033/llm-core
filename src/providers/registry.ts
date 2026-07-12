/**
 * Provider Registry - Single source of truth for registered LLM providers
 * Uses singleton pattern to ensure only one registry instance exists
 * Providers register themselves via static registration calls
 */

import { ProviderRuntimeConfig } from "../config";
import { ProviderId } from "../providerType";
import { LLMProvider } from "./LLMProvider";

export interface ProviderMetadata {
  type: ProviderId;
  name: string;
  requiresAuth: boolean;
  isLocal?: boolean;
  description?: string;
  defaultModels?: string[];
}

type ProviderConstructor = (
  apiKey?: string,
  runtimeConfig?: ProviderRuntimeConfig
) => LLMProvider;

interface RegisteredProvider {
  metadata: ProviderMetadata;
  constructor: ProviderConstructor;
}

/**
 * Singleton registry for managing LLM providers
 * Prevent instantiation with private constructor
 */
export class ProviderRegistry {
  private static instance: ProviderRegistry | null = null;
  private providers: Map<ProviderId, RegisteredProvider> = new Map();

  private constructor() {
    // Private constructor prevents instantiation
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }

  /**
   * Register a provider
   */
  register(
    type: ProviderId,
    metadata: Omit<ProviderMetadata, "type">,
    constructor: ProviderConstructor
  ): void {
    if (this.providers.has(type)) {
      console.warn(`Provider ${type} is already registered. Overwriting.`);
    }

    this.providers.set(type, {
      metadata: { ...metadata, type },
      constructor,
    });
  }

  /**
   * Get a provider instance by type
   */
  getInstance(
    type: ProviderId,
    apiKey?: string,
    runtimeConfig?: ProviderRuntimeConfig
  ): LLMProvider {
    const registered = this.providers.get(type);
    if (!registered) {
      throw new Error(
        `Provider ${type} is not registered. Available providers: ${this.getAvailableTypes().join(", ")}`
      );
    }
    return registered.constructor(apiKey, runtimeConfig);
  }

  /**
   * Get metadata for a provider type
   */
  getMetadata(type: ProviderId): ProviderMetadata | null {
    return this.providers.get(type)?.metadata || null;
  }

  /**
   * Get all registered providers with metadata
   */
  getAll(): ProviderMetadata[] {
    return Array.from(this.providers.values()).map((p) => p.metadata);
  }

  /**
   * Get all available provider types
   */
  getAvailableTypes(): ProviderId[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Check if a provider is registered
   */
  has(type: ProviderId): boolean {
    return this.providers.has(type);
  }

  /**
   * Get providers that require authentication
   */
  getAuthRequired(): ProviderMetadata[] {
    return Array.from(this.providers.values())
      .filter((p) => p.metadata.requiresAuth)
      .map((p) => p.metadata);
  }

  /**
   * Get local-only providers
   */
  getLocalProviders(): ProviderMetadata[] {
    return Array.from(this.providers.values())
      .filter((p) => p.metadata.isLocal)
      .map((p) => p.metadata);
  }
}

/**
 * Get singleton registry instance
 */
export function getRegistry(): ProviderRegistry {
  return ProviderRegistry.getInstance();
}

/**
 * Get all available providers with metadata
 * Convenience function for consumers that need the provider list
 */
export function getAvailableProviders(): ProviderMetadata[] {
  return getRegistry().getAll();
}

/**
 * Get all available provider types
 */
export function getAvailableProviderTypes(): ProviderId[] {
  return getRegistry().getAvailableTypes();
}
