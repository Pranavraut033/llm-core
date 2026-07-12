/**
 * Per-model USD pricing table + cost computation.
 *
 * Rates are USD per 1,000,000 tokens, sourced from each provider's public
 * pricing pages. They are INDICATIVE ONLY and will drift as providers
 * change pricing — treat this table as a best-effort estimate, not a
 * billing-accurate source of truth. Update as needed; unknown models
 * simply aren't in the table and `computeCostUSD` returns `undefined`
 * rather than guessing.
 */

import { LLMUsageInfo } from "./usageTypes";

export interface ModelPricing {
  /** USD per 1,000,000 input (prompt) tokens. */
  input: number;
  /** USD per 1,000,000 output (completion) tokens. */
  output: number;
  /** USD per 1,000,000 cache-read tokens, if the provider discounts them. */
  cacheRead?: number;
  /** USD per 1,000,000 cache-write/creation tokens, if the provider charges a premium for them. */
  cacheWrite?: number;
}

/**
 * Pricing keyed by (normalized) model id. Grouped/commented by provider.
 * Rates are indicative and may drift — verify against the provider's
 * pricing page before using this for billing-accurate calculations.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // ── OpenAI ─────────────────────────────────────────────────────────────
  "gpt-4o": { input: 2.5, output: 10, cacheRead: 1.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-4.1": { input: 2, output: 8, cacheRead: 0.5 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, cacheRead: 0.1 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4, cacheRead: 0.025 },
  "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 },
  "gpt-5-mini": { input: 0.25, output: 2, cacheRead: 0.025 },
  "gpt-5-nano": { input: 0.05, output: 0.4, cacheRead: 0.005 },
  "gpt-5-chat-latest": { input: 1.25, output: 10, cacheRead: 0.125 },
  o1: { input: 15, output: 60, cacheRead: 7.5 },
  "o1-mini": { input: 1.1, output: 4.4, cacheRead: 0.55 },
  "o1-preview": { input: 15, output: 60 },
  o3: { input: 2, output: 8, cacheRead: 0.5 },
  "o3-mini": { input: 1.1, output: 4.4, cacheRead: 0.55 },
  "o4-mini": { input: 1.1, output: 4.4, cacheRead: 0.275 },

  // ── Anthropic ──────────────────────────────────────────────────────────
  "claude-opus-4-5": {
    input: 5,
    output: 25,
    cacheRead: 0.5,
    cacheWrite: 6.25,
  },
  "claude-opus-4-1": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 18.75,
  },
  "claude-opus-4": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 18.75,
  },
  "claude-sonnet-4-5": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "claude-sonnet-4": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "claude-haiku-4-5": {
    input: 1,
    output: 5,
    cacheRead: 0.1,
    cacheWrite: 1.25,
  },
  "claude-3-5-sonnet": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "claude-3-5-haiku": {
    input: 0.8,
    output: 4,
    cacheRead: 0.08,
    cacheWrite: 1,
  },
  "claude-3-opus": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 18.75,
  },

  // ── Google Gemini ──────────────────────────────────────────────────────
  "gemini-2.5-pro": { input: 1.25, output: 10, cacheRead: 0.31 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5, cacheRead: 0.075 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4, cacheRead: 0.025 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4, cacheRead: 0.025 },
  "gemini-2.0-flash-lite": { input: 0.075, output: 0.3 },

  // ── xAI Grok ───────────────────────────────────────────────────────────
  "grok-4": { input: 3, output: 15, cacheRead: 0.75 },
  "grok-3": { input: 3, output: 15, cacheRead: 0.75 },
  "grok-3-mini": { input: 0.3, output: 0.5, cacheRead: 0.075 },
  "grok-code-fast-1": { input: 0.2, output: 1.5, cacheRead: 0.02 },

  // ── Perplexity ─────────────────────────────────────────────────────────
  sonar: { input: 1, output: 1 },
  "sonar-pro": { input: 3, output: 15 },
  "sonar-reasoning": { input: 1, output: 5 },
  "sonar-reasoning-pro": { input: 2, output: 8 },
  "sonar-deep-research": { input: 2, output: 8 },

  // ── Ollama / local models ──────────────────────────────────────────────
  // Local inference has no per-token API cost.
  llama3: { input: 0, output: 0 },
  "llama3.1": { input: 0, output: 0 },
  "llama3.2": { input: 0, output: 0 },
  "llama3.3": { input: 0, output: 0 },
  mistral: { input: 0, output: 0 },
  mixtral: { input: 0, output: 0 },
  qwen: { input: 0, output: 0 },
  "qwen2.5": { input: 0, output: 0 },
  gemma: { input: 0, output: 0 },
  gemma2: { input: 0, output: 0 },
  phi3: { input: 0, output: 0 },
  "deepseek-r1": { input: 0, output: 0 },
};

/**
 * Normalize a model id so provider-prefixed / cased variants still hit the
 * pricing (and model-catalog) tables: lowercases, strips a leading
 * `models/` (Gemini's `fetchModels` prefix) or `<provider>/`-style prefix
 * (e.g. `openai/gpt-4o`, `anthropic/claude-...`, OpenRouter-style ids).
 */
export function normalizeModelId(model: string): string {
  const lower = model.trim().toLowerCase();
  const withoutModelsPrefix = lower.startsWith("models/")
    ? lower.slice("models/".length)
    : lower;
  const slashIndex = withoutModelsPrefix.indexOf("/");
  if (slashIndex !== -1) {
    return withoutModelsPrefix.slice(slashIndex + 1);
  }
  return withoutModelsPrefix;
}

function lookupPricing(model: string): ModelPricing | undefined {
  return MODEL_PRICING[normalizeModelId(model)];
}

/**
 * Compute the USD cost of an `LLMUsageInfo` record from its token counts
 * and this module's pricing table. Returns `undefined` (never throws, never
 * guesses) when the model isn't in the table.
 *
 * Accounting:
 * - `cacheReadTokens` are billed at `cacheRead` rate (falls back to `input`
 *   rate if the model doesn't discount cache reads).
 * - The remainder of `promptTokens` (i.e. minus any `cacheReadTokens`) is
 *   billed at the `input` rate.
 * - `completionTokens` are billed at the `output` rate.
 * - `cacheCreationTokens`, when present, are billed at `cacheWrite` rate
 *   (falls back to `input` rate if the model doesn't have a cache-write
 *   premium).
 */
export function computeCostUSD(usage: LLMUsageInfo): number | undefined {
  const pricing = lookupPricing(usage.model);
  if (!pricing) {
    return undefined;
  }

  const cacheReadTokens = usage.cacheReadTokens ?? 0;
  const cacheCreationTokens = usage.cacheCreationTokens ?? 0;
  const uncachedPromptTokens = Math.max(
    0,
    (usage.promptTokens ?? 0) - cacheReadTokens
  );

  const cacheReadRate = pricing.cacheRead ?? pricing.input;
  const cacheWriteRate = pricing.cacheWrite ?? pricing.input;

  const costPerMillion =
    uncachedPromptTokens * pricing.input +
    cacheReadTokens * cacheReadRate +
    cacheCreationTokens * cacheWriteRate +
    (usage.completionTokens ?? 0) * pricing.output;

  return costPerMillion / 1_000_000;
}
