// Feature 117 (T068) — the slot, the reduction and the escaping of the fact
// block (F117-FR-033, F117-FR-034, F117-FR-037).
//
// The fact block is the record `specstride.fact-block/1` of annex D §D.7
// (content owner 116). This module is its only reader in the critic prompt:
// it places the block in its ONE fixed slot — the assembler of `assemble.ts`
// puts the rendered text after the rules and before the criteria section and
// every text that comes from the workspace (F117-FR-033; annex X §X.9 T-04:
// facts of the runtime stand before untrusted text).
//
// The rules this module enforces:
//  - VALIDATION (F117-FR-034): the block must validate against
//    `specstride.fact-block/1` and may hold only the fields of annex D §D.7.
//    A field outside §D.7 refuses the whole block: it is left out, the
//    omission is stated in the prompt and recorded. A member outside a closed
//    set that the block names does NOT refuse the block (I3): the member is
//    not shown (rows 65 and 66 of annex X §X.6) and the rest stands.
//  - INTEGRITY (F117-FR-037): integrity events are shown only by the kinds of
//    the closed set of row 65, by kind and without counts. A protected change
//    that was refused is shown by its neutral kind
//    (`protected-change-not-applied`). The two facts of row 66 that have
//    fixed sentences are shown with exactly those sentences. A kind the
//    assembler does not know is not shown.
//  - ESCAPING (F117-FR-034): every string that comes from the workspace (a
//    path, an argument of a command read from a file of the repository, a
//    task title) is stripped of control characters and line breaks, cut to
//    256 bytes with a mark that says it was cut (CQ-062), and the whole block
//    is printed inside a data boundary with the token of the call.
//  - REDUCTION (F117-FR-033): the block is part of the budget. When it does
//    not fit, one fixed rule reduces it: first every row whose result is not
//    `pass` in full, then ONE line per result that says how many rows are
//    left out. The reduction is stated in the block. The block is never left
//    out without a statement, and it never shortens the criteria.
//
// Pure: no clock, no file system, no process.

import {
  furtherFactsOfTheFactBlock,
  integrityKindsThatReachTheCritic,
} from "@specstride/contracts/enums/all-sets";
import { isFactBlock } from "@specstride/contracts/records/fact-block";
import { frameData } from "./frame.ts";

/* ------------------------------------------------------------------ *
 * The closed sets of annex X §X.6 rows 65 and 66 (validation against
 * them happens in `@specstride/contracts`; here they are the show
 * filters).
 * ------------------------------------------------------------------ */

/** Row 65 — the only integrity kinds the critic is shown, by kind. */
export const FACT_INTEGRITY_KINDS: readonly string[] = integrityKindsThatReachTheCritic.members;

/** Row 66 — the only further facts the critic is shown. */
export const FACT_FACT_KINDS: readonly string[] = furtherFactsOfTheFactBlock.members;

/** The neutral kind of a protected change that was refused (row 65, owner 142). */
export const NEUTRAL_PROTECTED_REFUSED_KIND = "protected-change-not-applied" as const;

/* ------------------------------------------------------------------ *
 * The fixed sentences (F117-FR-037).
 * ------------------------------------------------------------------ */

/** The fixed sentence of the fact `result-of-stopped-job`. */
export const FIXED_SENTENCE_STOPPED_JOB = "A cited result file belongs to a stopped job." as const;

/** The fixed sentence of the fact `evidence-predates-tree`. */
export const FIXED_SENTENCE_EVIDENCE_PREDATES_TREE =
  "The phase evidence predates the tree." as const;

/** The fixed sentences by kind; every other known fact is shown by its kind alone. */
export const FACT_FIXED_SENTENCES: Readonly<Record<string, string>> = Object.freeze({
  "result-of-stopped-job": FIXED_SENTENCE_STOPPED_JOB,
  "evidence-predates-tree": FIXED_SENTENCE_EVIDENCE_PREDATES_TREE,
});

/* ------------------------------------------------------------------ *
 * The fields of annex D §D.7.
 * ------------------------------------------------------------------ */

/** The fields the schema `specstride.fact-block/1` defines — annex D §D.7. */
export const FACT_BLOCK_FIELDS: readonly string[] = Object.freeze([
  "schema",
  "manifestHash",
  "commands",
  "treeFingerprint",
  "units",
  "unnamedTasks",
  "notice",
  "protected",
  "integrity",
  "facts",
  "excluded",
]);

/** The cut of one workspace string: 256 bytes, mark included (CQ-062). */
export const FACT_STRING_CUT_BYTES = 256;
/** The mark that says a string was cut. */
export const FACT_STRING_CUT_MARK = " …[cut]";

