/**
 * T035 — the unknown-value rules and the role handling (F111-FR-037,
 * F111-FR-038).
 *
 * F111-FR-037: *A reader and a sink MUST ignore a field and a type they do not
 * know and MUST tolerate a torn last line. Types that start with `x.` MUST be
 * free for third parties, MUST never be projected and MUST never change the
 * read model. An event whose major is outside the accepted range MUST give a
 * doctor warning and never a failure of a run.*
 *
 * F111-FR-038: *The roles in events MUST come from the role registry of the
 * run, and `supervisor` and `host`. An unknown role MUST be kept as text. A
 * sink MUST enumerate no harness by name: it reads the registry.*
 *
 * Three things are mechanism here, not comment:
 *
 *   1. "KNOWN" IS NEVER A LITERAL OF THIS FILE. The envelope fields come from
 *      the schema feature 100 ships (`schemas/event-envelope.schema.json`), the
 *      `data` fields from the row of the catalogue, the types from the
 *      catalogue, and the two roles beside the registry from row 72 of annex X
 *      §X.6. A field added to one of those tables is known the moment it is
 *      added, with no edit here.
 *   2. `x.` IS FREE, NOT UNKNOWN. A third-party type is read, kept and counted
 *      separately: it is never projected and it never changes the read model.
 *      An UNKNOWN type — one that is neither in the catalogue nor prefixed —
 *      is the other case: it is ignored.
 *   3. OUT OF RANGE WARNS. `majorRangeFinding` returns a finding of severity
 *      `warn` and `readTolerantly` goes on reading. No path here raises a
 *      `fail` and no path throws, because a reader may not end a run
 *      (Principle V).
 *
 * No harness is named in this file. `harnessIdsFromTheRegistry` reads the ids
 * of the resolved registry of the run, which is the only list there is.
 */
import { readFileSync } from "node:fs";
import eventEnvelopeSchema from "@specstride/contracts/schemas/event-envelope.schema.json" with { type: "json" };
import {
  MAJOR,
  SUPPORTED_MAJORS,
  isThirdPartyType,
  outsideRange,
} from "@specstride/contracts/envelope/event";
import type { EventEnvelope, MajorRange } from "@specstride/contracts/envelope/event";
import { eventRoles } from "@specstride/contracts/enums/all-sets";
import type { DoctorSeverity } from "@specstride/contracts/codes/doctor-and-collisions";
import { CATALOGUE_BY_TYPE, isCatalogueType } from "../catalogue/index.ts";
import { LINE_END } from "../writer/seq.ts";
import type { DoctorFinding } from "../writer/check.ts";

export type { DoctorFinding };

/* ------------------------------------------------------------------ *
 * What a reader KNOWS: the envelope of feature 100 and the catalogue.
 * ------------------------------------------------------------------ */

/**
 * The fields of the envelope of annex X §X.1, read from the schema feature 100
 * ships. Never a literal list of this file.
 */
export const ENVELOPE_FIELDS: readonly string[] = Object.freeze(
  Object.keys((eventEnvelopeSchema as { properties?: Record<string, unknown> }).properties ?? {}),
);

/** True where the envelope of feature 100 holds this field. */
export function isKnownEnvelopeField(field: string): boolean {
  return ENVELOPE_FIELDS.includes(field);
}

/** True where the catalogue of this build holds the type. */
export function isKnownType(type: string): boolean {
  return isCatalogueType(type);
}

/** The `data` fields the catalogue gives the type, or none for a type it lacks. */
export function knownDataFieldsOf(type: string): readonly string[] {
  return CATALOGUE_BY_TYPE.get(type)?.dataFields ?? Object.freeze([]);
}

/** What one pass of `ignoreUnknownFields` kept and what it left behind. */
export type IgnoredFields = {
  readonly event: EventEnvelope;
  readonly ignoredFields: readonly string[];
  readonly ignoredDataFields: readonly string[];
};

/**
 * F111-FR-037 — ignore a field nobody knows. An envelope field that is not in
 * the schema of feature 100 and a `data` field the catalogue does not give the
 * type are dropped from what the reader hands on; the rest is untouched.
 *
 * A type the catalogue does not hold, and a third-party `x.` type, have no
 * declared `data`, so their `data` is passed through whole: there is nothing
 * to measure "unknown" against (F111-FR-020, the `data` of an `x.` type is not
 * checked).
 */
export function ignoreUnknownFields(value: Readonly<Record<string, unknown>>): IgnoredFields {
  const ignoredFields: string[] = [];
  const kept: Record<string, unknown> = {};
  for (const [field, content] of Object.entries(value)) {
    if (isKnownEnvelopeField(field)) kept[field] = content;
    else ignoredFields.push(field);
  }

  const type = typeof value.type === "string" ? value.type : "";
  const ignoredDataFields: string[] = [];
  const data = value.data;
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    if (isKnownType(type)) {
      const known = knownDataFieldsOf(type);
      const keptData: Record<string, unknown> = {};
      for (const [field, content] of Object.entries(data as Record<string, unknown>)) {
        if (known.includes(field)) keptData[field] = content;
        else ignoredDataFields.push(field);
      }
      kept.data = keptData;
    } else {
      kept.data = { ...(data as Record<string, unknown>) };
    }
  }

  return Object.freeze({
    event: kept as unknown as EventEnvelope,
    ignoredFields: Object.freeze(ignoredFields),
    ignoredDataFields: Object.freeze(ignoredDataFields),
  });
}

