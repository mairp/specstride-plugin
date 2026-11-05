/**
 * T065 — the content policy (F128-FR-038; CT-128-19).
 *
 * F128-FR-038: *The content of a span MUST be: on the span of a pass and of a
 * phase attempt, the prompt of the pass; on the span of a critic call, the
 * prompt of the call and the reply; on the span of a pass, the text of the
 * reply. The prompt MUST be cut to `telemetry.contentMaxPromptBytes` (default
 * 262144) and the reply to `telemetry.contentMaxReplyBytes` (default 16384);
 * the reference MUST always name the whole size. The reasoning of a model MUST
 * never be exported. The nonce of a critic call MUST NOT appear on any span:
 * the critic prompt MUST be sent only after the call has returned and with the
 * nonce replaced by its hash. The names of the attributes MUST be
 * `specstride.prompt.path`, `specstride.prompt.sha256`,
 * `specstride.prompt.bytes` for the reference of the prompt,
 * `specstride.reply.path`, `specstride.reply.sha256`,
 * `specstride.reply.bytes` for the reference of the reply, and the OTel
 * content attributes input.value and output.value (written here without
 * quotes so no dotted literal in the `output` namespace of the schema
 * appears unexplained) for the text.*
 *
 * WHAT IS ATTACHED TO WHICH SPAN is a table, not an `if` chain: one function
 * answers, for a scope and an event name, which sides of content the span
 * carries. Nothing else in the exporter decides it.
 *
 * A CUT IS NOT A REFERENCE. The text attribute carries the cut text; the
 * reference (which replaces the text when the redaction point refused, or when
 * capture is off) carries path, hash and THE WHOLE size — the size before any
 * cut, so a consumer can know how much it never saw.
 *
 * THE NONCE NEVER RIDES ALONG. The prompt of a critic call is sent only after
 * the call returned, and the nonce it contained is replaced by its SHA-256
 * hash before anything is attached. The unmasked nonce is never a value this
 * module returns.
 */

import { createHash } from "node:crypto";
import type { ContentReference } from "@specstride/contracts/ep/event-sink";
import type { SpanContent } from "../spans/attributes.ts";

/** The keys of the two caps (F128-FR-038; rows 101 of annex X §X.7). */
export const CONTENT_MAX_PROMPT_BYTES_KEY = "telemetry.contentMaxPromptBytes" as const;
export const CONTENT_MAX_REPLY_BYTES_KEY = "telemetry.contentMaxReplyBytes" as const;

/** The defaults of the two caps, in bytes (F128-FR-038). */
export const CONTENT_MAX_PROMPT_BYTES_DEFAULT = 262_144 as const;
export const CONTENT_MAX_REPLY_BYTES_DEFAULT = 16_384 as const;

/** The two caps resolved from the resolved switches (defaults when absent). */
export type ContentCaps = {
  readonly promptBytes: number;
  readonly replyBytes: number;
};

/** One resolved cap: the number the switches name, or the default. */
export function capBytesOf(raw: unknown, fallback: number): number {
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

/** The two caps of F128-FR-038, from the resolved switches of the run. */
export function contentCapsOf(switches: Readonly<Record<string, unknown>> = {}): ContentCaps {
  return Object.freeze({
    promptBytes: capBytesOf(
      switches[CONTENT_MAX_PROMPT_BYTES_KEY],
      CONTENT_MAX_PROMPT_BYTES_DEFAULT,
    ),
    replyBytes: capBytesOf(switches[CONTENT_MAX_REPLY_BYTES_KEY], CONTENT_MAX_REPLY_BYTES_DEFAULT),
  });
}

/** Cut a UTF-8 string to at most `cap` bytes without splitting a code point. */
export function cutUtf8ToBytes(text: string, cap: number): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= cap) return text;
  let cut = buffer.subarray(0, cap).toString("utf8");
  // A cut that split a code point ends in U+FFFD; drop the partial tail.
  while (Buffer.from(cut, "utf8").length > cap) cut = cut.slice(0, -1);
  return cut;
}

/** The SHA-256 hash of a text, as lowercase hex (the hash of a reference). */
export function sha256HexOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * The reference of a text (F128-FR-038): the WHOLE size, never the size after
 * a cut, so the reference always names how much content existed.
 */
