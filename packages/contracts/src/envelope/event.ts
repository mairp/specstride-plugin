/**
 * T064 — the type and the validator of the event envelope and the rules of
 * versioning (annex X, §X.1; F100-FR-198, F100-FR-199, F100-FR-200).
 *
 * Feature 100 owns the envelope and the rules of versioning. Feature 111 owns
 * the content: the event types and the fields of `data`.
 */
import type { EventEnvelope } from "../records/generated/event-envelope.ts";
import { validate } from "../records/compile.ts";
import type { SchemaError } from "../records/compile.ts";

export type { EventEnvelope };

/** The schema id an event carries; the constant `specstride.event`. */
export const SCHEMA = "specstride.event" as const;
/** The schema id with its major, as the validator is keyed (F100-FR-048). */
export const SCHEMA_ID = "specstride.event/1" as const;
/** The major this reader supports. */
export const MAJOR = 1 as const;

/** The logical name of the event stream of a run (annex B, §B.5). */
export const LOGICAL_NAME = "run:<runId>:events" as const;

/**
 * F100-FR-198 — `workerId` and `wseq` are absent on the main line. A run with
 * parallel units on still records `strategy` as `micro`.
 */
export const WORKER_FIELDS = ["workerId", "wseq"] as const;
export const STRATEGIES = ["classic", "micro"] as const;
export type Strategy = (typeof STRATEGIES)[number];
export const STRATEGY_WITH_PARALLEL_UNITS_ON: Strategy = "micro";

/**
 * F100-FR-198 — typed values, null for an unknown value, absence for a value
 * that does not apply. These three fields are the ones the annex names as
 * null-where-unknown (`harness`, `provider`, `model`: "as known, else null").
 */
export const NULL_WHERE_UNKNOWN = ["harness", "provider", "model"] as const;

/** An event type free for third parties starts with `x.` (F100-FR-199). */
export const THIRD_PARTY_PREFIX = "x." as const;
export function isThirdPartyType(type: string): boolean {
  return type.startsWith(THIRD_PARTY_PREFIX);
}

/** The range of majors a reader declares (F100-FR-199). */
export type MajorRange = { readonly from: number; readonly to: number };
export const SUPPORTED_MAJORS: MajorRange = Object.freeze({ from: 1, to: 1 });

/** What a reader does with an event whose major lies outside its range. */
export type OutsideRangeOutcome = {
  readonly accepted: false;
  /** A doctor warning, never a failure of a run (F100-FR-199). */
  readonly doctorWarning: true;
  readonly failsTheRun: false;
  readonly message: string;
};

export function majorIsSupported(v: number, range: MajorRange = SUPPORTED_MAJORS): boolean {
  return v >= range.from && v <= range.to;
}

export function outsideRange(v: number, range: MajorRange = SUPPORTED_MAJORS): OutsideRangeOutcome {
  return Object.freeze({
    accepted: false as const,
    doctorWarning: true as const,
    failsTheRun: false as const,
    message:
      `the event carries the major ${v}; this reader declares the majors ` +
      `${range.from} to ${range.to} (F100-FR-199)`,
  });
}

/** The result of reading one line of the event stream. */
export type ReadLine =
  | { readonly ok: true; readonly event: EventEnvelope }
  | { readonly ok: false; readonly reason: "torn"; readonly tolerated: true }
  | { readonly ok: false; readonly reason: "outside-range"; readonly outcome: OutsideRangeOutcome }
  | { readonly ok: false; readonly reason: "invalid"; readonly errors: readonly SchemaError[] };

/**
 * Read one line of the event stream. A torn last line is tolerated
 * (F100-FR-199): the reader says so and never fails the run.
 */
export function readEventLine(line: string, isLastLine = false): ReadLine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    if (isLastLine) return { ok: false, reason: "torn", tolerated: true };
    return {
      ok: false,
      reason: "invalid",
      errors: [{ keyword: "json", path: "(line)", message: "the line is not a record" }],
    };
  }
  const v = (parsed as { v?: unknown }).v;
  if (typeof v === "number" && !majorIsSupported(v)) {
    return { ok: false, reason: "outside-range", outcome: outsideRange(v) };
  }
  const result = validate<EventEnvelope>(SCHEMA_ID, parsed);
  if (!result.ok) return { ok: false, reason: "invalid", errors: result.errors };
  return { ok: true, event: result.record };
}

/** True when the value validates against the envelope. */
export function isEventEnvelope(value: unknown): value is EventEnvelope {
  return validate<EventEnvelope>(SCHEMA_ID, value).ok;
}

/**
 * F100-FR-198 — `seq` is given by the one event writer at the append: rising,
 * without gaps.
 */
export function seqIsWellFormed(events: readonly { seq: number }[]): boolean {
  return events.every((e, i) => Number(e.seq) === i + 1);
}

/**
 * F100-FR-200 — an event holds no content. Content is referred to by logical
 * name, hash and size.
 */
export const CONTENT_REFERENCE_FIELDS = ["logicalName", "hash", "size"] as const;
export const AN_EVENT_HOLDS_CONTENT = false as const;

/** F100-FR-200 — liveness is never an event. */
export const LIVENESS_IS_AN_EVENT = false as const;

/**
 * F100-FR-200 — every event that opens something has a matching event that
 * closes it; where a process died before it could write the closing event,
 * the next writer writes it, marked as synthesized.
 */
export const SYNTHESIZED_FIELD = "synthesized" as const;

export function unclosed(
  events: readonly { type: string; cause?: string | undefined }[],
  pairs: Readonly<Record<string, string>>,
): readonly string[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.type in pairs) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    for (const [open, close] of Object.entries(pairs)) {
      if (e.type === close) counts.set(open, (counts.get(open) ?? 0) - 1);
    }
  }
  return Object.freeze([...counts].filter(([, n]) => n > 0).map(([t]) => t));
}

/** F100-FR-199 — a change inside a major is additive. */
export const CHANGES_INSIDE_A_MAJOR_ARE_ADDITIVE = true as const;

/** F100-FR-199 — a reader ignores a field and an event type it does not know. */
export function ignoresUnknown(): true {
  return true;
}
