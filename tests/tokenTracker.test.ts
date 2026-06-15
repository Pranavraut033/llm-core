import { describe, expect, it, vi } from "vitest";

import {
  estimateTokenCount,
  generateRequestId,
  mergeLLMUsageInfo,
  trackTokenUsage,
} from "../src/tokens/tokenTracker";
import { LLMUsageInfo } from "../src/tokens/usageTypes";

function usage(overrides: Partial<LLMUsageInfo> = {}): LLMUsageInfo {
  return {
    provider: "openai",
    model: "gpt-test",
    purpose: "generate_text",
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    ...overrides,
  };
}

describe("generateRequestId", () => {
  it("returns a uuid, optionally prefixed by purpose", () => {
    const plain = generateRequestId();
    expect(plain).toMatch(/^[0-9a-f-]{36}$/i);

    const prefixed = generateRequestId("parse_resume");
    expect(prefixed.startsWith("parse_resume-")).toBe(true);
  });
});

describe("estimateTokenCount", () => {
  it("approximates token count as ~4 chars per token", () => {
    expect(estimateTokenCount("")).toBe(0);
    expect(estimateTokenCount("a")).toBe(1);
    expect(estimateTokenCount("abcd")).toBe(1);
    expect(estimateTokenCount("abcde")).toBe(2);
  });
});

describe("mergeLLMUsageInfo", () => {
  it("sums token/cost counters and combines purposes", () => {
    const a = usage({
      purpose: "generate_resume",
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      costUSD: 0.01,
      cacheReadTokens: 1,
      cacheCreationTokens: 2,
      reasoningTokens: 3,
      durationMs: 100,
    });
    const b = usage({
      purpose: "generate_cover_letter",
      promptTokens: 20,
      completionTokens: 8,
      totalTokens: 28,
      costUSD: 0.02,
      cacheReadTokens: 4,
      cacheCreationTokens: 5,
      reasoningTokens: 6,
      durationMs: 200,
    });

    const merged = mergeLLMUsageInfo(a, b);

    expect(merged.provider).toBe("openai");
    expect(merged.model).toBe("gpt-test");
    expect(merged.purpose).toEqual([
      "generate_resume",
      "generate_cover_letter",
    ]);
    expect(merged.promptTokens).toBe(30);
    expect(merged.completionTokens).toBe(13);
    expect(merged.totalTokens).toBe(43);
    expect(merged.costUSD).toBeCloseTo(0.03);
    expect(merged.cacheReadTokens).toBe(5);
    expect(merged.cacheCreationTokens).toBe(7);
    expect(merged.reasoningTokens).toBe(9);
    expect(merged.durationMs).toBe(300);
  });

  it("throws when merging records with different providers", () => {
    const a = usage({ provider: "openai" });
    const b = usage({ provider: "gemini" });

    expect(() => mergeLLMUsageInfo(a, b)).toThrow(/different providers/);
  });

  it("throws when merging records with different models", () => {
    const a = usage({ model: "gpt-4o" });
    const b = usage({ model: "gpt-5" });

    expect(() => mergeLLMUsageInfo(a, b)).toThrow(/different models/);
  });
});

describe("trackTokenUsage", () => {
  it("invokes the injected sink with a usage record (filling in a requestId)", async () => {
    const sink = vi.fn();
    const data = usage();

    await trackTokenUsage(data, { sink });

    expect(sink).toHaveBeenCalledTimes(1);
    const tracked = sink.mock.calls[0][0] as LLMUsageInfo;
    expect(tracked.provider).toBe("openai");
    expect(tracked.model).toBe("gpt-test");
    expect(tracked.requestId).toBeTruthy();
  });

  it("preserves an existing requestId", async () => {
    const sink = vi.fn();
    await trackTokenUsage(usage({ requestId: "existing-id" }), { sink });

    expect(sink.mock.calls[0][0].requestId).toBe("existing-id");
  });

  it("falls back to logging when no sink is provided", async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await trackTokenUsage(usage(), { logger });

    expect(logger.info).toHaveBeenCalledWith(
      "Token usage",
      expect.objectContaining({ provider: "openai" })
    );
  });
});
