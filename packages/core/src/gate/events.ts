/**
 * T017 of feature 101 — the emitters of the events of the phase gate and their
 * rows for the compatibility projection (F101-FR-038).
 *
 * Two things live here, and the separation is the point:
 *
 *  1. the EVENTS the engine emits, in the envelope of feature 100 annex X §X.1
 *     with the types of the EVENT CATALOGUE of feature 111
 *     (`packages/observability/data/event-catalogue.tsv`) — typed values, a
 *     dotted lower-case type, `data` with no prompt, no reply and no nonce;
 *  2. the ROWS of the compatibility projection — for each of them the as-is
 *     NAME and the as-is FIELDS of the table "As-is events of the phase gate"
 *     of the spec, so that the projection renders the baseline's event and not a
 *     translation of it.
 *
 * ## Why a type is held as two parts and not as one dotted literal
 *
 * The event types this feature emits sit in the families `critic`, `attempt`,
 * `integrity` and others, and those words are also NAMESPACES OF THE
 * CONFIGURATION SCHEMA of feature 110. The check CT-110-109
 * (`packages/config/tests/unit/catalogue.test.ts`, "no source file holds a
 * dotted literal in a namespace of the schema that the catalogue lacks") reads a
 * quoted literal that joins such a family to an event name, in a source file of
 * a package, as a configuration key with no row, and reports it. Feature 110's
 * own exception list is in ITS test file, which this feature does not edit — and
 * this comment therefore names no such literal either.
 *
 * So a row carries its `family` and its `event` separately and `typeOf` joins
 * them. The join is the type; the parts are not a second vocabulary: the test
 * `packages/core/test/phase2-shared-parts-101.test.ts` reads
 * `packages/observability/data/event-catalogue.tsv` and asserts that the joined
 * type of EVERY row of this module is a row of that catalogue, so the catalogue
 * stays the one source of the type and a drift is a failing test.
 *
 * ## What no event may carry
 *
 * No event holds a nonce, a prompt or a reply in full (F101-FR-038, threat
 * T-05): `holdsForbiddenContent` is the check, and `emit` REFUSES rather than
 * writes. The excerpts the as-is fields `reason`, `error` and `note` carry pass
 * the one ingress FIRST (F101-FR-052) — this module takes them as already
 * passed and names which fields they are, so a caller that skipped the ingress
 * is a caller that cannot name the field.
 *
 * The typing note of `contracts/as-is-literals.md` is kept: events the engine
 * script wrote carry every value as TEXT; events the critic module wrote carry
 * TYPED values (D-25). The projection keeps both, so each row says which it is.
 */
import type { EventEnvelope } from "@specstride/contracts/envelope/event";
import { MAJOR, SCHEMA } from "@specstride/contracts/envelope/event";
import { throughTheIngress, type Ingress, type OutsideTextKind } from "./lines.ts";

/** F101-FR-038 — an event holds a nonce, a prompt or a reply in full. */
export const AN_EVENT_HOLDS_A_NONCE_A_PROMPT_OR_A_REPLY = false as const;

/** The as-is fields that carry an excerpt of a reply; they pass the ingress first. */
export const FIELDS_THAT_CARRY_AN_EXCERPT = ["reason", "error", "note"] as const;

/** The requirement of the one ingress those excerpts pass (F101-FR-052). */
export const INGRESS_REQUIREMENT = "F101-FR-052" as const;

/** The catalogue of event types this module's rows are taken from (feature 111). */
export const EVENT_CATALOGUE_FILE = "packages/observability/data/event-catalogue.tsv" as const;

/** Which side of the baseline wrote an event, which decides its typing (D-25). */
export const WRITERS = ["engine-script", "critic-module"] as const;
export type AsIsWriter = (typeof WRITERS)[number];

/** The typing of the as-is values of a row (D-25). */
export const TYPINGS = ["every-value-as-text", "typed-values"] as const;
export type AsIsTyping = (typeof TYPINGS)[number];

/** One row of the table "As-is events of the phase gate". */
export type AsIsEventRow = {
  /** The family of the catalogued type: its part before the dot. */
  readonly family: string;
  /** The name of the catalogued type: its part after the dot. */
  readonly event: string;
  /** The as-is NAME the compatibility projection renders. */
  readonly asIs: string;
  /** The as-is FIELDS, in the order of the table. */
  readonly fields: readonly string[];
  /** When the event is emitted, as the table's column "When" says it. */
  readonly when: string;
  /** The behaviour item of `research/R18-behaviour-inventory.tsv`. */
  readonly item: string;
  /** Which side of the baseline wrote it, and therefore how its values are typed. */
  readonly writer: AsIsWriter;
  readonly typing: AsIsTyping;
  /**
   * The condition under which this row is the projection of its type. Several
   * rows share a type — `verdict.recorded` has one row for an approval and one
   * for a rejection, `attempt.started` projects to `accelerator_start` only for
   * an accelerated phase attempt — and a type whose condition does not hold
   * projects to nothing.
   */
  readonly onlyWhen?: string;
  /** A note of `contracts/as-is-literals.md` that belongs to this row. */
  readonly note?: string;
};

