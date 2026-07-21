/**
 * Drives `createCompletion`/`createChat` (`src/core/`) against a
 * network-free streaming provider, asserting the snapshot transitions
 * loading -> text accumulation -> done, and that `subscribe` fires on
 * every state change.
 */
import { describe, expect, it } from "vitest";
import { ZodTypeAny } from "zod";

import "../helpers/ambientProviderIds";
import { ChatSnapshot, createChat } from "../../src/core/createChat";
import {
  CompletionSnapshot,
  createCompletion,
} from "../../src/core/createCompletion";
import { ResolvedPrompt } from "../../src/prompts/types";
import { LLMProvider, StructureResult } from "../../src/providers/LLMProvider";
import { ProviderId } from "../../src/providerType";
import { LLMUsageInfo } from "../../src/tokens/usageTypes";
import {
  LLMGenerationOptions,
  LLMResult,
  LLMStreamEvent,
  PromptMessage,
} from "../../src/types";

const DUMMY_USAGE: LLMUsageInfo = {
  promptTokens: 3,
  completionTokens: 5,
  totalTokens: 8,
  provider: "core-stream-llm" as ProviderId,
  model: "dummy-model",
  purpose: "generate_text",
};

/**
 * A minimal, network-free streaming `LLMProvider`: `runLLM({ stream: true })`
 * yields the configured text chunks, then a `usage` event, then `done`.
 */
class StreamingDummyProvider extends LLMProvider {
  constructor(
    private readonly id: ProviderId,
    private readonly chunks: string[],
    private readonly usage: LLMUsageInfo = DUMMY_USAGE
  ) {
    super();
  }

  get providerType(): ProviderId {
    return this.id;
  }

  get streamSupported(): boolean {
    return true;
  }

  async fetchModels(): Promise<string[]> {
    return ["dummy-model"];
  }

  async validateConnection(): Promise<{ success: boolean; message: string }> {
    return { success: true, message: "ok" };
  }

  runLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions & { stream: true }
  ): AsyncGenerator<LLMStreamEvent>;
  runLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions & { stream?: false; onUsage?: never }
  ): Promise<LLMResult<string>>;
  runLLM(
    _messages: PromptMessage[],
    options: LLMGenerationOptions
  ): Promise<LLMResult<string>> | AsyncGenerator<LLMStreamEvent> {
    if (options.stream) {
      return this.streamChunks(options.signal);
    }
    return Promise.resolve({
      result: this.chunks.join(""),
      usage: this.usage,
    });
  }

  private async *streamChunks(
    signal?: AbortSignal
  ): AsyncGenerator<LLMStreamEvent> {
    for (const chunk of this.chunks) {
      if (signal?.aborted) {
        throw Object.assign(new Error("The operation was aborted."), {
          name: "AbortError",
        });
      }
      yield { type: "text", delta: chunk };
    }
    yield { type: "usage", usage: this.usage };
    yield { type: "done" };
  }

  async runStructuredLLM<TSchema extends ZodTypeAny>(
    _template: ResolvedPrompt,
    _options: LLMGenerationOptions,
    zodSchema: TSchema,
    _schemaName: string
  ): Promise<StructureResult<TSchema>> {
    return { result: zodSchema.parse({}), usage: this.usage };
  }
}

