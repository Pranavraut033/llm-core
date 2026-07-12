import { describe, expect, it } from "vitest";

import { GenericOpenAICompatibleProvider } from "../src/providers/genericOpenAICompatible";
import { ProviderId } from "../src/providerType";

describe("GenericOpenAICompatibleProvider", () => {
  it("uses the caller-supplied id/name/baseURL", () => {
    const provider = new GenericOpenAICompatibleProvider({
      id: "together" as ProviderId,
      name: "Together AI",
      apiKey: "test-key",
      baseURL: "https://api.together.xyz/v1",
    });

    expect(provider.providerType).toBe("together");
  });

  it("fetchModels falls back to an empty list on failure (no fixed model set to assume)", async () => {
    const provider = new GenericOpenAICompatibleProvider({
      id: "together" as ProviderId,
      name: "Together AI",
      apiKey: "test-key",
      baseURL: "https://api.together.xyz/v1",
    });
    (
      provider as unknown as {
        client: { models: { list: () => Promise<never> } };
      }
    ).client = {
      models: { list: () => Promise.reject(new Error("network down")) },
    };

    await expect(provider.fetchModels()).resolves.toEqual([]);
  });
});