/* ------------------------------------------------------------------ *
 * `x.` — free for third parties, never projected, never in the read model.
 * ------------------------------------------------------------------ */

/** The prefix of a third-party type, as feature 100 writes it. */
export { THIRD_PARTY_PREFIX } from "../catalogue/index.ts";

/** F111-FR-037 — a type that starts with `x.` is never projected. */
export function isNeverProjected(type: string): boolean {
  return isThirdPartyType(type);
}

/** F111-FR-037 — a type that starts with `x.` never changes the read model. */
export function changesTheReadModel(type: string): boolean {
  return !isNeverProjected(type) && isKnownType(type);
}

/* ------------------------------------------------------------------ *
 * A major outside the accepted range: a warning, never a failure.
 * ------------------------------------------------------------------ */

/** The doctor finding of an event whose major lies outside the range. */
export const DOCTOR_FINDING_MAJOR_OUT_OF_RANGE = "events.major_out_of_range" as const;

/** F111-FR-037 — it warns. */
export const DOCTOR_SEVERITY_MAJOR_OUT_OF_RANGE: DoctorSeverity = "warn";

/** F111-FR-037 — and it never fails a run. */
export const MAJOR_OUT_OF_RANGE_FAILS_THE_RUN = false as const;

/**
 * The finding for one event's major, or null where the major is inside the
 * accepted range. The message is feature 100's `outsideRange`, so the sentence
 * a reader and the doctor show is one sentence.
 */
export function majorRangeFinding(
  v: number,
  accepted: MajorRange = SUPPORTED_MAJORS,
): DoctorFinding | null {
  if (v >= accepted.from && v <= accepted.to) return null;
  const outcome = outsideRange(v, accepted);
  return Object.freeze({
    id: DOCTOR_FINDING_MAJOR_OUT_OF_RANGE,
    severity: DOCTOR_SEVERITY_MAJOR_OUT_OF_RANGE,
    // `lb` is false: F111-FR-037 says the finding never fails a run.
    lb: false as const,
    message: outcome.message,
    fix: `read this stream with a reader that accepts the event major ${v}`,
    evidence: `v=${v} accepted=${accepted.from}..${accepted.to}`,
  });
}

/* ------------------------------------------------------------------ *
 * The tolerant reader.
 * ------------------------------------------------------------------ */

/** What one tolerant read of an event file found. */
export type TolerantRead = {
  /** Every event the reader could read: the catalogue's types and the `x.` ones. */
  readonly events: readonly EventEnvelope[];
  /** The events a projection sees: never a third-party type (F111-FR-037). */
  readonly projected: readonly EventEnvelope[];
  /** The third-party events, kept and never projected. */
  readonly thirdParty: readonly EventEnvelope[];
  /** The types the reader did not know and ignored. */
  readonly ignoredTypes: readonly string[];
  /** True where the last line of the file had no line end: a torn line. */
  readonly tornLastLine: boolean;
  /** The `seq` of the last COMPLETE line, or 0 where there is none. */
  readonly lastCompleteSeq: number;
  /** The doctor findings the read produced. Never a failure. */
  readonly findings: readonly DoctorFinding[];
  /** F111-FR-037: a read never fails a run. */
  readonly failed: false;
};

export type TolerantReadOptions = {
  /** The range of majors this reader accepts. */
  readonly acceptsMajors?: MajorRange;
};

/**
 * Read an event file the way F111-FR-037 requires: a torn last line is skipped,
 * a type nobody knows is ignored, a third-party type is kept and never
 * projected, and an event whose major is outside the range gives a warning and
 * is read all the same. The call never throws and never fails a run.
 */
export function readTolerantly(file: string, options?: TolerantReadOptions): TolerantRead {
  const accepted = options?.acceptsMajors ?? SUPPORTED_MAJORS;
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    // An unreadable file is an empty read, never an error of the run.
    return frozenRead([], [], [], [], false, 0, []);
  }

  const tornLastLine = text.length > 0 && !text.endsWith(LINE_END);
  const lines = text.split(LINE_END);
  const complete = tornLastLine ? lines.slice(0, -1) : lines.filter((l) => l.length > 0);

  const events: EventEnvelope[] = [];
  const projected: EventEnvelope[] = [];
  const thirdParty: EventEnvelope[] = [];
  const ignoredTypes: string[] = [];
  const findings: DoctorFinding[] = [];
  let lastCompleteSeq = 0;

  for (const line of complete) {
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // A line in the middle that is not a record is ignored like an unknown
      // type: a reader never throws.
      continue;
    }
    const record = parsed as Record<string, unknown>;
    const seq = typeof record.seq === "number" ? record.seq : 0;
    if (seq > lastCompleteSeq) lastCompleteSeq = seq;

    const v = typeof record.v === "number" ? record.v : MAJOR;
    const finding = majorRangeFinding(v, accepted);
    if (finding !== null) findings.push(finding);

    const type = typeof record.type === "string" ? record.type : "";
    if (isNeverProjected(type)) {
      const event = record as unknown as EventEnvelope;
      events.push(event);
      thirdParty.push(event);
      continue;
    }
    if (!isKnownType(type)) {
      if (!ignoredTypes.includes(type)) ignoredTypes.push(type);
      continue;
    }
    const event = record as unknown as EventEnvelope;
    events.push(event);
    projected.push(event);
  }

  return frozenRead(
    events,
    projected,
    thirdParty,
    ignoredTypes,
    tornLastLine,
    lastCompleteSeq,
    findings,
  );
}

