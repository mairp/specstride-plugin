/**
 * T068 — the `data` schemas of the ten types of F111-FR-050: the micro-loop
 * layer and the check runner.
 *
 * *The catalogue MUST hold the types with which the micro-loop layer and the
 * check runner record their facts, each with the `data` of the table "Types
 * added on 2026-09-30": `strategy.selected` (the strategy selected for a run,
 * with the manifest hashes and the fallback reason), `microloop.inert` (a phase
 * attempt that ended without a declared unit), `checkpoint.accepted`,
 * `checkpoint.refused` (with a reason of annex X §X.6 row 138),
 * `checkpoint.removed`, `check.excluded` (with its reason), `check.admission`,
 * `check.parallelism_lowered`, `tripwire.raised` (with the breach kind of annex
 * X §X.6 row 141 and the rule id) and `tripwire.cleared`. None of them MUST
 * hold the output of a command, the note of a checkpoint or a path beyond what
 * the redactor allows. They MUST project to nothing. The feature that owns the
 * behaviour emits them.*
 *
 * THE FIELDS COME FROM THE ROW, THE OBLIGATIONS FROM THE REQUIREMENT. As in
 * the rest of this folder (T025), a refinement adds only what a row cannot
 * say: which fields are required, what kind of value each holds, and which
 * pairs of fields have to agree. `consistencyFindings` of `index.ts` reports a
 * refinement that names a field no row has.
 *
 * "NONE OF THEM HOLDS THE OUTPUT OF A COMMAND, THE NOTE OF A CHECKPOINT OR A
 * PATH" is enforced twice, because the two halves fail differently. A field
 * NAMED for such a thing is a design mistake and is caught over the catalogue
 * by `forbiddenFieldFindings` — the build fails on it. A VALUE that is such a
 * thing is a runtime mistake and is caught per event by `contentFindings`,
 * which runs as a rule of every one of the ten: a value holding a line end is
 * the output of a command, and a value that begins like a path is a path.
 * `checkpoint.accepted` carries `checkpointRef`, a logical name with a hash
 * and a size — the note is referred to and never written.
 */
import { closedSet } from "@specstride/contracts/enums/all-sets";
import { CATALOGUE, type CatalogueEntry } from "../index.ts";
import {
  refine,
  COUNT,
  COUNT_OR_NULL,
  TEXT,
  TEXT_OR_NULL,
  TIME_OR_NULL,
  type ObjectShape,
  type TypeRefinement,
} from "./refinement.ts";

/** The ten types of F111-FR-050, in the order the requirement names them. */
export const LAYER_CHECK_TYPES = [
  "strategy.selected",
  "microloop.inert",
  "checkpoint.accepted",
  "checkpoint.refused",
  "checkpoint.removed",
  "check.excluded",
  "check.admission",
  "check.parallelism_lowered",
  "tripwire.raised",
  "tripwire.cleared",
] as const;
export type LayerCheckType = (typeof LAYER_CHECK_TYPES)[number];

/** F111-FR-050: they project to nothing. */
export const LAYER_CHECK_TYPES_PROJECT_TO = null;

/** True where the type is one of the ten. */
export function isLayerCheckType(type: string): boolean {
  return (LAYER_CHECK_TYPES as readonly string[]).includes(type);
}

/* ------------------------------------------------------------------ *
 * The closed sets, read from annex X §X.6 by row number.
 * ------------------------------------------------------------------ */

/** The loop strategies: annex X §X.6 row 55. */
export const LOOP_STRATEGIES: readonly string[] = Object.freeze([
  ...(closedSet(55)?.members ?? []),
]);

/**
 * The micro levels: annex X §X.6 row 56. The row holds no member yet, so
 * `level` stays text (or null) until feature 115 fills it; inventing members
 * here would make the schema refuse a value the product is about to write.
 */
export const MICRO_LEVELS: readonly string[] = Object.freeze([...(closedSet(56)?.members ?? [])]);

/** The fallback reasons of the layer `micro`: annex X §X.6 row 59. */
export const MICRO_FALLBACK_REASONS: readonly string[] = Object.freeze([
  ...(closedSet(59)?.members ?? []),
]);

/** The refusal reasons of a checkpoint: annex X §X.6 row 138. */
export const CHECKPOINT_REFUSAL_REASONS: readonly string[] = Object.freeze([
  ...(closedSet(138)?.members ?? []),
]);

/** The breach kinds of the integrity of the phase gate: annex X §X.6 row 141. */
export const TRIPWIRE_BREACH_KINDS: readonly string[] = Object.freeze([
  ...(closedSet(141)?.members ?? []),
]);