/* ------------------------------------------------------------------ *
 * Escaping (F117-FR-034).
 * ------------------------------------------------------------------ */

/**
 * Strip control characters and line breaks, and cut to 256 bytes with the
 * cut mark. No `\n`, no `\r`, no C0 control, no DEL survives.
 */
export function escapeFactString(value: string): string {
  // eslint-disable-next-line no-control-regex -- the point IS to strip control characters
  const stripped = value.replace(/[\u0000-\u001f\u007f]/g, "");
  if (Buffer.byteLength(stripped, "utf8") <= FACT_STRING_CUT_BYTES) return stripped;
  const budget = FACT_STRING_CUT_BYTES - Buffer.byteLength(FACT_STRING_CUT_MARK, "utf8");
  let out = "";
  for (const ch of stripped) {
    if (Buffer.byteLength(out + ch, "utf8") > budget) break;
    out += ch;
  }
  return out + FACT_STRING_CUT_MARK;
}

/* ------------------------------------------------------------------ *
 * The result of the slot.
 * ------------------------------------------------------------------ */

/** The block was placed in its slot. */
export type FactSlotPlaced = {
  readonly ok: true;
  /** The rendered text of the block, as it stands in the prompt. */
  readonly text: string;
  /** True when the fixed reduction rule was applied. */
  readonly reduced: boolean;
  /** The reduction statement inside the text, when reduced. */
  readonly statement?: string;
};

/** The block was refused and left out (F117-FR-034, unknown field). */
export type FactSlotOmitted = {
  readonly ok: false;
  readonly omitted: true;
  /** Why the block is not in the prompt. Recorded, never the content. */
  readonly reason: string;
  /** The statement the prompt shows in the place of the block. */
  readonly statement: string;
};

export type FactSlotResult = FactSlotPlaced | FactSlotOmitted;

/** The statement the prompt shows when the block is left out. */
export const OMITTED_STATEMENT =
  "(The fact block of this phase attempt was left out: it held a field outside " +
  "annex D §D.7. This is a statement of omission, not a fact.)";

/** The heading of the fact block in the prompt. */
export const FACT_BLOCK_HEADING =
  "FACT BLOCK (written by the runtime; facts about the tree)" as const;

/** The reduction statement of the fixed rule (F117-FR-033). */
export function reductionStatement(leftOut: number): string {
  return (
    `REDUCED to fit the prompt budget: ${leftOut} row(s) whose result is ` +
    `pass are not shown; every row whose result is not pass stands in full.`
  );
}

/** One count line per result: how many rows are left out (F117-FR-033). */
export function countLine(result: "pass", leftOut: number): string {
  return `- ${leftOut} row(s) with result pass left out by the reduction.`;
}

/* ------------------------------------------------------------------ *
 * The rows and the reduction.
 * ------------------------------------------------------------------ */

/** One row of the block: a unit of work and its result. */
export type FactRow = {
  readonly id: string;
  readonly tasks: readonly string[];
  readonly result: "pass" | "fail";
};

/** Read the rows of a valid block: one per unit, result `pass` only when every command exited 0. */
export function rowsOfBlock(block: {
  units: readonly { id: string; tasks: readonly string[]; commands: readonly { exit: number }[] }[];
}): FactRow[] {
  return block.units.map((unit) => ({
    id: unit.id,
    tasks: unit.tasks,
    result: unit.commands.every((c) => c.exit === 0) ? ("pass" as const) : ("fail" as const),
  }));
}

/**
 * The fixed reduction rule (F117-FR-033): under a budget that the full block
 * misses, first every row whose result is not `pass` stands in full, then one
 * count line says how many rows are left out, and the reduction is stated.
 */
export function reduceRows(rows: readonly FactRow[]): {
  kept: readonly FactRow[];
  leftOut: number;
  reduced: boolean;
} {
  const kept = rows.filter((row) => row.result !== "pass");
  const leftOut = rows.length - kept.length;
  return { kept, leftOut, reduced: leftOut > 0 };
}

/* ------------------------------------------------------------------ *
 * The rendering.
 * ------------------------------------------------------------------ */

function lineFor(kind: string): string | null {
  if (FACT_FIXED_SENTENCES[kind] !== undefined) return `- ${FACT_FIXED_SENTENCES[kind]}`;
  return `- fact: ${kind}`;
}

/**
 * Render the fact block into its slot.
 *
 * - A block that does not validate against `specstride.fact-block/1`, or that
 *   holds a field outside annex D §D.7, is left out with a statement
 *   (F117-FR-034).
 * - Integrity kinds outside row 65 and facts outside row 66 are not shown;
 *   the rest of the block stands (I3, F117-FR-037).
 * - With `budgetBytes`, the block is reduced by the fixed rule when it does
 *   not fit; without it (or when it fits) the full block stands.
 * - With `boundaryToken`, the rendered block stands inside a data boundary
 *   with the token of the call (F117-FR-034).
 */
