import { describe, expect, it } from "vitest";

import { AnthropicProvider } from "../src/providers/anthropic";
import {
  LLMGenerationOptions,
  LLMStreamEvent,
  PromptMessage,
} from "../src/types";

class TestableAnthropic extends AnthropicProvider {
  constructor(streamEvents?: unknown[]) {
    super("test-key");
    if (streamEvents) {
      (
        this as unknown as {
          client: { messages: { stream: () => unknown[] } };
        }
      ).client = { messages: { stream: () => streamEvents } };
    }
  }

  callToAnthropicRequest(
    messages: PromptMessage[],
    options: LLMGenerationOptions
  ) {
    return this.toAnthropicRequest(messages, options);
  }
}

function provider(streamEvents?: unknown[]): TestableAnthropic {
  return new TestableAnthropic(streamEvents);
}

const baseOptions: LLMGenerationOptions = { model: "claude-sonnet-4-5" };

describe("AnthropicProvider.toAnthropicRequest (tool loop)", () => {
  it("emits a tool_use block for an assistant message with toolCalls", () => {
    const messages: PromptMessage[] = [
      {
        role: "assistant",
        content: "Let me check.",
        toolCalls: [
          { id: "toolu_1", name: "search", arguments: { q: "cats" } },
        ],
      },
    ];

    const request = provider().callToAnthropicRequest(messages, baseOptions);

    expect(request.messages[0]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "Let me check." },
        {
          type: "tool_use",
          id: "toolu_1",
          name: "search",
          input: { q: "cats" },
        },
      ],
    });
  });

  it("emits a tool_result block for a tool-role message, as a user turn", () => {
    const messages: PromptMessage[] = [
      { role: "tool", content: "42 results", toolCallId: "toolu_1" },
    ];

    const request = provider().callToAnthropicRequest(messages, baseOptions);

    expect(request.messages[0]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "toolu_1", content: "42 results" },
      ],
    });
  });

  it("merges consecutive tool-role messages into a single user turn", () => {
    const messages: PromptMessage[] = [
      { role: "tool", content: "result A", toolCallId: "toolu_1" },
      { role: "tool", content: "result B", toolCallId: "toolu_2" },
    ];

    const request = provider().callToAnthropicRequest(messages, baseOptions);

    expect(request.messages).toHaveLength(1);
    expect(request.messages[0]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "toolu_1", content: "result A" },
        { type: "tool_result", tool_use_id: "toolu_2", content: "result B" },
      ],
    });
  });

  it("maps toolChoice 'required' to Anthropic's {type: 'any'}", () => {
    const messages: PromptMessage[] = [{ role: "user", content: "hi" }];
    const request = provider().callToAnthropicRequest(messages, {
      ...baseOptions,
      toolChoice: "required",
      tools: [
        {
          name: "search",
          description: "search",
          parameters: { type: "object", properties: {} },
        },
      ],
    });

    expect(request.tool_choice).toEqual({ type: "any" });
  });
});

describe("AnthropicProvider.toAnthropicRequest (Cluster A sampling params)", () => {
  it("maps topP/topK/stopSequences to their Anthropic wire names", () => {
    const request = provider().callToAnthropicRequest(
      [{ role: "user", content: "hi" }],
      {
        ...baseOptions,
        topP: 0.9,
        topK: 40,
        stopSequences: ["STOP"],
      }
    );

    expect(request.top_p).toBe(0.9);
    expect(request.top_k).toBe(40);
    expect(request.stop_sequences).toEqual(["STOP"]);
  });

  it("maps thinkingBudget to thinking:{type:'enabled', budget_tokens}", () => {
    const request = provider().callToAnthropicRequest(
      [{ role: "user", content: "hi" }],
      { ...baseOptions, thinkingBudget: 2048 }
    );

    expect(request.thinking).toEqual({
      type: "enabled",
      budget_tokens: 2048,
    });
  });

  it("omits sampling/thinking fields when not provided", () => {
    const request = provider().callToAnthropicRequest(
      [{ role: "user", content: "hi" }],
      baseOptions
    );

    expect(request).not.toHaveProperty("top_p");
    expect(request).not.toHaveProperty("top_k");
    expect(request).not.toHaveProperty("stop_sequences");
    expect(request).not.toHaveProperty("thinking");
  });

  it("does not map frequencyPenalty/presencePenalty/seed/reasoningEffort — Anthropic has no such params", () => {
    const request = provider().callToAnthropicRequest(
      [{ role: "user", content: "hi" }],
      {
        ...baseOptions,
        frequencyPenalty: 0.5,
        presencePenalty: 0.5,
        seed: 7,
        reasoningEffort: "high",
      }
    );

    expect(request).not.toHaveProperty("frequency_penalty");
    expect(request).not.toHaveProperty("presence_penalty");
    expect(request).not.toHaveProperty("seed");
    expect(request).not.toHaveProperty("reasoning_effort");
  });
});

