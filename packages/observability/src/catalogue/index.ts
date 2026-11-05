/**
 * T004 — the catalogue of event types and the `data` schemas, AS DATA
 * (F111-FR-001, F111-FR-015).
 *
 * plan.md, "Approach": *the catalogue is data (`contracts/event-catalogue.tsv`),
 * read by the writer and by a consistency test*. This module is that reader.
 * It holds no type name and no field name of its own: every row of
 * `data/event-catalogue.tsv` — the copy of T002 — becomes one `CatalogueEntry`,
 * and the `data` schema of a type is DERIVED from its row:
 *
 *   - the properties of the schema are exactly the `data` fields of the row,
 *     and `additionalProperties` is false, so a field the catalogue does not
 *     know makes the event invalid (F111-FR-020);
 *   - no field is required, because absence is how a value that does not apply
 *     is written (F111-FR-002, annex X §X.1);
 *   - a field the row marks as free text is text, a list of text or null; the
 *     mark is the only list of free-text fields (F111-FR-016), and a list is
 *     treated member by member;
 *   - a field that holds a member of a closed set carries that set's members
 *     as an `enum`. The table `CLOSED_SET_FIELDS` is data too: it names the
 *     ROW NUMBER of annex X §X.6, and the members come from
 *     `@specstride/contracts` (F100-FR-208), never from a literal here.
 *
 * Because the schema is the row, ADDING A TYPE IS ADDITIVE (F111-FR-001, US4):
 * a new row brings its schema with it, and the schemas of the types that were
 * already there do not change. `additiveChangeFindings` is the check of that
 * property: it reports a removal or a redefinition and says nothing about an
 * addition.
 *
 * An event type that starts with `x.` is free for third parties
 * (F100-FR-199): the catalogue holds no row for it, this module gives it no
 * schema, and `typeIsWritable` admits it all the same. The `data` of such a
 * type is not checked (F111-FR-020).
 *
 * The file calls of the package live in this edge package of layer L1, never in
 * a core package (F100-FR-012, CQ-185).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closedSet } from "@specstride/contracts/enums/all-sets";
import { THIRD_PARTY_PREFIX as ENVELOPE_THIRD_PARTY_PREFIX } from "@specstride/contracts/envelope/event";

/** The directory of the package: two levels up from `src/catalogue`. */
const PACKAGE_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** The catalogue this package ships (T002), the data this module reads. */
export const CATALOGUE_FILE = join(PACKAGE_ROOT, "data", "event-catalogue.tsv");

/** The columns of `data/event-catalogue.tsv`, in order. */
export const CATALOGUE_COLUMNS = [
  "type",
  "kind",
  "partner",
  "data_fields",
  "free_text_fields",
] as const;

/** The kinds of an event type: an opener, a closer, or neither. */
export const EVENT_KINDS = ["open", "close", "instant"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/**
 * F111-FR-001 — a type name is lower-case, in dotted segments of lower-case
 * letters, digits and underscores. A segment begins with a letter, so neither
 * an empty segment nor a leading digit is a name.
 */
export const EVENT_TYPE_NAME_FORM = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

/** True where the name is of the form F111-FR-001 states. */
export function nameIsWellFormed(type: string): boolean {
  return EVENT_TYPE_NAME_FORM.test(type);
}

/** An event type free for third parties starts with `x.` (F100-FR-199). */
export const THIRD_PARTY_PREFIX = ENVELOPE_THIRD_PARTY_PREFIX;

/** True where the type is free for third parties and no row of the catalogue. */
export function isThirdPartyType(type: string): boolean {
  return type.startsWith(THIRD_PARTY_PREFIX);
}

/** One free-text mark of a row: the field and the ingress class of its cap. */
export type FreeTextMark = {
  readonly field: string;
  readonly ingressClass: string;
};

/** One row of the catalogue: an event type with its kind, partner and fields. */
export type CatalogueEntry = {
  readonly type: string;
  readonly kind: EventKind;
  /** The closer of an opener, the opener of a closer; empty for an instant. */
  readonly partner: string;
  readonly dataFields: readonly string[];
  /** The free-text fields the row marks, each with its ingress class. */
  readonly freeTextFields: readonly FreeTextMark[];
};

function cells(line: string): string[] {
  return line.split("\t");
}

function list(cell: string): string[] {
  return cell
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** A catalogue whose header is not the five columns of `CATALOGUE_COLUMNS`. */
export class CatalogueFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogueFormatError";
  }
}

