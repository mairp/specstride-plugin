/**
 * T028 — PHASE ACCESS and VALIDATION (F104-FR-014, F104-FR-015), and the
 * `parse` of EP-03 that both stand on (F104-FR-010).
 *
 * This module holds NO grammar. Every phase heading, criteria block and task
 * line is read by one of the three adapters of `adapters/`, reached through
 * `grammarOf`; what is here is the model built from a grammar's phases, the
 * access to a phase by number, and the findings, whose as-is texts each
 * adapter states for its own format.
 *
 * The records it is measured against, read by research report R18 at their
 * lines of `lib/specstride_spec.py`:
 *
 *  - B-2040 `slice_phase()`, the importable form the critic uses, returns the
 *    section STRIPPED; the command line's `slice` returns it UNSTRIPPED;
 *  - B-2041 the phase shape, 16 hexadecimal characters, which a tick never
 *    changes — computed by the one hasher of `@specstride/kernel`, never here;
 *  - B-2042 a title read from a SECTION alone is read as native, then Spec
 *    Kit, then priority, then the OpenSpec form;
 *  - B-2057 a missing phase gives an empty slice, title or shape, not an error;
 *  - B-2001 `validate` exits 3 on an invalid spec;
 *  - B-0367 the shim prints `spec not found: <path>` for a missing file and
 *    otherwise the phase count.
 */
import { readFileSync } from "node:fs";
import { phaseShape } from "@specstride/kernel/hasher";
import {
  type CanonicalSpecModel,
  type FormatName,
  type ModelFormatName,
  type PhaseView,
  type SpecFinding,
  type SpecGrammar,
  type SpecPhase,
  type SpecSource,
  CRITERIA_HEADING,
  isValid,
  phaseOf,
  phaseViews,
} from "./model.ts";
import { grammarOf } from "./adapters/index.ts";
import * as native from "./adapters/native.ts";
import * as speckit from "./adapters/speckit-tasks.ts";
import * as openspec from "./adapters/openspec-change.ts";
import { UnknownFormatError, specModuleNotFound } from "./errors.ts";
import { readSpecText } from "./registry.ts";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F104-FR-010", "F104-FR-014", "F104-FR-015"] as const;

/** The records of the baseline it is measured against. */
export const BEHAVIOUR_ROWS = Object.freeze([
  "B-2040",
  "B-2041",
  "B-2042",
  "B-2057",
  "B-2001",
  "B-0367",
]);

/* ------------------------------------------------------------------ *
 * `parse` (F104-FR-010).
 * ------------------------------------------------------------------ */

/** What `parse` is given. `sources` is T035's (phase 5); the grammar is here. */
export type ParseInput = {
  /** The repository-relative path of the spec, as a task's `file`. */
  readonly file: string;
  /** The text of the spec file. */
  readonly text: string;
  /**
   * The format, already detected once and handed on (F104-FR-007, D-8). An
   * ADDED format of F104-FR-009 brings its own name and its own grammar, which
   * is why the field is `ModelFormatName` and not one of the three literals.
   */
  readonly format: ModelFormatName;
  /** The feature slug, derived once by the rule of F104-FR-003. */
  readonly feature: string;
  /**
   * The recorded sources. `inputs` of T035 (`sources.ts`, phase 5) builds
   * them; `parse` takes them, because only a RECORDED source can be stale
   * (`data-model.md`) and the grammar has nothing to say about a hash.
   */
  readonly sources?: readonly SpecSource[] | undefined;
};

/**
 * F104-FR-010 — the canonical model. A PURE function of its input: it reads no
 * file, asks no clock and holds no state. `format` is never the alias
 * `openspec`, because `grammarOf` resolves the alias and the model carries the
 * adapter's own registered name.
 */
