import { ProviderId } from "../providerType";

/**
 * A single "purpose" label for an LLM call (e.g. "generate_text",
 * "parse_resume"). Hosts define their own purpose vocabulary — this
 * package treats it as an opaque string.
 */
export type Purpose = string;

/**
 * Multiple purposes attributed to a single (merged) usage record.
 */
export type MultiPurpose = Purpose[];

/**
 * Data structure for recording token usage of LLM calls.
 *
 * This type is intentionally persistence-agnostic: this package never
 * writes it anywhere. Providers populate it and hand it to the host via
 * `LLMResult.usage`, `LLMGenerationOptions.onUsage`, or the injected
 * `onUsage` sink passed to `trackTokenUsage`.
 */
export interface LLMUsageInfo {
  // Core — all providers
  promptTokens: number; // OpenAI: prompt_tokens / Anthropic: input_tokens
  completionTokens: number; // OpenAI: completion_tokens / Anthropic: output_tokens
  totalTokens?: number; // OpenAI: total_tokens

  // Cache — Anthropic: cache_read_input_tokens / cache_creation_input_tokens
  //          OpenAI: prompt_tokens_details.cached_tokens
  cacheReadTokens?: number;
  cacheCreationTokens?: number;

  // Reasoning — OpenAI o-series: completion_tokens_details.reasoning_tokens
  reasoningTokens?: number;

  // Cost
  costUSD?: number;

  // Metadata
  provider: ProviderId;
  model: string;
  purpose: Purpose | MultiPurpose;
  requestId?: string;
  durationMs?: number;
}