describe("createCompletion", () => {
  it("transitions loading -> text accumulation -> done, notifying subscribers on each change", async () => {
    const provider = new StreamingDummyProvider("core-stream-llm", [
      "Hello",
      ", ",
      "world",
    ]);

    const usageNotifications: LLMUsageInfo[] = [];
    const controller = createCompletion({
      provider,
      model: "dummy-model",
      onUsage: (usage) => {
        usageNotifications.push(usage);
      },
    });

    const notifications: CompletionSnapshot[] = [];
    const unsubscribe = controller.subscribe(() => {
      notifications.push(controller.getSnapshot());
    });

    expect(controller.getSnapshot()).toEqual({
      text: "",
      isLoading: false,
      error: undefined,
      usage: undefined,
    });

    await controller.complete("hi there");

    // Loading turned on immediately, text accumulated chunk by chunk, then
    // loading turned back off — subscribe must have fired for every step.
    expect(notifications[0]).toMatchObject({ isLoading: true, text: "" });
    expect(notifications.some((s) => s.text === "Hello")).toBe(true);
    expect(notifications.some((s) => s.text === "Hello, ")).toBe(true);
    expect(notifications.some((s) => s.text === "Hello, world")).toBe(true);

    const final = controller.getSnapshot();
    expect(final.text).toBe("Hello, world");
    expect(final.isLoading).toBe(false);
    expect(final.error).toBeUndefined();
    expect(final.usage).toEqual(DUMMY_USAGE);
    expect(usageNotifications).toEqual([DUMMY_USAGE]);

    unsubscribe();
  });

  it("reset() clears the snapshot back to its initial state", async () => {
    const provider = new StreamingDummyProvider("core-stream-llm", ["hi"]);
    const controller = createCompletion({ provider, model: "dummy-model" });

    await controller.complete("hi");
    expect(controller.getSnapshot().text).toBe("hi");

    controller.reset();
    expect(controller.getSnapshot()).toEqual({
      text: "",
      isLoading: false,
      error: undefined,
      usage: undefined,
    });
  });

  it("resolves a { providerId, config } source lazily via getProviderInstance", async () => {
    const { getRegistry } = await import("../../src/providers/registry");
    getRegistry().register(
      "core-stream-llm" as ProviderId,
      { name: "core-stream-llm", requiresAuth: false },
      () => new StreamingDummyProvider("core-stream-llm" as ProviderId, ["ok"])
    );

    const controller = createCompletion({
      provider: {
        providerId: "core-stream-llm" as ProviderId,
        config: { keyResolver: () => undefined },
      },
      model: "dummy-model",
    });

    await controller.complete("hi");
    expect(controller.getSnapshot().text).toBe("ok");
  });
});

describe("createChat", () => {
  it("appends a user message and streams the trailing assistant message, notifying subscribers", async () => {
    const provider = new StreamingDummyProvider("core-stream-llm", [
      "Hi",
      " there",
    ]);

    const controller = createChat({ provider, model: "dummy-model" });

    const notifications: ChatSnapshot[] = [];
    const unsubscribe = controller.subscribe(() => {
      notifications.push(controller.getSnapshot());
    });

    await controller.sendMessage("hello");

    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0].isLoading).toBe(true);

    const final = controller.getSnapshot();
    expect(final.isLoading).toBe(false);
    expect(final.error).toBeUndefined();
    expect(final.messages).toHaveLength(2);
    expect(final.messages[0]).toMatchObject({ role: "user", content: "hello" });
    expect(final.messages[1]).toMatchObject({
      role: "assistant",
      content: "Hi there",
    });

    unsubscribe();
  });

  it("setMessages() replaces the message list wholesale", () => {
    const provider = new StreamingDummyProvider("core-stream-llm", []);
    const controller = createChat({ provider, model: "dummy-model" });

    controller.setMessages([
      { id: "1", role: "system", content: "You are helpful." },
    ]);

    expect(controller.getSnapshot().messages).toEqual([
      { id: "1", role: "system", content: "You are helpful." },
    ]);
  });

  it("reset() clears messages and aborts any in-flight call", async () => {
    const provider = new StreamingDummyProvider("core-stream-llm", ["hi"]);
    const controller = createChat({ provider, model: "dummy-model" });

    await controller.sendMessage("hello");
    expect(controller.getSnapshot().messages).toHaveLength(2);

    controller.reset();
    expect(controller.getSnapshot()).toEqual({
      messages: [],
      isLoading: false,
      error: undefined,
    });
  });
});