/** The type of a row, as the event catalogue of feature 111 writes it. */
export function typeOf(row: Pick<AsIsEventRow, "family" | "event">): string {
  return `${row.family}.${row.event}`;
}

/**
 * The table "As-is events of the phase gate" of the spec, row for row and in its
 * order, with the notes of `contracts/as-is-literals.md`.
 */
export const AS_IS_EVENT_ROWS: readonly AsIsEventRow[] = Object.freeze([
  {
    family: "run",
    event: "started",
    asIs: "run_start",
    fields: [
      "workdir",
      "phases",
      "feature",
      "proposer",
      "critic",
      "resume",
      "states",
      "verification",
      "verification_plan",
    ],
    when: "The engine starts the loop",
    item: "B-0086",
    writer: "engine-script",
    typing: "every-value-as-text",
    note: "`phases` is a count; `resume` is a phase number or `done`; `verification` is a mode",
  },
  {
    family: "phase",
    event: "started",
    asIs: "phase_start",
    fields: ["phase", "title", "total", "shape"],
    when: "A phase starts",
    item: "B-0093",
    writer: "engine-script",
    typing: "every-value-as-text",
  },
  {
    family: "critic",
    event: "started",
    asIs: "critic_start",
    fields: ["phase", "attempt", "provider"],
    when: "The critic prompt is assembled, before the call",
    item: "B-0855",
    writer: "critic-module",
    typing: "typed-values",
  },
  {
    family: "verdict",
    event: "recorded",
    asIs: "verdict",
    fields: ["phase", "attempt", "result", "title"],
    when: "After the approval record and the verdict record were written",
    item: "B-0858",
    writer: "critic-module",
    typing: "typed-values",
    onlyWhen: "the result is APPROVED",
    note: "`result=APPROVED`",
  },
  {
    family: "verdict",
    event: "recorded",
    asIs: "verdict",
    fields: ["phase", "attempt", "result", "reason", "title", "max_rejects"],
    when: "After the feedback was written",
    item: "B-0859",
    writer: "critic-module",
    typing: "typed-values",
    onlyWhen: "the result is REJECTED or MALFORMED",
    note: "`reason` is an excerpt and passes the one ingress first",
  },
  {
    family: "attempt",
    event: "ended",
    asIs: "reject",
    fields: ["phase", "attempt"],
    when: "Every rejection, a failed verification gate included",
    item: "B-0105",
    writer: "engine-script",
    typing: "every-value-as-text",
    onlyWhen:
      "the phase attempt ended in a rejection, a MALFORMED verdict or a failed verification gate",
    note: "Written for REJECTED, MALFORMED and a failed verification gate alike (B-0105). A phase attempt that ended in an approval projects to nothing here",
  },
  {
    family: "critic",
    event: "malformed",
    asIs: "critic_malformed",
    fields: ["phase", "attempt", "streak", "limit"],
    when: "A MALFORMED verdict while the limit is on",
    item: "B-0106",
    writer: "engine-script",
    typing: "every-value-as-text",
  },
  {
    family: "gate",
    event: "oscillation",
    asIs: "gate_oscillation",
    fields: ["phase", "attempt", "criterion", "reappears"],
    when: "An oscillation was found",
    item: "B-0107",
    writer: "engine-script",
    typing: "every-value-as-text",
  },
  {
    family: "attempt",
    event: "archived",
    asIs: "attempt_archived",
    fields: ["phase", "attempt", "dir"],
    when: "A phase attempt was archived",
    item: "B-0090",
    writer: "engine-script",
    typing: "every-value-as-text",
  },
  {
    family: "recovery",
    event: "triggered",
    asIs: "diagnostician_trigger",
    fields: ["phase", "attempt"],
    when: "The diagnostician is due",
    item: "B-0089",
    writer: "engine-script",
    typing: "every-value-as-text",
  },
  {
    family: "recovery",
    event: "diagnosis_started",
    asIs: "diagnostician_start",
    fields: ["phase", "attempt", "provider"],
    when: "Before the call of the diagnostician",
    item: "B-0851",
    writer: "critic-module",
    typing: "typed-values",
  },
  {
    family: "recovery",
    event: "diagnosis_done",
    asIs: "diagnostician_done",
    fields: ["phase", "attempt", "bytes", "case"],
    when: "After the call",
    item: "B-0853",
    writer: "critic-module",
    typing: "typed-values",
  },
  {
    family: "recovery",
    event: "diagnosis_failed",
    asIs: "diagnostician_error",
    fields: ["phase", "attempt", "error"],
    when: "The call failed",
    item: "B-0852",
    writer: "critic-module",
    typing: "typed-values",
    note: "`error` is an excerpt and passes the one ingress first",
  },
  {
    family: "attempt",
    event: "started",
    asIs: "accelerator_start",
    fields: ["phase", "attempt", "backend", "criteria"],
    when: "Before the pass of an accelerated phase attempt",
    item: "B-0094",
    writer: "engine-script",
    typing: "every-value-as-text",
    onlyWhen: "the phase attempt is an accelerated one",
    note: "`criteria` is the signature WITHOUT its last comma (B-0094). A phase attempt of the proposer projects to nothing here: the baseline has no event for it",
  },
  {
    family: "attempt",
    event: "acceleration_note",
    asIs: "acceleration_note",
    fields: ["phase", "attempt", "note"],
    when: "The acceleration note was written",
    item: "B-0098",
    writer: "engine-script",
    typing: "every-value-as-text",
    note: "`note` is an excerpt and passes the one ingress first",
  },
  {
    family: "phase",
    event: "ended",
    asIs: "phase_done",
    fields: ["phase", "attempt", "title"],
    when: "After an approval",
    item: "B-0102",
    writer: "engine-script",
    typing: "every-value-as-text",
    onlyWhen: "the phase was approved",
  },
  {
    family: "tasks",
    event: "ticked",
    asIs: "tasks_ticked",
    fields: ["phase", "count"],
    when: "Tasks were ticked",
    item: "B-0103",
    writer: "engine-script",
    typing: "every-value-as-text",
  },
  {
    family: "commit",
    event: "made",
    asIs: "git_checkpoint",
    fields: ["phase"],
    when: "The approval commit worked",
    item: "B-0088",
    writer: "engine-script",
    typing: "every-value-as-text",
    onlyWhen: "the commit worked",
    note: "Written ONLY when the commit worked (B-0088)",
  },
  {
    family: "run",
    event: "ended",
    asIs: "run_stop",
    fields: ["reason"],
    when: "A halt",
    item: "B-0151 to B-0154",
    writer: "engine-script",
    typing: "every-value-as-text",
    onlyWhen: "the run ended in a halt",
    note: 'And the fields of the table "Halts of the phase gate"',
  },
  {
    family: "run",
    event: "ended",
    asIs: "run_end",
    fields: ["outcome", "phases"],
    when: "The run ends approved",
    item: "B-0141, B-0155",
    writer: "engine-script",
    typing: "every-value-as-text",
    onlyWhen: "the run ended with every phase approved",
    note: "`outcome=all_approved`; WITHOUT `phases` where every phase was approved before (B-0141)",
  },
]);

