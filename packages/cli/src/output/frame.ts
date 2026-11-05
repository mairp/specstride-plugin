/**
 * T005 — the data-frame writer of default output (F119-FR-032).
 *
 * Text that comes from outside the runtime — the critic's feedback, the
 * verdict transcripts, free-text fields of an event — is NEVER printed in
 * default output: the line refers to it by logical name, byte count and the
 * first eight characters of its hash. With `--verbose` the text MAY be
 * printed, framed as data:
 *
 *   [SPECSTRIDE-DATA] part=begin name=<logical name> bytes=<n> token=<token>
 *   ... the redacted, cut text ...
 *   [SPECSTRIDE-DATA] part=end token=<token>
 *
 * The token is fresh for each call and 64 bits long, so that the framed text
 * cannot end the frame: only a line that repeats the fresh token does.
 *
 * THE REDACTION GOES THROUGH THE INGRESS (F111-FR-023). The front door never
 * holds a redactor of its own: the text of the frame passes through `Ingress`
 * of `@specstride/observability`, which redacts first and cuts second. The
 * ingress is built with `textMaxBytes: FRAME_TEXT_BYTE_CAP`, so the cap the
 * front door hands to the redaction point is exactly the 16,384 bytes of
 * F119-FR-032; the begin line's `bytes=<n>` is `original_bytes`, measured
 * BEFORE the redaction and the cut. A redaction point that fails closed
 * contributes an empty body and nothing else changes.
 */

import { createHash, randomBytes } from "node:crypto";
import { Ingress } from "@specstride/observability";
import { DATA_BEGIN_LABEL, DATA_END_LABEL } from "./closed-sets.ts";

/**
 * The size cap per framed text (F119-FR-032): the cap the front door hands
 * to the redaction point, through the limits of the ingress.
 */
export const FRAME_TEXT_BYTE_CAP = 16_384 as const;

/** The one ingress of the frame writer: redact first, cut at 16,384 second. */
const frameIngress = new Ingress({ limits: { textMaxBytes: FRAME_TEXT_BYTE_CAP } });

/**
 * A fresh 64-bit token, hexadecimal, for one data frame (F119-FR-032). Fresh
 * for each call: `randomBytes` never repeats it within a run in practice and
 * no caller may pass one in.
 */
export function freshFrameToken(): string {
  return randomBytes(8).toString("hex");
}

/** What a framed text refers to in default output (F119-FR-032). */
export type TextReference = {
  /** The logical name of the text, never its content. */
  readonly name: string;
  /** The size of the text in bytes. */
  readonly bytes: number;
  /** The first eight characters of the SHA-256 hash of the text. */
  readonly hash: string;
};

/** Refer to outside text by logical name, byte count and hash prefix. */
export function textReference(name: string, text: string): TextReference {
  return Object.freeze({
    name,
    bytes: Buffer.byteLength(text, "utf8"),
    hash: createHash("sha256").update(text, "utf8").digest("hex").slice(0, 8),
  });
}

/** One framed text: the begin line, the body, the end line. */
export type DataFrame = {
  /** `[SPECSTRIDE-DATA] part=begin name=... bytes=... token=...` */
  readonly begin: string;
  /** The redacted, cut text; empty when the redaction point dropped it. */
  readonly body: string;
  /** `[SPECSTRIDE-DATA] part=end token=...` */
  readonly end: string;
  /** The token of the frame, fresh for the call. */
  readonly token: string;
  /** True when the redaction point failed closed and the body is empty. */
  readonly dropped: boolean;
};

/**
 * Frame one text of outside the runtime for `--verbose` output. The text
 * passes through the ingress of `@specstride/observability` (F111-FR-023)
 * with the cap of F119-FR-032 BEFORE it enters the frame.
 */
export function frameText(name: string, text: string, token?: string): DataFrame {
  const frameToken = token ?? freshFrameToken();
  const through = frameIngress.text(text, "stream-text");
  const dropped = !through.ok;
  const body = through.ok ? through.text : "";
  return Object.freeze({
    begin: [
      DATA_BEGIN_LABEL,
      "part=begin",
      `name=${JSON.stringify(name)}`,
      `bytes=${Buffer.byteLength(text, "utf8")}`,
      `token=${frameToken}`,
    ].join(" "),
    body,
    end: `${DATA_END_LABEL} part=end token=${frameToken}`,
    token: frameToken,
    dropped,
  });
}

/**
 * The default-output reference line for outside text: no text, only the
 * logical name, the byte count and the hash prefix (F119-FR-032).
 */
export function referenceLine(label: string, name: string, text: string): string {
  const ref = textReference(name, text);
  return `${label} name=${JSON.stringify(ref.name)} bytes=${ref.bytes} hash=${ref.hash}`;
}
