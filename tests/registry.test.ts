import { describe, expect, it } from "vitest";

import { DummyProvider } from "./helpers/dummyProvider";
import { getRegistry, ProviderRegistry } from "../src/providers/registry";

describe("ProviderRegistry", () => {
  it("registers a custom ProviderId and exposes its metadata", () => {
    const registry = getRegistry();
    const customType = "my-custom-llm";

    registry.register(
      customType,
      {
        name: "My Custom LLM",
        requiresAuth: true,
        description: "A custom provider registered for testing",
      },
      (apiKey?: string) => new DummyProvider(customType, apiKey)
    );

    expect(registry.has(customType)).toBe(true);
    expect(registry.getAvailableTypes()).toContain(customType);

    const metadata = registry.getMetadata(customType);
    expect(metadata).toEqual({
      type: customType,
      name: "My Custom LLM",
      requiresAuth: true,
      description: "A custom provider registered for testing",
    });
  });

  it("returns the same singleton instance from getInstance/getRegistry", () => {
    expect(getRegistry()).toBe(ProviderRegistry.getInstance());
  });

  it("constructs provider instances via the registered constructor", () => {
    const registry = getRegistry();
    const customType = "my-instance-llm";

    registry.register(
      customType,
      { name: "Instance LLM", requiresAuth: false },
      (apiKey?: string) => new DummyProvider(customType, apiKey)
    );

    const instance = registry.getInstance(customType, "test-key");
    expect(instance).toBeInstanceOf(DummyProvider);
    expect(instance.providerType).toBe(customType);
    expect((instance as DummyProvider).getApiKey()).toBe("test-key");
  });

  it("throws a descriptive error for unregistered types", () => {
    const registry = getRegistry();
    expect(() => registry.getInstance("does-not-exist")).toThrow(
      /not registered/
    );
  });
});