/** Parse the catalogue. Throws `CatalogueFormatError` on a header that is not the five columns. */
export function parseCatalogue(text: string): readonly CatalogueEntry[] {
  const lines = text.split("\n").filter((line) => line.length > 0);
  const header = cells(lines[0] ?? "");
  if (header.length !== CATALOGUE_COLUMNS.length) {
    throw new CatalogueFormatError(
      `the header of the catalogue is the ${CATALOGUE_COLUMNS.length} columns ` +
        `${CATALOGUE_COLUMNS.join(", ")}; it reads ${header.join(", ")}`,
    );
  }
  for (const [index, column] of CATALOGUE_COLUMNS.entries()) {
    if (header[index] !== column) {
      throw new CatalogueFormatError(
        `the header of the catalogue names ${header[index]} where column ${index + 1} ` +
          `is ${column}`,
      );
    }
  }
  return Object.freeze(
    lines.slice(1).map((line) => {
      const [type, kind, partner, dataFields, freeTextFields] = cells(line);
      if (type === undefined || type.length === 0 || kind === undefined) {
        throw new CatalogueFormatError(`a row of the catalogue without a type: ${line}`);
      }
      return Object.freeze({
        type,
        kind: kind as EventKind,
        partner: partner ?? "",
        dataFields: Object.freeze(list(dataFields ?? "")),
        freeTextFields: Object.freeze(
          list(freeTextFields ?? "").map((mark) => {
            const at = mark.lastIndexOf(":");
            return Object.freeze({
              field: at < 0 ? mark : mark.slice(0, at),
              ingressClass: at < 0 ? "" : mark.slice(at + 1),
            });
          }),
        ),
      });
    }),
  );
}

/** Every row of the catalogue, read from the data at load. */
export const CATALOGUE: readonly CatalogueEntry[] = parseCatalogue(
  readFileSync(CATALOGUE_FILE, "utf8"),
);

/** How many types the catalogue holds. */
export const CATALOGUE_SIZE = CATALOGUE.length;

/** The catalogue by type name. */
export const CATALOGUE_BY_TYPE: ReadonlyMap<string, CatalogueEntry> = new Map(
  CATALOGUE.map((entry) => [entry.type, entry]),
);

/** True where the catalogue holds a row for the type. */
export function isCatalogueType(type: string): boolean {
  return CATALOGUE_BY_TYPE.has(type);
}

/**
 * F111-FR-001 — every event of the product has a type of the catalogue or a
 * type that starts with `x.`. An event whose type is neither is not written
 * and is counted with the reason `invalid` (F111-FR-020).
 */
export function typeIsWritable(type: string): boolean {
  return isCatalogueType(type) || isThirdPartyType(type);
}

/** The pairs of the catalogue: every opener with the closer that partners it. */
export const PAIRS: readonly { readonly open: string; readonly close: string }[] = Object.freeze(
  CATALOGUE.filter((entry) => entry.kind === "open").map((entry) =>
    Object.freeze({ open: entry.type, close: entry.partner }),
  ),
);

/* ------------------------------------------------------------------ *
 * The `data` schemas, derived from the rows.
 * ------------------------------------------------------------------ */

/**
 * The keyword subset a `data` schema uses. It is JSON Schema 2020-12: a record
 * with named properties, no property beyond them, an `enum` where the value is
 * a member of a closed set, and `type`/`items` where the mark says the value is
 * free text.
 */
