import { describe, expect, it } from "vitest";

import {
  computeCostUSD,
  normalizeModelId,
  MODEL_PRICING,
} from "../src/tokens/pricing";
import { mergeLLMUsageInfo } from "../src/tokens/tokenTracker";
import { LLMUsageInfo } from "../src/tokens/usageTypes";

function usage(overrides: Partial<LLMUsageInfo>): LLMUsageInfo {
  return {
    provider: "openai",
    model: "gpt-4o",
    purpose: "generate_text",
    promptTokens: 0,
    completionTokens: 0,
    ...overrides,
  };
}

describe("normalizeModelId", () => {
  it("lowercases and passes through bare ids", () => {
    expect(normalizeModelId("GPT-4o")).toBe("gpt-4o");
  });

  it("strips a leading models/ prefix (Gemini)", () => {
    expect(normalizeModelId("models/gemini-2.5-pro")).toBe("gemini-2.5-pro");
  });

  it("strips a provider/ style prefix", () => {
    expect(normalizeModelId("anthropic/claude-sonnet-4-5")).toBe(
      "claude-sonnet-4-5"
    );
    expect(normalizeModelId("openai/gpt-4o-mini")).toBe("gpt-4o-mini");
  });
});

describe("computeCostUSD", () => {
  it("computes a correct cost for a known model", () => {
    const pricing = MODEL_PRICING["gpt-4o"];
    const promptTokens = 1000;
    const completionTokens = 500;
    const expected =
      (promptTokens * pricing.input + completionTokens * pricing.output) /
      1_000_000;

    const result = computeCostUSD(
      usage({ model: "gpt-4o", promptTokens, completionTokens })
    );

    expect(result).toBeCloseTo(expected, 10);
  });

  it("is case-insensitive and prefix-tolerant", () => {
    const result = computeCostUSD(
      usage({
        model: "OpenAI/GPT-4O",
        promptTokens: 1000,
        completionTokens: 500,
      })
    );
    expect(result).toBeCloseTo(
      computeCostUSD(
        usage({ model: "gpt-4o", promptTokens: 1000, completionTokens: 500 })
      )!,
      10
    );
  });

  it("returns undefined for an unknown model", () => {
    expect(
      computeCostUSD(
        usage({
          model: "totally-unknown-model",
          promptTokens: 100,
          completionTokens: 50,
        })
      )
    ).toBeUndefined();
  });

  it("accounts for cacheReadTokens at the cache-read rate", () => {
    const pricing = MODEL_PRICING["claude-sonnet-4-5"];
    const promptTokens = 2000;
    const cacheReadTokens = 800;
    const completionTokens = 300;
    const expected =
      ((promptTokens - cacheReadTokens) * pricing.input +
        cacheReadTokens * pricing.cacheRead! +
        completionTokens * pricing.output) /
      1_000_000;

    const result = computeCostUSD(
      usage({
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        promptTokens,
        cacheReadTokens,
        completionTokens,
      })
    );

    expect(result).toBeCloseTo(expected, 10);
  });

  it("returns 0 for free/local models", () => {
    expect(
      computeCostUSD(
        usage({
          provider: "ollama",
          model: "llama3.1",
          promptTokens: 1000,
          completionTokens: 500,
        })
      )
    ).toBe(0);
  });
});

describe("mergeLLMUsageInfo populates costUSD", () => {
  it("carries a populated costUSD for a known model", () => {
    const merged = mergeLLMUsageInfo(
      usage({ model: "gpt-4o", promptTokens: 100, completionTokens: 50 }),
      usage({ model: "gpt-4o", promptTokens: 200, completionTokens: 75 })
    );

    const expected = computeCostUSD(
      usage({ model: "gpt-4o", promptTokens: 300, completionTokens: 125 })
    );

    expect(merged.costUSD).toBeCloseTo(expected!, 10);
  });

  it("leaves costUSD undefined for an unknown model", () => {
    const merged = mergeLLMUsageInfo(
      usage({
        model: "totally-unknown-model",
        promptTokens: 100,
        completionTokens: 50,
      })
    );

    expect(merged.costUSD).toBeUndefined();
  });
});