describe("AnthropicProvider.toAnthropicRequest (Cluster E prompt caching)", () => {
  const tools = [
    {
      name: "search",
      description: "search",
      parameters: { type: "object" as const, properties: {} },
    },
    {
      name: "get_weather",
      description: "get weather",
      parameters: { type: "object" as const, properties: {} },
    },
  ];

  it("cacheControl: true stamps cache_control on both the system block and the last tool", () => {
    const request = provider().callToAnthropicRequest(
      [
        { role: "system", content: "be terse" },
        { role: "user", content: "hi" },
      ],
      { ...baseOptions, tools, cacheControl: true }
    );

    expect(request.system).toEqual([
      {
        type: "text",
        text: "be terse",
        cache_control: { type: "ephemeral" },
      },
    ]);
    expect(request.tools?.[0]).not.toHaveProperty("cache_control");
    expect(request.tools?.[1]?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("cacheControl: 'system' caches only the system block", () => {
    const request = provider().callToAnthropicRequest(
      [
        { role: "system", content: "be terse" },
        { role: "user", content: "hi" },
      ],
      { ...baseOptions, tools, cacheControl: "system" }
    );

    expect(request.system).toEqual([
      {
        type: "text",
        text: "be terse",
        cache_control: { type: "ephemeral" },
      },
    ]);
    expect(request.tools?.[1]).not.toHaveProperty("cache_control");
  });

  it("cacheControl: 'tools' caches only the last tool", () => {
    const request = provider().callToAnthropicRequest(
      [
        { role: "system", content: "be terse" },
        { role: "user", content: "hi" },
      ],
      { ...baseOptions, tools, cacheControl: "tools" }
    );

    expect(request.system).toBe("be terse");
    expect(request.tools?.[1]?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("without cacheControl, no cache_control appears anywhere", () => {
    const request = provider().callToAnthropicRequest(
      [
        { role: "system", content: "be terse" },
        { role: "user", content: "hi" },
      ],
      { ...baseOptions, tools }
    );

    expect(request.system).toBe("be terse");
    expect(request.tools?.[0]).not.toHaveProperty("cache_control");
    expect(request.tools?.[1]).not.toHaveProperty("cache_control");
  });
});

describe("AnthropicProvider.toAnthropicRequest (Cluster D multimodal)", () => {
  it("maps a user message with text + base64 image parts to text/image content blocks", () => {
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

    const request = provider().callToAnthropicRequest(messages, baseOptions);

    expect(request.messages[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "What is this?" },
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "abc123" },
        },
      ],
    });
  });

  it("maps a URL-form image part to an image block with a url source", () => {
    const messages: PromptMessage[] = [
      {
        role: "user",
        content: [
          { type: "image", image: { url: "https://example.com/cat.png" } },
        ],
      },
    ];

    const request = provider().callToAnthropicRequest(messages, baseOptions);

    expect(request.messages[0]).toEqual({
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "url", url: "https://example.com/cat.png" },
        },
      ],
    });
  });

  it("maps a base64 document part to a document block", () => {
    const messages: PromptMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "document",
            document: { data: "pdfdata", mediaType: "application/pdf" },
          },
        ],
      },
    ];

    const request = provider().callToAnthropicRequest(messages, baseOptions);

    expect(request.messages[0]).toEqual({
      role: "user",
      content: [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: "pdfdata",
          },
        },
      ],
    });
  });

  it("maps a URL-form document part to a document block with a url source", () => {
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

    const request = provider().callToAnthropicRequest(messages, baseOptions);

    expect(request.messages[0]).toEqual({
      role: "user",
      content: [
        {
          type: "document",
          source: { type: "url", url: "https://example.com/resume.pdf" },
        },
      ],
    });
  });

  it("plain string content still produces identical output (regression guard)", () => {
    const request = provider().callToAnthropicRequest(
      [{ role: "user", content: "hi" }],
      baseOptions
    );

    expect(request.messages[0]).toEqual({ role: "user", content: "hi" });
  });
});

describe("AnthropicProvider streaming (rich events)", () => {
  it("yields text deltas, accumulates input_json_delta fragments into a tool_call, then usage/done", async () => {
    const events = [
      {
        type: "message_start",
        message: {
          usage: {
            input_tokens: 10,
            cache_creation: null,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            inference_geo: null,
            server_tool_use: null,
            service_tier: null,
          },
        },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hel" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "lo" },
      },
      {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "toolu_1",
          name: "get_weather",
          input: {},
        },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"ci' },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: 'ty":"SF"}' },
      },
      { type: "content_block_stop", index: 1 },
      {
        type: "message_delta",
        usage: { output_tokens: 5, server_tool_use: null },
      },
    ];

    const events_: LLMStreamEvent[] = [];
    for await (const event of provider(events).runLLM(
      [{ role: "user", content: "weather in SF?" }],
      { model: "claude-sonnet-4-5", stream: true }
    )) {
      events_.push(event);
    }

    expect(events_).toEqual([
      { type: "text", delta: "Hel" },
      { type: "text", delta: "lo" },
      {
        type: "tool_call",
        toolCall: {
          id: "toolu_1",
          name: "get_weather",
          arguments: { city: "SF" },
        },
      },
      {
        type: "usage",
        usage: expect.objectContaining({
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        }),
      },
      { type: "done" },
    ]);
  });
});
