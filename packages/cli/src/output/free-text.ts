/**
 * T034 — the free-text rule for every verb (F119-FR-032).
 *
 * Text that comes from outside the runtime — the critic's feedback, the
 * verdict transcripts, the text and targets of an agent, messages of a
 * harness, free-text fields of an event, titles from a spec, names of tests —
 * MUST NOT be printed in default output. The line refers to it by logical
 * name, byte count and the first eight characters of its hash
 * (`freeTextReference`). With `--verbose` the text MAY be printed, redacted
 * and cut to the 16,384-byte cap of the frame writer, and framed as data
 * (`freeTextFrame`, F119-FR-032).
 *
 * Every verb of the front door reaches its outside text ONLY through this
 * module: no handler of `src/inspect/` prints a free-text value directly.
 */

import { createHash } from "node:crypto";
import { Ingress } from "@specstride/observability";
import { referenceLine, frameText, type DataFrame } from "./frame.ts";

/** The closed list of the sources the rule names (F119-FR-032). */
export const OUTSIDE_TEXT_SOURCES: readonly string[] = Object.freeze([
  "critic feedback",
  "verdict transcript",
  "agent text and targets",
  "harness message",
  "event free text",
  "spec title",
  "test name",
]);

/**
 * The default-output reference to outside text (F119-FR-032): one line that
 * carries the logical name, the byte count and the hash prefix — never the
 * text itself.
 */
export function freeTextReference(label: string, name: string, text: string): string {
  return referenceLine(label, name, text);
}

/**
 * The `--verbose` data frame of outside text (F119-FR-032): the text passes
 * the redactor and the 16,384-byte cap BEFORE it enters the frame, and the
 * token of the frame is fresh for the call and 64 bits long.
 */
export function freeTextFrame(name: string, text: string): DataFrame {
  return frameText(name, text);
}

/**
 * The lines one call prints for outside text: the reference in default
 * output, or the frame of the redacted text under `--verbose`.
 */
export function outsideTextLines(
  label: string,
  name: string,
  text: string,
  options: { readonly verbose?: boolean | undefined },
): readonly string[] {
  if (options.verbose !== true) return [freeTextReference(label, name, text)];
  const frame = freeTextFrame(name, text);
  return [frame.begin, frame.body, frame.end];
}

/** True where the text holds any of the needles (the canary check). */
export function mentionsAny(output: string, needles: readonly string[]): boolean {
  return needles.some((needle) => needle !== "" && output.includes(needle));
}

/** The first eight characters of the SHA-256 hash of a text (F119-FR-032). */
export function hashPrefix(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 8);
}

/**
 * One free-text WORD as a line may carry it: the word passes through the
 * ingress of `@specstride/observability` (F111-FR-023) first, so a canary in
 * the read text never reaches default output (F119-FR-032). The word the
 * ingress returns is cut at 120 bytes; a failed redaction closes empty.
 */
const wordIngress = new Ingress({ limits: { textMaxBytes: 120 } });

export function redactWord(word: string): string {
  const through = wordIngress.text(word, "line-word");
  return through.ok ? through.text : "";
}