export function parse(input: ParseInput, grammar?: SpecGrammar): CanonicalSpecModel {
  const resolved = grammar ?? grammarOf(input.format);
  if (resolved === undefined) throw new UnknownFormatError(input.format, []);
  return Object.freeze({
    format: input.format,
    feature: input.feature,
    sources: input.sources ?? Object.freeze([]),
    phases: resolved.phasesOf(input.text, input.file),
  });
}

/**
 * `parse` over a FILE. The read is the only impure step, and it is kept apart
 * from `parse` itself for that reason. A file that cannot be read is
 * `unreadable-file` of F104-FR-018 (`spec: <operating-system error>`, B-2000).
 */
export function parseFile(
  path: string,
  options: Omit<ParseInput, "text">,
  grammar?: SpecGrammar,
): CanonicalSpecModel {
  return parse({ ...options, text: readSpecText(path) }, grammar);
}

/** The four-field view of every phase, the projection the oracle pins. */
export { phaseViews };
export type { PhaseView };

/* ------------------------------------------------------------------ *
 * Phase access (F104-FR-014).
 * ------------------------------------------------------------------ */

/** F104-FR-014, B-2057 — a missing phase gives an EMPTY text, never an error. */
export const EMPTY = "" as const;

/** F104-FR-014 — the phase numbers, in document order. */
export function numbersOf(model: CanonicalSpecModel): readonly number[] {
  return Object.freeze(model.phases.map((p) => p.number));
}

/** F104-FR-014 — the title of a phase; empty for a phase that does not exist. */
export function titleOf(model: CanonicalSpecModel, number: number): string {
  return phaseOf(model, number)?.title ?? EMPTY;
}

/**
 * F104-FR-014, B-2040 — the RAW section: the unstripped text followed by ONE
 * newline. This is what `spec slice` prints. A phase that does not exist gives
 * the empty string.
 */
export function rawSliceOf(model: CanonicalSpecModel, number: number): string {
  const phase = phaseOf(model, number);
  if (phase === undefined) return EMPTY;
  return `${phase.section}\n`;
}

/**
 * F104-FR-014, B-2040 — the section callers such as the critic use: STRIPPED.
 * The two readings of one section are the whole of B-2040, so both are here
 * and a test measures that they differ on a section with trailing blank lines.
 */
export function sectionOf(model: CanonicalSpecModel, number: number): string {
  return phaseOf(model, number)?.section.trim() ?? EMPTY;
}

/** F104-FR-014 — the criteria of a phase; empty for a phase that does not exist. */
export function criteriaOf(model: CanonicalSpecModel, number: number): readonly string[] {
  return phaseOf(model, number)?.criteria ?? Object.freeze([]);
}

/**
 * F104-FR-014, B-2041 — the phase shape: 16 hexadecimal characters of the ONE
 * hasher of `@specstride/kernel`, over the number, the title and the criteria.
 * A tick never changes it, because a tick changes none of the three. A phase
 * that does not exist gives the empty string, not an error (B-2057).
 *
 * The shape is NOT computed here: the hasher owns every hash of the product
 * (F104-FR-021), and this module only hands it the three fields.
 */
export function shapeOf(model: CanonicalSpecModel, number: number): string {
  const phase = phaseOf(model, number);
  if (phase === undefined) return EMPTY;
  return phaseShape({ number: phase.number, title: phase.title, criteria: phase.criteria });
}

/** F104-FR-014 — the heading the criteria of a phase are shown under, per format. */
export function criteriaHeadingOf(format: FormatName): string {
  return CRITERIA_HEADING[format];
}

/**
 * F104-FR-014, B-2042 — a title read from a SECTION alone, with no model and
 * no format: native first, then `speckit-tasks`, then the priority form, then
 * the OpenSpec form. The four steps are written out in that order, each a call
 * into the adapter that owns the form; the first that answers wins.
 */
export const TITLE_OF_A_SECTION_ORDER = [
  "native",
  "speckit-tasks",
  "priority",
  "openspec-change",
] as const;

export type TitleOfASectionStep = (typeof TITLE_OF_A_SECTION_ORDER)[number];

