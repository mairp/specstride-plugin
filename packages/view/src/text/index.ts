/**
 * T022 — text safety of the view (F129-FR-009).
 *
 * Every free-text field of the view passes through `safeText`. The value
 * already came from an event or a record that the ingress redacted; the view
 * applies the patterns of the RECORDED VERSION of the pattern set again, takes
 * out every control character, escape sequences included, and cuts the field
 * to its size cap at a character boundary. A field that was cut is marked cut.
 * Where the redactor cannot run the field is dropped and the view says so.
 *
 * The redaction function is INJECTED: the patterns live in `@specstride/kernel`
 * and the pure package may not import it (plan.md, Primary Dependencies).
 */
import { TEXT_CAP_BYTES } from "@specstride/contracts/records/run-view";

export { TEXT_CAP_BYTES };

/**
 * The injected redactor. `version` is the recorded version of the pattern set
 * that `apply` uses; the view records it so that a reader can tell which
 * version ran.
 */
export type Redactor = {
  readonly version: string;
  apply(text: string): string;
};

/** What `safeText` did with one field. */
export type SafeTextOutcome = {
  /** The value for the view, or null where the field was dropped. */
  readonly value: string | null;
  /** True where the value was cut to the cap at a character boundary. */
  readonly cut: boolean;
  /** True where the field was dropped: the redactor could not run, or a path survived. */
  readonly dropped: boolean;
  /** Set where the field was dropped: why. */
  readonly dropReason: "no-redactor" | "redactor-failed" | "physical-path" | null;
  /** The recorded version of the pattern set that ran, or null. */
  readonly redactorVersion: string | null;
};

/* eslint-disable no-control-regex -- taking control characters out is the point of F129-FR-009 */
const ESCAPE_SEQUENCE =
  /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/gu;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/gu;
/* eslint-enable no-control-regex */

/** Take out escape sequences first, then every remaining control character. */
export function withoutControlCharacters(text: string): string {
  return text.replace(ESCAPE_SEQUENCE, "").replace(CONTROL_CHARACTER, "");
}

/** True where the text holds a control character or an escape sequence. */
export function hasControlCharacters(text: string): boolean {
  return withoutControlCharacters(text) !== text;
}

const encoder = new TextEncoder();

/** The length of the text in UTF-8 bytes. */
export function byteLength(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Cut the text to at most `cap` UTF-8 bytes at a CHARACTER boundary: whole
 * code points, and never between the two halves of a surrogate pair.
 */
export function cutToBytes(text: string, cap: number): string {
  if (byteLength(text) <= cap) return text;
  let out = "";
  let used = 0;
  for (const character of text) {
    const size = byteLength(character);
    if (used + size > cap) break;
    out += character;
    used += size;
  }
  return out;
}

/**
 * A physical path: the view names state by LOGICAL NAME and never by physical
 * path (F129-FR-009). A text that still carries one after the redactor has run
 * is dropped, as a text the redactor could not make safe.
 */
const PHYSICAL_PATH =
  /(?:^|[\s"'(=:])(?:\/[^\s"')]*\/[^\s"')]*|[A-Za-z]:[\\/][^\s"')]+|~\/[^\s"')]+)/u;

/** True where the text carries something that reads as a physical path. */
export function hasPhysicalPath(text: string): boolean {
  return PHYSICAL_PATH.test(text);
}

/** The mark a cut field carries at its end. */
export const CUT_MARK = "..." as const;

/**
 * F129-FR-009 for one field. `cap` is 240 bytes for a field of the view
 * (`contracts/run-view.md`) and 120 for the line of an attention item that
 * `status` prints (F129-FR-025).
 */
export function safeText(
  raw: string | null | undefined,
  redactor: Redactor | null | undefined,
  cap: number = TEXT_CAP_BYTES,
): SafeTextOutcome {
  if (raw === null || raw === undefined) {
    return Object.freeze({
      value: null,
      cut: false,
      dropped: false,
      dropReason: null,
      redactorVersion: redactor?.version ?? null,
    });
  }
  if (redactor === null || redactor === undefined) {
    return Object.freeze({
      value: null,
      cut: false,
      dropped: true,
      dropReason: "no-redactor" as const,
      redactorVersion: null,
    });
  }
  let redacted: string;
  try {
    redacted = redactor.apply(String(raw));
  } catch {
    return Object.freeze({
      value: null,
      cut: false,
      dropped: true,
      dropReason: "redactor-failed" as const,
      redactorVersion: redactor.version,
    });
  }
  if (typeof redacted !== "string") {
    return Object.freeze({
      value: null,
      cut: false,
      dropped: true,
      dropReason: "redactor-failed" as const,
      redactorVersion: redactor.version,
    });
  }
  const clean = withoutControlCharacters(redacted);
  if (hasPhysicalPath(clean)) {
    return Object.freeze({
      value: null,
      cut: false,
      dropped: true,
      dropReason: "physical-path" as const,
      redactorVersion: redactor.version,
    });
  }
  if (byteLength(clean) <= cap) {
    return Object.freeze({
      value: clean,
      cut: false,
      dropped: false,
      dropReason: null,
      redactorVersion: redactor.version,
    });
  }
  const room = cap - byteLength(CUT_MARK);
  const value = cutToBytes(clean, room > 0 ? room : 0) + CUT_MARK;
  return Object.freeze({
    value,
    cut: true,
    dropped: false,
    dropReason: null,
    redactorVersion: redactor.version,
  });
}
