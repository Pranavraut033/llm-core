/**
 * `createCompletion` — an observable controller wrapping
 * `LLMProvider.generateText`/`runLLM` for a single-string completion
 * (no message history). Framework-agnostic: no React import.
 */
import { classifyProviderError, LLMError } from "../errors";
import { LLMProvider } from "../providers/LLMProvider";
import { ProviderId } from "../providerType";
import { LLMUsageInfo } from "../tokens/usageTypes";
import { LLMStreamEvent } from "../types";
import { createProviderResolver } from "./providerResolution";
import { createEmitter } from "./store";
import { ControllerBaseOptions, Store } from "./types";

export interface CompletionSnapshot {
  text: string;
  isLoading: boolean;
  error: LLMError | undefined;
  usage: LLMUsageInfo | undefined;
}

export interface CreateCompletionOptions extends ControllerBaseOptions {
  /** System prompt prepended to every `complete()` call. */
  systemPrompt?: string;
}

export interface CompletionController extends Store<CompletionSnapshot> {
  /** Streams a completion for `input`, accumulating deltas into `text`. */
  complete(input: string): Promise<void>;
  /** Aborts the in-flight `complete()` call, if any. */
  stop(): void;
  /** Resets the snapshot to its initial state and aborts any in-flight call. */
  reset(): void;
}

const INITIAL_SNAPSHOT: CompletionSnapshot = {
  text: "",
  isLoading: false,
  error: undefined,
  usage: undefined,
};

export function createCompletion(
  opts: CreateCompletionOptions
): CompletionController {
  const resolveProvider = createProviderResolver(opts.provider);
  const emitter = createEmitter();

  let snapshot: CompletionSnapshot = INITIAL_SNAPSHOT;
  let abortController: AbortController | undefined;

  function setSnapshot(patch: Partial<CompletionSnapshot>): void {
    snapshot = { ...snapshot, ...patch };
    emitter.emit();
  }

  async function complete(input: string): Promise<void> {
    abortController?.abort();
    const controller = new AbortController();
    abortController = controller;
    const { signal } = controller;

    setSnapshot({
      text: "",
      isLoading: true,
      error: undefined,
      usage: undefined,
    });

    let providerId: ProviderId | undefined;

    try {
      const provider: LLMProvider = await resolveProvider();
      providerId = provider.providerType;

      const stream = provider.generateText(opts.systemPrompt ?? "", input, {
        ...opts.generationOptions,
        model: opts.model,
        stream: true,
        signal,
      });

      let text = "";
      let usage: LLMUsageInfo | undefined;

      for await (const event of stream as AsyncGenerator<LLMStreamEvent>) {
        switch (event.type) {
          case "text":
            text += event.delta;
            setSnapshot({ text });
            break;
          case "usage":
            usage = event.usage;
            setSnapshot({ usage });
            break;
          case "done":
            if (usage) await opts.onUsage?.(usage);
            break;
          case "tool_call":
            break;
        }
      }

      setSnapshot({ isLoading: false });
    } catch (err) {
      if (signal.aborted) {
        setSnapshot({ isLoading: false });
        return;
      }
      setSnapshot({
        isLoading: false,
        error: classifyProviderError(err, providerId),
      });
    }
  }

  function stop(): void {
    abortController?.abort();
  }

  function reset(): void {
    abortController?.abort();
    abortController = undefined;
    snapshot = INITIAL_SNAPSHOT;
    emitter.emit();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: emitter.subscribe,
    complete,
    stop,
    reset,
  };
}
