/**
 * The session, model and message handling of the JSONL reader, and the text
 * accumulation (T033; covers F138-FR-027 and F138-FR-028).
 *
 * A session record with an accepted version gives an `init` record with the
 * schema version, the session id, the working directory, the provider and
 * the model, every null value dropped, and the display line of the row's
 * provider format with `?` where the id is absent. A message of the role
 * assistant, or of no role, that names a model or a provider that differs
 * from the current one is followed by an `init` record with `update` true. A
 * message whose role is present and is not `assistant` is ignored for text
 * and for the tracking of the model. Text deltas accumulate per message and
 * content index and are never emitted before the message ends; a negative or
 * non-integer index is read as 0; a content snapshot at the end of a message
 * replaces the accumulated text only where it starts with it, or where
 * nothing was accumulated.
 */
import type { DialectRow } from "./dialect.ts";
import { cleanFields, displayLineForInit, type ReaderRedactor } from "./display.ts";

/** The role rule of F138-FR-027: assistant, or no role at all. */
export function isAssistantish(record: Record<string, unknown>): boolean {
  const message = (record["message"] ?? {}) as Record<string, unknown>;
  const role = message["role"];
  return role === undefined || role === null || role === "assistant";
}

/** The id of a message, generated where the record names none. */
export function messageIdOf(record: Record<string, unknown>, knownMessages: number): string {
  const message = (record["message"] ?? {}) as Record<string, unknown>;
  const id = message["id"] ?? record["messageId"];
  if (typeof id === "string" && id.length > 0) return id;
  return `message-${knownMessages + 1}`;
}

/** The content index of one delta, with the rule of F138-FR-028. */
export function contentIndexOf(record: Record<string, unknown>): number {
  const index = record["contentIndex"] ?? record["content_index"] ?? 0;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return 0;
  return index;
}

/** One text block accumulated for one message and content index. */
export type TextBlock = {
  text: string;
  closed: boolean;
};

/** The messages of the session: message id to content index to block. */
export type MessageMap = Map<string, Map<number, TextBlock>>;

/** The update of the model and provider a message start may carry. */
export function trackModelChange(options: {
  record: Record<string, unknown>;
  model: string | null;
  provider: string | null;
}): { model: string | null; provider: string | null; changed: boolean } {
  const message = (options.record["message"] ?? {}) as Record<string, unknown>;
  const newModel = message["model"];
  const newProvider = message["provider"];
  const modelChanged =
    typeof newModel === "string" && newModel.length > 0 && newModel !== options.model;
  const providerChanged =
    typeof newProvider === "string" && newProvider.length > 0 && newProvider !== options.provider;
  if (!modelChanged && !providerChanged) {
    return { model: options.model, provider: options.provider, changed: false };
  }
  return {
    model: modelChanged ? (newModel as string) : options.model,
    provider: providerChanged ? (newProvider as string) : options.provider,
    changed: true,
  };
}

/** Accumulate one text delta (F138-FR-028). */
export function accumulateTextDelta(options: {
  record: Record<string, unknown>;
  messages: MessageMap;
}): void {
  const delta = (options.record["delta"] ?? {}) as Record<string, unknown>;
  const type = delta["type"];
  if (type !== "text_delta" && type !== "text") return;
  const text = delta["text"];
  if (typeof text !== "string") return;
  const messageKey =
    typeof options.record["messageId"] === "string"
      ? (options.record["messageId"] as string)
      : typeof options.record["message_id"] === "string"
        ? (options.record["message_id"] as string)
        : "message-unknown";
  const index = contentIndexOf(options.record);
  const blocks = options.messages.get(messageKey) ?? new Map<number, TextBlock>();
  const block = blocks.get(index) ?? { text: "", closed: false };
  if (!block.closed) block.text += text;
  blocks.set(index, block);
  options.messages.set(messageKey, blocks);
}

/** The stop reason and error message of a message end, under either name. */
export function messageEndErrorOf(message: Record<string, unknown>): {
  stopReason: unknown;
  errorMessage: string | null;
} {
  const stopReason = message["stopReason"] ?? message["stop_reason"];
  const raw = message["errorMessage"] ?? message["error_message"];
  const errorMessage = typeof raw === "string" && raw.length > 0 ? raw : null;
  return { stopReason, errorMessage };
}

/** What handling one message end gives back to the reader. */
export type MessageEndResult = {
  /** The closed, non-empty text blocks, in content order. */
  blocks: { messageKey: string; messageId: string; index: number; text: string }[];
  /** The provider error the end of the message carries, where it does. */
  providerError: { message: string; stopReason: unknown } | null;
};

/** Close a message: snapshots where they extend, then the text records. */
export function closeMessage(options: {
  record: Record<string, unknown>;
  messageId: string;
  messages: MessageMap;
}): MessageEndResult {
  const message = (options.record["message"] ?? {}) as Record<string, unknown>;
  const blocks = options.messages.get(options.messageId) ?? new Map<number, TextBlock>();
  const content = Array.isArray(message["content"]) ? (message["content"] as unknown[]) : [];
  content.forEach((block, index) => {
    if (
      block === null ||
      typeof block !== "object" ||
      (block as Record<string, unknown>)["type"] !== "text"
    ) {
      return;
    }
    const snapshot = (block as Record<string, unknown>)["text"];
    if (typeof snapshot !== "string") return;
    const state = blocks.get(index) ?? { text: "", closed: false };
    if (snapshot.startsWith(state.text) || !state.text) {
      state.text = snapshot;
    }
    blocks.set(index, state);
  });
  const emitted: MessageEndResult["blocks"] = [];
  for (const index of [...blocks.keys()].sort((a, b) => a - b)) {
    const state = blocks.get(index);
    if (state === undefined || state.closed) continue;
    state.closed = true;
    if (!state.text) continue;
    emitted.push({
      messageKey: `${options.messageId}:${index}`,
      messageId: options.messageId,
      index,
      text: state.text,
    });
  }
  options.messages.set(options.messageId, blocks);
  const error = messageEndErrorOf(message);
  const providerError =
    error.stopReason === "error" || error.errorMessage !== null
      ? {
          message: error.errorMessage ?? "Prime message ended with an error",
          stopReason: error.stopReason,
        }
      : null;
  return { blocks: emitted, providerError };
}

/** The fields of the `init` record a session gives, nulls dropped. */
export function sessionInitFields(options: {
  schemaVersion: number;
  sessionId: unknown;
  cwd: unknown;
  provider: unknown;
  model: unknown;
}): Record<string, unknown> {
  return cleanFields({
    schema_version: options.schemaVersion,
    session_id: options.sessionId ?? null,
    cwd: options.cwd ?? null,
    provider: options.provider ?? null,
    model: options.model ?? null,
  });
}

/** The fields of the `init` update a message start gives. */
export function initUpdateFields(options: {
  schemaVersion: number;
  sessionId: string | null;
  cwd: string | null;
  model: string | null;
  provider: string | null;
}): Record<string, unknown> {
  return cleanFields({
    schema_version: options.schemaVersion,
    session_id: options.sessionId,
    cwd: options.cwd,
    model: options.model,
    provider: options.provider,
    update: true,
  });
}

export { displayLineForInit, type ReaderRedactor, type DialectRow };