export type PropertySchema = {
  readonly type?: readonly string[] | string;
  readonly items?: { readonly type: string };
  readonly enum?: readonly string[];
};

/** The schema of the `data` of one event type. */
export type DataSchema = {
  readonly $schema: "https://json-schema.org/draft/2020-12/schema";
  readonly $id: string;
  readonly title: string;
  readonly type: "object";
  readonly properties: Readonly<Record<string, PropertySchema>>;
  readonly additionalProperties: false;
  /** Empty: absence is how a value that does not apply is written (F111-FR-002). */
  readonly required: readonly string[];
};

/** The schema id a `data` schema carries, with the major of the event schema. */
export const DATA_SCHEMA_BASE_ID = "specstride.event.data/1" as const;

/**
 * One row of the table of the fields whose value is a member of a closed set.
 * `sets` names the ROW NUMBERS of annex X §X.6; the members are read from
 * `@specstride/contracts` so no member is written twice in the product
 * (F100-FR-208, F100-FR-209). A field whose row merges several lists takes the
 * union, which is a superset: the check then never refuses a value the product
 * writes, and still refuses a value of no list at all.
 */
export type ClosedSetField = {
  readonly type: string;
  readonly field: string;
  readonly sets: readonly number[];
  readonly note?: string;
};

/** The fields of the catalogue whose value is a member of a closed set. */
export const CLOSED_SET_FIELDS: readonly ClosedSetField[] = Object.freeze([
  // The end causes and the outcomes of "End causes and outcomes" (data-model.md).
  Object.freeze({ type: "pass.ended", field: "endCause", sets: [271] }),
  Object.freeze({ type: "attempt.ended", field: "endCause", sets: [272] }),
  Object.freeze({ type: "phase.ended", field: "outcome", sets: [273] }),
  Object.freeze({
    type: "run.ended",
    field: "endCause",
    sets: [5, 96],
    note: "row 5 is what an engine says of its own end, row 96 what the next writer found (F111-FR-005)",
  }),
  Object.freeze({ type: "run.ended", field: "causedBy", sets: [5] }),
  // Delivery and redaction.
  Object.freeze({ type: "event.dropped", field: "reason", sets: [94] }),
  Object.freeze({ type: "telemetry.delivery", field: "status", sets: [93] }),
  Object.freeze({ type: "redaction.dropped", field: "ingressClass", sets: [89] }),
  Object.freeze({ type: "redaction.dropped", field: "mark", sets: [90] }),
  // The run, the launch, quota and alerts.
  Object.freeze({ type: "run.launched", field: "reason", sets: [82] }),
  Object.freeze({ type: "run.launched", field: "startMode", sets: [19] }),
  Object.freeze({ type: "run.launched", field: "requestKind", sets: [18] }),
  Object.freeze({ type: "run.started", field: "verificationMode", sets: [52] }),
  Object.freeze({ type: "quota.signal", field: "confidence", sets: [47] }),
  Object.freeze({ type: "quota.signal", field: "resetsAtSource", sets: [207] }),
  Object.freeze({ type: "alert", field: "kind", sets: [205] }),
  Object.freeze({ type: "alert", field: "level", sets: [48] }),
  Object.freeze({ type: "budget.exceeded", field: "dimension", sets: [206] }),
  Object.freeze({ type: "digest.written", field: "state", sets: [15] }),
  // The units of work.
  Object.freeze({ type: "attempt.started", field: "kind", sets: [9] }),
  Object.freeze({ type: "attempt.started", field: "strategy", sets: [55] }),
  Object.freeze({ type: "escalation.skipped", field: "reason", sets: [140] }),
  Object.freeze({ type: "recovery.diagnosis_done", field: "case", sets: [252] }),
  Object.freeze({ type: "tool.call", field: "category", sets: [95] }),
  Object.freeze({ type: "stream.diagnostic", field: "code", sets: [222] }),
  Object.freeze({ type: "stream.diagnostic", field: "severity", sets: [223] }),
  Object.freeze({ type: "yield.started", field: "jobMode", sets: [70] }),
  Object.freeze({ type: "yield.ended", field: "outcome", sets: [112] }),
  Object.freeze({ type: "microloop.unit", field: "result", sets: [136] }),
  Object.freeze({ type: "microloop.unit", field: "fallbackReason", sets: [59] }),
  // The critic-class call.
  Object.freeze({ type: "critic.selected", field: "diversity", sets: [183] }),
  Object.freeze({ type: "critic.call", field: "diversity", sets: [183] }),
  Object.freeze({ type: "critic.call", field: "form", sets: [28] }),
  // Learning.
  Object.freeze({ type: "learning.knob_adjusted", field: "knob", sets: [187] }),
  Object.freeze({ type: "learning.knob_auto_reverted", field: "knob", sets: [187] }),
  Object.freeze({ type: "learning.knob_evaluated", field: "knob", sets: [187] }),
  Object.freeze({ type: "learning.knob_evaluated", field: "label", sets: [190] }),
  Object.freeze({ type: "learning.knob_evaluated", field: "action", sets: [191] }),
  // The seven parallel types of F111-FR-015.
  Object.freeze({ type: "parallel.admission", field: "check", sets: [61] }),
  Object.freeze({ type: "parallel.group.ended", field: "outcome", sets: [62] }),
  Object.freeze({ type: "parallel.worker.ended", field: "outcome", sets: [62] }),
  // The loop layer and the check runner (F111-FR-050).
  Object.freeze({ type: "strategy.selected", field: "strategy", sets: [55] }),
  Object.freeze({ type: "checkpoint.refused", field: "reason", sets: [138] }),
  Object.freeze({ type: "check.admission", field: "reason", sets: [236] }),
  Object.freeze({
    type: "check.parallelism_lowered",
    field: "reason",
    sets: [53],
    note: "a reason of `tainted`; row 53 merges the result conditions, so the union is a superset",
  }),
  Object.freeze({ type: "tripwire.raised", field: "kind", sets: [141] }),
  // Run control, fallback and the terms gate (F111-FR-051).
  Object.freeze({
    type: "source.change_accepted",
    field: "file",
    sets: [50, 135],
    note: "rows 50 and 135 name the same three files (the table of spec.md)",
  }),
  Object.freeze({ type: "fallback.skipped", field: "reason", sets: [208] }),
  Object.freeze({ type: "fallback.skipped", field: "audience", sets: [41] }),
  Object.freeze({ type: "terms.override_used", field: "audience", sets: [41] }),
]);