export function renderFactSlot(input: {
  /** The fact block record, as the control plane wrote it. */
  readonly block: unknown;
  /** The boundary token of the call (`current` block set; F117-FR-035). */
  readonly boundaryToken?: string | undefined;
  /** The byte budget the rendered block must fit. */
  readonly budgetBytes?: number | undefined;
}): FactSlotResult {
  if (typeof input.block !== "object" || input.block === null || !isFactBlock(input.block)) {
    return {
      ok: false,
      omitted: true,
      reason: "not a valid specstride.fact-block/1 record",
      statement: OMITTED_STATEMENT,
    };
  }
  const block = input.block as unknown as Record<string, unknown>;
  const unknownField = Object.keys(block).find((key) => !FACT_BLOCK_FIELDS.includes(key));
  if (unknownField !== undefined) {
    return {
      ok: false,
      omitted: true,
      reason: `field outside annex D §D.7: ${unknownField}`,
      statement: OMITTED_STATEMENT,
    };
  }

  const rows = rowsOfBlock(
    block as {
      units: { id: string; tasks: string[]; commands: { exit: number }[] }[];
    },
  );
  const fit = fitRows(rows, input.budgetBytes);
  const lines = renderLines(block, fit.rows, fit);

  let text = `${FACT_BLOCK_HEADING}\n${lines.join("\n")}`;
  if (fit.reduced) text += `\n${reductionStatement(fit.leftOut)}`;
  if (input.boundaryToken !== undefined) text = frameData(text, input.boundaryToken);
  return { ok: true, text, reduced: fit.reduced, statement: fit.statement };
}

function fitRows(
  rows: readonly FactRow[],
  budgetBytes: number | undefined,
): { rows: readonly FactRow[]; leftOut: number; reduced: boolean; statement?: string } {
  if (budgetBytes === undefined) return { rows, leftOut: 0, reduced: false };
  const full = byteSize(rows);
  if (full <= budgetBytes) return { rows, leftOut: 0, reduced: false };
  const { kept, leftOut, reduced } = reduceRows(rows);
  if (!reduced) return { rows, leftOut: 0, reduced: false };
  return {
    rows: kept,
    leftOut,
    reduced: true,
    statement: reductionStatement(leftOut),
  };
}

function byteSize(rows: readonly FactRow[]): number {
  return rows.reduce(
    (total, row) =>
      total +
      Buffer.byteLength(rowLine(row) + (row.tasks.map(escapeFactString).join(", ") ?? ""), "utf8") +
      2,
    0,
  );
}

function rowLine(row: FactRow): string {
  const tasks = row.tasks.map(escapeFactString).join(", ");
  return `- unit ${escapeFactString(row.id)}: tasks ${tasks}; result ${row.result}`;
}

/** The body lines of the block, with every show filter of F117-FR-037 applied. */
function renderLines(
  block: Record<string, unknown>,
  rows: readonly FactRow[],
  fit: { leftOut: number; reduced: boolean },
): string[] {
  const lines: string[] = [];
  lines.push(`notice: ${String(block.notice)}`);
  lines.push(`tree fingerprint: ${escapeFactString(String(block.treeFingerprint))}`);
  const commands = (block.commands as readonly string[]).map(escapeFactString);
  lines.push(`commands: ${commands.join(", ")}`);
  for (const row of rows) lines.push(rowLine(row));
  if (fit.reduced) lines.push(countLine("pass", fit.leftOut));
  const unnamed = (block.unnamedTasks as readonly string[]).map(escapeFactString);
  if (unnamed.length > 0) lines.push(`unnamed tasks: ${unnamed.join(", ")}`);
  const integrity = (block.integrity as readonly string[]).filter((kind) =>
    FACT_INTEGRITY_KINDS.includes(kind),
  );
  if (integrity.length > 0) {
    lines.push("integrity, by kind:");
    for (const kind of integrity) lines.push(`- ${kind}`);
  }
  const facts = (block.facts as readonly string[]).filter((kind) => FACT_FACT_KINDS.includes(kind));
  for (const kind of facts) {
    lines.push(lineFor(kind) ?? `- fact: ${kind}`);
  }
  const excluded = block.excluded as readonly { commandId: string; reason: string }[];
  if (excluded.length > 0) {
    lines.push(
      "commands excluded from the inner set: " +
        excluded
          .map((e) => `${escapeFactString(e.commandId)} (${escapeFactString(e.reason)})`)
          .join(", "),
    );
  }
  return lines;
}