/** The reader of each step of B-2042, in the order the row states them. */
export const TITLE_READERS: Readonly<
  Record<TitleOfASectionStep, (section: string) => string | undefined>
> = Object.freeze({
  native: native.titleOfASection,
  "speckit-tasks": speckit.titleOfAnExplicitSection,
  priority: speckit.titleOfAPrioritySection,
  "openspec-change": openspec.titleOfASection,
});

/** F104-FR-014, B-2042 — the title of a bare section, and which step read it. */
export function titleOfASectionWithStep(
  section: string,
): { readonly title: string; readonly step: TitleOfASectionStep } | undefined {
  for (const step of TITLE_OF_A_SECTION_ORDER) {
    const title = TITLE_READERS[step](section);
    if (title !== undefined) return Object.freeze({ title, step });
  }
  return undefined;
}

/** F104-FR-014, B-2042 — the title of a bare section; empty where none is read. */
export function titleOfASection(section: string): string {
  return titleOfASectionWithStep(section)?.title ?? EMPTY;
}

/* ------------------------------------------------------------------ *
 * Validation (F104-FR-015).
 * ------------------------------------------------------------------ */

/**
 * F104-FR-015 — the findings of a model. A spec is valid only when there are
 * NONE. The texts are the adapters': the native ones of B-2002 to B-2005, the
 * Spec Kit ones of B-2006 and B-2007, the OpenSpec ones of B-2008 and B-2009.
 */
export function validate(
  model: CanonicalSpecModel,
  text: string,
  grammar?: SpecGrammar,
): readonly SpecFinding[] {
  const resolved = grammar ?? grammarOf(model.format);
  if (resolved === undefined) throw new UnknownFormatError(model.format, []);
  return resolved.findingsOf(model.phases, text);
}

/** F104-FR-015 — a spec is valid only when `validate` returns no finding. */
export { isValid };

/** F104-FR-015 — on success the PHASE COUNT is reported (B-0367, B-1982). */
export function phaseCountOf(model: CanonicalSpecModel): number {
  return model.phases.length;
}

/** F104-FR-015 — a missing file gives `spec not found: <path>` (B-0367). */
export { specModuleNotFound };

/** `validate` exits 3 on an invalid spec (B-2001, F104-FR-020). */
export const EXIT_OF_AN_INVALID_SPEC = 3 as const;

/** `validate` exits 0 on a valid spec. */
export const EXIT_OF_A_VALID_SPEC = 0 as const;

/** What `spec validate` reports: the phase count, or the findings and exit 3. */
export type ValidationReport = {
  readonly valid: boolean;
  /** The phase count, on success. */
  readonly phaseCount: number;
  /** One finding per line of the error stream, on failure. */
  readonly findings: readonly SpecFinding[];
  readonly exit: number;
};

/**
 * F104-FR-015, F104-FR-020, B-1982 — the whole of `spec validate` over a FILE:
 * a missing file is `spec not found: <path>` with exit 3; otherwise the phase
 * count and exit 0, or every finding on its own line and exit 3.
 */
export function validateFile(
  path: string,
  options: Omit<ParseInput, "text">,
  grammar?: SpecGrammar,
): ValidationReport {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return Object.freeze({
      valid: false,
      phaseCount: 0,
      findings: Object.freeze([
        { severity: "fail" as const, message: specModuleNotFound(path), path },
      ]),
      exit: EXIT_OF_AN_INVALID_SPEC,
    });
  }
  const model = parse({ ...options, text }, grammar);
  const findings = validate(model, text, grammar);
  return Object.freeze({
    valid: isValid(findings),
    phaseCount: phaseCountOf(model),
    findings,
    exit: isValid(findings) ? EXIT_OF_A_VALID_SPEC : EXIT_OF_AN_INVALID_SPEC,
  });
}

/** The phases of a model, for a caller that wants the record itself. */
export function phasesOf(model: CanonicalSpecModel): readonly SpecPhase[] {
  return model.phases;
}
