import { describe, expect, it } from "vitest";

import "./helpers/ambientProviderIds";
import { DummyProvider } from "./helpers/dummyProvider";
import { OpenAICompatibleProvider } from "../src/providers/openaiCompatibleProvider";
import { getRegistry } from "../src/providers/registry";
import { isProviderSDKAvailable } from "../src/providers/sdkAvailability";
import "../src/providers/ollama";
import { BUILTIN_PROVIDERS } from "../src/providerType";

describe("isProviderSDKAvailable", () => {
  it("returns true for a provider with no requiredPeerDependency (Ollama needs no SDK)", async () => {
    await expect(
      isProviderSDKAvailable(BUILTIN_PROVIDERS.OLLAMA)
    ).resolves.toBe(true);
  });

  it("returns true for a provider whose required SDK is actually installed", async () => {
    const registry = getRegistry();
    const type = "sdk-available-llm";

    registry.register(
      type,
      {
        name: "SDK Available",
        requiresAuth: false,
        requiredPeerDependency: "zod",
      },
      (apiKey?: string) => new DummyProvider(type, apiKey)
    );

    await expect(isProviderSDKAvailable(type)).resolves.toBe(true);
  });

  it("returns false for a provider whose requiredPeerDependency can't be resolved", async () => {
    const registry = getRegistry();
    const type = "sdk-unavailable-llm";

    registry.register(
      type,
      {
        name: "SDK Unavailable",
        requiresAuth: false,
        requiredPeerDependency: "this-package-does-not-exist-xyz",
      },
      (apiKey?: string) => new DummyProvider(type, apiKey)
    );

    await expect(isProviderSDKAvailable(type)).resolves.toBe(false);
  });

  it("returns true for an unregistered provider type (nothing to check)", async () => {
    await expect(
      isProviderSDKAvailable("does-not-exist" as never)
    ).resolves.toBe(true);
  });
});

describe("OpenAICompatibleProvider lazy SDK loading", () => {
  class TestableOpenAICompatible extends OpenAICompatibleProvider {
    constructor() {
      super({ apiKey: "test-key" });
    }

    get providerType() {
      return BUILTIN_PROVIDERS.OPENAI;
    }

    async fetchModels(): Promise<string[]> {
      return [];
    }

    /** Test-only escape hatch to inspect the private `client` field. */
    getRawClient(): unknown {
      return (this as unknown as { client?: unknown }).client;
    }
  }

  it("does not construct the real openai SDK client merely from being instantiated", () => {
    const provider = new TestableOpenAICompatible();
    // `client` stays unset until `getClient()`/a method that calls it runs —
    // confirms SDK resolution is deferred to first use, not constructor time.
    expect(provider.getRawClient()).toBeUndefined();
  });

  it("lazily resolves and caches the real openai client once a method needs it", async () => {
    const provider = new TestableOpenAICompatible();
    expect(provider.getRawClient()).toBeUndefined();

    // `openai` is a real devDependency here, so this resolves successfully
    // — this is the positive-path proof that lazy resolution still works
    // end-to-end when the SDK genuinely is installed.
    const client = await (
      provider as unknown as { getClient: () => Promise<unknown> }
    ).getClient();

    expect(client).toBeDefined();
    expect(provider.getRawClient()).toBe(client);
  });
});
