/**
 * T178 — the type and the validator of the fact block from
 * `schemas/fact-block.schema.json` (annex D, §D.7; F100-FR-135,
 * F100-FR-136).
 *
 * Schema id `specstride.fact-block/1`, logical name
 * `attempt:<N>:<k>:<n>:fact-block`. The engine writes it from the control
 * plane and the ledger, through the call point `contributeCriticInput` of
 * EP-04; the critic prompt assembler is its only reader. Content owner 116;
 * its slot and its escaping in the critic prompt belong to 117.
 */
import type { FactBlock as Generated } from "./generated/fact-block.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.fact-block/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "attempt:<N>:<k>:<n>:fact-block" as const;

/** The section of annex D that owns the field list. */
export const ANNEX_SECTION = "annex D, §D.7" as const;

/** The content owner of §D.7, and the owner of its slot in the critic prompt. */
export const CONTENT_OWNER = "116" as const;
export const SLOT_AND_ESCAPING_OWNER = "117" as const;

/** The call point of EP-04 through which the engine writes it (§D.7). */
export const CALL_POINT = "contributeCriticInput" as const;

/** The fact block of a phase attempt (annex D, §D.7). */
export type FactBlock = Generated;

/**
 * §D.7 — the block is present only when at least one unit of work was
 * declared in the phase attempt, or when an integrity rule that is
 * independent of the layer found a fact.
 */
export function blockIsPresent(input: {
  readonly unitsDeclared: number;
  readonly layerIndependentIntegrityFact: boolean;
}): boolean {
  return input.unitsDeclared > 0 || input.layerIndependentIntegrityFact;
}

/**
 * Read the record: the field `schema` is required, a different major is
 * refused with the message of the annex, and every required field of §D.7 is
 * required (F100-FR-048, F100-FR-049).
 */
export function readFactBlock(value: unknown, logicalName: string = LOGICAL_NAME): FactBlock {
  return readRecord<FactBlock>(logicalName, value);
}

/** `readFactBlock` that returns a result instead of throwing. */
export function tryReadFactBlock(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: FactBlock } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<FactBlock>(logicalName, value);
}

/** True when the value validates against `specstride.fact-block/1`. */
export function isFactBlock(value: unknown): value is FactBlock {
  return validate<FactBlock>(SCHEMA_ID, value).ok;
}

/* ------------------------------------------------------------------ *
 * F100-FR-135 — the block holds the fields of §D.7 and nothing from the
 * list of what is never in the block.
 * ------------------------------------------------------------------ */

/** The list "Never in the block" of §D.7, verbatim. */
export const NEVER_IN_THE_BLOCK = [
  "counts",
  "order",
  "times",
  "output of a command",
  "earlier results",
  "fingerprint values per row",
  "model tiers",
  "sessions",
  "routing decisions",
  "whether a result came from the closing check",
  "anything about groups or workers",
] as const;

/** The conditions of a unit of work, each in a separate field (§D.7, `units`). */
export const UNIT_CONDITIONS = ["tainted", "flaky", "superseded", "current", "cached"] as const;

/** The one fixed sentence of the field `notice` (§D.7). */
export const NOTICE = "a result is evidence about the tree and not about a task" as const;

/**
 * F100-FR-135 — every text of the block that comes from the workspace is
 * escaped, cut, stripped of control characters and printed inside a data
 * boundary with a token of the call.
 */
export const TREATMENT_OF_WORKSPACE_TEXT = [
  "escaped",
  "cut",
  "stripped of control characters",
  "printed inside a data boundary with a token of the call",
] as const;

/** F100-FR-135 — test counts are not shown in Wave 1. */
export const TEST_COUNTS_SHOWN_IN_WAVE_1 = false as const;

/** F100-FR-135 — only counts of suppression markers are shown. */
export const COUNTS_SHOWN = ["suppression markers"] as const;

/** F100-FR-135 — file modification times stay in the grounding snapshot. */
export const FILE_MODIFICATION_TIMES_STAY_IN = "the grounding snapshot" as const;

/**
 * F100-FR-135 — the check of one field name against the list "Never in the
 * block": `true` where the field may be in the block.
 */
export const NEVER_IN_THE_BLOCK_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bcounts?\b/,
  /\borders?\b/,
  /\btimes?\b/,
  /\boutputs?\b/,
  /\bearlier\b/,
  /\bfingerprint values?\b/,
  /\btiers?\b/,
  /\bsessions?\b/,
  /\brouting\b/,
  /\bclosing check\b/,
  /\bgroups?\b/,
  /\bworkers?\b/,
]);

/** The one count the block DOES show: suppression markers (F100-FR-135). */
export const COUNT_THAT_IS_SHOWN = /suppression/;

/**
 * F100-FR-135 — the check of one field name against the list "Never in the
 * block": `true` where the field may be in the block. A field name is read as
 * words, so that `workerId` and "anything about groups or workers" are the same
 * subject.
 */
export function mayBeInTheBlock(field: string): boolean {
  const words = field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  if (COUNT_THAT_IS_SHOWN.test(words)) return true;
  return !NEVER_IN_THE_BLOCK_PATTERNS.some((pattern) => pattern.test(words));
}

/* ------------------------------------------------------------------ *
 * F100-FR-136 — a change of the protected set without authority is a
 * fact and never a halt.
 * ------------------------------------------------------------------ */

/**
 * F100-FR-136 — when files of the protected set were changed without
 * authority the verification gate still runs, its result carries the
 * condition, the critic is told, approval stays possible and the run does not
 * halt.
 */
export const ON_AN_UNAUTHORISED_PROTECTED_CHANGE = Object.freeze({
  verificationGateStillRuns: true as const,
  resultCarriesTheCondition: true as const,
  criticIsTold: true as const,
  approvalStaysPossible: true as const,
  theRunHalts: false as const,
});

/**
 * F100-FR-136 — at phase entry the tree is compared with the approved tree of
 * the phase before; a difference is a fact for the critic and never blocks.
 */
export const AT_PHASE_ENTRY = Object.freeze({
  comparedWith: "the approved tree of the phase before" as const,
  aDifferenceIsAFactForTheCritic: true as const,
  aDifferenceBlocks: false as const,
});

/** The row of §X.7 that switches the comparison off under the `parity` profile. */
export const PARITY_ROW = 32 as const;
