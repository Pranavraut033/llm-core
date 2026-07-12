/**
 * Unified error taxonomy for LLM provider calls.
 *
 * Every provider's non-streaming call site (and, best-effort, the abort
 * path of streaming calls) should surface one of these instead of a raw
 * SDK error, so hosts can branch on error *kind* (auth vs rate-limit vs
 * context-length vs cancellation) without knowing each SDK's exception
 * hierarchy.
 */
import { ProviderId } from "./providerType";

export interface LLMErrorOptions {
  provider?: ProviderId;
  status?: number;
  cause?: unknown;
  retryAfterMs?: number;
}

/**
 * Base class for every error this package throws from a provider call.
 * `retryable` tells `LLMProvider.withResilience` whether it's worth
 * retrying with backoff.
 */
export class LLMError extends Error {
  readonly provider?: ProviderId;
  readonly status?: number;
  readonly cause?: unknown;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: LLMErrorOptions & { retryable: boolean }
  ) {
    super(message);
    this.name = "LLMError";
    this.provider = options.provider;
    this.status = options.status;
    this.cause = options.cause;
    this.retryable = options.retryable;
  }
}

/** 401/403 — bad or missing credentials. Never retryable. */
export class AuthError extends LLMError {
  constructor(message: string, options: LLMErrorOptions = {}) {
    super(message, { ...options, retryable: false });
    this.name = "AuthError";
  }
}

/** 429 — rate limited. Retryable, optionally honoring a `Retry-After`. */
export class RateLimitError extends LLMError {
  readonly retryAfterMs?: number;

  constructor(message: string, options: LLMErrorOptions = {}) {
    super(message, { ...options, retryable: true });
    this.name = "RateLimitError";
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** 400 with a context-length/too-many-tokens style message. Never retryable. */
export class ContextLengthError extends LLMError {
  constructor(message: string, options: LLMErrorOptions = {}) {
    super(message, { ...options, retryable: false });
    this.name = "ContextLengthError";
  }
}

/** A timeout raised by `withResilience`'s own `timeoutMs`. Never retryable. */
export class TimeoutError extends LLMError {
  constructor(message: string, options: LLMErrorOptions = {}) {
    super(message, { ...options, retryable: false });
    this.name = "TimeoutError";
  }
}

/** User-initiated cancellation via `AbortSignal`. Never retryable. */
export class AbortError extends LLMError {
  constructor(message: string, options: LLMErrorOptions = {}) {
    super(message, { ...options, retryable: false });
    this.name = "AbortError";
  }
}

/**
 * Catch-all for anything that doesn't fit a more specific bucket.
 * Retryable only for 5xx-style server errors (or an unclassifiable error
 * with no status at all is treated as non-retryable, since we can't tell
 * whether retrying would help).
 */
export class ProviderError extends LLMError {
  constructor(
    message: string,
    options: LLMErrorOptions & { retryable?: boolean }
  ) {
    super(message, { ...options, retryable: options.retryable ?? false });
    this.name = "ProviderError";
  }
}

function hasStatus(err: unknown): err is { status: number } {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status?: unknown }).status === "number"
  );
}

function getMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message?: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return String(err);
}

function getRetryAfterMs(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const headers = (err as { headers?: unknown }).headers;
  if (!headers || typeof (headers as Headers).get !== "function") {
    return undefined;
  }
  const h = headers as Headers;
  const retryAfterMsHeader = h.get("retry-after-ms");
  if (retryAfterMsHeader) {
    const ms = Number(retryAfterMsHeader);
    if (Number.isFinite(ms)) return ms;
  }
  const retryAfterHeader = h.get("retry-after");
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds)) return seconds * 1000;
  }
  return undefined;
}

const CONTEXT_LENGTH_PATTERN =
  /context.?length|too many tokens|maximum context|context window|token limit/i;

/**
 * Classify an unknown thrown value into the `LLMError` hierarchy.
 *
 * Recognizes:
 * - An already-classified `LLMError` (returned as-is).
 * - `name === "AbortError"` (user cancellation — Node fetch/AbortController
 *   default, and most SDKs' user-abort error).
 * - `name === "TimeoutError"` (raised by `AbortSignal.timeout()`, whether
 *   thrown directly by `fetch` or surfaced by `withResilience`).
 * - SDK errors with a numeric `.status` (`@anthropic-ai/sdk` and `openai`
 *   both throw `APIError` subclasses shaped this way): 401/403 -> AuthError,
 *   429 -> RateLimitError, 400 matching a context-length message ->
 *   ContextLengthError, everything else -> ProviderError (retryable for 5xx).
 * - Anything else -> ProviderError, not retryable.
 */
export function classifyProviderError(
  err: unknown,
  provider?: ProviderId
): LLMError {
  if (err instanceof LLMError) return err;

  const name = err instanceof Error ? err.name : undefined;

  if (name === "AbortError") {
    return new AbortError(getMessage(err) || "The operation was aborted.", {
      provider,
      cause: err,
    });
  }

  if (name === "TimeoutError") {
    return new TimeoutError(getMessage(err) || "The operation timed out.", {
      provider,
      cause: err,
    });
  }

  if (hasStatus(err)) {
    const status = err.status;
    const message = getMessage(err);

    if (status === 401 || status === 403) {
      return new AuthError(message, { provider, status, cause: err });
    }

    if (status === 429) {
      return new RateLimitError(message, {
        provider,
        status,
        cause: err,
        retryAfterMs: getRetryAfterMs(err),
      });
    }

    if (status === 400 && CONTEXT_LENGTH_PATTERN.test(message)) {
      return new ContextLengthError(message, { provider, status, cause: err });
    }

    return new ProviderError(message, {
      provider,
      status,
      cause: err,
      retryable: status >= 500,
    });
  }

  return new ProviderError(getMessage(err), { provider, cause: err });
}
