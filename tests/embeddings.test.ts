import { describe, expect, it, vi } from "vitest";

import { AnthropicProvider } from "../src/providers/anthropic";
import { GeminiProvider } from "../src/providers/gemini";
import { OllamaProvider } from "../src/providers/ollama";
import { OpenAIProvider } from "../src/providers/openai";

const generateContent = vi.fn();
const generateContentStream = vi.fn();
const embedContent = vi.fn();

vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  return {
    ...actual,
    GoogleGenAI: vi.fn().mockImplementation(function GoogleGenAI(this: {
      models: unknown;
    }) {
      this.models = { generateContent, generateContentStream, embedContent };
    }),
  };
});

describe("OpenAIProvider.embed", () => {
  it("sends the right request shape and returns embeddings/usage from the mocked response", async () => {
    const embeddingsCreate = vi.fn().mockResolvedValue({
      data: [
        { index: 1, embedding: [0.4, 0.5] },
        { index: 0, embedding: [0.1, 0.2, 0.3] },
      ],
      model: "text-embedding-3-small",
      object: "list",
      usage: { prompt_tokens: 8, total_tokens: 8 },
    });

    const provider = new OpenAIProvider("test-key");
    (
      provider as unknown as {
        client: { embeddings: { create: typeof embeddingsCreate } };
      }
    ).client = { embeddings: { create: embeddingsCreate } };

    const result = await provider.embed({
      model: "text-embedding-3-small",
      input: ["hello", "world"],
    });

    expect(embeddingsCreate).toHaveBeenCalledWith({
      model: "text-embedding-3-small",
      input: ["hello", "world"],
    });

    // Sorted back into request order by `index`, not response order.
    expect(result.embeddings).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5],
    ]);
    expect(result.usage).toMatchObject({
      promptTokens: 8,
      completionTokens: 0,
      totalTokens: 8,
      model: "text-embedding-3-small",
      purpose: "embed",
    });
  });
});

describe("GeminiProvider.embed", () => {
  it("calls models.embedContent and returns embeddings with estimated usage", async () => {
    embedContent.mockResolvedValue({
      embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }],
    });

    const provider = new GeminiProvider("test-key");

    const result = await provider.embed({
      model: "text-embedding-004",
      input: ["hello", "world"],
    });

    expect(embedContent).toHaveBeenCalledWith({
      model: "text-embedding-004",
      contents: ["hello", "world"],
    });

    expect(result.embeddings).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(result.usage).toMatchObject({
      completionTokens: 0,
      model: "text-embedding-004",
      purpose: "embed",
    });
    expect(result.usage.promptTokens).toBeGreaterThan(0);
  });

  it("wraps a single string input into an array of one", async () => {
    embedContent.mockResolvedValue({ embeddings: [{ values: [0.9] }] });

    const provider = new GeminiProvider("test-key");
    await provider.embed({ model: "text-embedding-004", input: "solo" });

    expect(embedContent).toHaveBeenCalledWith({
      model: "text-embedding-004",
      contents: ["solo"],
    });
  });
});

describe("OllamaProvider.embed", () => {
  it("POSTs to /api/embed with the right body and returns the mocked embeddings", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        embeddings: [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaProvider("http://localhost:11434");
    const result = await provider.embed({
      model: "nomic-embed-text",
      input: ["hello", "world"],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/embed",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "nomic-embed-text",
          input: ["hello", "world"],
        }),
      })
    );

    expect(result.embeddings).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(result.usage.completionTokens).toBe(0);

    vi.unstubAllGlobals();
  });

  it("uses real prompt_eval_count when present instead of estimating", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        embeddings: [[0.1]],
        prompt_eval_count: 3,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaProvider("http://localhost:11434");
    const result = await provider.embed({
      model: "nomic-embed-text",
      input: "hi",
    });

    expect(result.usage).toMatchObject({
      promptTokens: 3,
      completionTokens: 0,
      totalTokens: 3,
    });

    vi.unstubAllGlobals();
  });
});

describe("Non-supporting providers reject embed() loudly", () => {
  it("AnthropicProvider.embed rejects with a clear 'not supported' error", async () => {
    const provider = new AnthropicProvider("test-key");

    await expect(
      provider.embed({ model: "claude-3-5-sonnet", input: "hi" })
    ).rejects.toThrow(/embeddings are not supported/i);
  });
});
