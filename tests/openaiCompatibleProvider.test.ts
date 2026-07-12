import { describe, expect, it } from "vitest";

import { OpenAICompatibleProvider } from "../src/providers/openaiCompatibleProvider";
import { ProviderId } from "../src/providerType";
import {
  LLMGenerationOptions,
  LLMStreamEvent,
  PromptMessage,
  ToolDefinition,
} from "../src/types";

class TestableOpenAICompatible extends OpenAICompatibleProvider {
  constructor(streamChunks?: unknown[]) {
    super({ apiKey: "test-key" });
    if (streamChunks) {
      (
        this as unknown as {
          client: { chat: { completions: { stream: () => unknown[] } } };
        }
      ).client = { chat: { completions: { stream: () => streamChunks } } };
    }
  }

  get providerType(): ProviderId {
    return "openai" as ProviderId;
  }

  async fetchModels(): Promise<string[]> {
    return [];
  }

  callToOpenAIToolChoice(
    toolChoice: LLMGenerationOptions["toolChoice"],
    hasTools: boolean
  ) {
    return this.toOpenAIToolChoice(toolChoice, hasTools);
  }

  callToChatMessages(messages: PromptMessage[]) {
    return this.toChatMessages(messages);
  }

  callToOpenAISamplingParams(options: LLMGenerationOptions) {
    return this.toOpenAISamplingParams(options);
  }
}

function provider(streamChunks?: unknown[]): TestableOpenAICompatible {
  return new TestableOpenAICompatible(streamChunks);
}

describe("OpenAICompatibleProvider.toOpenAIToolChoice", () => {
  it("returns undefined when there's no toolChoice or no tools are offered", () => {
    expect(provider().callToOpenAIToolChoice(undefined, true)).toBeUndefined();
    expect(provider().callToOpenAIToolChoice("auto", false)).toBeUndefined();
  });

  it("passes auto/none through as-is", () => {
    expect(provider().callToOpenAIToolChoice("auto", true)).toBe("auto");
    expect(provider().callToOpenAIToolChoice("none", true)).toBe("none");
  });

  it("maps a named tool choice to the OpenAI function shape", () => {
    expect(
      provider().callToOpenAIToolChoice({ type: "tool", name: "search" }, true)
    ).toEqual({ type: "function", function: { name: "search" } });
  });

  it("passes required through as-is", () => {
    expect(provider().callToOpenAIToolChoice("required", true)).toBe(
      "required"
    );
  });
});

describe("OpenAICompatibleProvider.toChatMessages (tool loop)", () => {
  it("maps an assistant message with toolCalls to tool_calls, stringifying arguments", () => {
    const messages: PromptMessage[] = [
      {
        role: "assistant",
        content: "Let me check.",
        toolCalls: [{ id: "call_1", name: "search", arguments: { q: "cats" } }],
      },
    ];

    const result = provider().callToChatMessages(messages);

    expect(result[0]).toEqual({
      role: "assistant",
      content: "Let me check.",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "search", arguments: '{"q":"cats"}' },
        },
      ],
    });
  });

  it("maps a tool message to role:tool with tool_call_id", () => {
    const messages: PromptMessage[] = [
      { role: "tool", content: "42 results", toolCallId: "call_1" },
    ];

    const result = provider().callToChatMessages(messages);

    expect(result[0]).toEqual({
      role: "tool",
      content: "42 results",
      tool_call_id: "call_1",
    });
  });

  it("passes plain user/system/assistant messages through unchanged", () => {
    const messages: PromptMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];

    expect(provider().callToChatMessages(messages)).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });
});

