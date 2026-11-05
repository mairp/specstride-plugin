/**
 * T007 — the one hasher of the product, a module of `@specstride/kernel`
 * built by feature 104 (F104-FR-021, F104-FR-022, F104-FR-024, F104-FR-027;
 * feature 100 annex X §X.5, F100-FR-207).
 *
 * There is ONE hashing scheme. Every feature that hashes a source, a launch
 * contract, a plan or a manifest reaches it here, and no feature compares
 * hashes itself (F104-FR-027). The hasher lives in the kernel and not in
 * `@specstride/spec-formats` so that a core package, whose `mayImport` is
 * `@specstride/contracts` and `@specstride/kernel` alone, can call it
 * (research D-9, W-104-01; `specs/100-specstride/contracts/data/package-graph.json`).
 *
 * The interface type is feature 100's (`@specstride/contracts/ep/hasher`);
 * this module is its one implementation.
 *
 * What this module does NOT do, on purpose:
 *
 *  - It reads no file. Every operation is a pure function of the bytes, the
 *    text or the record it is handed. `@specstride/spec-formats` reads the
 *    files and hands the bytes over (F104-FR-024). The classification of the
 *    staleness verdict is pure for the same reason, and `classifyStaleness`
 *    therefore takes recorded hashes and hashes now, never paths.
 *  - It reads no phase heading and builds no model. Of the grammar it holds
 *    exactly ONE rule, the mark rule of F104-FR-022 below, which says what the
 *    task-list hash covers; that single exception is the one F104-SC-001 names.
 *  - It builds neither the obligation id nor the signature of unmet criteria.
 *    Those are formed by their owners (features 107 and 101) OVER the content
 *    hash of a text; this module hashes the text it is handed and holds no
 *    rule of theirs (annex X §X.5, row "Phase shape, obligation id, signature
 *    of unmet criteria", as amended on 2026-09-30).
 */
import { createHash } from "node:crypto";
import {
  ALGORITHM,
  LINE_END_OF_THE_CANONICAL_RECORD_HASH,
  type CanonicalHasher,
} from "@specstride/contracts/ep/hasher";
/**
 * The ONE import of this folder's own classification module (T036). It is
 * imported and not only re-exported, because `canonicalHasher` below has to
 * carry the operation as a member.
 */
import { classifyStaleness } from "./staleness.ts";

/**
 * The section of annex X that owns the table of operations. The names of
 * these three carry the word `HASHER` because `@specstride/kernel` re-exports
 * every folder from one module and the stable read of feature 100 already
 * holds `ANNEX_SECTION`, `REQUIREMENT` and `RULE_OWNER`.
 */
export const HASHER_ANNEX_SECTION = "annex X, §X.5" as const;

/** The requirement of feature 100 this module carries out. */
export const HASHER_REQUIREMENT = "F100-FR-207" as const;

/** The feature that owns the rules of this module. */
export const HASHER_RULE_OWNER = "104" as const;

/** The one hashing scheme (annex X §X.5): every hash here is SHA-256. */
export { ALGORITHM };

/** This module reads no file: every operation is pure (F104-FR-024). */
export const HASHER_READS_A_FILE = false as const;

/* ------------------------------------------------------------------ *
 * The content hash.
 * ------------------------------------------------------------------ */

/**
 * The content hash of the bytes of a file, or of a text taken as UTF-8
 * (annex X §X.5, row "Content hash"). Lower-case hexadecimal SHA-256.
 *
 * A caller that holds a file hands the bytes over; this module opens nothing.
 */
export function contentHash(bytes: Uint8Array | string): string {
  const hash = createHash("sha256");
  if (typeof bytes === "string") hash.update(bytes, "utf8");
  else hash.update(bytes);
  return hash.digest("hex");
}

/* ------------------------------------------------------------------ *
 * The mark rule of F104-FR-022 — the ONE rule of the grammar this module
 * holds, and the one exception F104-SC-001 names.
 * ------------------------------------------------------------------ */

/**
 * The white space of the baseline's regular expressions. The baseline is
 * Python (`bootstrap_contract.py:44` at `9c88f86`), where `\s` over a text
 * matches these characters. JavaScript's `\s` is not the same set — it holds
 * U+FEFF and lacks `\x1c`-`\x1f` and `\x85` — so the class is written out,
 * and a hash cannot differ from the baseline's over a character on which the
 * two languages disagree (F104-FR-021: equal to the baseline's on the same
 * input).
 */
