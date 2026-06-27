import { describe, expect, it, vi } from "vitest";

import "./helpers/ambientProviderIds";
import { DummyProvider } from "./helpers/dummyProvider";
import {
  getAvailableProviders,
  getAvailableProviderTypes,
  getRegistry,
  ProviderRegistry,
} from "../src/providers/registry";
import { ProviderId } from "../src/providerType";

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
    // Simulates an untyped/dynamic id (e.g. from user input or a config
    // file) that was never declared in ProviderIdRegistry — the runtime
    // guard is the safety net for exactly this case.
    expect(() => registry.getInstance("does-not-exist" as ProviderId)).toThrow(
      /not registered/
    );
  });

  it("rejects an undeclared provider id at compile time (type-level check)", () => {
    const registry = getRegistry();

    // @ts-expect-error — "not-in-the-registry" was never added to
    // ProviderIdRegistry (see tests/helpers/ambientProviderIds.ts), so
    // ProviderId rejects it. Vitest doesn't type-check by default, so this
    // assertion is only enforced by `npm run type-check` (tsc --noEmit) —
    // it fails there (as "unused directive") if ProviderId is ever widened
    // back to a plain `string`.
    registry.register("not-in-the-registry", { requiresAuth: false }, () => {
      throw new Error("never constructed");
    });

    expect(true).toBe(true);
  });

  it("warns and overwrites when registering an already-registered type", () => {
    const registry = getRegistry();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const customType = "overwrite-llm";

    registry.register(
      customType,
      { name: "First", requiresAuth: false },
      (apiKey?: string) => new DummyProvider(customType, apiKey)
    );
    registry.register(
      customType,
      { name: "Second", requiresAuth: false },
      (apiKey?: string) => new DummyProvider(customType, apiKey)
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Provider ${customType} is already registered`)
    );
    expect(registry.getMetadata(customType)?.name).toBe("Second");
    warnSpy.mockRestore();
  });

  it("exposes getAuthRequired and getLocalProviders for filtering registered providers", () => {
    const registry = getRegistry();
    const authType = "auth-required-llm";
    const localType = "local-only-llm";

    registry.register(
      authType,
      { name: "Auth Required", requiresAuth: true },
      (apiKey?: string) => new DummyProvider(authType, apiKey)
    );
    registry.register(
      localType,
      { name: "Local Only", requiresAuth: false, isLocal: true },
      (apiKey?: string) => new DummyProvider(localType, apiKey)
    );

    expect(registry.getAuthRequired().map((m) => m.type)).toContain(authType);
    expect(registry.getLocalProviders().map((m) => m.type)).toContain(
      localType
    );
  });

  it("getAvailableProviders/getAvailableProviderTypes mirror the registry singleton", () => {
    const registry = getRegistry();
    const customType = "convenience-fn-llm";

    registry.register(
      customType,
      { name: "Convenience", requiresAuth: false },
      (apiKey?: string) => new DummyProvider(customType, apiKey)
    );

    expect(getAvailableProviderTypes()).toContain(customType);
    expect(getAvailableProviders().map((m) => m.type)).toContain(customType);
  });
});
