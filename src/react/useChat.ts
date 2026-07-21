/**
 * `useChat` — a thin React binding over `createChat` (`../core/createChat`).
 * No duplicated logic: the controller owns all message state, this hook
 * just subscribes to it via `useSyncExternalStore` and binds its actions.
 */
import { useMemo, useSyncExternalStore } from "react";

import {
  ChatMessage,
  ChatSnapshot,
  createChat,
  CreateChatOptions,
} from "../core";

export interface UseChatResult extends ChatSnapshot {
  /** Appends a user message and streams the assistant's reply. */
  sendMessage(content: string): Promise<void>;
  /** Aborts the in-flight `sendMessage()` call, if any. */
  stop(): void;
  /** Replaces the message list wholesale (e.g. to restore history). */
  setMessages(messages: ChatMessage[]): void;
}

export function useChat(opts: CreateChatOptions): UseChatResult {
  const controller = useMemo(
    () => createChat(opts),
    // Re-create the controller only when the provider/model identity
    // changes — `initialMessages` only seeds the controller once, matching
    // the "don't recreate on every render" guidance.
    [opts.provider, opts.model]
  );

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot
  );

  return {
    ...snapshot,
    sendMessage: controller.sendMessage,
    stop: controller.stop,
    setMessages: controller.setMessages,
  };
}