const BASELINE_WHITE_SPACE =
  "[ \\t\\n\\x0b\\f\\r\\x1c-\\x1f\\x85\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";

/**
 * A word end, as the baseline's `\b` reads it. The character before it is
 * always a word character here (a digit or a letter), so `\b` holds exactly
 * where the next character is no word character or the text ends. Python's
 * `\w` over a text is Unicode-aware; JavaScript's `\b` without `u` is ASCII,
 * so the assertion is written out.
 */
const BASELINE_WORD_END = "(?![\\p{L}\\p{N}_])";

/** A digit, as the baseline's `\d` over a text reads it: Unicode decimals. */
const BASELINE_DIGIT = "\\p{Nd}";

/**
 * The mark rule of F104-FR-022, first form: a task line with a `T` id. This
 * is the baseline's regular expression, character for character in meaning:
 *
 *     (?m)^(\s*-\s*\[)[ xX](\]\s+T\d+[A-Za-z]?\b)
 *
 * (`skills/mixture-of-loops/scripts/bootstrap_contract.py:44` at `9c88f86`;
 * behaviour row B-2477; research D-3). The mark — one of space, `x` or `X` —
 * is replaced by a space, so ticking or clearing a box never changes the hash.
 *
 * A line with an EMPTY box `[]` is outside the rule, as at the baseline: it
 * matches neither form, so a tick of such a line IS a change (F104-FR-022,
 * research D-3, and the edge case of the spec).
 */
const TASK_LINE_WITH_A_T_ID = new RegExp(
  `^(${BASELINE_WHITE_SPACE}*-${BASELINE_WHITE_SPACE}*\\[)[ xX]` +
    `(\\]${BASELINE_WHITE_SPACE}+T${BASELINE_DIGIT}+[A-Za-z]?${BASELINE_WORD_END})`,
  "gmu",
);

/**
 * The mark rule of F104-FR-022, second form: an `openspec-change` task line,
 * whose id is dotted (`N.N[.N…]`, F104-FR-013). The baseline covers the `T`
 * id only; this feature widens the rule so that the engine's own tick of an
 * OpenSpec change never makes a run stale.
 *
 * This widening is the recorded divergence **DV-118** (research D-4; B-2054;
 * R28; CQ-045, closed 2026-09-30), whose oracle handling is "not observable":
 * no fixture of the baseline holds an OpenSpec change, so no golden capture
 * can tell the two rules apart. Over a task list with `T` ids only the two
 * rules give the SAME hash, which `hasher/mark-rule.test.ts` pins against the
 * value the baseline's own expression produces.
 *
 * A single undotted number (`- [ ] 1 text`) is NOT a dotted id and is not
 * covered.
 */
const TASK_LINE_WITH_A_DOTTED_ID = new RegExp(
  `^(${BASELINE_WHITE_SPACE}*-${BASELINE_WHITE_SPACE}*\\[)[ xX]` +
    `(\\]${BASELINE_WHITE_SPACE}+${BASELINE_DIGIT}+(?:\\.${BASELINE_DIGIT}+)+${BASELINE_WORD_END})`,
  "gmu",
);

/**
 * The two expressions of the mark rule, EXPORTED so that the static test of
 * F104-SC-001 (T023 of feature 104) can read the rule itself and prove that
 * the hasher holds the mark rule of F104-FR-022 and no other part of the
 * grammar. A claim about what a module holds has to be measurable on the
 * module, and a private constant is not.
 *
 * Both carry the `g` flag, because `withMarksReplaced` replaces every match;
 * a caller that only asks whether a line matches must drop it, or `test` will
 * be stateful.
 */
export const MARK_RULE = TASK_LINE_WITH_A_T_ID;
export const OPENSPEC_MARK_RULE = TASK_LINE_WITH_A_DOTTED_ID;

/** The two expressions above, by the form each covers. */
export const MARK_RULE_OF: Readonly<Record<"T-id" | "dotted-id", RegExp>> = Object.freeze({
  "T-id": TASK_LINE_WITH_A_T_ID,
  "dotted-id": TASK_LINE_WITH_A_DOTTED_ID,
});

/** The two forms of task line the mark rule covers (F104-FR-022). */
export const MARK_RULE_FORMS = ["T-id", "dotted-id"] as const;
export type MarkRuleForm = (typeof MARK_RULE_FORMS)[number];

/** The divergence row that records the second form (CQ-045). */
export const DIVERGENCE_OF_THE_DOTTED_FORM = "DV-118" as const;

