/**
 * T024 — the `native` adapter: the as-is native grammar (F104-FR-011) and the
 * native findings of `validate` (F104-FR-015).
 *
 * The records this module is measured against, each read at its line of
 * `lib/specstride_spec.py` by research report R18:
 *
 *  - B-2017 the phase heading, `## Phase <digits>`, case-sensitive, column 0,
 *    spaces or tabs as separators;
 *  - B-2018 the title, the heading text after the number with the leading run
 *    of spaces and `-`, em dash or `:` separators removed;
 *  - B-2019 the section, from the heading to the next level-2 heading or the
 *    end of the file, trailing blank lines kept;
 *  - B-2020 the criteria block, `### Acceptance criteria` as a case-sensitive
 *    prefix, ending at the next line that starts with `###`;
 *  - B-2021 the checkbox syntax, which every format shares and `model.ts`
 *    therefore states once;
 *  - B-2022 the criteria are ONLY the checkbox lines inside that block;
 *  - B-2023 the order of the findings: per phase in scan order first, then
 *    duplicates and contiguity.
 *
 * A native phase carries NO task: the native grammar names criteria only
 * (B-2022) and a native spec is never ticked (F104-FR-017, B-2054). `tasks` is
 * therefore the empty list, which `data-model.md` allows ("Required; it may be
 * empty").
 */
import {
  type SpecFinding,
  type SpecGrammar,
  type SpecPhase,
  CRITERIA_HEADING,
  LEVEL_3_HEADING,
  level2SectionsOf,
  linesOf,
  readCheckboxLine,
  textOfSection,
} from "../model.ts";
import { ACCEPTANCE_CRITERIA_HEADING } from "../registry.ts";

/** The name of the format this module is the grammar of. */
export const FORMAT = "native" as const;

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F104-FR-011", "F104-FR-014", "F104-FR-015"] as const;

/** The records of the baseline it is measured against. */
export const BEHAVIOUR_ROWS = Object.freeze([
  "B-2017",
  "B-2018",
  "B-2019",
  "B-2020",
  "B-2021",
  "B-2022",
  "B-2023",
  "B-2002",
  "B-2003",
  "B-2004",
  "B-2005",
]);

/**
 * B-2017 — `## Phase <digits>`, matched CASE-SENSITIVELY at column 0, with
 * spaces or tabs as the separators. Group 1 is the number, group 2 the rest of
 * the heading line, unstripped.
 *
 * A lower-case `## phase 1:` is NOT a phase heading: the grammar of
 * mixture-of-loops read one (B-2475, case-insensitive), the one grammar does
 * not, and that is divergence row DV-119 (CQ-045).
 */
export const PHASE_HEADING = /^##[ \t]+Phase[ \t]+(\d+)(.*)$/;

/** The separators B-2018 removes from the head of the title. */
export const TITLE_SEPARATORS = Object.freeze([" ", "\t", "-", "—", ":"]);

/** The leading run of those separators (B-2018). */
export const LEADING_TITLE_SEPARATORS = /^[ \t\-—:]+/;

/**
 * B-2003 names the "raw heading text". The as-is source is not in this
 * repository, so the recorded reading is: the heading text AFTER the number,
 * trimmed — which keeps the separator run (`— Setup`) that the title rule of
 * B-2018 removes (`Setup`), and so is the one text the two readings differ on.
 */
export function rawHeadingTextOf(headingLine: string): string {
  const found = PHASE_HEADING.exec(headingLine);
  if (found === null) return "";
  return (found[2] as string).trim();
}

/** B-2018 — the title of a native phase heading. */
export function titleOfHeading(headingLine: string): string {
  return rawHeadingTextOf(headingLine).replace(LEADING_TITLE_SEPARATORS, "").trimEnd();
}

/** The phase number of a heading line, or `undefined` where it is none. */
export function phaseNumberOfHeading(headingLine: string): number | undefined {
  const found = PHASE_HEADING.exec(headingLine);
  if (found === null) return undefined;
  return Number.parseInt(found[1] as string, 10);
}

/**
 * B-2020 — whether a native section holds an `### Acceptance criteria` block.
 * A block that is EMPTY of checkboxes is still a block, and so still valid
 * (B-2003, F104-FR-015).
 */
export function hasACriteriaBlock(section: string): boolean {
  return linesOf(section).some((line) => ACCEPTANCE_CRITERIA_HEADING.test(line));
}

/**
 * B-2020, B-2022 — the criteria of a native section: the TEXT of the checkbox
 * lines inside the acceptance-criteria block, which ends at the next line that
 * starts with `###`.
 */
export function criteriaOf(section: string): readonly string[] {
  const criteria: string[] = [];
  let inside = false;
  for (const line of linesOf(section)) {
    if (inside && LEVEL_3_HEADING.test(line)) break;
    if (!inside) {
      if (ACCEPTANCE_CRITERIA_HEADING.test(line)) inside = true;
      continue;
    }
    const box = readCheckboxLine(line);
    if (box !== undefined) criteria.push(box.text);
  }
  return Object.freeze(criteria);
}