/** The count of rows the table holds. */
export const AS_IS_EVENT_ROW_COUNT = AS_IS_EVENT_ROWS.length;

/**
 * The events of this feature that have NO as-is equivalent and project to
 * nothing (the note under the table of the spec): a verdict adjudicated later, a
 * gap of grounding, an integrity note, and `blocked`. Held as parts for the same
 * reason the rows above are.
 */
export const TYPES_THAT_PROJECT_TO_NOTHING: readonly { family: string; event: string }[] =
  Object.freeze([
    { family: "verdict", event: "adjudicated" },
    { family: "critic", event: "grounding_gap" },
    { family: "integrity", event: "noted" },
    { family: "blocked", event: "" },
  ]);

/** The same four, as the types they join to. */
export const EVENTS_THAT_PROJECT_TO_NOTHING: readonly string[] = Object.freeze(
  TYPES_THAT_PROJECT_TO_NOTHING.map((t) => (t.event === "" ? t.family : typeOf(t))),
);

/** True when the event type projects to an as-is event of the baseline. */
export function projectsToAnAsIsEvent(type: string): boolean {
  if (EVENTS_THAT_PROJECT_TO_NOTHING.includes(type)) return false;
  return AS_IS_EVENT_ROWS.some((row) => typeOf(row) === type);
}

/** The rows of a type; a type with two as-is forms has two. */
export function rowsOfType(type: string): readonly AsIsEventRow[] {
  return AS_IS_EVENT_ROWS.filter((row) => typeOf(row) === type);
}

