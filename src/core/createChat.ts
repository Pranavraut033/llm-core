/**
 * `createChat` — the message-array analog of `createCompletion`, wrapping
 * `LLMProvider.runLLM`. This is the generalized, framework-agnostic form
 * of a hand-rolled streaming chat context: it owns message state,
 * consumes the stream, and appends/updates the trailing assistant message
 * per delta instead of a single `text` field.
 */
import { v4 as uuidv4 } from "uuid";

import { classifyProviderError, LLMError } from "../errors";
import { LLMProvider } from "../providers/LLMProvider";
import { ProviderId } from "../providerType";
import { LLMUsageInfo } from "../tokens/usageTypes";
import { LLMStreamEvent, PromptMessage } from "../types";
import { createProviderResolver } from "./providerResolution";
import { createEmitter } from "./store";
import { ControllerBaseOptions, Store } from "./types";

/**
 * A chat message as managed by `createChat`. Deliberately narrower than
 * the full `PromptMessage` union (no tool-role/multimodal parts) — this
 * controller targets the common text-chat UI case; hosts that need
 * multimodal/tool-call messages should drive `runLLM` directly.
 */
export interface ChatMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatSnapshot {
  messages: ChatMessage[];
  isLoading: boolean;
  error: LLMError | undefined;
}

export interface CreateChatOptions extends ControllerBaseOptions {
  /** Seed messages the chat starts with (e.g. a system prompt). */
  initialMessages?: ChatMessage[];
}

export interface ChatController extends Store<ChatSnapshot> {
  /** Appends a user message and streams the assistant's reply. */
  sendMessage(content: string): Promise<void>;
  /** Aborts the in-flight `sendMessage()` call, if any. */
  stop(): void;
  /** Resets messages to empty and aborts any in-flight call. */
  reset(): void;
  /** Replaces the message list wholesale (e.g. to restore history). */
  setMessages(messages: ChatMessage[]): void;
}

function toPromptMessages(messages: ChatMessage[]): PromptMessage[] {
  return messages.map(
    (m) => ({ role: m.role, content: m.content }) as PromptMessage
  );
}

export function createChat(opts: CreateChatOptions): ChatController {
  const resolveProvider = createProviderResolver(opts.provider);
  const emitter = createEmitter();

  let snapshot: ChatSnapshot = {
    messages: opts.initialMessages ?? [],
    isLoading: false,
    error: undefined,
  };
  let abortController: AbortController | undefined;

  function setSnapshot(patch: Partial<ChatSnapshot>): void {
    snapshot = { ...snapshot, ...patch };
    emitter.emit();
  }

  function updateMessage(id: string, content: string): void {
    setSnapshot({
      messages: snapshot.messages.map((m) =>
        m.id === id ? { ...m, content } : m
      ),
    });
  }

  async function sendMessage(content: string): Promise<void> {
    abortController?.abort();
    const controller = new AbortController();
    abortController = controller;
    const { signal } = controller;

    const userMessage: ChatMessage = { id: uuidv4(), role: "user", content };
    const assistantMessage: ChatMessage = {
      id: uuidv4(),
      role: "assistant",
      content: "",
    };

    setSnapshot({
      messages: [...snapshot.messages, userMessage, assistantMessage],
      isLoading: true,
      error: undefined,
    });

    let providerId: ProviderId | undefined;

    try {
      const provider: LLMProvider = await resolveProvider();
      providerId = provider.providerType;

      const priorMessages = toPromptMessages(
        snapshot.messages.filter((m) => m.id !== assistantMessage.id)
      );

      const stream = provider.runLLM(priorMessages, {
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
            updateMessage(assistantMessage.id, text);
            break;
          case "usage":
            usage = event.usage;
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
    snapshot = { messages: [], isLoading: false, error: undefined };
    emitter.emit();
  }

  function setMessages(messages: ChatMessage[]): void {
    setSnapshot({ messages });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: emitter.subscribe,
    sendMessage,
    stop,
    reset,
    setMessages,
  };
}
