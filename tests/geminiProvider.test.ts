import { FunctionCallingConfigMode, Type } from "@google/genai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { GeminiProvider } from "../src/providers/gemini";
import { LLMStreamEvent } from "../src/types";

const generateContent = vi.fn();
const generateContentStream = vi.fn();

vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  return {
    ...actual,
    GoogleGenAI: vi.fn().mockImplementation(function GoogleGenAI(this: {
      models: unknown;
    }) {
      this.models = { generateContent, generateContentStream };
    }),
  };
});

describe("GeminiProvider tool loop", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends a proper multi-turn contents array with functionDeclarations, not a flattened string", async () => {
    generateContent.mockResolvedValue({
      text: "It is sunny in SF.",
      usageMetadata: {
        promptTokenCount: 12,
        candidatesTokenCount: 6,
        totalTokenCount: 18,
      },
    });

    const provider = new GeminiProvider("test-key");
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

    await provider.runLLM(
      [
        { role: "system", content: "be terse" },
        { role: "user", content: "weather in SF?" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "call_1", name: "get_weather", arguments: { city: "SF" } },
          ],
        },
        {
          role: "tool",
          content: "72F and sunny",
          toolCallId: "call_1",
          toolName: "get_weather",
        },
      ],
      { model: "gemini-2.5-flash", tools }
    );

    const call = generateContent.mock.calls[0][0];
    expect(call.config.systemInstruction).toBe("be terse");
    expect(call.contents).toEqual([
      { role: "user", parts: [{ text: "weather in SF?" }] },
      {
        role: "model",
        parts: [
          { functionCall: { name: "get_weather", args: { city: "SF" } } },
        ],
      },
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "get_weather",
              response: { output: "72F and sunny" },
            },
          },
        ],
      },
    ]);
    expect(call.config.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: "get_weather",
            description: "Get the weather for a city",
            parameters: expect.objectContaining({ type: "OBJECT" }),
          },
        ],
      },
    ]);
  });

  it("extracts functionCalls from the response into toolCalls", async () => {
    generateContent.mockResolvedValue({
      text: "",
      functionCalls: [{ name: "get_weather", args: { city: "SF" } }],
      usageMetadata: {
        promptTokenCount: 5,
        candidatesTokenCount: 2,
        totalTokenCount: 7,
      },
    });

    const provider = new GeminiProvider("test-key");
    const result = await provider.runLLM(
      [{ role: "user", content: "weather in SF?" }],
      {
        model: "gemini-2.5-flash",
        tools: [
          {
            name: "get_weather",
            description: "Get the weather for a city",
            parameters: {
              type: "object" as const,
              properties: { city: { type: "string" as const } },
            },
          },
        ],
      }
    );

    expect(result.toolCalls).toEqual([
      { id: "get_weather_0", name: "get_weather", arguments: { city: "SF" } },
    ]);
  });

  it("maps toolChoice to Gemini's toolConfig.functionCallingConfig", async () => {
    generateContent.mockResolvedValue({ text: "ok" });

    const provider = new GeminiProvider("test-key");
    const tools = [
      {
        name: "get_weather",
        description: "d",
        parameters: { type: "object" as const, properties: {} },
      },
    ];

    await provider.runLLM([{ role: "user", content: "hi" }], {
      model: "gemini-2.5-flash",
      tools,
      toolChoice: "required",
    });
    expect(generateContent.mock.calls[0][0].config.toolConfig).toEqual({
      functionCallingConfig: { mode: FunctionCallingConfigMode.ANY },
    });

    await provider.runLLM([{ role: "user", content: "hi" }], {
      model: "gemini-2.5-flash",
      tools,
      toolChoice: { type: "tool", name: "get_weather" },
    });
    expect(generateContent.mock.calls[1][0].config.toolConfig).toEqual({
      functionCallingConfig: {
        mode: FunctionCallingConfigMode.ANY,
        allowedFunctionNames: ["get_weather"],
      },
    });
  });

  it("does not send tools/toolConfig when no tools are provided", async () => {
    generateContent.mockResolvedValue({ text: "ok" });

    const provider = new GeminiProvider("test-key");
    await provider.runLLM([{ role: "user", content: "hi" }], {
      model: "gemini-2.5-flash",
    });

    const call = generateContent.mock.calls[0][0];
    expect(call.config.tools).toBeUndefined();
    expect(call.config.toolConfig).toBeUndefined();
  });
});

describe("GeminiProvider sampling/reasoning params (Cluster A)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("maps topP/topK/stopSequences/thinkingBudget into config", async () => {
    generateContent.mockResolvedValue({ text: "ok" });

    const provider = new GeminiProvider("test-key");
    await provider.runLLM([{ role: "user", content: "hi" }], {
      model: "gemini-2.5-flash",
      topP: 0.8,
      topK: 20,
      stopSequences: ["STOP"],
      thinkingBudget: 1024,
    });

    const call = generateContent.mock.calls[0][0];
    expect(call.config.topP).toBe(0.8);
    expect(call.config.topK).toBe(20);
    expect(call.config.stopSequences).toEqual(["STOP"]);
    expect(call.config.thinkingConfig).toEqual({ thinkingBudget: 1024 });
  });

  it("omits sampling/thinking fields from config when not provided", async () => {
    generateContent.mockResolvedValue({ text: "ok" });

    const provider = new GeminiProvider("test-key");
    await provider.runLLM([{ role: "user", content: "hi" }], {
      model: "gemini-2.5-flash",
    });

    const call = generateContent.mock.calls[0][0];
    expect(call.config.topP).toBeUndefined();
    expect(call.config.topK).toBeUndefined();
    expect(call.config.stopSequences).toBeUndefined();
    expect(call.config.thinkingConfig).toBeUndefined();
  });
});