/** The reasons of an admission to a batch of verification commands: row 236. */
export const ADMISSION_REASONS: readonly string[] = Object.freeze([
  ...(closedSet(236)?.members ?? []),
]);

/** The reasons of `tainted`, among the result conditions of a check: row 53. */
export const TAINT_REASONS: readonly string[] = Object.freeze([...(closedSet(53)?.members ?? [])]);

/** The prefix row 67 gives an exclusion of the decision point `tools`. */
export const EXCLUSION_CHOICE_PREFIX = "exclude:" as const;

/**
 * The three exclusions of the decision point `tools` (annex X §X.6 row 67),
 * without the prefix of the choice: `flaky`, `slow`, `budget`. They are READ
 * off the row, so a fourth exclusion added to row 67 arrives here with it.
 */
export const CHECK_EXCLUSION_REASONS: readonly string[] = Object.freeze(
  (closedSet(67)?.members ?? [])
    .filter((choice) => choice.startsWith(EXCLUSION_CHOICE_PREFIX))
    .map((choice) => choice.slice(EXCLUSION_CHOICE_PREFIX.length)),
);

/** For how long a command is excluded (the table: `attempt` or `phase`). */
export const CHECK_EXCLUSION_SCOPES = ["attempt", "phase"] as const;

/** The two results of an admission (the table: `admitted`, `refused`). */
export const ADMISSION_RESULTS = ["admitted", "refused"] as const;

/** The parallelism is always lowered to one (the table: "`to` is 1"). */
export const PARALLELISM_LOWERED_TO = 1;

/** The reason a lowering carries today (a reason of `tainted`, row 53). */
export const PARALLELISM_LOWERED_REASON_TODAY = "changed-during-check" as const;

/* ------------------------------------------------------------------ *
 * The reference of a checkpoint: a logical name, a hash and a size.
 * ------------------------------------------------------------------ */

/** The logical name of the checkpoint of a unit (the table of spec.md). */
export function checkpointLogicalNameOf(unitId: string): string {
  return `unit:${unitId}:checkpoint`;
}

/** The shape of `checkpointRef`: a logical name, a hash and a size. */
export const CHECKPOINT_REFERENCE: ObjectShape = Object.freeze({
  required: Object.freeze(["logicalName", "hash", "size"]),
  additional: false,
});

/** The shape of one entry of `manifestHashes`: a logical name and a hash. */
export const MANIFEST_HASH: ObjectShape = Object.freeze({
  required: Object.freeze(["logicalName", "hash"]),
  additional: false,
});

/**
 * The findings of one `checkpoint.accepted`: the reference names the checkpoint
 * of the unit the event is about, and nothing else.
 */
export function checkpointAcceptedFindings(
  data: Readonly<Record<string, unknown>>,
): readonly string[] {
  const reference = data.checkpointRef;
  if (typeof reference !== "object" || reference === null) return Object.freeze([]);
  const logicalName = (reference as { logicalName?: unknown }).logicalName;
  if (typeof data.unitId !== "string" || typeof logicalName !== "string") {
    return Object.freeze([]);
  }
  const expected = checkpointLogicalNameOf(data.unitId);
  if (logicalName === expected) return Object.freeze([]);
  return Object.freeze([
    `checkpoint.accepted: \`checkpointRef\` names the checkpoint of the unit the event is ` +
      `about (${expected}); it reads ${logicalName}`,
  ]);
}

/** The findings of one `check.admission`: a refusal carries no slot. */
export function admissionFindings(data: Readonly<Record<string, unknown>>): readonly string[] {
  const findings: string[] = [];
  const slot = data.slot ?? null;
  if (data.result === "refused" && slot !== null) {
    findings.push(
      `check.admission: a refusal carries no slot; \`slot\` is null for a refusal, and reads ${String(slot)}`,
    );
  }
  if (data.result === "admitted" && slot === null) {
    findings.push(
      "check.admission: an admission names the slot it was admitted to; `slot` reads null",
    );
  }
  return Object.freeze(findings);
}

/** The findings of one `check.parallelism_lowered`: it goes to one, from more. */
export function parallelismFindings(data: Readonly<Record<string, unknown>>): readonly string[] {
  const findings: string[] = [];
  if (data.to !== PARALLELISM_LOWERED_TO) {
    findings.push(
      `check.parallelism_lowered: \`to\` is ${PARALLELISM_LOWERED_TO}; it reads ${String(data.to)}`,
    );
    return Object.freeze(findings);
  }
  if (typeof data.from === "number" && typeof data.to === "number" && data.from <= data.to) {
    findings.push(
      "check.parallelism_lowered: the parallelism was lowered, so `from` is above `to`; " +
        `${String(data.from)} is not`,
    );
  }
  return Object.freeze(findings);
}

