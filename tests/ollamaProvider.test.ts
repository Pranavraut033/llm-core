import { afterEach, describe, expect, it, vi } from "vitest";

import { OllamaProvider } from "../src/providers/ollama";
import { textOnly } from "../src/streamUtils";
import { LLMUsageInfo } from "../src/tokens/usageTypes";
import { LLMStreamEvent } from "../src/types";

function ndjsonStream(lines: object[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
      }
      controller.close();
    },
  });
}

describe("OllamaProvider streaming", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("yields text chunks (not a mislabeled Promise) and reports real eval counts via onUsage", async () => {
    const body = ndjsonStream([
      { message: { role: "assistant", content: "Hel" } },
      { message: { role: "assistant", content: "lo" } },
      { done: true, prompt_eval_count: 5, eval_count: 2 },
    ]);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body }));

    const provider = new OllamaProvider("http://localhost:11434");
    let usage: LLMUsageInfo | undefined;
    const chunks: string[] = [];

    for await (const chunk of textOnly(
      provider.runLLM([{ role: "user", content: "hi" }], {
        model: "llama3",
        stream: true,
        onUsage: (u) => {
          usage = u;
        },
      })
    )) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe("Hello");
    expect(usage).toMatchObject({
      promptTokens: 5,
      completionTokens: 2,
      totalTokens: 7,
    });
  });

  it("yields a tool_call event followed by usage and done", async () => {
    const body = ndjsonStream([
      {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            { function: { name: "get_weather", arguments: { city: "SF" } } },
          ],
        },
      },
      { done: true, prompt_eval_count: 5, eval_count: 2 },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body }));

    const provider = new OllamaProvider("http://localhost:11434");
    const events: LLMStreamEvent[] = [];
    for await (const event of provider.runLLM(
      [{ role: "user", content: "weather in SF?" }],
      {
        model: "llama3",
        stream: true,
        tools: [
          {
            name: "get_weather",
            description: "d",
            parameters: { type: "object" as const, properties: {} },
          },
        ],
      }
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "tool_call",
        toolCall: {
          id: "get_weather_0",
          name: "get_weather",
          arguments: { city: "SF" },
        },
      },
      { type: "usage", usage: expect.objectContaining({ promptTokens: 5 }) },
      { type: "done" },
    ]);
  });

  it("sends temperature/maxTokens through to the Ollama request body", async () => {
    const body = ndjsonStream([
      {
        message: { role: "assistant", content: "hi" },
        done: true,
        prompt_eval_count: 1,
        eval_count: 1,
      },
    ]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaProvider("http://localhost:11434");
    const gen = provider.runLLM([{ role: "user", content: "hi" }], {
      model: "llama3",
      stream: true,
      temperature: 0.3,
      maxTokens: 42,
    });
    for await (const _chunk of gen) {
      // drain
    }

    const [, requestInit] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(requestInit.body as string);
    expect(sentBody.options).toEqual({ temperature: 0.3, num_predict: 42 });
  });
});

describe("OllamaProvider sampling params (Cluster A)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps topP/topK/seed/stopSequences/penalties into request options.*", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { role: "assistant", content: "ok" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaProvider("http://localhost:11434");
    await provider.runLLM([{ role: "user", content: "hi" }], {
      model: "llama3",
      topP: 0.9,
      topK: 40,
      seed: 7,
      stopSequences: ["STOP"],
      frequencyPenalty: 0.2,
      presencePenalty: 0.1,
    });

    const [, requestInit] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(requestInit.body as string);
    expect(sentBody.options).toEqual({
      temperature: undefined,
      num_predict: undefined,
      top_p: 0.9,
      top_k: 40,
      seed: 7,
      stop: ["STOP"],
      frequency_penalty: 0.2,
      presence_penalty: 0.1,
    });
  });

  it("omits sampling fields from request options.* when not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { role: "assistant", content: "ok" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaProvider("http://localhost:11434");
    await provider.runLLM([{ role: "user", content: "hi" }], {
      model: "llama3",
    });

    const [, requestInit] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(requestInit.body as string);
    expect(sentBody.options).toEqual({
      temperature: undefined,
      num_predict: undefined,
    });
  });
});