/**
 * Line ends taken as one form (F104-FR-022). The baseline reads the file with
 * Python's `open()` in text mode, which translates `\r\n` and a lone `\r` to
 * `\n` before hashing, so a file with Windows line ends and the same file with
 * Unix line ends give the same hash.
 */
export function withLineEndsAsOneForm(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * The mark rule applied: every covered task line's mark replaced by a space.
 * Exported so that a test, and a reader, can see the rule's effect as text
 * and not only through a hash.
 */
export function withMarksReplaced(taskList: string): string {
  return taskList
    .replace(TASK_LINE_WITH_A_T_ID, "$1 $2")
    .replace(TASK_LINE_WITH_A_DOTTED_ID, "$1 $2");
}

/**
 * The task-list hash that ignores checkboxes (annex X §X.5; F104-FR-022):
 * the hash of the task list read as UTF-8 text with line ends taken as one
 * form, in which the mark of every covered task line is replaced by a space.
 * Ticking or clearing a box never changes it.
 */
export function taskListHashIgnoringCheckboxes(taskList: string): string {
  return contentHash(withMarksReplaced(withLineEndsAsOneForm(taskList)));
}

/**
 * The same hash over the BYTES of a task list. A file that cannot be decoded
 * as UTF-8 gives NO hash — `undefined` — and so a difference (F104-FR-022);
 * the baseline's `UnicodeDecodeError` branch does the same.
 */
export function taskListHashIgnoringCheckboxesOfBytes(bytes: Uint8Array): string | undefined {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
  return taskListHashIgnoringCheckboxes(text);
}

/* ------------------------------------------------------------------ *
 * The canonical record text and the canonical record hash.
 * ------------------------------------------------------------------ */

/**
 * The baseline sorts keys by code point (Python compares strings by code
 * point). JavaScript compares by UTF-16 code unit, which differs for a key
 * that holds a character above the basic plane, so the comparison is written
 * out over code points.
 */
function compareByCodePoint(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i += 1) {
    const x = left[i]!.codePointAt(0)!;
    const y = right[i]!.codePointAt(0)!;
    if (x !== y) return x < y ? -1 : 1;
  }
  return left.length - right.length;
}

/** A deep copy of the value with the keys of every object sorted. */
function withSortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withSortedKeys);
  if (value === null || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort(compareByCodePoint)) {
    sorted[key] = withSortedKeys(source[key]);
  }
  return sorted;
}

/**
 * The canonical record TEXT (annex X §X.5, row "Canonical record text"):
 * the record as text with sorted keys, compact separators, non-ASCII
 * characters kept, and NO final line end. It is the input of the canonical
 * record hash, and the form in which the Specstride baseline hashes the
 * records of its verification plan (feature 105, F105-FR-011, F105-FR-012).
 *
 * It is the baseline's `json.dumps(sort_keys=True, separators=(",", ":"),
 * ensure_ascii=False)` — the behaviour row "Canonical contract bytes" of the
 * mixture-of-loops runtime inventory, `docs/ecosystem/research/R18-partial/raw/mol-runtime.tsv`
 * row 75 (011 FR-009), at `9c88f86`. No feature builds a record text of its own.
 */
export function canonicalRecordText(record: unknown): string {
  return JSON.stringify(withSortedKeys(record)) ?? "null";
}

/**
 * The canonical record HASH (annex X §X.5, row "Canonical record hash"): the
 * content hash of the canonical record text with ONE line end added. It is
 * not the content hash of the text as it is; the two forms are different
 * values over the same record, and feature 107's launch contract hashes this
 * one (F107-FR-019).
 */
export function canonicalRecordHash(record: unknown): string {
  return contentHash(canonicalRecordText(record) + LINE_END_OF_THE_CANONICAL_RECORD_HASH);
}

/* ------------------------------------------------------------------ *
 * The phase shape.
 * ------------------------------------------------------------------ */

/** The length of a phase shape in hexadecimal characters (F104-FR-021). */
export const PHASE_SHAPE_LENGTH = 16 as const;

/** What the phase shape is taken over: the number, title and criteria. */
export type PhaseShapeInput = {
  readonly number: number;
  readonly title: string;
  readonly criteria: readonly string[];
};

const RUNS_OF_WHITE_SPACE = new RegExp(`${BASELINE_WHITE_SPACE}+`, "gu");

/** Runs of white space collapsed to one space, and the ends trimmed. */
function collapseWhiteSpace(text: string): string {
  return text.replace(RUNS_OF_WHITE_SPACE, " ").trim();
}

