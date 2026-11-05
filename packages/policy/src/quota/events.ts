/**
 * T012 — the ten events of this feature, emitted through the event port,
 * REDACTED and CUT (F127-FR-040).
 *
 * F127-FR-040: the engine writes `quota.signal`, `run.paused`, `run.resumed`,
 * `harness.error`, `alert`, `budget.exceeded`, `fallback.switched`,
 * `fallback.restored`, `fallback.skipped` and `blocked` under the envelope of
 * feature 100 annex X §X.1, with NO CONTENT and with free-text fields redacted
 * and cut. Every one of them is a type of the catalogue of feature 111; this
 * feature writes no event whose type the catalogue does not hold. A `run.paused`
 * and a `run.resumed` open and close a PAIR.
 *
 * Three things this module guarantees, each in one place:
 *
 *  - **the closed list** — `POLICY_EVENT_TYPES` is the ten types and nothing
 *    else. `emit` refuses a type outside it, so a typo cannot reach a sink;
 *  - **redacted and cut** — `FREE_TEXT_FIELDS` names, per event type, which
 *    fields are free text. Every one of them passes the injected redactor and
 *    is cut to `FREE_TEXT_CAP_BYTES`. With no redactor handed in, a free-text
 *    field is DROPPED and replaced by its drop mark — the fail-closed rule of
 *    F100-FR-205, never the text in the clear. No field named `content`,
 *    `text`, `body`, `prompt` or `reply` is ever carried: `NO_CONTENT` is
 *    checked on every payload, because "with no content" is a rule about the
 *    whole payload and not about one field;
 *  - **the pair** — `pairState` follows the `run.paused`/`run.resumed` pair, so
 *    a second `run.paused` without its `run.resumed`, or a `run.resumed` with
 *    no pause open, is refused instead of written.
 *
 * The envelope itself (`schema`, `seq`, `ts`, `runId`, …) belongs to the writer
 * of feature 111: this module hands over a type and a payload, which is what
 * the `EventWriter` port of `./ports.ts` takes.
 */
import type { RedactResult } from "@specstride/contracts/ep/redactor";
import { REDACTOR_UNAVAILABLE } from "./classify.ts";
import type { EventWriter, PolicyEvent } from "./ports.ts";

/** The ten event types of F127-FR-040, in the order the requirement lists them. */
export const POLICY_EVENT_TYPES = [
  "quota.signal",
  "harness.error",
  "run.paused",
  "run.resumed",
  "alert",
  "budget.exceeded",
  "fallback.switched",
  "fallback.restored",
  "fallback.skipped",
  "blocked",
] as const;
export type PolicyEventType = (typeof POLICY_EVENT_TYPES)[number];

/** The byte cap of a free-text field of an event (F127-FR-040, "cut"). */
export const FREE_TEXT_CAP_BYTES = 512;

/**
 * The mark a dropped free-text field carries (F100-FR-205). It is the kernel's
 * drop mark, declared once in `./classify.ts` and used by both.
 */
export { REDACTOR_UNAVAILABLE };

/**
 * The free-text fields per event type. Every one of them passes the redactor
 * and is cut; a field not named here carries a typed value and is written as
 * it is.
 */
export const FREE_TEXT_FIELDS: Readonly<Record<PolicyEventType, readonly string[]>> = Object.freeze(
  {
    "quota.signal": Object.freeze(["evidence", "rateLimitType"]),
    "harness.error": Object.freeze(["message", "evidence"]),
    "run.paused": Object.freeze(["note"]),
    "run.resumed": Object.freeze(["note"]),
    alert: Object.freeze(["message"]),
    "budget.exceeded": Object.freeze(["note"]),
    "fallback.switched": Object.freeze(["note"]),
    "fallback.restored": Object.freeze(["note"]),
    "fallback.skipped": Object.freeze(["note"]),
    blocked: Object.freeze(["needs"]),
  },
);

/**
 * Field names an event of this feature never carries: "with no content"
 * (F127-FR-040). A payload that holds one is refused.
 */
export const NO_CONTENT = Object.freeze([
  "content",
  "text",
  "body",
  "prompt",
  "reply",
  "stdout",
  "stderr",
  "transcript",
]);

/** An event this module refuses to emit (F127-FR-040). */
export class PolicyEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyEventError";
  }
}

/** How the emitters are configured. */
export type EmitOptions = {
  /** The one redactor of the product, handed in by the composition root. */
  readonly redact?: ((text: string, sizeCap: number) => RedactResult) | undefined;
  /** The byte cap of a free-text field; `FREE_TEXT_CAP_BYTES` by default. */
  readonly capBytes?: number;
};

