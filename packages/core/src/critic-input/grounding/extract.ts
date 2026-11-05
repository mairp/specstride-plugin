// Feature 117 (T034) — the citation extractor of F117-FR-003 (and the
// citation record of the data model).
//
// The as-is extraction rules live in `grounding.ts`, the source extracted
// from the Lisa baseline at `363e6a3` and brought to F117-FR-003 (T001);
// this module is the typed surface the rest of the feature builds on. It is
// PURE: no port, no file system, no import beyond the sibling module and the
// budget data. Globs are NOT expanded here (F117-FR-010, research D-1) — a
// wildcard is only LABELLED as one; it is expanded when the snapshot is
// built (`snapshot.ts`).

import { isAbsolute } from "node:path";
import budgetsData from "../data/budgets.json" with { type: "json" };
import { expandBraceCitation, extractPaths, GROUNDING_MAX_FILES } from "./grounding.ts";

/** The extraction cap: three times the cap of presence lines per text (F117-FR-003). */
export const EXTRACTION_CAP = GROUNDING_MAX_FILES * budgetsData.extractionCapFactor;

/** Where a citation came from (the data model, field `source`). */
export type CitationSource = "evidence" | "section" | "carried" | "directory";

/** The form of a citation as cited (the data model, field `form`). */
export type CitationForm = "relative" | "absolute" | "wildcard" | "placeholder";

/** One citation candidate, as the data model of the plan describes it. */
export interface Citation {
  /** The text as cited, after locators and trailing characters were stripped. */
  readonly token: string;
  /** Where the citation was extracted from. */
  readonly source: CitationSource;
  /** True when the citation is a priority path (F117-FR-004). */
  readonly priority: boolean;
  /** The form of the citation as cited. */
  readonly form: CitationForm;
}

/** The form of a token as cited. Globs are labelled, never expanded (D-1). */
export function formOf(token: string): CitationForm {
  if (/[*?[]/.test(token)) return "wildcard";
  if (/^<[^<>/\n]{1,40}>$/.test(token)) return "placeholder";
  if (isAbsolute(token)) return "absolute";
  return "relative";
}

/**
 * Extract the citation candidates of one text, in order, each with its form.
 * Stops after `EXTRACTION_CAP` candidates (F117-FR-003). Every rule — the
 * locators, the ellipsis prefix, the trailing characters, the brace shorthand
 * of at most 16 alternatives, the scheme/whitespace/`@v` drops, the dotfile
 * rule, the extension rule and the drop of a bare token that does not
 * resolve — is the as-is rule of `grounding.ts` and is tested there and by
 * the parity tests of this feature.
 */
export function extractCitations(text: string, source: CitationSource = "evidence"): Citation[] {
  return extractPaths(text)
    .slice(0, EXTRACTION_CAP)
    .map((token) => ({ token, source, priority: false, form: formOf(token) }));
}

export { expandBraceCitation, extractPaths };