/** F104-FR-011 — the phases of a native spec. A pure function of the text. */
export function phasesOf(text: string, _file: string): readonly SpecPhase[] {
  const phases: SpecPhase[] = [];
  for (const section of level2SectionsOf(text)) {
    const number = phaseNumberOfHeading(section.heading);
    if (number === undefined) continue;
    const body = textOfSection(section);
    phases.push(
      Object.freeze({
        number,
        title: titleOfHeading(section.heading),
        section: body,
        criteria: criteriaOf(body),
        // The native grammar names no task line (B-2022) and a native spec is
        // never ticked (B-2054), so a native phase carries no task.
        tasks: Object.freeze([]),
      }),
    );
  }
  return Object.freeze(phases);
}

/* ------------------------------------------------------------------ *
 * The findings of `validate` (F104-FR-015).
 *
 * The four texts below are the as-is texts of B-2002 to B-2005. They are
 * SHARED by the three formats where the requirement shares them: the duplicate
 * and the contiguity finding are "(all formats)" in B-2004 and B-2005, so
 * `duplicateAndContiguityFindings` is exported and the two task formats call
 * it rather than restating the texts.
 * ------------------------------------------------------------------ */

/** B-2002 — the native "zero phases" finding. */
export const ZERO_PHASES = 'spec has zero phases (need at least one "## Phase <N>")';

/** B-2003 — the native "no criteria block" finding, per phase. */
export function noCriteriaBlock(number: number, rawHeadingText: string): string {
  return `phase ${number} (${rawHeadingText}) has no "### Acceptance criteria" block`;
}

/** B-2004 — the duplicate finding, in EVERY format. */
export function duplicatePhaseNumber(number: number): string {
  return `duplicate phase number: ${number}`;
}

/** B-2005 — the contiguity finding, in EVERY format; the first number is free. */
export function nonContiguousPhases(previous: number, next: number): string {
  return `non-contiguous phases: ${next} follows ${previous} (must ascend by 1)`;
}

/** A finding of `validate`; every finding of F104-FR-015 fails the spec. */
export function finding(message: string): SpecFinding {
  return Object.freeze({ severity: "fail" as const, message });
}

/**
 * B-2004, B-2005 — the duplicate and contiguity findings over the phase
 * numbers in document order. The FIRST number is free (0, 1 or any); after it
 * every number must ascend by 1. A duplicate also yields the non-contiguous
 * message, which B-2004 states outright.
 */
export function duplicateAndContiguityFindings(numbers: readonly number[]): readonly SpecFinding[] {
  const findings: SpecFinding[] = [];
  const seen = new Set<number>();
  numbers.forEach((number, index) => {
    if (seen.has(number)) findings.push(finding(duplicatePhaseNumber(number)));
    seen.add(number);
    if (index === 0) return;
    const previous = numbers[index - 1] as number;
    if (number !== previous + 1) findings.push(finding(nonContiguousPhases(previous, number)));
  });
  return Object.freeze(findings);
}

/**
 * F104-FR-015, B-2023 — the native findings: the per-phase missing-criteria
 * messages first, in scan order, THEN the duplicate and contiguity messages.
 */
export function findingsOf(phases: readonly SpecPhase[], _text: string): readonly SpecFinding[] {
  if (phases.length === 0) return Object.freeze([finding(ZERO_PHASES)]);
  const findings: SpecFinding[] = [];
  for (const phase of phases) {
    if (!hasACriteriaBlock(phase.section)) {
      const heading = linesOf(phase.section)[0] ?? "";
      findings.push(finding(noCriteriaBlock(phase.number, rawHeadingTextOf(heading))));
    }
  }
  findings.push(...duplicateAndContiguityFindings(phases.map((p) => p.number)));
  return Object.freeze(findings);
}

/** F104-FR-014, B-2042 — the title of a bare native section, or `undefined`. */
export function titleOfASection(section: string): string | undefined {
  const heading = linesOf(section).find((line) => PHASE_HEADING.test(line));
  if (heading === undefined) return undefined;
  return titleOfHeading(heading);
}

/** F104-FR-017, B-2054 — a native spec is NEVER ticked. */
export function mayBeTicked(_text: string): boolean {
  return false;
}

/** The `native` grammar, as `validate.ts`, `tick.ts` and `context.ts` use it. */
export const grammar: SpecGrammar = Object.freeze({
  name: FORMAT,
  // Native holds no task line; the form is named so that the record is total.
  taskIdForm: "T-id" as const,
  criteriaHeading: CRITERIA_HEADING[FORMAT],
  phasesOf,
  findingsOf,
  titleOfASection,
  mayBeTicked,
});
