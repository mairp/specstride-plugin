/**
 * T073 — the closed sets of `endCause` and of `outcome` AS DATA, the rename of
 * the `data` field `cause` to `endCause`, and the guard that makes the build
 * fail when a `data` schema has a field named `cause` (F111-FR-005,
 * F111-FR-007, F111-FR-010).
 *
 * TWO FACTS, TWO NAMES. The ENVELOPE field `cause` (annex X §X.1) is the `seq`
 * or the id of the event that led to this one: a link. The `data` field
 * `endCause` is why a pass, a phase attempt or an engine start ended: a reason.
 * `data-model.md` puts it plainly — *no `data` of a catalogue type has a field
 * named `cause`* — and research D-13 says why: the projection and the exporter
 * select by the members of the end-cause sets, and a name that means a link in
 * one place and a reason in another makes that selection wrong rather than
 * merely confusing.
 *
 * THE SETS ARE READ, NEVER WRITTEN OUT. `END_CAUSE_SETS` names the ROW NUMBERS
 * of annex X §X.6 and takes the members from `@specstride/contracts`
 * (F100-FR-208): row 271 for a pass, row 272 for a phase attempt, row 273 for
 * the outcome of a phase, and rows 5 and 96 for an engine start. The two sets
 * of a run do not compete (F111-FR-005): row 5 is what an engine says of its
 * OWN end, row 96 what the next writer FOUND of an end that left no
 * `run.ended`, and the flag `synthesized` tells which applies. `crash` means
 * the same in both.
 *
 * THE RENAME IS A FUNCTION AND NOT A MIGRATION. `renameCauseToEndCause` is
 * applied by an emitter before the write: a record that still carries `cause`
 * reaches the file with `endCause`, and the envelope's own `cause` travels
 * beside it untouched. It renames only where the catalogue says the type HAS an
 * `endCause`, so `phase.ended` — which carries `outcome` — is left alone rather
 * than given a field the catalogue does not know, and a record that already has
 * an `endCause` is never overwritten.
 *
 * THE BUILD FAILS AT LOAD. `assertNoCauseFieldInADataSchema` runs over the
 * shipped catalogue and the shipped `data` schemas the moment this module is
 * loaded, and throws `CauseFieldError`. `src/index.ts` exports this module, so
 * nothing in the product can reach the schemas without the guard having run.
 */
import { closedSet } from "@specstride/contracts/enums/all-sets";
import { SYNTHESIZED_FIELD as F100_SYNTHESIZED_FIELD } from "@specstride/contracts/envelope/event";
import {
  CATALOGUE,
  CATALOGUE_BY_TYPE,
  DATA_SCHEMAS,
  type CatalogueEntry,
  type DataSchema,
} from "./index.ts";
import { REFINED_DATA_SCHEMAS, refinedDataSchemaOf } from "./types/index.ts";

/** F111-FR-005 — the `data` field of an end is named `endCause`. */
export const DATA_END_CAUSE_FIELD = "endCause" as const;

/** The field of the ENVELOPE that `endCause` is not: the link to another event. */
export const ENVELOPE_CAUSE_FIELD = "cause" as const;

/** The rename of 2026-09-30: the `data` field `cause` became `endCause`. */
export const RENAMED_DATA_FIELD = Object.freeze({
  from: ENVELOPE_CAUSE_FIELD,
  to: DATA_END_CAUSE_FIELD,
});

/* ------------------------------------------------------------------ *
 * The closed sets, as data.
 * ------------------------------------------------------------------ */

/** One closed set of an end cause or of an outcome. */
export type EndCauseSet = {
  readonly type: string;
  readonly field: string;
  /** The ROW NUMBERS of annex X §X.6 the members come from. */
  readonly rows: readonly number[];
  readonly members: readonly string[];
  /** When this set applies, where a type has more than one. */
  readonly condition?: string;
  /** What a reader makes of a value that is in no set. */
  readonly unknownValueReadAs?: string;
  readonly note?: string;
};

function membersOf(rows: readonly number[]): readonly string[] {
  const members: string[] = [];
  for (const row of rows) members.push(...(closedSet(row)?.members ?? []));
  return Object.freeze([...new Set(members)]);
}

/** The end causes of a pass: annex X §X.6 row 271 (F111-FR-007). */
export const PASS_END_CAUSES: readonly string[] = membersOf([271]);

/** The end causes of a phase attempt: annex X §X.6 row 272 (F111-FR-010). */
export const ATTEMPT_END_CAUSES: readonly string[] = membersOf([272]);

/** The outcomes of a phase: annex X §X.6 row 273 (F111-FR-010). */
export const PHASE_OUTCOMES: readonly string[] = membersOf([273]);

/**
 * The end causes an ENGINE writes of its own end: the three members of row 5 of
 * annex X §X.6 that F111-FR-005 names. Row 5 merges the terminal `cause` with
 * `causedBy`, so the three are filtered out of it rather than taken whole.
 */