/** A field whose value is a member of a closed set, as a lookup. */
const CLOSED_SET_FIELD_INDEX: ReadonlyMap<string, readonly number[]> = new Map(
  CLOSED_SET_FIELDS.map((row) => [`${row.type}\u0000${row.field}`, row.sets]),
);

/** The members of the closed sets of a field, in the order of the rows, each once. */
export function closedSetMembersOf(type: string, field: string): readonly string[] | undefined {
  const sets = CLOSED_SET_FIELD_INDEX.get(`${type}\u0000${field}`);
  if (sets === undefined) return undefined;
  const members: string[] = [];
  for (const number of sets) {
    const set = closedSet(number);
    if (set === undefined || set.members.length === 0) return undefined;
    members.push(...set.members);
  }
  return Object.freeze([...new Set(members)]);
}

/**
 * The property schema of one `data` field, from the row alone:
 * an `enum` where the field holds a member of a closed set, text / a list of
 * text / null where the row marks the field as free text, and otherwise any
 * value, because the catalogue states the field and not its type.
 */
export function propertySchemaOf(entry: CatalogueEntry, field: string): PropertySchema {
  const members = closedSetMembersOf(entry.type, field);
  if (members !== undefined) return Object.freeze({ enum: members });
  const marked = entry.freeTextFields.some((mark) => mark.field === field);
  if (marked) {
    return Object.freeze({
      type: Object.freeze(["string", "array", "null"]),
      items: Object.freeze({ type: "string" }),
    });
  }
  return Object.freeze({});
}