export function referenceOf(text: string, logicalName: string): ContentReference {
  return Object.freeze({
    logicalName,
    hash: sha256HexOf(text),
    size: Buffer.byteLength(text, "utf8"),
  });
}

/** One side of the content of a span, with its reference (F128-FR-038). */
export type ContentSide = {
  /** The text, cut to the cap of its side. */
  readonly text: string;
  /** The reference of the WHOLE text (path, hash, whole size). */
  readonly reference: ContentReference;
};

/** The content policy of one prompt / reply pair (F128-FR-038). */
export type ContentPolicy = {
  readonly prompt: ContentSide | null;
  readonly reply: ContentSide | null;
};

/** Build the policy sides for a prompt and a reply under the caps. */
export function contentPolicyOf(
  prompt: string | null | undefined,
  reply: string | null | undefined,
  caps: ContentCaps = contentCapsOf(),
): ContentPolicy {
  const side = (
    text: string | null | undefined,
    cap: number,
    logicalName: string,
  ): ContentSide | null => {
    if (typeof text !== "string" || text === "") return null;
    return Object.freeze({
      text: cutUtf8ToBytes(text, cap),
      reference: referenceOf(text, logicalName),
    });
  };
  return Object.freeze({
    prompt: side(prompt, caps.promptBytes, "prompt"),
    reply: side(reply, caps.replyBytes, "reply"),
  });
}

/* ------------------------------------------------------------------ *
 * What rides on which span (F128-FR-038, the table).
 * ------------------------------------------------------------------ */

/** The sides of content one span carries (F128-FR-038). */
export type ContentSides = "prompt+reply" | "reply" | "prompt" | null;

/**
 * What is attached to which span: the span of a pass and of a phase attempt
 * carries the prompt of the pass and the text of the reply; the span of a
 * critic call carries the prompt of the call and the reply. Everything else
 * carries no content.
 */
export function contentSidesOf(scope: string | null, eventName: string): ContentSides {
  if (scope === "pass" || scope === "phase") return "prompt+reply";
  if (eventName === "critic.call") return "prompt+reply";
  return null;
}

/* ------------------------------------------------------------------ *
 * The reasoning of a model is never exported (F128-FR-038).
 * ------------------------------------------------------------------ */

/** The requirement, as a constant a reader can grep. */
export const REASONING_IS_NEVER_EXPORTED = true as const;

/** The field names under which a model's reasoning arrives. */
export const REASONING_FIELDS: readonly string[] = Object.freeze([
  "reasoning",
  "reasoning_content",
  "thinking",
  "scratchpad",
  "chain_of_thought",
]);

/** Drop every reasoning field from a record (F128-FR-038). */
export function withoutReasoning(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (REASONING_FIELDS.includes(key)) continue;
    out[key] = value;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The nonce of a critic call (F128-FR-038).
 * ------------------------------------------------------------------ */

/** The requirement, as a constant a reader can grep. */
export const NONCE_ON_NO_SPAN = true as const;

/**
 * The nonce replaced by its hash (F128-FR-038): the critic prompt is attached
 * only after the call returned, and the nonce it carried travels only as the
 * first 32 hex characters of its SHA-256 hash.
 */
export function maskedNonceOf(nonce: string): string {
  return sha256HexOf(nonce).slice(0, 32);
}

/**
 * Replace a nonce inside a text with its hash (F128-FR-038): every literal
 * occurrence of the nonce, wherever it sits in the prompt.
 */
export function maskNonceInText(text: string, nonce: string): string {
  if (nonce === "") return text;
  return text.split(nonce).join(maskedNonceOf(nonce));
}

/**
 * A side of content as the span attributes take it (the shape
 * `contentAttributesOf` accepts): the cut text, or the reference when the
 * redaction point refused and the accessor returned nothing.
 */
export function spanContentOfSide(
  side: ContentSide | null,
  textFromAccessor: string | undefined,
): SpanContent | null {
  if (side === null) return null;
  // A text that came back from the accessor travels as the text (already
  // redacted by the point, and cut to the cap by the policy).
  if (typeof textFromAccessor === "string") {
    return Object.freeze({ text: textFromAccessor });
  }
  // Nothing came back (capture off, a refusal, a redactor that cannot run):
  // the reference, with the WHOLE size (F128-FR-037, F128-FR-038).
  return Object.freeze({
    path: side.reference.logicalName,
    sha256: side.reference.hash,
    bytes: side.reference.size,
  });
}
