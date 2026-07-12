import { describe, expect, it } from "vitest";

import { getModelInfo, MODEL_CATALOG } from "../src/models/modelCatalog";

describe("getModelInfo", () => {
  it("returns capability flags and limits for a known model", () => {
    const info = getModelInfo("gpt-4o");
    expect(info).toEqual(MODEL_CATALOG["gpt-4o"]);
    expect(info?.capabilities).toEqual({
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: false,
    });
    expect(info?.contextWindow).toBe(128_000);
  });

  it("is case-insensitive", () => {
    expect(getModelInfo("GPT-4O")).toEqual(MODEL_CATALOG["gpt-4o"]);
  });

  it("is prefix-tolerant (Gemini models/ prefix)", () => {
    expect(getModelInfo("models/gemini-2.5-pro")).toEqual(
      MODEL_CATALOG["gemini-2.5-pro"]
    );
  });

  it("is prefix-tolerant (provider/ style prefix)", () => {
    expect(getModelInfo("anthropic/claude-sonnet-4-5")).toEqual(
      MODEL_CATALOG["claude-sonnet-4-5"]
    );
  });

  it("accepts an optional provider hint without affecting the lookup", () => {
    expect(getModelInfo("sonar-pro", "perplexity")).toEqual(
      MODEL_CATALOG["sonar-pro"]
    );
  });

  it("returns undefined for an unknown model", () => {
    expect(getModelInfo("totally-unknown-model")).toBeUndefined();
  });

  it("marks reasoning models correctly", () => {
    expect(getModelInfo("o1")?.capabilities.reasoning).toBe(true);
    expect(getModelInfo("gpt-4o")?.capabilities.reasoning).toBe(false);
  });

  it("marks free/local Ollama models with no cost implications in the catalog (capability-only)", () => {
    const info = getModelInfo("llama3.1");
    expect(info).toBeDefined();
    expect(info?.capabilities.tools).toBe(true);
  });
});