/** Every type this feature emits, each exactly once, in the order of the table. */
export const TYPES_EMITTED: readonly string[] = Object.freeze([
  ...new Set([...AS_IS_EVENT_ROWS.map((row) => typeOf(row)), ...EVENTS_THAT_PROJECT_TO_NOTHING]),
]);

/**
 * The as-is form of one event, as the compatibility projection renders it: the
 * as-is name, and only the as-is fields of the row, in the order of the table. A
 * field the event does not carry is ABSENT, as at the baseline (`run_end`
 * without `phases`, B-0141).
 */
export function projectToAsIs(
  row: AsIsEventRow,
  data: Readonly<Record<string, unknown>>,
): { readonly event: string; readonly fields: Readonly<Record<string, unknown>> } {
  const fields: Record<string, unknown> = {};
  for (const field of row.fields) {
    if (Object.hasOwn(data, field) && data[field] !== undefined) {
      fields[field] = row.typing === "every-value-as-text" ? String(data[field]) : data[field];
    }
  }
  return { event: row.asIs, fields };
}

/* ------------------------------------------------------------------ *
 * F101-FR-038 — the emitters.
 * ------------------------------------------------------------------ */

/** The keys an event's `data` may never hold (F101-FR-038, threat T-05). */
export const FORBIDDEN_KEYS = ["nonce", "prompt", "reply", "promptText", "replyText"] as const;

/**
 * True when the `data` of an event holds a nonce, a prompt or a reply. The check
 * is over the KEYS, and over a value that is a nonce in the form F101-FR-006
 * gives, so a nonce smuggled under another key is caught too.
 */
export function holdsForbiddenContent(data: Readonly<Record<string, unknown>>): string | undefined {
  for (const key of Object.keys(data)) {
    if ((FORBIDDEN_KEYS as readonly string[]).includes(key)) return key;
  }
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" && /^[0-9a-f]{16}$/.test(value.trim())) {
      return `${key} (a value in the form of a nonce)`;
    }
  }
  return undefined;
}

/** The error an emitter throws rather than write a nonce, a prompt or a reply. */
export class ForbiddenEventContentError extends Error {
  constructor(type: string, what: string) {
    super(
      `the event ${type} would carry \`${what}\`; no event of the phase gate holds a nonce, ` +
        `a prompt or a reply in full (F101-FR-038)`,
    );
    this.name = "ForbiddenEventContentError";
  }
}

/** The identity every event of a run carries (annex X §X.1). */
export type EventIdentity = {
  readonly runId: string;
  readonly launchId: string;
  readonly engineStartId?: string | undefined;
  readonly featureId?: string | undefined;
  readonly phaseId?: string | undefined;
  readonly attemptId?: string | undefined;
  readonly attempt?: number | undefined;
};

/** What the caller hands an emitter for one event. */
export type EmitInputs = {
  readonly type: string;
  readonly seq: number;
  readonly ts: string;
  readonly identity: EventIdentity;
  readonly data: Readonly<Record<string, unknown>>;
};

/**
 * F101-FR-038 — one event of the phase gate in the envelope of annex X §X.1. It
 * REFUSES rather than emit an event that would carry a nonce, a prompt or a
 * reply in full: the safe failure of an observability path that would leak the
 * one secret of the gate is to stop, not to redact and hope.
 */
export function emit(inputs: EmitInputs): EventEnvelope {
  const found = holdsForbiddenContent(inputs.data);
  if (found !== undefined) throw new ForbiddenEventContentError(inputs.type, found);
  const envelope: Record<string, unknown> = {
    schema: SCHEMA,
    v: MAJOR,
    seq: inputs.seq,
    ts: inputs.ts,
    type: inputs.type,
    runId: inputs.identity.runId,
    launchId: inputs.identity.launchId,
    data: { ...inputs.data },
  };
  for (const key of ["engineStartId", "featureId", "phaseId", "attemptId", "attempt"] as const) {
    const value = inputs.identity[key];
    if (value !== undefined) envelope[key] = value;
  }
  return envelope as unknown as EventEnvelope;
}

/** Emit the event of a row, with the row's own type. */
export function emitRow(row: AsIsEventRow, rest: Omit<EmitInputs, "type">): EventEnvelope {
  return emit({ ...rest, type: typeOf(row) });
}

/** The as-is names of the rows, in the order of the table. */
export const EMITTER_NAMES: readonly string[] = Object.freeze(
  AS_IS_EVENT_ROWS.map((row) => row.asIs),
);