/** The `data` schema of one row of the catalogue (F111-FR-001). */
export function dataSchemaOf(entry: CatalogueEntry): DataSchema {
  const properties: Record<string, PropertySchema> = {};
  for (const field of entry.dataFields) properties[field] = propertySchemaOf(entry, field);
  return Object.freeze({
    $schema: "https://json-schema.org/draft/2020-12/schema" as const,
    $id: `${DATA_SCHEMA_BASE_ID}:${entry.type}`,
    title: `the data of ${entry.type}`,
    type: "object" as const,
    properties: Object.freeze(properties),
    additionalProperties: false as const,
    required: Object.freeze([] as string[]),
  });
}

/** The `data` schema of every type of the catalogue: one per row, and no more. */
export const DATA_SCHEMAS: ReadonlyMap<string, DataSchema> = new Map(
  CATALOGUE.map((entry) => [entry.type, dataSchemaOf(entry)]),
);

/**
 * The `data` schema of a type, or `undefined` where the catalogue holds no row
 * for it. A type that starts with `x.` has none: its `data` is not checked
 * (F111-FR-020).
 */
export function dataSchemaForType(type: string): DataSchema | undefined {
  return DATA_SCHEMAS.get(type);
}

/* ------------------------------------------------------------------ *
 * Adding a type inside a major is additive (F111-FR-001, US4).
 * ------------------------------------------------------------------ */

/** The types `after` holds and `before` did not: the additions of a change. */
export function addedTypes(
  before: readonly CatalogueEntry[],
  after: readonly CatalogueEntry[],
): readonly string[] {
  const known = new Set(before.map((entry) => entry.type));
  return Object.freeze(after.filter((entry) => !known.has(entry.type)).map((entry) => entry.type));
}

/**
 * F111-FR-001 — adding a type inside a major MUST be additive. The findings of
 * a change that is not: a type removed, a kind or a partner redefined, a `data`
 * field removed, a free-text mark removed or re-classed. An addition — a type,
 * a field, a mark — is no finding.
 */
export function additiveChangeFindings(
  before: readonly CatalogueEntry[],
  after: readonly CatalogueEntry[],
): readonly string[] {
  const now = new Map(after.map((entry) => [entry.type, entry]));
  const findings: string[] = [];
  for (const was of before) {
    const is = now.get(was.type);
    if (is === undefined) {
      findings.push(`${was.type}: the type was removed; a change inside a major is additive`);
      continue;
    }
    if (is.kind !== was.kind) {
      findings.push(`${was.type}: the kind changed from ${was.kind} to ${is.kind}`);
    }
    if (is.partner !== was.partner) {
      const from = was.partner.length === 0 ? "(none)" : was.partner;
      const to = is.partner.length === 0 ? "(none)" : is.partner;
      findings.push(`${was.type}: the partner changed from ${from} to ${to}`);
    }
    const fields = new Set(is.dataFields);
    for (const field of was.dataFields) {
      if (!fields.has(field)) findings.push(`${was.type}: the data field ${field} was removed`);
    }
    const marks = new Map(is.freeTextFields.map((mark) => [mark.field, mark.ingressClass]));
    for (const mark of was.freeTextFields) {
      if (!marks.has(mark.field)) {
        findings.push(`${was.type}: the free-text mark on ${mark.field} was removed`);
        continue;
      }
      const ingressClass = marks.get(mark.field);
      if (ingressClass !== mark.ingressClass) {
        findings.push(
          `${was.type}: the ingress class of ${mark.field} changed from ` +
            `${mark.ingressClass} to ${ingressClass}`,
        );
      }
    }
  }
  return Object.freeze(findings);
}
