import { afterEach, describe, expect, it, vi } from "vitest";

// Import provider files to trigger registration
import "../src/providers/groq";
import "../src/providers/deepseek";
import "../src/providers/mistral";
import "../src/providers/openrouter";

import { DeepSeekProvider } from "../src/providers/deepseek";
import { GroqProvider } from "../src/providers/groq";
import { MistralProvider } from "../src/providers/mistral";
import { OpenRouterProvider } from "../src/providers/openrouter";
import { getRegistry } from "../src/providers/registry";
import { BUILTIN_PROVIDERS } from "../src/providerType";

describe("GroqProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has the correct providerType", () => {
    const provider = new GroqProvider("test-key");
    expect(provider.providerType).toBe(BUILTIN_PROVIDERS.GROQ);
  });

  it("fetchModels returns fallback list when client.models.list() fails", async () => {
    const provider = new GroqProvider("test-key");
    const mockList = vi.fn().mockRejectedValue(new Error("Network error"));
    (
      provider as unknown as {
        client: { models: { list: typeof mockList } };
      }
    ).client = { models: { list: mockList } };

    const models = await provider.fetchModels();

    expect(models).toEqual(["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]);
  });

  it("fetchModels returns all model ids unfiltered on success", async () => {
    const provider = new GroqProvider("test-key");
    const mockList = vi.fn().mockResolvedValue({
      data: [{ id: "llama-3.3-70b-versatile" }, { id: "llama-3.1-8b-instant" }],
    });
    (
      provider as unknown as {
        client: { models: { list: typeof mockList } };
      }
    ).client = { models: { list: mockList } };

    const models = await provider.fetchModels();

    expect(models).toEqual(["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]);
  });

  it("registry throws when no apiKey is provided", () => {
    const registry = getRegistry();
    expect(() => registry.getInstance(BUILTIN_PROVIDERS.GROQ)).toThrow(
      "Groq API key is required"
    );
  });
});

describe("DeepSeekProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has the correct providerType", () => {
    const provider = new DeepSeekProvider("test-key");
    expect(provider.providerType).toBe(BUILTIN_PROVIDERS.DEEPSEEK);
  });

  it("fetchModels returns fallback list when client.models.list() fails", async () => {
    const provider = new DeepSeekProvider("test-key");
    const mockList = vi.fn().mockRejectedValue(new Error("Network error"));
    (
      provider as unknown as {
        client: { models: { list: typeof mockList } };
      }
    ).client = { models: { list: mockList } };

    const models = await provider.fetchModels();

    expect(models).toEqual(["deepseek-chat", "deepseek-reasoner"]);
  });

  it("fetchModels returns all model ids unfiltered on success", async () => {
    const provider = new DeepSeekProvider("test-key");
    const mockList = vi.fn().mockResolvedValue({
      data: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }],
    });
    (
      provider as unknown as {
        client: { models: { list: typeof mockList } };
      }
    ).client = { models: { list: mockList } };

    const models = await provider.fetchModels();

    expect(models).toEqual(["deepseek-chat", "deepseek-reasoner"]);
  });

  it("registry throws when no apiKey is provided", () => {
    const registry = getRegistry();
    expect(() => registry.getInstance(BUILTIN_PROVIDERS.DEEPSEEK)).toThrow(
      "DeepSeek API key is required"
    );
  });
});

describe("MistralProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has the correct providerType", () => {
    const provider = new MistralProvider("test-key");
    expect(provider.providerType).toBe(BUILTIN_PROVIDERS.MISTRAL);
  });

  it("fetchModels returns fallback list when client.models.list() fails", async () => {
    const provider = new MistralProvider("test-key");
    const mockList = vi.fn().mockRejectedValue(new Error("Network error"));
    (
      provider as unknown as {
        client: { models: { list: typeof mockList } };
      }
    ).client = { models: { list: mockList } };

    const models = await provider.fetchModels();

    expect(models).toEqual(["mistral-large-latest", "mistral-small-latest"]);
  });

  it("fetchModels returns all model ids unfiltered on success", async () => {
    const provider = new MistralProvider("test-key");
    const mockList = vi.fn().mockResolvedValue({
      data: [{ id: "mistral-large-latest" }, { id: "mistral-small-latest" }],
    });
    (
      provider as unknown as {
        client: { models: { list: typeof mockList } };
      }
    ).client = { models: { list: mockList } };

    const models = await provider.fetchModels();

    expect(models).toEqual(["mistral-large-latest", "mistral-small-latest"]);
  });

  it("registry throws when no apiKey is provided", () => {
    const registry = getRegistry();
    expect(() => registry.getInstance(BUILTIN_PROVIDERS.MISTRAL)).toThrow(
      "Mistral API key is required"
    );
  });
});

describe("OpenRouterProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has the correct providerType", () => {
    const provider = new OpenRouterProvider("test-key");
    expect(provider.providerType).toBe(BUILTIN_PROVIDERS.OPENROUTER);
  });

  it("fetchModels returns fallback list when client.models.list() fails", async () => {
    const provider = new OpenRouterProvider("test-key");
    const mockList = vi.fn().mockRejectedValue(new Error("Network error"));
    (
      provider as unknown as {
        client: { models: { list: typeof mockList } };
      }
    ).client = { models: { list: mockList } };

    const models = await provider.fetchModels();

    expect(models).toEqual(["openai/gpt-4o", "anthropic/claude-3.5-sonnet"]);
  });

  it("fetchModels returns all model ids unfiltered on success", async () => {
    const provider = new OpenRouterProvider("test-key");
    const mockList = vi.fn().mockResolvedValue({
      data: [{ id: "openai/gpt-4o" }, { id: "anthropic/claude-3.5-sonnet" }],
    });
    (
      provider as unknown as {
        client: { models: { list: typeof mockList } };
      }
    ).client = { models: { list: mockList } };

    const models = await provider.fetchModels();

    expect(models).toEqual(["openai/gpt-4o", "anthropic/claude-3.5-sonnet"]);
  });

  it("registry throws when no apiKey is provided", () => {
    const registry = getRegistry();
    expect(() => registry.getInstance(BUILTIN_PROVIDERS.OPENROUTER)).toThrow(
      "OpenRouter API key is required"
    );
  });
});
