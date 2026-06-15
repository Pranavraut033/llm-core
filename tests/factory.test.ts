import { describe, expect, it } from "vitest";

import { LLMCoreConfig } from "../src/config";
import { DummyProvider } from "./helpers/dummyProvider";
import { getProviderInstance } from "../src/providers/factory";
import { getRegistry } from "../src/providers/registry";

function registerDummy(type: string, requiresAuth: boolean): void {
  getRegistry().register(
    type,
    { name: type, requiresAuth },
    (apiKey?: string) => new DummyProvider(type, apiKey)
  );
}

describe("getProviderInstance", () => {
  it("returns an instance for a registered provider that requires no auth", async () => {
    registerDummy("no-auth-llm", false);

    const config: LLMCoreConfig = {
      keyResolver: () => undefined,
    };

    const provider = await getProviderInstance("no-auth-llm", config);
    expect(provider).toBeInstanceOf(DummyProvider);
    expect(provider.providerType).toBe("no-auth-llm");
  });

  it("resolves the API key via keyResolver for auth-required providers", async () => {
    registerDummy("auth-llm", true);

    const config: LLMCoreConfig = {
      keyResolver: (type) => (type === "auth-llm" ? "secret-key" : undefined),
    };

    const provider = await getProviderInstance("auth-llm", config);
    expect(provider).toBeInstanceOf(DummyProvider);
    expect((provider as DummyProvider).getApiKey()).toBe("secret-key");
  });

  it("throws when an auth-required provider has no key configured", async () => {
    registerDummy("auth-llm-missing-key", true);

    const config: LLMCoreConfig = {
      keyResolver: () => undefined,
    };

    await expect(
      getProviderInstance("auth-llm-missing-key", config)
    ).rejects.toThrow(/No API key configured/);
  });

  it("throws for an unregistered provider type", async () => {
    const config: LLMCoreConfig = {
      keyResolver: () => undefined,
    };

    await expect(
      getProviderInstance("totally-unknown", config)
    ).rejects.toThrow(/is not registered/);
  });

  it("supports an async keyResolver", async () => {
    registerDummy("async-auth-llm", true);

    const config: LLMCoreConfig = {
      keyResolver: async (type) =>
        type === "async-auth-llm" ? "async-secret" : undefined,
    };

    const provider = await getProviderInstance("async-auth-llm", config);
    expect((provider as DummyProvider).getApiKey()).toBe("async-secret");
  });
});
