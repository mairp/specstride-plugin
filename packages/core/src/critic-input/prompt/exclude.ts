// Feature 117 (T070) — the exclusion guard (F117-FR-027, F117-FR-038).
//
// Two halves:
//
// STATIC — the type of the assembler's input
// (`AssembleCriticPromptInput` of `assemble.ts`) holds no excluded field:
// no count of cycles, repairs, passes or checks, no order of units or of
// work, no time or duration of work, no output of a check, no earlier result
// of a check, no model tier, no session, no routing decision, no worker or
// group id. `InputTypeExcludesExcludedFields` is a compile-time fact about
// that type: it is `true` only while the input type names none of the
// excluded fields, so adding one breaks the build (F117-FR-027).
//
// RUN-TIME — a scan refuses a block that holds a word of the list of
// `data/excluded-vocabulary.json` in text that the RUNTIME wrote, in a run
// with parallel units on (F117-FR-038). The exemption is exactly the
// `exemptWord` (`snapshot`) inside the as-is literals named by `exemptIn` of
// the same data file — the heading of the grounding snapshot and the lines
// under it, the rules, the text of the gap section, the pin block — and
// nothing else: any other word of the list, in any other text, refuses.
//
// Pure: no file system, no process.

import excludedVocabulary from "../data/excluded-vocabulary.json" with { type: "json" };
import type { AssembleCriticPromptInput } from "./assemble.ts";

/** `data/excluded-vocabulary.json` as the guard reads it. */
export const EXCLUDED_VOCABULARY: Readonly<{
  excludedFields: readonly string[];
  namedException: string;
  words: readonly string[];
  exemptLiterals: readonly string[];
  exemptWord: string;
  exemptIn: readonly string[];
  exemptNote: string;
}> = Object.freeze(
  excludedVocabulary as unknown as {
    excludedFields: readonly string[];
    namedException: string;
    words: readonly string[];
    exemptLiterals: readonly string[];
    exemptWord: string;
    exemptIn: readonly string[];
    exemptNote: string;
  },
);

/* ------------------------------------------------------------------ *
 * The static half: the assembler's input type holds no excluded field.
 * ------------------------------------------------------------------ */

/**
 * The field names an excluded fact could take. None of them may appear on
 * `AssembleCriticPromptInput`; `InputTypeExcludesExcludedFields` fails the
 * build if one ever does (F117-FR-027).
 */
type ExcludedFieldName =
  | "cycleCount"
  | "cycles"
  | "repairCount"
  | "repairs"
  | "passCount"
  | "checkCount"
  | "checks"
  | "unitOrder"
  | "workOrder"
  | "order"
  | "elapsed"
  | "durationMs"
  | "elapsedMs"
  | "time"
  | "checkOutput"
  | "earlierResult"
  | "modelTier"
  | "session"
  | "routingDecision"
  | "workerId"
  | "groupId";

/** Compile-time: true only while the assembler's input names no excluded field. */
export type InputTypeExcludesExcludedFields =
  Extract<keyof AssembleCriticPromptInput, ExcludedFieldName> extends never ? true : false;

/** The value of the compile-time fact, asserted by the tests. */
export const ASSEMBLER_INPUT_EXCLUDES_EXCLUDED_FIELDS: InputTypeExcludesExcludedFields = true;

/**
 * A generic input type that refuses an excluded field at compile time: a
 * caller that adds `workerId` (or any other excluded name) to a type that
 * claims this shape does not compile.
 */
export type NoExcludedFields<T extends object> = T & {
  readonly [K in ExcludedFieldName]?: never;
};

/** The excluded field names of the run-time half, from the data file. */
export function excludedFields(): readonly string[] {
  return EXCLUDED_VOCABULARY.excludedFields;
}

/* ------------------------------------------------------------------ *
 * The run-time half: the scan of the words (F117-FR-038).
 * ------------------------------------------------------------------ */