export const RUN_END_CAUSES_ENGINE: readonly string[] = Object.freeze(
  ["normal", "crash", "owner-lost"].filter((member) => membersOf([5]).includes(member)),
);

/** The end causes of a SYNTHESIZED end of a run: annex X §X.6 row 96. */
export const RUN_END_CAUSES_SYNTHESIZED: readonly string[] = membersOf([96]);

/**
 * The mark that says which set a `run.ended` is read against (F111-FR-004). It
 * is the ENVELOPE's own field name, taken from `@specstride/contracts` and not
 * written out here; it is module-local because `src/writer/pairs.ts` already
 * exports the same name to the package.
 */
const SYNTHESIZED_FIELD = F100_SYNTHESIZED_FIELD;

/** The four closed sets of this feature, the two of a run counted apart. */
export const END_CAUSE_SETS: readonly EndCauseSet[] = Object.freeze([
  Object.freeze({
    type: "pass.ended",
    field: DATA_END_CAUSE_FIELD,
    rows: Object.freeze([271]),
    members: PASS_END_CAUSES,
    unknownValueReadAs: "error",
    note: "F111-FR-007",
  }),
  Object.freeze({
    type: "attempt.ended",
    field: DATA_END_CAUSE_FIELD,
    rows: Object.freeze([272]),
    members: ATTEMPT_END_CAUSES,
    unknownValueReadAs: "error",
    note: "F111-FR-010; a quota pause does not end a phase attempt, so the set holds no member for it",
  }),
  Object.freeze({
    type: "phase.ended",
    field: "outcome",
    rows: Object.freeze([273]),
    members: PHASE_OUTCOMES,
    unknownValueReadAs: "halted",
    note: "F111-FR-010",
  }),
  Object.freeze({
    type: "run.ended",
    field: DATA_END_CAUSE_FIELD,
    rows: Object.freeze([5]),
    members: RUN_END_CAUSES_ENGINE,
    condition: "`synthesized` absent or false",
    note: "F111-FR-005: what an engine says of its OWN end, the `cause` of its terminal record",
  }),
  Object.freeze({
    type: "run.ended",
    field: DATA_END_CAUSE_FIELD,
    rows: Object.freeze([96]),
    members: RUN_END_CAUSES_SYNTHESIZED,
    condition: "`synthesized` true",
    note: "F111-FR-005: what the next writer FOUND of an end that left no `run.ended`",
  }),
]);

/**
 * The fields that go with each end cause of a pass (`data-model.md`, the table
 * of `pass.ended`). A member with no field of its own carries an empty list;
 * the list is not a schema, it is what a reader may expect to find.
 */
export const FIELDS_THAT_GO_WITH: Readonly<Record<string, readonly string[]>> = Object.freeze({
  evidence: Object.freeze(["evidence"]),
  completed: Object.freeze(["pluginRestart"]),
  yield: Object.freeze(["yielded", "waitedSec"]),
  no_progress: Object.freeze(["consec"]),
  error: Object.freeze(["subtype", "consec", "reason"]),
  killed: Object.freeze(["reason", "killClass", "consec"]),
  hard_cap: Object.freeze(["reason", "elapsed", "consec", "max"]),
  quota_pause: Object.freeze([]),
  stopped: Object.freeze([]),
  crash: Object.freeze(["synthesized"]),
});

/**
 * The set an end cause of one event is read against. `run.ended` has two, and
 * the flag `synthesized` chooses (F111-FR-005); every other type has one.
 * `undefined` where the type has no end cause and no outcome.
 */
export function endCauseSetOf(
  type: string,
  data: Readonly<Record<string, unknown>> = {},
): readonly string[] | undefined {
  const own = END_CAUSE_SETS.filter((set) => set.type === type);
  if (own.length === 0) return undefined;
  if (own.length === 1) return own[0]?.members;
  const synthesized = data[SYNTHESIZED_FIELD] === true;
  return synthesized ? RUN_END_CAUSES_SYNTHESIZED : RUN_END_CAUSES_ENGINE;
}

/**
 * What a reader makes of a value of no set: `error` for a pass and for a phase
 * attempt, `halted` for the outcome of a phase (`data-model.md`).
 */
export function readUnknownAs(type: string, field: string): string | undefined {
  return END_CAUSE_SETS.find((set) => set.type === type && set.field === field)?.unknownValueReadAs;
}

/** True where the catalogue says the type carries an `endCause` in `data`. */
export function hasEndCauseField(type: string): boolean {
  return CATALOGUE_BY_TYPE.get(type)?.dataFields.includes(DATA_END_CAUSE_FIELD) === true;
}

