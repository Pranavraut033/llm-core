// Generic LLM types — provider-agnostic, domain-agnostic.

import { LLMUsageInfo } from "./tokens/usageTypes";

// ── Multimodal content parts ────────────────────────────────────────────────

/**
 * A single part of a multimodal `user`/`assistant` message. Additive to the
 * plain-`string` content shape that already works everywhere — a message's
 * `content` is `string | ContentPart[]`, never required to be an array.
 */
export type ContentPart =
  | { type: "text"; text: string }
  | {
      type: "image";
      image: { data: string; mediaType: string } | { url: string };
    }
  | {
      type: "document";
      document:
        | { data: string; mediaType: string; filename?: string }
        | { url: string };
    };

export type PromptMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | {
      role: "assistant";
      content: string | ContentPart[];
      toolCalls?: ToolCall[];
    }
  | { role: "tool"; content: string; toolCallId: string; toolName?: string };

/**
 * Flattens `PromptMessage.content` to a plain string — for token estimation,
 * logging, or any other place that genuinely needs a flat string rather than
 * the real multimodal parts. Non-text parts are replaced with a short
 * placeholder (`[image]`/`[document]`) rather than dropped silently.
 */
export function contentToText(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => {
      switch (part.type) {
        case "text":
          return part.text;
        case "image":
          return "[image]";
        case "document":
          return "[document]";
      }
    })
    .join("\n");
}

export interface LLMResult<T = string> {
  result: T;
  toolCalls?: ToolCall[];
  usage: LLMUsageInfo;
  /**
   * Provider-specific web citations (currently populated by Perplexity's
   * `citations`/`search_results` response fields). Optional and additive —
   * providers that don't surface citations simply omit this field.
   */
  citations?: { url: string; title?: string }[];
}

export type TextGenerationResult = LLMResult<string>;

// ── Primitive schema types ──────────────────────────────────────────────────

export type JSONSchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "object"
  | "null";

export interface JSONSchemaProperty {
  // core
  type?: JSONSchemaType | JSONSchemaType[]; // optional: not needed when using anyOf/oneOf/allOf
  title?: string;
  description?: string;
  const?: unknown;
  enum?: unknown[]; // any JSON value, not just strings
  default?: unknown;

  // composition
  anyOf?: JSONSchemaProperty[];
  oneOf?: JSONSchemaProperty[];
  allOf?: JSONSchemaProperty[];
  not?: JSONSchemaProperty;

  // conditionals
  if?: JSONSchemaProperty;
  then?: JSONSchemaProperty;
  else?: JSONSchemaProperty;

  // arrays
  items?: JSONSchemaProperty;
  minItems?: number;
  maxItems?: number;

  // objects
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: JSONSchemaProperty | boolean;

  // strings
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;

  // numbers
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;

  // zod/ref support
  $ref?: string;
  $defs?: Record<string, JSONSchemaProperty>;
  [key: string]: unknown;
}

export interface ToolParameter extends JSONSchemaProperty {
  type?: "object";
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter;
  strict?: boolean;
}

// ── Tool call result (what the model returns) ───────────────────────────────

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

// ── Tool choice control ─────────────────────────────────────────────────────

export type ToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "tool"; name: string };

// ── LLM response ───────────────────────────────────────────────────────────

export type LLMResponseType = "text" | "tool_call";

export interface LLMResponse {
  type: LLMResponseType;
  text?: string;
  toolCall?: ToolCall;
}

// ── Streaming events ────────────────────────────────────────────────────────

/**
 * Discriminated-union stream event. Replaces the old text-only
 * `AsyncGenerator<string>` contract so tool calls, usage, and completion
 * survive a streamed response instead of being silently dropped.
 */
export type LLMStreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "usage"; usage: LLMUsageInfo }
  | { type: "done" };

// ── Embeddings ───────────────────────────────────────────────────────────

/**
 * Options for `LLMProvider.embed()`. Only OpenAI, Gemini, and Ollama support
 * embeddings among the built-in providers — see `LLMProvider.embed`'s
 * default implementation for the other providers' behavior.
 */
export interface EmbeddingOptions {
  model: string;
  input: string | string[];
}

export interface EmbeddingResult {
  embeddings: number[][];
  usage: LLMUsageInfo;
}

export interface LLMGenerationOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  stream?: boolean;
  onUsage?: (usage: LLMUsageInfo) => void;

  // ── Sampling params ───────────────────────────────────────────────────────
  // Optional, default-off passthrough params. Only sent to providers whose
  // SDK/API supports them; silently omitted otherwise (see each provider's
  // request builder).
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  frequencyPenalty?: number;
  presencePenalty?: number;
  seed?: number;

  // ── Reasoning controls ────────────────────────────────────────────────────
  /** OpenAI/Grok `reasoning_effort` for reasoning models. */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  /** Anthropic extended-thinking budget / Gemini `thinkingConfig.thinkingBudget`. */
  thinkingBudget?: number;

  /**
   * Anthropic prompt-caching opt-in. `true` caches both the system prompt
   * and tool definitions; `"system"`/`"tools"` caches only that breakpoint.
   * Ignored by providers other than Anthropic.
   */
  cacheControl?: boolean | "system" | "tools";

  // ── Cancellation & resilience ─────────────────────────────────────────────
  /**
   * Abort the in-flight request. Composed internally with an optional
   * `timeoutMs`-derived signal via `LLMProvider.withResilience`.
   */
  signal?: AbortSignal;
  /** Abort the request if it hasn't completed within this many milliseconds. */
  timeoutMs?: number;
  /**
   * Max retry attempts (with exponential backoff) for retryable failures
   * (rate limits, 5xx). Defaults to 2 inside `withResilience`. Never
   * retries aborts/timeouts/auth/context-length errors.
   */
  maxRetries?: number;
}