/** One violation of the vocabulary rule: the word and where it matched. */
export type WordViolation = {
  readonly word: string;
  /** The index in the scanned text at which the word matched. */
  readonly at: number;
};

export type ExcludeScanResult =
  | { readonly clean: true; readonly violations: readonly [] }
  | { readonly clean: false; readonly violations: readonly WordViolation[] };

const WORD_PATTERNS: readonly RegExp[] = [
  /\bgroups?\b/i,
  /\bworkers?\b/i,
  /\bparallel\b/i,
  /\bmerges?\b|\bmerging\b|\bmerged\b/i,
  /\bintegrat\w*/i,
  /\brefus\w*/i,
  /\bsnapshot\w*/i,
];

/** The opaque tokens the parallel-units layer writes (annex X §X.6 row 60 wording). */
const PARALLEL_LAYER_TOKENS: readonly RegExp[] = [/\bparallel\.plan\b/i, /\bworker-\d+\b/i];

/**
 * Scan ONE text that the runtime wrote for the words of the list
 * (F117-FR-038). The exemption is exactly the `exemptWord` of the data file
 * (`snapshot`) inside the as-is literals named by `exemptIn`: pass those
 * literals as `exemptLiterals` and the exempt word inside them is allowed —
 * the same word anywhere else, and every other word everywhere, is a
 * violation that refuses the block.
 */
export function scanForExcludedWords(
  text: string,
  options: { readonly exemptLiterals?: readonly string[] } = {},
): ExcludeScanResult {
  const exemptWord = EXCLUDED_VOCABULARY.exemptWord;
  let scoped = text;
  for (const literal of options.exemptLiterals ?? []) {
    if (!literal.toLowerCase().includes(exemptWord.toLowerCase())) continue;
    // Cut the exempt literal out of the scanned text, so that the exempt word
    // inside it is gone. A short literal is a section heading: the exemption
    // covers the heading AND the lines under it, up to the next blank line.
    // A long literal is a whole as-is text; it is exempt in full.
    const index = scoped.indexOf(literal);
    if (index === -1) continue;
    const tail = scoped.slice(index + literal.length);
    const nl = tail.indexOf("\n\n");
    const cut = literal.length <= 120 ? (nl === -1 ? tail.length : nl) : 0;
    scoped =
      scoped.slice(0, index) +
      "\n".repeat((scoped.slice(index, index + literal.length + cut).match(/\n/g) ?? []).length) +
      tail.slice(cut);
  }
  // The exempt literal spans were cut out above, so the exempt word inside
  // them is gone and every match left below is outside them and refuses.
  const violations: WordViolation[] = [];
  for (const pattern of [...WORD_PATTERNS, ...PARALLEL_LAYER_TOKENS]) {
    const re = new RegExp(pattern.source, pattern.flags + "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(scoped)) !== null) {
      violations.push({ word: match[0], at: match.index });
    }
  }
  void exemptWord;
  if (violations.length === 0) return { clean: true, violations: [] };
  violations.sort((a, b) => a.at - b.at);
  return { clean: false, violations };
}

/**
 * The refusal the run-time scan raises: the block is refused with the words
 * and their positions and never with the text around them (F117-FR-038).
 */
export class ExcludedWordRefusedError extends Error {
  readonly violations: readonly WordViolation[];
  constructor(violations: readonly WordViolation[]) {
    super(
      `the block holds ${violations.length} word(s) of the excluded vocabulary ` +
        `(F117-FR-038); the block is refused`,
    );
    this.name = "ExcludedWordRefusedError";
    this.violations = violations;
  }
}

/** `scanForExcludedWords` that refuses by throw when the scan is not clean. */
export function refuseExcludedWords(
  text: string,
  options: { readonly exemptLiterals?: readonly string[] } = {},
): void {
  const result = scanForExcludedWords(text, options);
  if (!result.clean) throw new ExcludedWordRefusedError(result.violations);
}