/* ------------------------------------------------------------------ *
 * No output of a command, no note of a checkpoint, no path.
 * ------------------------------------------------------------------ */

/**
 * The field names that WOULD hold the output of a command, the note of a
 * checkpoint or a path. None of the ten may carry one: a field so named is a
 * design mistake, and the build fails on it.
 */
export const FIELDS_THAT_WOULD_HOLD_FORBIDDEN_CONTENT = [
  "note",
  "notes",
  "output",
  "stdout",
  "stderr",
  "log",
  "logs",
  "body",
  "text",
  "content",
  "snippet",
  "excerpt",
  "diff",
  "command",
  "cmd",
  "argv",
  "path",
  "paths",
  "file",
  "files",
  "dir",
  "workdir",
  "cwd",
] as const;

/**
 * The findings of the catalogue against F111-FR-050: a field of one of the ten
 * whose NAME says it would hold the output of a command, the note of a
 * checkpoint or a path.
 */
export function forbiddenFieldFindings(
  rows: readonly CatalogueEntry[] = CATALOGUE,
): readonly string[] {
  const findings: string[] = [];
  for (const row of rows) {
    if (!isLayerCheckType(row.type)) continue;
    for (const field of row.dataFields) {
      if (!(FIELDS_THAT_WOULD_HOLD_FORBIDDEN_CONTENT as readonly string[]).includes(field)) {
        continue;
      }
      findings.push(
        `${row.type}: the data field \`${field}\` would hold the output of a command, ` +
          `the note of a checkpoint or a path; F111-FR-050 keeps none of them`,
      );
    }
  }
  return Object.freeze(findings);
}

/** A value that begins like a path: absolute, relative, home-relative, drive. */
export const PATH_SHAPE = /^(?:[./~]|[A-Za-z]:[\\/])/;

function walk(
  path: string,
  value: unknown,
  report: (at: string, value: string) => void,
  depth = 0,
): void {
  if (depth > 6) return;
  if (typeof value === "string") {
    report(path, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, member] of value.entries()) {
      walk(`${path}[${index}]`, member, report, depth + 1);
    }
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [field, member] of Object.entries(value)) {
      walk(`${path}.${field}`, member, report, depth + 1);
    }
  }
}

/**
 * The findings of one event of the ten against F111-FR-050: a VALUE that holds
 * a line end is the output of a command, and a value that begins like a path is
 * a path. Nested values are reached too, because a reference is a record.
 */
export function layerCheckContentFindings(type: string, data: unknown): readonly string[] {
  const findings: string[] = [];
  if (typeof data !== "object" || data === null || Array.isArray(data)) return Object.freeze([]);
  for (const [field, value] of Object.entries(data)) {
    walk(`${type}.${field}`, value, (at, text) => {
      if (text.includes("\n") || text.includes("\r")) {
        findings.push(
          `${at}: the value holds a line end, which is the output of a command; ` +
            `F111-FR-050 keeps no output in these events`,
        );
        return;
      }
      if (PATH_SHAPE.test(text)) {
        findings.push(
          `${at}: the value is a path (\`${text}\`); F111-FR-050 keeps no path beyond what ` +
            `the redactor allows`,
        );
      }
    });
  }
  return Object.freeze(findings);
}