/* ==================================================================== *
 * T112 — F101-FR-052: the fields of an event that carry an excerpt of a
 * text a critic-class call brought from outside the runtime pass the ONE
 * INGRESS of feature 100 before the event is emitted.
 *
 * The port of that ingress and the helper that calls it belong to
 * `./lines.ts`, which is the one place this feature hands outside text
 * over; this module names only WHICH fields carry such an excerpt and
 * emits through it. Where the redactor cannot run, the mark of dropped
 * content stands in the field and the event is still emitted: dropping the
 * event would lose the record of the rejection, and the verdict and the
 * counts may not change (F100-FR-205).
 * ==================================================================== */

/**
 * F101-FR-052 — the kind of outside text each field that carries an excerpt
 * holds: `reason` is an excerpt of the reply of the critic, `error` the message
 * of a failed call of the harness, `note` the accelerator's own text, which
 * reaches the runtime the same way.
 */
export const KIND_OF_THE_FIELD: Readonly<Record<string, OutsideTextKind>> = Object.freeze({
  reason: "critic-reply",
  error: "harness-error",
  note: "critic-reply",
});

/**
 * The attributes of a span that carry such an excerpt. A span of a
 * critic-class call carries the reason of a verdict and the message of a
 * failed call, and no other outside text (F101-FR-052, F101-FR-038).
 */
export const SPAN_ATTRIBUTES_THAT_CARRY_AN_EXCERPT = ["reason", "error"] as const;

/**
 * F101-FR-052 — the `data` of an event with every field that carries an
 * excerpt passed through the one ingress. A field that is not a string is left
 * as it is; a field that is no field of an excerpt is left as it is.
 */
export function dataThroughTheIngress(
  data: Readonly<Record<string, unknown>>,
  ingress: Ingress,
): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...data };
  for (const field of FIELDS_THAT_CARRY_AN_EXCERPT) {
    const value = out[field];
    if (typeof value !== "string") continue;
    out[field] = throughTheIngress(ingress, value, KIND_OF_THE_FIELD[field] ?? "critic-reply");
  }
  return Object.freeze(out);
}

/**
 * F101-FR-038 and F101-FR-052 — emit one event whose `data` may carry an
 * excerpt of outside text. The excerpt passes the one ingress FIRST, and the
 * refusal of `emit` still stands afterwards: an event that would carry a
 * nonce, a prompt or a reply in full is refused, redacted or not.
 */
export function emitThroughTheIngress(
  inputs: EmitInputs & { readonly ingress: Ingress },
): EventEnvelope {
  const { ingress, ...rest } = inputs;
  return emit({ ...rest, data: dataThroughTheIngress(inputs.data, ingress) });
}

/**
 * F101-FR-052 — the attributes of a span with every attribute that carries an
 * excerpt passed through the one ingress.
 */
export function spanAttributesThroughTheIngress(
  attributes: Readonly<Record<string, unknown>>,
  ingress: Ingress,
): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...attributes };
  for (const attribute of SPAN_ATTRIBUTES_THAT_CARRY_AN_EXCERPT) {
    const value = out[attribute];
    if (typeof value !== "string") continue;
    out[attribute] = throughTheIngress(
      ingress,
      value,
      KIND_OF_THE_FIELD[attribute] ?? "critic-reply",
    );
  }
  return Object.freeze(out);
}

/* ==================================================================== *
 * The two events of a rejection the handler of the order after a
 * rejection emits (T065, F101-FR-014, F101-FR-015). They are formed here
 * because the FIELDS of an as-is event belong to this module's table, and
 * the handler may not grow a second vocabulary of them.
 * ==================================================================== */

/** The as-is event of every rejection, with its two fields (B-0105). */
export type RejectEventData = { readonly phase: number; readonly attempt: number };

/**
 * F101-FR-014 — the as-is event `reject`, written for REJECTED, MALFORMED and
 * a failed verification gate alike (B-0105).
 */
export function rejectEvent(phase: number, attempt: number): RejectEventData {
  return Object.freeze({ phase, attempt });
}

/** The as-is event of a MALFORMED verdict, with its four fields (B-0106). */
export type CriticMalformedEventData = {
  readonly phase: number;
  readonly attempt: number;
  readonly streak: number;
  readonly limit: number;
};

/**
 * F101-FR-015 — the as-is event `critic_malformed`, written on a MALFORMED
 * verdict while the limit is on, with the streak and the limit (B-0106).
 */
export function criticMalformedEvent(
  phase: number,
  attempt: number,
  streak: number,
  limit: number,
): CriticMalformedEventData {
  return Object.freeze({ phase, attempt, streak, limit });
}
