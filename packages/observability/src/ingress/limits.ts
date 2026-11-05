/**
 * T040 — the limits and the truncation of the ingress (F111-FR-027).
 *
 * F111-FR-027: *Limits and truncation MUST be as at the baseline. The metadata
 * fields of a sanitised value MUST be `redacted`, `truncated`, `original_bytes`
 * and `retained_bytes`. The default limits in bytes MUST be: text 4096, tool
 * arguments 2048, tool result 4096, diagnostic 1024, target 512; and 8 target
 * paths. A limit that is not a positive integer MUST be refused with the message
 * `observability limits must be positive integers`. Truncation MUST be by UTF-8
 * bytes, MUST drop a partial trailing character and MUST add no marker. Redaction
 * MUST run before truncation.*
 *
 * THE METADATA IS SNAKE_CASE AND THAT IS DELIBERATE. These four names are the
 * baseline's `SanitizedValue.metadata()` and the requirement spells them with
 * underscores. The four MARKS OF AN EVENT — `redacted`, `truncated`,
 * `originalBytes`, `retainedBytes` of `tool.call` and `stream.text`
 * (F111-FR-007) — are the same four facts in the camel case of the envelope.
 * They are two surfaces, not a slip: `metadata()` serves the ported policy and
 * `marks()` serves the event. Keeping both means neither surface has to be
 * renamed to suit the other, and `marks()` is derived from `metadata()` so they
 * cannot disagree.
 *
 * REDACT, THEN CUT, AND MEASURE BEFORE EITHER (research D-7, B-2216).
 * `sanitizeText` takes the size of the input first, hands the text to the
 * redactor second, and cuts third. Cutting first could leave the head of a
 * secret whose tail the pattern needed; measuring after redaction would report
 * the size of the placeholders rather than the size of what arrived.
 *
 * `baselineJson` RENDERS AS PYTHON'S `json.dumps` DOES. The baseline's summary of
 * a tool argument is a JSON string with sorted keys and a space after every
 * separator, and both its bytes and its length travel into `original_bytes` and
 * `retained_bytes`. A port that used `JSON.stringify` would differ from the
 * reference by one byte per separator, which the parity oracle compares; so the
 * separators are the baseline's here, and nowhere else in the product.
 */
import { createRedactor, type SpecstrideRedactor } from "@specstride/kernel";

/** The six limits the baseline validates, in its own order. */
export const LIMIT_NAMES = [
  "textMaxBytes",
  "toolArgsMaxBytes",
  "toolResultMaxBytes",
  "diagnosticMaxBytes",
  "targetMaxBytes",
  "maxTargetPaths",
] as const;
export type LimitName = (typeof LIMIT_NAMES)[number];

/** The limits of the ingress (F111-FR-027; row 44 of annex X §X.7). */
export type Limits = { readonly [Name in LimitName]: number };

/** The defaults of the baseline (B-2213). */
export const DEFAULT_LIMITS: Limits = Object.freeze({
  textMaxBytes: 4096,
  toolArgsMaxBytes: 2048,
  toolResultMaxBytes: 4096,
  diagnosticMaxBytes: 1024,
  targetMaxBytes: 512,
  maxTargetPaths: 8,
});

/** The message of the baseline, word for word (B-2212). */
export const BAD_LIMIT_MESSAGE = "observability limits must be positive integers" as const;