/** The content rule every one of the ten carries. */
function contentRule(type: string) {
  return {
    name: "no-output-no-note-no-path",
    check: (data: Readonly<Record<string, unknown>>) =>
      layerCheckContentFindings(type, data)[0] ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * The refinements.
 * ------------------------------------------------------------------ */

/** The refinements of F111-FR-050. */
export const REFINEMENTS: readonly TypeRefinement[] = Object.freeze([
  refine({
    requirement: "F111-FR-050",
    type: "strategy.selected",
    required: ["strategy", "level", "manifestHashes", "fallbackReason"],
    fields: {
      strategy: { enum: LOOP_STRATEGIES },
      level: {
        ...TEXT_OR_NULL,
        note: "annex X §X.6 row 56, which holds no member yet; text until it does",
      },
      manifestHashes: {
        type: ["array"],
        items: MANIFEST_HASH,
        note: "a list of logical name and hash, the check manifest among them",
      },
      fallbackReason: {
        type: ["string", "null"],
        enum: MICRO_FALLBACK_REASONS,
        note: "annex X §X.6 row 59, or null when the layer is on",
      },
    },
    rules: [contentRule("strategy.selected")],
    note: "written once for each engine start, at launch",
  }),
  refine({
    requirement: "F111-FR-050",
    type: "microloop.inert",
    required: ["phase", "attempt"],
    fields: { phase: COUNT, attempt: COUNT },
    rules: [contentRule("microloop.inert")],
    note: "a phase attempt with the layer on ended and no unit was declared",
  }),
  refine({
    requirement: "F111-FR-050",
    type: "checkpoint.accepted",
    required: ["unitId", "taskIds", "checkpointRef"],
    fields: {
      unitId: TEXT,
      // `taskIds` is a marked free-text field of the catalogue: the task ids,
      // or the criterion indexes, that the checkpoint names.
      checkpointRef: {
        type: ["object", "null"],
        shape: CHECKPOINT_REFERENCE,
        note: "`unit:<unitId>:checkpoint` with hash and size; the note is never in the event",
      },
    },
    rules: [
      {
        name: "the-reference-names-this-unit",
        check: (data) => checkpointAcceptedFindings(data)[0] ?? null,
      },
      contentRule("checkpoint.accepted"),
    ],
  }),
  refine({
    requirement: "F111-FR-050",
    type: "checkpoint.refused",
    required: ["reason", "bytes"],
    fields: {
      reason: { enum: CHECKPOINT_REFUSAL_REASONS },
      bytes: { ...COUNT_OR_NULL, note: "the size of the file, or null when it could not be read" },
    },
    rules: [contentRule("checkpoint.refused")],
  }),
  refine({
    requirement: "F111-FR-050",
    type: "checkpoint.removed",
    required: ["bytes"],
    fields: { bytes: COUNT_OR_NULL },
    rules: [contentRule("checkpoint.removed")],
    note: "a checkpoint that was present when a pass started",
  }),
  refine({
    requirement: "F111-FR-050",
    type: "check.excluded",
    required: ["checkId", "reason", "scope", "durationMs", "ruleId"],
    fields: {
      checkId: TEXT,
      reason: {
        enum: CHECK_EXCLUSION_REASONS,
        note: "the three exclusions of the decision point `tools`, annex X §X.6 row 67",
      },
      scope: { enum: [...CHECK_EXCLUSION_SCOPES] },
      durationMs: { ...COUNT_OR_NULL, note: "the measured duration, or null" },
      ruleId: { ...TEXT_OR_NULL, note: "the router rule, or null when routing is off" },
    },
    rules: [contentRule("check.excluded")],
  }),
  refine({
    requirement: "F111-FR-050",
    type: "check.admission",
    required: ["checkId", "batch", "slot", "result", "reason"],
    fields: {
      checkId: TEXT,
      batch: COUNT,
      slot: { ...COUNT_OR_NULL, note: "null for a refusal" },
      result: { enum: [...ADMISSION_RESULTS] },
      reason: { enum: ADMISSION_REASONS },
    },
    rules: [
      { name: "a-refusal-carries-no-slot", check: (data) => admissionFindings(data)[0] ?? null },
      contentRule("check.admission"),
    ],
  }),
  refine({
    requirement: "F111-FR-050",
    type: "check.parallelism_lowered",
    required: ["from", "to", "batch", "phase", "attempt", "reason"],
    fields: {
      from: COUNT,
      to: { ...COUNT, note: "`to` is 1" },
      batch: COUNT,
      phase: COUNT,
      attempt: COUNT,
      reason: {
        enum: TAINT_REASONS,
        note: `a reason of \`tainted\` (annex X §X.6 row 53); today ${PARALLELISM_LOWERED_REASON_TODAY}`,
      },
    },
    rules: [
      { name: "the-lowering-goes-to-one", check: (data) => parallelismFindings(data)[0] ?? null },
      contentRule("check.parallelism_lowered"),
    ],
  }),
  refine({
    requirement: "F111-FR-050",
    type: "tripwire.raised",
    required: ["kind", "ruleId"],
    fields: { kind: { enum: TRIPWIRE_BREACH_KINDS }, ruleId: TEXT },
    rules: [contentRule("tripwire.raised")],
    note: "the fields of the tripwire record (annex B §B.18)",
  }),
  refine({
    requirement: "F111-FR-050",
    type: "tripwire.cleared",
    required: ["clearedAt"],
    fields: {
      clearedAt: {
        ...TIME_OR_NULL,
        note: "the time of the command `tripwire clear`, or null when it is not known",
      },
    },
    rules: [contentRule("tripwire.cleared")],
    note: "written in the first engine start after `tripwire clear`",
  }),
]);