describe("GeminiProvider streaming (rich events)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("yields text deltas, a tool_call from a chunk's functionCalls, then usage/done", async () => {
    generateContentStream.mockResolvedValue([
      { text: "Hel" },
      { text: "lo" },
      {
        text: "",
        functionCalls: [{ name: "get_weather", args: { city: "SF" } }],
      },
      {
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 2,
          totalTokenCount: 7,
        },
      },
    ]);

    const provider = new GeminiProvider("test-key");
    const events: LLMStreamEvent[] = [];
    for await (const event of provider.runLLM(
      [{ role: "user", content: "weather in SF?" }],
      { model: "gemini-2.5-flash", stream: true }
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text", delta: "Hel" },
      { type: "text", delta: "lo" },
      {
        type: "tool_call",
        toolCall: {
          id: "get_weather_0",
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

describe("GeminiProvider.toGeminiSchema fidelity (Cluster E)", () => {
  it("resolves a $ref/$defs nested object instead of falling back to STRING", () => {
    const provider = new GeminiProvider("test-key");

    const Address = z.object({
      street: z.string(),
      city: z.string(),
    });
    const Person = z.object({
      name: z.string(),
      address: Address,
      // nullable/optional field alongside the $ref
      nickname: z.string().nullable(),
    });

    const schema = provider.toGeminiSchema(Person);

    expect(schema.type).toBe(Type.OBJECT);
    expect(schema.properties?.address.type).toBe(Type.OBJECT);
    expect(schema.properties?.address.properties?.street.type).toBe(
      Type.STRING
    );
    expect(schema.properties?.address.properties?.city.type).toBe(Type.STRING);
    // must not have degraded to the STRING fallback
    expect(schema.properties?.address.type).not.toBe(Type.STRING);
  });

  it("collapses a nullable union (anyOf [T, null]) to T with nullable:true", () => {
    const provider = new GeminiProvider("test-key");
    const schema = provider.toGeminiSchema(
      z.object({ nickname: z.string().nullable() })
    );

    expect(schema.properties?.nickname.type).toBe(Type.STRING);
    expect(schema.properties?.nickname.nullable).toBe(true);
  });

  it("collapses a type:[T,'null'] array into T with nullable:true", () => {
    const provider = new GeminiProvider("test-key");
    const schema = provider.toGeminiSchema(
      z.object({ age: z.number().nullable() })
    );

    // Zod v4 may emit either anyOf or a type-array for nullable — either
    // way the number/null pair must resolve to NUMBER + nullable, not
    // fall back to STRING.
    expect([Type.NUMBER, Type.INTEGER]).toContain(schema.properties?.age.type);
    expect(schema.properties?.age.nullable).toBe(true);
  });
});

describe("GeminiProvider content parts (Cluster D multimodal)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("maps a user message with text + base64 image parts to text/inlineData parts", async () => {
    generateContent.mockResolvedValue({ text: "ok" });

    const provider = new GeminiProvider("test-key");
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
      { model: "gemini-2.5-flash" }
    );

    const call = generateContent.mock.calls[0][0];
    expect(call.contents).toEqual([
      {
        role: "user",
        parts: [
          { text: "What is this?" },
          { inlineData: { mimeType: "image/png", data: "abc123" } },
        ],
      },
    ]);
  });

  it("maps a URL-form image part to a fileData part", async () => {
    generateContent.mockResolvedValue({ text: "ok" });

    const provider = new GeminiProvider("test-key");
    await provider.runLLM(
      [
        {
          role: "user",
          content: [
            { type: "image", image: { url: "https://example.com/cat.png" } },
          ],
        },
      ],
      { model: "gemini-2.5-flash" }
    );

    const call = generateContent.mock.calls[0][0];
    expect(call.contents).toEqual([
      {
        role: "user",
        parts: [{ fileData: { fileUri: "https://example.com/cat.png" } }],
      },
    ]);
  });

  it("maps a base64 document part to an inlineData part", async () => {
    generateContent.mockResolvedValue({ text: "ok" });

    const provider = new GeminiProvider("test-key");
    await provider.runLLM(
      [
        {
          role: "user",
          content: [
            {
              type: "document",
              document: { data: "pdfdata", mediaType: "application/pdf" },
            },
          ],
        },
      ],
      { model: "gemini-2.5-flash" }
    );

    const call = generateContent.mock.calls[0][0];
    expect(call.contents).toEqual([
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "application/pdf", data: "pdfdata" } },
        ],
      },
    ]);
  });

  it("plain string content still produces identical output (regression guard)", async () => {
    generateContent.mockResolvedValue({ text: "ok" });

    const provider = new GeminiProvider("test-key");
    await provider.runLLM([{ role: "user", content: "hi" }], {
      model: "gemini-2.5-flash",
    });

    const call = generateContent.mock.calls[0][0];
    expect(call.contents).toEqual([{ role: "user", parts: [{ text: "hi" }] }]);
  });
});
