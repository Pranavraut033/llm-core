import { describe, expect, it, vi } from "vitest";

import "./helpers/ambientProviderIds";
import { DummyProvider, DUMMY_RESULT_TEXT } from "./helpers/dummyProvider";
import { ResolvedPrompt } from "../src/prompts/types";
import { LLMUsageInfo } from "../src/tokens/usageTypes";
import { PromptMessage } from "../src/types";

class TestableProvider extends DummyProvider {
  public callToPromptMessages(resolved: ResolvedPrompt): PromptMessage[] {
    return this.toPromptMessages(resolved);
  }

  public callCombinePromptText(resolved: ResolvedPrompt): string {
    return this.combinePromptText(resolved);
  }

  public callEstimateTokenUsage(args: {
    inputPrompt: string;
    outputText: string;
    model: string;
    purpose?: string;
  }) {
    return this.estimateTokenUsage({ ...args, provider: this.providerType });
  }
}

function provider(): TestableProvider {
  return new TestableProvider("integration-dummy" as never);
}

describe("LLMProvider.getDefaultTemperature", () => {
  it("returns undefined for empty or non-string model ids", () => {
    const p = provider();
    expect(p.getDefaultTemperature("")).toBeUndefined();
    expect(
      p.getDefaultTemperature(undefined as unknown as string)
    ).toBeUndefined();
  });

  it("returns undefined for unsupported providers", () => {
    expect(provider().getDefaultTemperature("llama3")).toBeUndefined();
  });

  it.each([
    "gpt-4o",
    "grok-3",
    "gemini-2.0-flash",
    "sonar-pro",
    "gpt-5-chat-latest",
  ])("returns 0.7 for standard chat model %s", (model) => {
    expect(provider().getDefaultTemperature(model)).toBe(0.7);
  });

  it.each([
    "o1-preview",
    "gpt-5-reasoning",
    "grok-4-reasoning",
    "sonar-reasoning",
    "sonar-deep-research",
    "gemini-2.0-thinking",
  ])("returns undefined for reasoning model %s", (model) => {
    expect(provider().getDefaultTemperature(model)).toBeUndefined();
  });
});

describe("LLMProvider.generateText", () => {
  it("delegates to runLLM with system/user messages and resolved temperature", async () => {
    const p = provider();
    const spy = vi.spyOn(p, "runLLM");

    const result = await p.generateText("be helpful", "say hi", {
      model: "gpt-4o",
    });

    expect(spy).toHaveBeenCalledWith(
      [
        { role: "system", content: "be helpful" },
        { role: "user", content: "say hi" },
      ],
      expect.objectContaining({ model: "gpt-4o", temperature: 0.7 })
    );
    expect(result.result).toBe(DUMMY_RESULT_TEXT);
  });

  it("omits temperature when the model doesn't support it", async () => {
    const p = provider();
    const spy = vi.spyOn(p, "runLLM");

    await p.generateText("sys", "usr", { model: "o1-preview" });

    expect(spy).toHaveBeenCalledWith(
      expect.any(Array),
      expect.not.objectContaining({ temperature: expect.anything() })
    );
  });
});

describe("LLMProvider.estimateTokenUsage", () => {
  it("estimates tokens as ceil(length / 4) and defaults purpose", () => {
    const p = provider();
    const usage = p.callEstimateTokenUsage({
      inputPrompt: "abcde", // 5 chars -> 2 tokens
      outputText: "abcdefgh", // 8 chars -> 2 tokens
      model: "gpt-4o",
    });

    expect(usage.promptTokens).toBe(2);
    expect(usage.completionTokens).toBe(2);
    expect(usage.totalTokens).toBe(4);
    expect(usage.purpose).toBe("generate_text");
  });

  it("returns 0 tokens for empty strings", () => {
    const usage = provider().callEstimateTokenUsage({
      inputPrompt: "",
      outputText: "",
      model: "gpt-4o",
    });

    expect(usage.promptTokens).toBe(0);
    expect(usage.completionTokens).toBe(0);
  });
});

describe("LLMProvider.toPromptMessages", () => {
  it("prefers an explicit messages array when present and non-empty", () => {
    const messages: PromptMessage[] = [{ role: "user", content: "hi" }];
    const resolved = {
      systemPrompt: "ignored",
      userPrompt: "ignored",
      purpose: "generate_text",
      estimatedTokens: 0,
      messages,
    } as ResolvedPrompt & { messages: PromptMessage[] };

    expect(provider().callToPromptMessages(resolved)).toBe(messages);
  });

  it("falls back to system/user split when no messages array is present", () => {
    const resolved: ResolvedPrompt = {
      systemPrompt: "sys",
      userPrompt: "usr",
      purpose: "generate_text",
      estimatedTokens: 0,
    };

    expect(provider().callToPromptMessages(resolved)).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ]);
  });

  it("omits absent system/user fields", () => {
    const resolved: ResolvedPrompt = {
      systemPrompt: "",
      userPrompt: "usr",
      purpose: "generate_text",
      estimatedTokens: 0,
    };

    expect(provider().callToPromptMessages(resolved)).toEqual([
      { role: "user", content: "usr" },
    ]);
  });
});

describe("LLMProvider runtime config wiring", () => {
  const usage: LLMUsageInfo = {
    promptTokens: 1,
    completionTokens: 1,
    totalTokens: 2,
    provider: "integration-dummy" as never,
    model: "dummy-model",
    purpose: "generate_text",
  };

  it("falls back to the injected onUsage sink when no explicit sink is passed", () => {
    const events: LLMUsageInfo[] = [];
    const p = new DummyProvider("integration-dummy" as never, undefined, {
      onUsage: (u) => {
        events.push(u);
      },
    });

    p.callNotifyUsage(usage);
    expect(events).toEqual([usage]);
  });

  it("prefers an explicit sink over the injected default", () => {
    const injected: LLMUsageInfo[] = [];
    const explicit: LLMUsageInfo[] = [];
    const p = new DummyProvider("integration-dummy" as never, undefined, {
      onUsage: (u) => {
        injected.push(u);
      },
    });

    p.callNotifyUsage(usage, (u) => explicit.push(u));
    expect(explicit).toEqual([usage]);
    expect(injected).toEqual([]);
  });

  it("does nothing when neither an explicit nor injected sink is configured", () => {
    const p = new DummyProvider("integration-dummy" as never);
    expect(() => p.callNotifyUsage(usage)).not.toThrow();
  });

  it("uses the injected logger instead of the default noop logger", () => {
    const messages: string[] = [];
    const p = new DummyProvider("integration-dummy" as never, undefined, {
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: (msg) => messages.push(msg as string),
      },
    });

    p.getLogger().error("boom");
    expect(messages).toEqual(["boom"]);
  });
});

describe("LLMProvider.combinePromptText", () => {
  it("joins system, user, and messages content, filtering falsy values", () => {
    const resolved = {
      systemPrompt: "sys",
      userPrompt: "",
      purpose: "generate_text",
      estimatedTokens: 0,
      messages: [{ role: "user", content: "extra" }],
    } as ResolvedPrompt & { messages: PromptMessage[] };

    expect(provider().callCombinePromptText(resolved)).toBe("sys\nextra");
  });
});