describe("OpenAICompatibleProvider.toChatMessages (Cluster D multimodal)", () => {
  it("maps a user message with text + base64 image parts to a data-URL image_url part", () => {
    const messages: PromptMessage[] = [
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
    ];

    const result = provider().callToChatMessages(messages);

    expect(result[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "What is this?" },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,abc123" },
        },
      ],
    });
  });

  it("maps a URL-form image part to image_url with the raw url", () => {
    const messages: PromptMessage[] = [
      {
        role: "user",
        content: [
          { type: "image", image: { url: "https://example.com/cat.png" } },
        ],
      },
    ];

    const result = provider().callToChatMessages(messages);

    expect(result[0]).toEqual({
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: { url: "https://example.com/cat.png" },
        },
      ],
    });
  });

  it("degrades a document part to a text placeholder without crashing", () => {
    const messages: PromptMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "document",
            document: { url: "https://example.com/resume.pdf" },
          },
        ],
      },
    ];

    const result = provider().callToChatMessages(messages);

    expect(result[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "[document: https://example.com/resume.pdf]" },
      ],
    });
  });

  it("degrades a non-text assistant content part to a text placeholder", () => {
    const messages: PromptMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "image",
            image: { data: "abc123", mediaType: "image/png" },
          },
        ],
      },
    ];

    const result = provider().callToChatMessages(messages);

    expect(result[0]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "[image]" }],
    });
  });

  it("plain string content still produces identical output (regression guard)", () => {
    const messages: PromptMessage[] = [{ role: "user", content: "hi" }];
    expect(provider().callToChatMessages(messages)).toEqual([
      { role: "user", content: "hi" },
    ]);
  });
});

describe("OpenAICompatibleProvider.toOpenAITool", () => {
  const baseTool: ToolDefinition = {
    name: "search",
    description: "Search the web",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      additionalProperties: true,
    },
  };

  it("preserves the caller's additionalProperties when not strict", () => {
    const result = provider().toOpenAITool(baseTool);
    if (result.type !== "function") throw new Error("expected function tool");
    expect(result.function.parameters?.additionalProperties).toBe(true);
  });

  it("forces additionalProperties:false when strict", () => {
    const result = provider().toOpenAITool({ ...baseTool, strict: true });
    if (result.type !== "function") throw new Error("expected function tool");
    expect(result.function.parameters?.additionalProperties).toBe(false);
  });
});

describe("OpenAICompatibleProvider.toOpenAISamplingParams (Cluster A)", () => {
  it("maps sampling/reasoning options to their OpenAI wire names", () => {
    const result = provider().callToOpenAISamplingParams({
      model: "gpt-4o",
      topP: 0.9,
      frequencyPenalty: 0.2,
      presencePenalty: 0.1,
      seed: 42,
      stopSequences: ["\n\n", "END"],
      reasoningEffort: "high",
    });

    expect(result).toEqual({
      top_p: 0.9,
      frequency_penalty: 0.2,
      presence_penalty: 0.1,
      seed: 42,
      stop: ["\n\n", "END"],
      reasoning_effort: "high",
    });
  });

  it("omits every field when no sampling options are given", () => {
    expect(provider().callToOpenAISamplingParams({ model: "gpt-4o" })).toEqual(
      {}
    );
  });

  it("does not map topK — the OpenAI dialect has no such param", () => {
    const result = provider().callToOpenAISamplingParams({
      model: "gpt-4o",
      topK: 40,
    });
    expect(result).not.toHaveProperty("top_k");
  });
});

describe("OpenAICompatibleProvider streaming (rich events)", () => {
  it("yields text deltas, accumulates tool_call argument fragments by index, then usage/done", async () => {
    const chunks = [
      { choices: [{ delta: { content: "Hel" } }] },
      { choices: [{ delta: { content: "lo" } }] },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  function: { name: "get_weather", arguments: '{"ci' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: 'ty":"SF"}' } }],
            },
          },
        ],
      },
      {
        choices: [{ delta: {} }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      },
    ];

    const events: LLMStreamEvent[] = [];
    for await (const event of provider(chunks).runLLM(
      [{ role: "user", content: "weather in SF?" }],
      { model: "gpt-4o", stream: true }
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text", delta: "Hel" },
      { type: "text", delta: "lo" },
      {
        type: "tool_call",
        toolCall: {
          id: "call_1",
          name: "get_weather",
          arguments: { city: "SF" },
        },
      },
      {
        type: "usage",
        usage: expect.objectContaining({
          promptTokens: 5,
          completionTokens: 2,
          totalTokens: 7,
        }),
      },
      { type: "done" },
    ]);
  });
});
