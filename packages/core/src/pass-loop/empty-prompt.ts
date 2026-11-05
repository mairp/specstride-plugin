/**
 * T016 of feature 103 — the EMPTY-PROMPT TEST, in time that grows linearly
 * with the size of the prompt (F103-FR-006, F103-FR-008; divergence DV-087;
 * ruling K7).
 *
 * ## What was wrong, and what an observer sees
 *
 * The baseline tested the prompt for emptiness at `proposer.sh:1807` with a
 * shell construct that EXPANDS the whole prompt per candidate character. In a
 * UTF-8 locale that cost 2 s at 20 kB, 33 s at 80 kB and 548 s observed at
 * 319 kB — about nine minutes of processor time before every start of a
 * proposer on a large prompt (`research/R28-netops-run-stuck-diagnosis.md`).
 *
 * F103-FR-008 fixes the COST and nothing else. What an observer sees is
 * unchanged: a prompt that holds only white space is refused exactly as
 * F103-FR-006 says, with `exit_code` 1 and the line
 * `proposer.sh: prompt is empty`, so no fixture differs. This is why the fix
 * is a divergence of COST (DV-087) and not of behaviour.
 *
 * ## Why this is linear, and why it is not a regular expression
 *
 * `promptIsEmpty` is ONE forward scan that returns at the first code point
 * that is not white space. It therefore costs O(1) on a prompt whose first
 * character is text — the common case, since a prompt starts with its standing
 * block — and O(n) in the worst case, a prompt that really is all white space.
 * It allocates nothing: no copy of the prompt, no split, no match object, no
 * trimmed string. A `prompt.trim().length === 0` would be linear too but would
 * COPY the prompt; on a 320 kB prompt that is a 320 kB allocation per pass for
 * an answer a scan gives without one, and the allocation is what
 * F103-FR-008's budget of 1 s of processor time at 320 kB is measured against.
 *
 * A regular expression is deliberately avoided: `/^\s*$/` over a long prompt
 * is the shape that backtracks on some engines, and the cost of the construct
 * the baseline used is the very defect this task removes. The scan has no
 * state to backtrack over.
 *
 * ## Which code points count as white space
 *
 * The baseline's test was the shell's, in the locale of the run. The set kept
 * here is the one of `String.prototype.trim` — the Unicode `White_Space`
 * property plus the line terminators — so that a prompt of non-breaking spaces
 * or of an ideographic space reads as empty on every host and in every locale.
 * `WHITE_SPACE_CODE_POINTS` names the set, and `isWhiteSpaceCodePoint` is the
 * one test; the locale of the host changes nothing.
 */

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F103-FR-006", "F103-FR-008"] as const;

/** The divergence row of the fix: a divergence of cost, not of behaviour. */
export const DIVERGENCE_ROW = "DV-087" as const;

/** The site of the defect at the baseline, for the record. */
export const DEFECT_SITE = "proposer.sh:1807" as const;

/** What an observer sees is unchanged: the refusal of F103-FR-006 stands. */
export const WHAT_AN_OBSERVER_SEES_CHANGES = false as const;

/** F103-FR-006 — the as-is line of a prompt that holds only white space. */
export const EMPTY_PROMPT_LINE = "proposer.sh: prompt is empty" as const;

/** F103-FR-006 — the result of a prompt that holds only white space. */
export const EMPTY_PROMPT_EXIT_CODE = 1 as const;

/**
 * F103-FR-006 — the order: the check for phase evidence comes FIRST, and the
 * empty-prompt refusal only after it. A resume that goes straight to the
 * critic therefore ends with 0 even when the prompt is empty.
 */
export const EVIDENCE_IS_CHECKED_FIRST = true as const;

/** The measured cost of the baseline's construct, for the record (R28). */
export const BASELINE_COST_SECONDS: Readonly<Record<number, number>> = Object.freeze({
  20_480: 2,
  81_920: 33,
  326_656: 548,
});

/** F103-SC-004 — the budget of the fix at 320 kB, in seconds of processor time. */
export const BUDGET_SECONDS_AT_320_KB = 1 as const;

/**
 * The white-space code points, as `String.prototype.trim` defines them: the
 * Unicode `White_Space` property, the line terminators, and the byte-order
 * mark. Named so that a reader can see the set and a test can assert it.
 */
export const WHITE_SPACE_CODE_POINTS: readonly number[] = Object.freeze([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
  0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
]);

const WHITE_SPACE = new Set<number>(WHITE_SPACE_CODE_POINTS);

/** True when the code point is white space by the set above. */
export function isWhiteSpaceCodePoint(codePoint: number): boolean {
  return WHITE_SPACE.has(codePoint);
}

/**
 * F103-FR-006 and F103-FR-008 — true when the prompt holds only white space.
 *
 * One forward scan, no allocation, no regular expression, no copy of the
 * prompt. It returns at the FIRST code unit that is not white space, so the
 * cost is bounded by the size of the prompt and never exceeds it.
 *
 * The scan walks code UNITS and not code points on purpose: no white-space
 * code point of the set above lies outside the Basic Multilingual Plane, so a
 * surrogate half is never white space, and reading units lets the scan avoid
 * the code-point iterator's allocation per step.
 */
export function promptIsEmpty(prompt: string): boolean {
  const length = prompt.length;
  for (let at = 0; at < length; at += 1) {
    if (!WHITE_SPACE.has(prompt.charCodeAt(at))) return false;
  }
  return true;
}

/** The number of code units the scan read before it decided; for a measurement. */
export function codeUnitsScanned(prompt: string): number {
  const length = prompt.length;
  for (let at = 0; at < length; at += 1) {
    if (!WHITE_SPACE.has(prompt.charCodeAt(at))) return at + 1;
  }
  return length;
}

/** The decision of the empty-prompt test, as the loop reads it. */
export type EmptyPromptDecision =
  | { readonly refused: false }
  | {
      readonly refused: true;
      readonly exit_code: typeof EMPTY_PROMPT_EXIT_CODE;
      readonly line: typeof EMPTY_PROMPT_LINE;
    };

/**
 * F103-FR-006 — the refusal as the loop takes it: `exit_code` 1 and the line
 * `proposer.sh: prompt is empty`, or nothing to do. The caller has already
 * checked for phase evidence (`EVIDENCE_IS_CHECKED_FIRST`).
 */
export function checkPrompt(prompt: string): EmptyPromptDecision {
  if (!promptIsEmpty(prompt)) return Object.freeze({ refused: false as const });
  return Object.freeze({
    refused: true as const,
    exit_code: EMPTY_PROMPT_EXIT_CODE,
    line: EMPTY_PROMPT_LINE,
  });
}
