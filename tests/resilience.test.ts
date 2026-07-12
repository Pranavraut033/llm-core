import { afterEach, describe, expect, it, vi } from "vitest";

import "./helpers/ambientProviderIds";
import { DummyProvider } from "./helpers/dummyProvider";
import {
  AbortError,
  AuthError,
  classifyProviderError,
  ContextLengthError,
  ProviderError,
  RateLimitError,
  TimeoutError,
} from "../src/errors";
import { OllamaProvider } from "../src/providers/ollama";

/**
 * Exposes the protected `withResilience` helper for direct testing, and
 * zeroes out the backoff base so retry tests don't actually wait.
 */
class TestableResilientProvider extends DummyProvider {
  constructor() {
    super("integration-dummy" as never);
    this.resilienceBackoffBaseMs = 0;
  }

  public callWithResilience<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    options: {
      signal?: AbortSignal;
      timeoutMs?: number;
      maxRetries?: number;
    } = {}
  ): Promise<T> {
    return this.withResilience(fn, options);
  }
}

describe("classifyProviderError", () => {
  it("maps a {status:429} error to RateLimitError (retryable)", () => {
    const err = classifyProviderError({ status: 429, message: "too many" });
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryable).toBe(true);
    expect(err.status).toBe(429);
  });

  it("maps a {status:401} error to AuthError (not retryable)", () => {
    const err = classifyProviderError({ status: 401, message: "bad key" });
    expect(err).toBeInstanceOf(AuthError);
    expect(err.retryable).toBe(false);
  });

  it("maps a {status:403} error to AuthError as well", () => {
    const err = classifyProviderError({ status: 403, message: "forbidden" });
    expect(err).toBeInstanceOf(AuthError);
    expect(err.retryable).toBe(false);
  });

  it("maps a {status:400} context-length message to ContextLengthError", () => {
    const err = classifyProviderError({
      status: 400,
      message: "This model's maximum context length is 8192 tokens.",
    });
    expect(err).toBeInstanceOf(ContextLengthError);
    expect(err.retryable).toBe(false);
  });

  it("maps a {status:500} error to a retryable ProviderError", () => {
    const err = classifyProviderError({ status: 500, message: "oops" });
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(true);
  });

  it("maps a {status:400} non-context-length error to a non-retryable ProviderError", () => {
    const err = classifyProviderError({ status: 400, message: "bad request" });
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(false);
  });

  it("maps a name:'AbortError' error to AbortError", () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const err = classifyProviderError(abort);
    expect(err).toBeInstanceOf(AbortError);
    expect(err.retryable).toBe(false);
  });

  it("maps a name:'TimeoutError' error to TimeoutError", () => {
    const timeout = Object.assign(new Error("timed out"), {
      name: "TimeoutError",
    });
    const err = classifyProviderError(timeout);
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err.retryable).toBe(false);
  });

  it("returns an already-classified LLMError unchanged", () => {
    const original = new AuthError("bad key");
    expect(classifyProviderError(original)).toBe(original);
  });

  it("defaults an unrecognized error to a non-retryable ProviderError", () => {
    const err = classifyProviderError(new Error("network blip"));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(false);
  });

  it("extracts retryAfterMs from a Headers-bearing 429 error", () => {
    const err = classifyProviderError({
      status: 429,
      message: "slow down",
      headers: new Headers({ "retry-after-ms": "1234" }),
    });
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBe(1234);
  });
});

describe("LLMProvider.withResilience", () => {
  it("retries a 429 twice then succeeds", async () => {
    const provider = new TestableResilientProvider();
    const fn = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockRejectedValueOnce({ status: 429, message: "rate limited" })
      .mockRejectedValueOnce({ status: 429, message: "rate limited" })
      .mockResolvedValueOnce("ok");

    const result = await provider.callWithResilience(fn, { maxRetries: 2 });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("rejects immediately without retry on a 401", async () => {
    const provider = new TestableResilientProvider();
    const fn = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockRejectedValue({ status: 401, message: "bad key" });

    await expect(
      provider.callWithResilience(fn, { maxRetries: 3 })
    ).rejects.toBeInstanceOf(AuthError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up and rethrows once maxRetries is exhausted", async () => {
    const provider = new TestableResilientProvider();
    const fn = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockRejectedValue({ status: 500, message: "server error" });

    await expect(
      provider.callWithResilience(fn, { maxRetries: 2 })
    ).rejects.toBeInstanceOf(ProviderError);
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("rejects with AbortError immediately when the signal is already aborted", async () => {
    const provider = new TestableResilientProvider();
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn<(signal: AbortSignal) => Promise<string>>();

    await expect(
      provider.callWithResilience(fn, { signal: controller.signal })
    ).rejects.toBeInstanceOf(AbortError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("rejects with TimeoutError once timeoutMs elapses", async () => {
    const provider = new TestableResilientProvider();
    const fn = vi.fn(
      (signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        })
    );

    await expect(
      provider.callWithResilience(fn, { timeoutMs: 10 })
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it("never retries an AbortError even when attempts remain", async () => {
    const provider = new TestableResilientProvider();
    const controller = new AbortController();
    const fn = vi.fn((signal: AbortSignal) => {
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
        controller.abort();
      });
    });

    await expect(
      provider.callWithResilience(fn, {
        signal: controller.signal,
        maxRetries: 3,
      })
    ).rejects.toBeInstanceOf(AbortError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("OllamaProvider abort (provider-level)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects the non-streaming call with AbortError when the signal is already aborted", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaProvider("http://localhost:11434");
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.runLLM([{ role: "user", content: "hi" }], {
        model: "llama3",
        signal: controller.signal,
      })
    ).rejects.toBeInstanceOf(AbortError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies a mid-flight abort-named fetch rejection as AbortError", async () => {
    const abortErr = Object.assign(new Error("The operation was aborted."), {
      name: "AbortError",
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortErr));

    const provider = new OllamaProvider("http://localhost:11434");

    await expect(
      provider.runLLM([{ role: "user", content: "hi" }], {
        model: "llama3",
      })
    ).rejects.toBeInstanceOf(AbortError);
  });
});