describe("OllamaProvider.runLLM (non-streaming)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses real prompt_eval_count/eval_count when Ollama returns them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { role: "assistant", content: "hello" },
          prompt_eval_count: 10,
          eval_count: 3,
        }),
      })
    );

    const provider = new OllamaProvider("http://localhost:11434");
    const result = await provider.runLLM([{ role: "user", content: "hi" }], {
      model: "llama3",
    });

    expect(result.result).toBe("hello");
    expect(result.usage).toMatchObject({
      promptTokens: 10,
      completionTokens: 3,
      totalTokens: 13,
    });
  });

  it("sends messages array (not a flattened prompt string) to /api/chat", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { role: "assistant", content: "ok" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaProvider("http://localhost:11434");
    await provider.runLLM(
      [
        { role: "system", content: "be terse" },
        { role: "user", content: "hi" },
      ],
      { model: "llama3" }
    );

    const [url, requestInit] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:11434/api/chat");
    const sentBody = JSON.parse(requestInit.body as string);
    expect(sentBody.messages).toEqual([
      { role: "system", content: "be terse" },
      { role: "user", content: "hi" },
    ]);
  });

  it("round-trips a tool call and its result through the chat message format", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              { function: { name: "get_weather", arguments: { city: "SF" } } },
            ],
          },
          prompt_eval_count: 8,
          eval_count: 4,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { role: "assistant", content: "It is sunny in SF." },
          prompt_eval_count: 12,
          eval_count: 6,
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaProvider("http://localhost:11434");
    const tools = [
      {
        name: "get_weather",
        description: "Get the weather for a city",
        parameters: {
          type: "object" as const,
          properties: { city: { type: "string" as const } },
          required: ["city"],
        },
      },
    ];

    const first = await provider.runLLM(
      [{ role: "user", content: "weather in SF?" }],
      {
        model: "llama3",
        tools,
      }
    );

    expect(first.toolCalls).toEqual([
      { id: "get_weather_0", name: "get_weather", arguments: { city: "SF" } },
    ]);

    const second = await provider.runLLM(
      [
        { role: "user", content: "weather in SF?" },
        {
          role: "assistant",
          content: "",
          toolCalls: first.toolCalls,
        },
        {
          role: "tool",
          content: "72F and sunny",
          toolCallId: first.toolCalls![0].id,
          toolName: "get_weather",
        },
      ],
      { model: "llama3", tools }
    );

    expect(second.result).toBe("It is sunny in SF.");
    const [, secondRequestInit] = fetchMock.mock.calls[1];
    const sentBody = JSON.parse(secondRequestInit.body as string);
    expect(sentBody.messages).toContainEqual({
      role: "tool",
      content: "72F and sunny",
      tool_name: "get_weather",
    });
    expect(sentBody.messages).toContainEqual({
      role: "assistant",
      content: "",
      tool_calls: [
        { function: { name: "get_weather", arguments: { city: "SF" } } },
      ],
    });
  });

  it("omits tools from the request when toolChoice is none", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { role: "assistant", content: "ok" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaProvider("http://localhost:11434");
    await provider.runLLM([{ role: "user", content: "hi" }], {
      model: "llama3",
      toolChoice: "none",
      tools: [
        {
          name: "noop",
          description: "does nothing",
          parameters: { type: "object" as const, properties: {} },
        },
      ],
    });

    const [, requestInit] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(requestInit.body as string);
    expect(sentBody.tools).toBeUndefined();
  });
});

describe("OllamaProvider content parts (Cluster D multimodal)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("collects a base64 image part into the sibling images array, keeping content as flattened text", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { role: "assistant", content: "ok" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaProvider("http://localhost:11434");
    await provider.runLLM(
      [
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            {
              type: "image",
              image: { data: "abc123", mediaType: "image/png" },
            },
          ],
        },
      ],
      { model: "llama3" }
    );

    const [, requestInit] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(requestInit.body as string);
    expect(sentBody.messages[0]).toEqual({
      role: "user",
      content: "What is this?",
      images: ["abc123"],
    });
  });

  it("degrades a URL-form image part to a text placeholder (no images-array support)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { role: "assistant", content: "ok" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaProvider("http://localhost:11434");
    await provider.runLLM(
      [
        {
          role: "user",
          content: [
            { type: "image", image: { url: "https://example.com/cat.png" } },
          ],
        },
      ],
      { model: "llama3" }
    );

    const [, requestInit] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(requestInit.body as string);
    expect(sentBody.messages[0]).toEqual({
      role: "user",
      content: "[image: https://example.com/cat.png]",
    });
  });

  it("degrades a document part to a text placeholder (no document support)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { role: "assistant", content: "ok" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaProvider("http://localhost:11434");
    await provider.runLLM(
      [
        {
          role: "user",
          content: [
            {
              type: "document",
              document: { url: "https://example.com/resume.pdf" },
            },
          ],
        },
      ],
      { model: "llama3" }
    );

    const [, requestInit] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(requestInit.body as string);
    expect(sentBody.messages[0]).toEqual({
      role: "user",
      content: "[document: https://example.com/resume.pdf]",
    });
  });

  it("plain string content still produces identical output (regression guard)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { role: "assistant", content: "ok" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaProvider("http://localhost:11434");
    await provider.runLLM([{ role: "user", content: "hi" }], {
      model: "llama3",
    });

    const [, requestInit] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(requestInit.body as string);
    expect(sentBody.messages[0]).toEqual({ role: "user", content: "hi" });
  });
});