/** A limit that is not a positive integer. */
export class LimitsRefused extends Error {
  constructor() {
    super(BAD_LIMIT_MESSAGE);
    this.name = "LimitsRefused";
  }
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * The limits in force. Every one of the six must be a positive integer, and the
 * refusal carries the baseline's message.
 */
export function resolveLimits(options: Partial<Record<LimitName, unknown>> = {}): Limits {
  const out: Record<string, number> = {};
  for (const name of LIMIT_NAMES) {
    const given = options[name];
    const value = given === undefined ? DEFAULT_LIMITS[name] : given;
    if (!isPositiveInteger(value)) throw new LimitsRefused();
    out[name] = value as number;
  }
  return Object.freeze(out as unknown as Limits);
}

/** The metadata fields of a sanitised value (B-2215), in the baseline's order. */
export const SANITIZED_METADATA_FIELDS = [
  "redacted",
  "truncated",
  "original_bytes",
  "retained_bytes",
] as const;
export type SanitizedMetadataField = (typeof SANITIZED_METADATA_FIELDS)[number];

/** The metadata of a sanitised value, as the baseline writes it. */
export type SanitizedMetadata = {
  readonly redacted: boolean;
  readonly truncated: boolean;
  readonly original_bytes: number;
  readonly retained_bytes: number;
};

/** The four marks of an event, the same four facts in the case of the envelope. */
export type EventMarks = {
  readonly redacted: boolean;
  readonly truncated: boolean;
  readonly originalBytes: number;
  readonly retainedBytes: number;
};

/** A value that passed the ingress, with what was done to it. */
export type SanitizedValue<Value = unknown> = {
  readonly value: Value;
  readonly redacted: boolean;
  readonly truncated: boolean;
  readonly original_bytes: number;
  readonly retained_bytes: number;
  /** The four fields of F111-FR-027. */
  metadata(): SanitizedMetadata;
  /** The same four facts as the marks of an event (F111-FR-007). */
  marks(): EventMarks;
};

/** The size of a text in UTF-8 bytes. */
export function byteLength(text: string): number {
  return Buffer.byteLength(String(text), "utf8");
}

/** What a cut did. */
export type Truncation = { readonly value: string; readonly truncated: boolean };

/**
 * Cut a text to a byte cap: by UTF-8 bytes, dropping a partial trailing
 * character, adding no marker (B-2214).
 */
export function truncateUtf8(text: string, maxBytes: number): Truncation {
  const bytes = Buffer.from(String(text), "utf8");
  if (bytes.length <= maxBytes) return Object.freeze({ value: String(text), truncated: false });
  // Step back to the start of the character the cap falls inside.
  let end = maxBytes;
  while (end > 0 && (bytes[end] as number) >= 0x80 && (bytes[end] as number) < 0xc0) end -= 1;
  return Object.freeze({ value: bytes.subarray(0, end).toString("utf8"), truncated: true });
}

function sanitized<Value>(
  value: Value,
  redacted: boolean,
  truncated: boolean,
  originalBytes: number,
  retainedBytes: number,
): SanitizedValue<Value> {
  return Object.freeze({
    value,
    redacted,
    truncated,
    original_bytes: originalBytes,
    retained_bytes: retainedBytes,
    metadata(): SanitizedMetadata {
      return Object.freeze({
        redacted,
        truncated,
        original_bytes: originalBytes,
        retained_bytes: retainedBytes,
      });
    },
    marks(): EventMarks {
      const data = this.metadata();
      return Object.freeze({
        redacted: data.redacted,
        truncated: data.truncated,
        originalBytes: data.original_bytes,
        retainedBytes: data.retained_bytes,
      });
    },
  });
}

/** A sanitised value built by hand: what the ingress hands on. */
export { sanitized as sanitizedValueOf };

/**
 * Render a value as the baseline's `json.dumps(..., ensure_ascii=False,
 * sort_keys=True, default=str)` renders it: sorted keys, a space after `:` and
 * after `,`.
 */
export function baselineJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(baselineJson).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}: ${baselineJson(child)}`);
    return `{${entries.join(", ")}}`;
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  // `default=str` of the baseline: anything else is rendered as its text.
  return JSON.stringify(String(value));
}

/** The redactor a call may bring. Absent: the one the product ships. */
export type WithRedactor = { readonly redactor?: SpecstrideRedactor };

let shipped: SpecstrideRedactor | undefined;

/** The redactor of the product, made once. */
export function defaultRedactor(): SpecstrideRedactor {
  shipped ??= createRedactor();
  return shipped;
}

/**
 * A cap that cuts nothing: the ingress asks the redactor to REPLACE only, and
 * applies the cut itself, so that `truncated` is a fact about the cut and not a
 * guess about what the redactor already did (B-2216).
 */
export const NO_CAP = Number.MAX_SAFE_INTEGER;

/**
 * Sanitise a text: measure, redact, cut (B-2216). `maxBytes` defaults to the
 * text cap of the limits.
 */
export function sanitizeText(
  value: string,
  limits: Limits,
  maxBytes?: number,
  redactor: SpecstrideRedactor = defaultRedactor(),
): SanitizedValue<string> {
  const text = String(value);
  const originalBytes = byteLength(text);
  const cap = maxBytes ?? limits.textMaxBytes;
  const result = redactor.redact(text, NO_CAP);
  if (result.dropped === true) {
    // The redactor could not run: nothing passes (F111-FR-024).
    return sanitized("", true, true, originalBytes, 0);
  }
  const cut = truncateUtf8(result.text, cap);
  return sanitized(
    cut.value,
    result.replacements > 0,
    cut.truncated,
    originalBytes,
    byteLength(cut.value),
  );
}

/**
 * Sanitise a whole value: drop the thinking keys, replace the values of the
 * secret keys, redact every text, and — where a cap is given — render the result
 * as the baseline does and cut it to the cap (`sanitize` of the baseline).
 *
 * With no cap the value comes back as a STRUCTURE; with a cap it comes back as
 * the rendered TEXT, which is the baseline's own behaviour and what the summary
 * of a tool argument needs.
 */
export function sanitizeValue(
  value: unknown,
  limits: Limits,
  maxBytes?: number,
  redactor: SpecstrideRedactor = defaultRedactor(),
): SanitizedValue {
  const original = baselineJson(value);
  const originalBytes = byteLength(original);
  let walked: { value: unknown; redacted: boolean };
  try {
    const result = redactor.redactValue(value);
    walked = { value: result.value, redacted: result.redacted };
  } catch {
    // The redactor could not run: nothing passes (F111-FR-024).
    return sanitized("", true, true, originalBytes, 0);
  }
  const rendered = baselineJson(walked.value);
  if (maxBytes === undefined) {
    return sanitized(walked.value, walked.redacted, false, originalBytes, byteLength(rendered));
  }
  const cut = truncateUtf8(rendered, maxBytes);
  return sanitized(cut.value, walked.redacted, cut.truncated, originalBytes, byteLength(cut.value));
}

/** `limits` is a positive-integer record; this names the cap of a tool result. */
export function toolResultCap(limits: Limits): number {
  return limits.toolResultMaxBytes;
}