function frozenRead(
  events: readonly EventEnvelope[],
  projected: readonly EventEnvelope[],
  thirdParty: readonly EventEnvelope[],
  ignoredTypes: readonly string[],
  tornLastLine: boolean,
  lastCompleteSeq: number,
  findings: readonly DoctorFinding[],
): TolerantRead {
  return Object.freeze({
    events: Object.freeze([...events]),
    projected: Object.freeze([...projected]),
    thirdParty: Object.freeze([...thirdParty]),
    ignoredTypes: Object.freeze([...ignoredTypes]),
    tornLastLine,
    lastCompleteSeq,
    findings: Object.freeze([...findings]),
    failed: false as const,
  });
}

/* ------------------------------------------------------------------ *
 * The roles (F111-FR-038).
 * ------------------------------------------------------------------ */

/**
 * The two roles row 72 of annex X §X.6 writes out beside the role registry of
 * the run. The literals come from the row, not from this file.
 */
export const ROLES_BESIDE_THE_REGISTRY: readonly string[] = Object.freeze([...eventRoles.members]);

/** The row of annex X §X.6 that holds the event roles. */
export const EVENT_ROLES_ROW = eventRoles.number;

/**
 * The cell "unknown value" of row 72, verbatim: "Kept as text".
 *
 * Read from the row and not written here. The GENERIC classifier of feature
 * 100 (`unknownValueRuleOf`) has no pattern for this wording and falls through
 * to `refuse`, so `eventRoles.onUnknown(...).kind` is not the rule this
 * requirement states; the cell is. F111-FR-038 and the row agree with each
 * other, so this module follows the cell and keeps the text. The classifier
 * belongs to feature 100 and is not changed here.
 */
export const UNKNOWN_ROLE_CELL: string = eventRoles.onUnknown("a-role-of-another-run").cell;

/** F111-FR-038 — an unknown role is kept as text, which is row 72's cell. */
export const UNKNOWN_ROLE_IS_KEPT_AS_TEXT = /kept as text/i.test(UNKNOWN_ROLE_CELL);

/** F111-FR-038 — no list of harnesses is written anywhere: the registry is read. */
export const NO_HARNESS_IS_ENUMERATED_BY_NAME = true as const;

/** As much of the resolved registry of a run as the roles and the sinks need. */
export type RunRegistry = {
  readonly roles?: readonly { readonly id: string }[];
  readonly harnesses?: readonly { readonly id: string }[];
};

/**
 * F111-FR-038 — the roles a run may write: the ids of its role registry, then
 * the two of row 72.
 */
export function rolesOfTheRun(registry: RunRegistry): readonly string[] {
  const registered = [...(registry.roles ?? [])].map((role) => role.id).sort();
  const out: string[] = [];
  for (const role of [...registered, ...ROLES_BESIDE_THE_REGISTRY]) {
    if (!out.includes(role)) out.push(role);
  }
  return Object.freeze(out);
}

/** Where a role in an event came from. */
export const ROLE_SOURCES = ["registry", "row-72", "kept-as-text"] as const;
export type RoleSource = (typeof ROLE_SOURCES)[number];

/** One role of an event, as this run reads it. */
export type ReadRole = {
  /** The text of the field, kept byte for byte whether it is known or not. */
  readonly role: string;
  readonly known: boolean;
  readonly source: RoleSource;
};

/**
 * Read the `role` field of an event against the registry of the run. An
 * unknown role is kept as text: it is neither dropped nor mapped onto a
 * registered one (F111-FR-038, row 72).
 */
export function roleOf(role: string, registry: RunRegistry): ReadRole {
  if ((registry.roles ?? []).some((entry) => entry.id === role)) {
    return Object.freeze({ role, known: true, source: "registry" as const });
  }
  if (ROLES_BESIDE_THE_REGISTRY.includes(role)) {
    return Object.freeze({ role, known: true, source: "row-72" as const });
  }
  return Object.freeze({ role, known: false, source: "kept-as-text" as const });
}

/**
 * F111-FR-038 — the harnesses of a run, read from its registry. A sink calls
 * this; it never carries a list of its own.
 */
export function harnessIdsFromTheRegistry(registry: RunRegistry): readonly string[] {
  return Object.freeze([...(registry.harnesses ?? [])].map((harness) => harness.id));
}