/** True where the type is one of the ten of F127-FR-040. */
export function isPolicyEventType(type: string): type is PolicyEventType {
  return (POLICY_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * Redact and cut one free-text value. With no redactor, the value is DROPPED
 * and replaced by its drop mark rather than carried in the clear
 * (F100-FR-205).
 */
export function redactField(value: unknown, options: EmitOptions): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (text.length === 0) return null;
  const cap = options.capBytes ?? FREE_TEXT_CAP_BYTES;
  if (options.redact === undefined) return `[dropped: ${REDACTOR_UNAVAILABLE}]`;
  try {
    const result = options.redact(text, cap);
    if (result.dropped === true) return `[dropped: ${result.reason ?? REDACTOR_UNAVAILABLE}]`;
    return result.text;
  } catch (error) {
    return `[dropped: ${REDACTOR_UNAVAILABLE}: ${String(error).slice(0, 80)}]`;
  }
}

/**
 * The payload of one event, with every free-text field redacted and cut and
 * the no-content rule checked (F127-FR-040).
 */
export function preparePayload(
  type: PolicyEventType,
  payload: Readonly<Record<string, unknown>>,
  options: EmitOptions = {},
): Readonly<Record<string, unknown>> {
  for (const forbidden of NO_CONTENT) {
    if (forbidden in payload) {
      throw new PolicyEventError(
        `the event ${type} carries the field \`${forbidden}\`; the events of this feature carry ` +
          `no content (F127-FR-040)`,
      );
    }
  }
  const freeText = FREE_TEXT_FIELDS[type];
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(payload)) {
    out[field] = freeText.includes(field) ? redactField(value, options) : value;
  }
  return Object.freeze(out);
}

/**
 * Emit one event of this feature through the event port (F127-FR-040).
 *
 * Refuses a type outside the ten, and a payload that carries content. Never
 * appends to a file: the writer of feature 111 owns the envelope and the file.
 */
export function emit(
  writer: EventWriter,
  type: PolicyEventType,
  payload: Readonly<Record<string, unknown>>,
  options: EmitOptions = {},
): PolicyEvent {
  if (!isPolicyEventType(type)) {
    throw new PolicyEventError(
      `${String(type)} is not one of the ten event types of F127-FR-040 ` +
        `(${POLICY_EVENT_TYPES.join(", ")})`,
    );
  }
  const event: PolicyEvent = Object.freeze({
    type,
    payload: preparePayload(type, payload, options),
  });
  writer.emit(event);
  return event;
}

/* ------------------------------------------------------------------ *
 * The ten emitters. Each names the fields the catalogue of feature 111
 * requires for its type, so a missing field is a type error here and not
 * a refusal at the sink.
 * ------------------------------------------------------------------ */

/** `quota.signal` — the fields of F111-FR-013 (class, confidence, limit type, …). */
export function quotaSignal(
  writer: EventWriter,
  fields: {
    readonly class: string;
    readonly confidence: string;
    readonly rateLimitType: string | null;
    readonly utilization: number | null;
    readonly resetsAt: string | null;
    readonly resetsAtSource: string | null;
    readonly status: string;
    readonly evidence?: string | null;
    readonly ruleId?: string;
    readonly tableVersion?: string;
    readonly role?: string;
    readonly harness?: string;
  },
  options: EmitOptions = {},
): PolicyEvent {
  return emit(writer, "quota.signal", { ...fields }, options);
}

/** `harness.error` — the fields of F111-FR-013 (class, retryable). */
export function harnessError(
  writer: EventWriter,
  fields: {
    readonly class: string;
    readonly retryable: boolean;
    readonly role?: string;
    readonly harness?: string;
    readonly message?: string | null;
    readonly evidence?: string | null;
  },
  options: EmitOptions = {},
): PolicyEvent {
  return emit(writer, "harness.error", { ...fields }, options);
}

/** `alert` — the fields of F111-FR-013 (kind, level, role, threshold, value, limit). */
export function alert(
  writer: EventWriter,
  fields: {
    readonly kind: string;
    readonly level: string;
    readonly role: string | null;
    readonly threshold: number | null;
    readonly value: number | null;
    readonly limit: number | null;
    readonly dedupeKey?: string;
    readonly message?: string | null;
  },
  options: EmitOptions = {},
): PolicyEvent {
  return emit(writer, "alert", { ...fields }, options);
}

/** `budget.exceeded` — the fields of F111-FR-013 (dimension, limit, used, resumable). */
export function budgetExceeded(
  writer: EventWriter,
  fields: {
    readonly dimension: string;
    readonly limit: number | null;
    readonly used: number | null;
    readonly role?: string | null;
    readonly resumable?: boolean;
    readonly over?: number;
    readonly key?: string;
    readonly scope?: string;
    readonly note?: string | null;
  },
  options: EmitOptions = {},
): PolicyEvent {
  return emit(writer, "budget.exceeded", { ...fields }, options);
}

