import { afterEach, describe, expect, it, vi } from "vitest";

import { PerplexityProvider } from "../src/providers/perplexity";

describe("PerplexityProvider.fetchModels", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a Bearer auth header when listing models", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "sonar-pro" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new PerplexityProvider("test-key");
    const models = await provider.fetchModels();

    expect(models).toEqual(["sonar-pro"]);
    const [, requestInit] = fetchMock.mock.calls[0];
    expect(requestInit.headers.Authorization).toBe("Bearer test-key");
  });

  it("falls back without prepending a stray 'fallback' entry when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    );

    const provider = new PerplexityProvider("test-key");
    const models = await provider.fetchModels();

    expect(models).not.toContain("fallback");
    expect(models.length).toBeGreaterThan(0);
  });
});

describe("PerplexityProvider citations (Cluster E)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("surfaces citations from a completion carrying citations + search_results", async () => {
    const provider = new PerplexityProvider("test-key");
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "answer", tool_calls: undefined } }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      citations: ["https://a.com", "https://b.com"],
      search_results: [{ url: "https://b.com", title: "B site" }],
    });
    (
      provider as unknown as {
        client: { chat: { completions: { create: typeof create } } };
      }
    ).client = { chat: { completions: { create } } };

    const result = await provider.runLLM(
      [{ role: "user", content: "search this" }],
      { model: "sonar-pro" }
    );

    expect(result.citations).toEqual([
      { url: "https://a.com" },
      { url: "https://b.com" },
      { url: "https://b.com", title: "B site" },
    ]);
  });

  it("leaves citations undefined for a plain OpenAI-style completion", async () => {
    const provider = new PerplexityProvider("test-key");
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "answer", tool_calls: undefined } }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    });
    (
      provider as unknown as {
        client: { chat: { completions: { create: typeof create } } };
      }
    ).client = { chat: { completions: { create } } };

    const result = await provider.runLLM([{ role: "user", content: "hi" }], {
      model: "sonar-pro",
    });

    expect(result.citations).toBeUndefined();
  });
});
