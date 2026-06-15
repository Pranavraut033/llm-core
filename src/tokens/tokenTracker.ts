/**
 * Token Usage Tracking Utilities
 *
 * Domain-agnostic, persistence-agnostic helpers for working with
 * `LLMUsageInfo` records. Persistence is the host's responsibility —
 * `trackTokenUsage` takes an injected `sink` callback rather than writing
 * to a database directly.
 */

import { v4 as uuidv4 } from "uuid";

import { Logger, noopLogger } from "../logger";
import { LLMUsageInfo, MultiPurpose } from "./usageTypes";

/**
 * Generate a unique request ID for grouping related LLM calls.
 * Optionally prefixes the ID with a purpose label.
 */
export function generateRequestId(purpose?: string): string {
  return purpose ? `${purpose}-${uuidv4()}` : uuidv4();
}

/**
 * Estimate token count for text (rough approximation).
 * Uses ~4 characters per token as a general rule.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Merge multiple `LLMUsageInfo` records that share the same provider and
 * model into a single record, summing token/cost counters and combining
 * their purposes into a `MultiPurpose` array.
 *
 * Throws if the records disagree on `provider` or `model`.
 */
export function mergeLLMUsageInfo(
  usage1: LLMUsageInfo,
  ...additionalUsageInfo: LLMUsageInfo[]
): LLMUsageInfo {
  for (const usage of additionalUsageInfo) {
    if (usage1.provider !== usage.provider) {
      throw new Error(
        `Cannot merge LLMUsageInfo with different providers: ${usage1.provider} vs ${usage.provider}`
      );
    }
    if (usage1.model !== usage.model) {
      throw new Error(
        `Cannot merge LLMUsageInfo with different models: ${usage1.model} vs ${usage.model}`
      );
    }
  }

  return {
    provider: usage1.provider,
    model: usage1.model,
    purpose: [
      usage1.purpose,
      ...additionalUsageInfo.map((u) => u.purpose),
    ] as MultiPurpose,
    promptTokens: additionalUsageInfo.reduce(
      (sum, u) => sum + (u.promptTokens || 0),
      usage1.promptTokens
    ),
    completionTokens: additionalUsageInfo.reduce(
      (sum, u) => sum + (u.completionTokens || 0),
      usage1.completionTokens
    ),
    totalTokens: additionalUsageInfo.reduce(
      (sum, u) => sum + (u.totalTokens || 0),
      usage1.totalTokens || 0
    ),
    costUSD: additionalUsageInfo.reduce(
      (sum, u) => sum + (u.costUSD || 0),
      usage1.costUSD || 0
    ),
    cacheReadTokens: additionalUsageInfo.reduce(
      (sum, u) => sum + (u.cacheReadTokens || 0),
      usage1.cacheReadTokens || 0
    ),
    cacheCreationTokens: additionalUsageInfo.reduce(
      (sum, u) => sum + (u.cacheCreationTokens || 0),
      usage1.cacheCreationTokens || 0
    ),
    reasoningTokens: additionalUsageInfo.reduce(
      (sum, u) => sum + (u.reasoningTokens || 0),
      usage1.reasoningTokens || 0
    ),
    durationMs: additionalUsageInfo.reduce(
      (sum, u) => sum + (u.durationMs || 0),
      usage1.durationMs || 0
    ),
  };
}

/**
 * Track token usage from an LLM response.
 *
 * Fills in a `requestId` if missing, then hands the record to the
 * injected `sink` (e.g. a function that persists it to a database).
 * If no `sink` is provided, the record is simply logged via `logger`.
 */
export async function trackTokenUsage(
  data: LLMUsageInfo,
  options?: {
    sink?: (usage: LLMUsageInfo) => void | Promise<void>;
    logger?: Logger;
  }
): Promise<void> {
  const logger = options?.logger ?? noopLogger;
  const purposeLabel = Array.isArray(data.purpose)
    ? data.purpose.join(",")
    : data.purpose?.toString();

  logger.debug("Tracking token usage", {
    provider: data.provider,
    model: data.model,
    tokens: (data.promptTokens || 0) + (data.completionTokens || 0),
  });

  const usage: LLMUsageInfo = {
    ...data,
    requestId: data.requestId || generateRequestId(purposeLabel),
  };

  if (options?.sink) {
    await options.sink(usage);
  } else {
    logger.info("Token usage", usage);
  }
}