/**
 * The phase shape (annex X §X.5; F104-FR-021): the first 16 hexadecimal
 * characters of the hash of the number, the title and the criteria of a
 * phase, with runs of white space collapsed. It is the baseline's digest over
 * the compact JSON `[n, title, [criteria]]` (`lib/specstride_spec.py:462`,
 * behaviour row B-2041; printed by `spec shape <n>`, B-1986).
 *
 * A tick never changes it: the criteria a model hands over are the TEXT of
 * the checkbox lines and carry no mark, so the mark is not in the input at
 * all. This module strips no mark itself — that would be grammar, and of the
 * grammar it holds only the mark rule of F104-FR-022.
 *
 * `assumption`: the baseline's `lib/specstride_spec.py` is not in this
 * repository, so the serialization of the payload is taken to be the compact,
 * non-ASCII-keeping form of the canonical record text of the same annex
 * section rather than Python's `ensure_ascii=True` default. The two agree on
 * every payload whose title and criteria are ASCII. The parity tasks of the
 * later phases (T009 and on, fixtures FX-09, FX-10) compare the value against
 * the reference and settle it; `FIXTURES.md` records that no golden capture
 * exists yet.
 */
export function phaseShape(input: unknown): string {
  const phase = input as PhaseShapeInput;
  const payload = [
    phase.number,
    collapseWhiteSpace(phase.title),
    [...phase.criteria].map(collapseWhiteSpace),
  ];
  return contentHash(canonicalRecordText(payload)).slice(0, PHASE_SHAPE_LENGTH);
}

/* ------------------------------------------------------------------ *
 * The two hashes whose rules belong to their owners.
 * ------------------------------------------------------------------ */

/**
 * The obligation id, over the text feature 107 forms (F107-FR-004). This
 * module returns the CONTENT HASH of that text and nothing more: the prefix
 * `OBL-` and the cut to twelve hexadecimal characters are feature 107's rule,
 * which the hasher does not hold (annex X §X.5, as amended on 2026-09-30;
 * F104-FR-021: "this feature builds neither and holds no rule of theirs").
 */
export function obligationId(text: string): string {
  return contentHash(text);
}

/**
 * The signature of unmet criteria, over the text feature 101 forms
 * (F101-FR-019). As with the obligation id, this module returns the content
 * hash of that text and holds no rule of feature 101's.
 */
export function unmetCriteriaSignature(text: string): string {
  return contentHash(text);
}

/* ------------------------------------------------------------------ *
 * The classification of the staleness verdict (F104-FR-024, F104-FR-027).
 *
 * T036 moved the rules into `staleness.ts`, a module of this folder that
 * imports `@specstride/contracts` ALONE — no `node:crypto`, no `node:fs` — so
 * that "it reads no file" is measurable on the file and not only stated. Every
 * name is re-exported here, so the hasher stays ONE module to its callers
 * (`@specstride/kernel/hasher`) and `canonicalHasher` below still carries the
 * operation of annex X §X.5.
 * ------------------------------------------------------------------ */

export {
  CLOSED_SET_OF_THE_KINDS_OF_SOURCE,
  CLOSED_SET_OF_THE_NAMES_OF_THE_RUN_VERDICT,
  CLOSED_SET_OF_THE_STATES_OF_A_SOURCE,
  KIND_WITH_A_CHECKBOX_INSENSITIVE_HASH,
  KINDS_OF_SOURCE,
  NAME_RULES,
  NAMES_OF_THE_RUN_VERDICT,
  STALENESS_ANNEX_SECTION,
  STALENESS_DEPENDS_ON_WHEN_IT_IS_ASKED,
  STALENESS_READS_A_FILE,
  STALENESS_REQUIREMENTS,
  STATES_OF_A_SOURCE,
  changedNames,
  classifySources,
  classifyStaleness,
  verdictOf,
} from "./staleness.ts";

export type { ClassifiedSource, ClassifyOptions, NameRule } from "./staleness.ts";

/* ------------------------------------------------------------------ *
 * The hasher as one value.
 * ------------------------------------------------------------------ */

/**
 * The canonical hasher of the product: the one implementation of feature
 * 100's `CanonicalHasher` (annex X §X.5; F100-FR-207). Every caller of a hash
 * calls this value or the functions above, and no caller writes a hash of its
 * own.
 */
export const canonicalHasher: CanonicalHasher = Object.freeze({
  contentHash,
  canonicalRecordText,
  taskListHashIgnoringCheckboxes,
  canonicalRecordHash,
  phaseShape,
  obligationId,
  unmetCriteriaSignature,
  classifyStaleness,
});
