/**
 * The closed family of finding codes of the reverse lint (F140-FR-003;
 * F140-SC-001; row 146 of annex X §X.6, owner 140).
 *
 * This module is the TypeScript face of the contract
 * `specs/140-reverse-inventory-and-lint/contracts/finding-codes.json`, copied
 * byte for byte into `data/finding-codes.json` by T003. The family is CLOSED:
 * the lint may print no code that is not a row below, and every row below is
 * raised by at least one fixture of FX-30.
 *
 * The rows are NOT hand-maintained knowledge. `src/lint/codes-check.ts` reads
 * `data/finding-codes.json` and fails the build when this module and the
 * contract differ in the set of codes, in a severity, in a level list or in
 * their order — so a code added to the contract and not here, or here and not
 * in the contract, is a build failure and never a silent divergence.
 *
 * `levels` is kept as the contract writes it, the literal string, so that the
 * comparison is of bytes and not of an interpretation. `levelsOf` is the
 * interpretation, and `LEVELS_ALL` the one token that is not a list.
 */

/** The schema id the contract carries. */
export const FINDING_CODES_SCHEMA = "specstride.reverse-finding-codes/1" as const;

/** The feature that owns the family (row 146 of annex X §X.6). */
export const FINDING_CODES_OWNER = "140" as const;

/** The copy of the contract this module is checked against, inside the package. */
export const FINDING_CODES_CONTRACT = "data/finding-codes.json" as const;

/** The levels of the reverse lint, 0 to 5 (F140-FR-002). */
export const LINT_LEVELS = Object.freeze([0, 1, 2, 3, 4, 5] as const);

/** A level of the reverse lint. */
export type LintLevel = (typeof LINT_LEVELS)[number];

/** The token the contract writes for "every level" (row 148 is open). */
export const LEVELS_ALL = "all" as const;

/** The two severities a finding may carry (row 147 of annex X §X.6). */
export const FINDING_SEVERITIES = Object.freeze(["error", "warning"] as const);

/** The severity of a finding. */
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/** Every code of the closed family, as the contract names it. */
export type FindingCode =
  | "template.mandatory"
  | "template.family"
  | "template.expected"
  | "placeholder"
  | "structure.extra"
  | "structure.contracts"
  | "structure.required"
  | "evidence.format"
  | "evidence.kind"
  | "evidence.confidence"
  | "evidence.validation"
  | "evidence.disproved"
  | "evidence.citation"
  | "evidence.contradicts"
  | "evidence.missing"
  | "evidence.skipped"
  | "unknowns.placement"
  | "spec.fr-format"
  | "spec.sc-format"
  | "spec.fr-unique"
  | "spec.sc-unique"
  | "spec.story-format"
  | "spec.story-numbers"
  | "spec.story-parts"
  | "spec.clarifications"
  | "research.decisions"
  | "data-model.entities"
  | "checklist.items"
  | "tasks.grammar"
  | "tasks.line-format"
  | "tasks.ids"
  | "tasks.phase-order"
  | "tasks.story-labels"
  | "tasks.story-exists"
  | "tasks.parallel-files"
  | "tasks.mode"
  | "coverage.fr"
  | "claims.missing";

/** One row of the contract: the code, its severity and its level list. */
export interface FindingCodeRow {
  /** The code, as the lint prints it. */
  readonly code: FindingCode;
  /** `error` or `warning`. */
  readonly severity: FindingSeverity;
  /**
   * The levels at which the code can be raised, cumulative upward from the
   * first one; `all` means every level. The literal string of the contract.
   */
  readonly levels: string;
}

/**
 * The closed family, in the order of the contract. The order is part of the
 * comparison: a reordering is a divergence the build reports.
 */