/** `fallback.switched` — the fields of F111-FR-013 (from, to, reason). */
export function fallbackSwitched(
  writer: EventWriter,
  fields: {
    readonly from: string;
    readonly to: string;
    readonly reason: string;
    readonly role?: string;
    readonly note?: string | null;
  },
  options: EmitOptions = {},
): PolicyEvent {
  return emit(writer, "fallback.switched", { ...fields }, options);
}

/** `fallback.restored` — the fields of F111-FR-013 (from, to). */
export function fallbackRestored(
  writer: EventWriter,
  fields: {
    readonly from: string;
    readonly to: string;
    readonly role?: string;
    readonly note?: string | null;
  },
  options: EmitOptions = {},
): PolicyEvent {
  return emit(writer, "fallback.restored", { ...fields }, options);
}

/**
 * `fallback.skipped` — the fields of F111-FR-051 (entry, entryHarness,
 * entryProvider, authTier, audience, reason). `reason` is a member of row 208
 * of annex X §X.6, the closed set this feature owns.
 */
export function fallbackSkipped(
  writer: EventWriter,
  fields: {
    readonly entry: number;
    readonly entryHarness: string;
    readonly entryProvider: string;
    readonly authTier: string;
    readonly audience: string;
    readonly reason: string;
    readonly role?: string;
    readonly note?: string | null;
  },
  options: EmitOptions = {},
): PolicyEvent {
  return emit(writer, "fallback.skipped", { ...fields }, options);
}

/** `blocked` — the fields of F111-FR-009 (reason, needs). `needs` is one line. */
export function blocked(
  writer: EventWriter,
  fields: {
    readonly reason: string;
    readonly needs: string;
    readonly role?: string;
    readonly synthesized?: boolean;
  },
  options: EmitOptions = {},
): PolicyEvent {
  return emit(writer, "blocked", { ...fields }, options);
}

/* ------------------------------------------------------------------ *
 * The pair `run.paused` / `run.resumed` (F127-FR-040).
 * ------------------------------------------------------------------ */

/** Whether a pause is open, so the pair of F127-FR-040 can be followed. */
export type PairState = {
  /** True between a `run.paused` and its `run.resumed`. */
  readonly open: boolean;
};

/** No pause open: the state a run starts in. */
export const PAIR_CLOSED: PairState = Object.freeze({ open: false });

/**
 * `run.paused` — the OPENER of the pair (F127-FR-040). Refuses a second
 * `run.paused` while one is open, because a pair that never closes is the one
 * thing a reader of the stream cannot recover from.
 */
export function runPaused(
  writer: EventWriter,
  pair: PairState,
  fields: {
    readonly class: string;
    readonly resetsAt?: string | null;
    readonly resumeAt?: string | null;
    readonly role?: string;
    readonly confidence?: string;
    readonly note?: string | null;
  },
  options: EmitOptions = {},
): { readonly event: PolicyEvent; readonly pair: PairState } {
  if (pair.open) {
    throw new PolicyEventError(
      "a `run.paused` is already open; `run.paused` and `run.resumed` open and close a pair " +
        "(F127-FR-040)",
    );
  }
  const event = emit(writer, "run.paused", { ...fields }, options);
  return { event, pair: Object.freeze({ open: true }) };
}

/**
 * `run.resumed` — the CLOSER of the pair, with `pausedMs` (F111-FR-013).
 * Refuses a `run.resumed` with no pause open.
 */
export function runResumed(
  writer: EventWriter,
  pair: PairState,
  fields: {
    readonly pausedMs: number;
    readonly role?: string;
    readonly resumedBy?: string;
    readonly note?: string | null;
  },
  options: EmitOptions = {},
): { readonly event: PolicyEvent; readonly pair: PairState } {
  if (!pair.open) {
    throw new PolicyEventError(
      "no `run.paused` is open, so there is no pair for this `run.resumed` to close " +
        "(F127-FR-040)",
    );
  }
  const event = emit(writer, "run.resumed", { ...fields }, options);
  return { event, pair: PAIR_CLOSED };
}

/**
 * The findings of a stream of this feature's events: a pair that never closed,
 * a type outside the ten, a payload that carried content. An empty list means
 * the stream obeys F127-FR-040.
 */
export function pairFindings(types: readonly string[]): readonly string[] {
  const findings: string[] = [];
  let open = 0;
  for (const type of types) {
    if (type === "run.paused") {
      if (open > 0) findings.push("a second `run.paused` while one was open (F127-FR-040)");
      open += 1;
    } else if (type === "run.resumed") {
      if (open === 0) findings.push("a `run.resumed` with no `run.paused` open (F127-FR-040)");
      else open -= 1;
    }
  }
  if (open > 0) findings.push("a `run.paused` that no `run.resumed` closed (F127-FR-040)");
  return Object.freeze(findings);
}