/**
 * The rename of the `data` field: a record that still carries `cause` reaches
 * the writer with `endCause`. Only for a type the catalogue says has an
 * `endCause`; a record that already has one is left exactly as it is, because a
 * record carrying both is a bug to be seen and not a bug to be hidden.
 */
export function renameCauseToEndCause(
  type: string,
  data: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  if (!hasEndCauseField(type)) return { ...data };
  if (!Object.hasOwn(data, ENVELOPE_CAUSE_FIELD)) return { ...data };
  if (Object.hasOwn(data, DATA_END_CAUSE_FIELD)) return { ...data };
  const renamed: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(data)) {
    renamed[field === ENVELOPE_CAUSE_FIELD ? DATA_END_CAUSE_FIELD : field] = value;
  }
  return renamed;
}

/* ------------------------------------------------------------------ *
 * The guard: no `data` schema has a field named `cause`.
 * ------------------------------------------------------------------ */

/** A `data` schema, or a row of the catalogue, with a field named `cause`. */
export class CauseFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CauseFieldError";
  }
}

/** Every `data` schema the package ships: the rows' own and the refined ones. */
export const ALL_DATA_SCHEMAS: ReadonlyMap<string, DataSchema> = new Map([
  ...DATA_SCHEMAS,
  ...REFINED_DATA_SCHEMAS,
]);

/**
 * The findings of the catalogue and of the `data` schemas against
 * `data-model.md`: a row with a `data` field named `cause`, or a schema with a
 * property so named. Both halves are read, because a row is where a field is
 * declared and a schema is where a validator would admit it.
 */
export function causeFieldFindings(
  rows: readonly CatalogueEntry[] = CATALOGUE,
  schemas: ReadonlyMap<string, DataSchema> = ALL_DATA_SCHEMAS,
): readonly string[] {
  const findings: string[] = [];
  for (const row of rows) {
    if (!row.dataFields.includes(ENVELOPE_CAUSE_FIELD)) continue;
    findings.push(
      `${row.type}: the data field \`${ENVELOPE_CAUSE_FIELD}\` is a field of the envelope ` +
        `(annex X §X.1); the end cause of a \`data\` is named \`${DATA_END_CAUSE_FIELD}\``,
    );
  }
  for (const [type, schema] of schemas) {
    if (!Object.hasOwn(schema.properties, ENVELOPE_CAUSE_FIELD)) continue;
    findings.push(
      `${type}: the data schema has a property named \`${ENVELOPE_CAUSE_FIELD}\`, which is a ` +
        `field of the envelope (annex X §X.1); the end cause of a \`data\` is named ` +
        `\`${DATA_END_CAUSE_FIELD}\``,
    );
  }
  return Object.freeze(findings);
}

/** Throw `CauseFieldError` where a `data` schema has a field named `cause`. */
export function assertNoCauseFieldInADataSchema(
  rows: readonly CatalogueEntry[] = CATALOGUE,
  schemas: ReadonlyMap<string, DataSchema> = ALL_DATA_SCHEMAS,
): void {
  const findings = causeFieldFindings(rows, schemas);
  if (findings.length === 0) return;
  throw new CauseFieldError(
    `the \`data\` of a catalogue type has no field named \`${ENVELOPE_CAUSE_FIELD}\`:\n` +
      findings.map((finding) => `  - ${finding}`).join("\n"),
  );
}

/**
 * The findings of this module against the `data` schemas that ship: a set whose
 * members differ from the `enum` the schema of its type carries. A set with a
 * `condition` is held to be a SUBSET, because the row's own schema carries the
 * union of the two sets of a run and `synthesized` chooses between them at read
 * time (F111-FR-005).
 */
export function endCauseSetConsistencyFindings(): readonly string[] {
  const findings: string[] = [];
  for (const set of END_CAUSE_SETS) {
    const shipped = refinedDataSchemaOf(set.type)?.properties[set.field]?.enum;
    if (shipped === undefined) {
      findings.push(`${set.type}.${set.field}: the data schema carries no closed set`);
      continue;
    }
    if (set.condition === undefined) {
      const same =
        shipped.length === set.members.length &&
        set.members.every((member) => shipped.includes(member));
      if (!same) {
        findings.push(
          `${set.type}.${set.field}: this module reads ${set.members.join(", ")} where the ` +
            `data schema carries ${shipped.join(", ")}`,
        );
      }
      continue;
    }
    for (const member of set.members) {
      if (shipped.includes(member)) continue;
      findings.push(
        `${set.type}.${set.field} (${set.condition}): ${member} is no member of the ` +
          `closed set the data schema carries`,
      );
    }
  }
  return Object.freeze(findings);
}

/* ------------------------------------------------------------------ *
 * The guard runs at load: the build fails on a field named `cause`.
 * ------------------------------------------------------------------ */

assertNoCauseFieldInADataSchema();

/** True once the guard above has run. Loading this module is the check. */
export const CHECKED_AT_LOAD = true as const;