export const FINDING_CODES: readonly FindingCodeRow[] = Object.freeze([
  { code: "template.mandatory", severity: "error", levels: "1,2,4" },
  { code: "template.family", severity: "error", levels: "1,2,4" },
  { code: "template.expected", severity: "warning", levels: "1,2,4" },
  { code: "placeholder", severity: "error", levels: "1,2,3,4" },
  { code: "structure.extra", severity: "error", levels: "all" },
  { code: "structure.contracts", severity: "error", levels: "3" },
  { code: "structure.required", severity: "error", levels: "all" },
  { code: "evidence.format", severity: "error", levels: "0,1,2,3" },
  { code: "evidence.kind", severity: "error", levels: "0,1,2,3" },
  { code: "evidence.confidence", severity: "error", levels: "0,1,2,3" },
  { code: "evidence.validation", severity: "error", levels: "0,1,2,3" },
  { code: "evidence.disproved", severity: "error", levels: "1" },
  { code: "evidence.citation", severity: "error", levels: "0,1,2,3" },
  { code: "evidence.contradicts", severity: "error", levels: "0,1,2,3" },
  { code: "evidence.missing", severity: "error", levels: "0,1,2,3" },
  { code: "evidence.skipped", severity: "warning", levels: "all" },
  { code: "unknowns.placement", severity: "warning", levels: "1" },
  { code: "spec.fr-format", severity: "error", levels: "1" },
  { code: "spec.sc-format", severity: "error", levels: "1" },
  { code: "spec.fr-unique", severity: "error", levels: "1" },
  { code: "spec.sc-unique", severity: "error", levels: "1" },
  { code: "spec.story-format", severity: "error", levels: "1" },
  { code: "spec.story-numbers", severity: "error", levels: "1" },
  { code: "spec.story-parts", severity: "error", levels: "1" },
  { code: "spec.clarifications", severity: "error", levels: "1" },
  { code: "research.decisions", severity: "error", levels: "2" },
  { code: "data-model.entities", severity: "warning", levels: "3" },
  { code: "checklist.items", severity: "error", levels: "1" },
  { code: "tasks.grammar", severity: "error", levels: "4" },
  { code: "tasks.line-format", severity: "error", levels: "4" },
  { code: "tasks.ids", severity: "error", levels: "4" },
  { code: "tasks.phase-order", severity: "error", levels: "4" },
  { code: "tasks.story-labels", severity: "error", levels: "4" },
  { code: "tasks.story-exists", severity: "error", levels: "4" },
  { code: "tasks.parallel-files", severity: "error", levels: "4" },
  { code: "tasks.mode", severity: "error", levels: "4" },
  { code: "coverage.fr", severity: "error", levels: "5" },
  { code: "claims.missing", severity: "error", levels: "0" },
] as const);

/** How many codes the closed family holds (F140-SC-001). */
export const FINDING_CODE_COUNT = 38 as const;

/** The codes of the family as a set, for the membership test of the lint. */
export const FINDING_CODE_SET: ReadonlySet<string> = Object.freeze(
  new Set<string>(FINDING_CODES.map((row) => row.code)),
) as ReadonlySet<string>;

/** True when `value` is a code of the closed family. */
export function isFindingCode(value: string): value is FindingCode {
  return FINDING_CODE_SET.has(value);
}

/** The row of a code, or `undefined` for a code outside the family. */
export function rowOf(code: string): FindingCodeRow | undefined {
  return FINDING_CODES.find((row) => row.code === code);
}

/** The severity the contract gives the code; `undefined` outside the family. */
export function severityOf(code: string): FindingSeverity | undefined {
  return rowOf(code)?.severity;
}

/**
 * The levels at which the code can be raised. `all` yields every level; a
 * list yields its members, cumulative upward from the first one, so a code of
 * `1,2,4` is raised at 1, 2 and 4 and at no other level. A code outside the
 * family yields the empty list.
 */
export function levelsOf(code: string): readonly LintLevel[] {
  const row = rowOf(code);
  if (row === undefined) return Object.freeze([]);
  if (row.levels === LEVELS_ALL) return LINT_LEVELS;
  const wanted = new Set(row.levels.split(",").map((part) => Number(part.trim())));
  return Object.freeze(LINT_LEVELS.filter((level) => wanted.has(level)));
}

/** The codes the lint may raise at `level`, in the order of the contract. */
export function codesAtLevel(level: LintLevel): readonly FindingCode[] {
  return Object.freeze(
    FINDING_CODES.filter((row) => levelsOf(row.code).includes(level)).map((row) => row.code),
  );
}
