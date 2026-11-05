/**
 * T026 — the `openspec-change` adapter: the as-is OpenSpec grammar
 * (F104-FR-013) and its findings (F104-FR-015).
 *
 * The records it is measured against, each read at its line of
 * `lib/specstride_spec.py` by research report R18:
 *
 *  - B-2031 the phase heading, `## <digits>` with an optional `.` or `)`, then
 *    a title;
 *  - B-2032 the task line, a checkbox followed by a DOTTED id `N.N[.N…]`; the
 *    criterion is `<id> <text>`, and a checkbox WITHOUT such an id is not a
 *    criterion;
 *  - B-2008, B-2009 the two findings of this format;
 *  - B-2054 an OpenSpec change IS ticked (unlike native and the priority form).
 *
 * The name `openspec` selects this grammar (F104-FR-006); the alias is
 * resolved by the registry, and a MODEL's `format` is never `openspec`
 * (`data-model.md`). The dotted id is also the second form of the hasher's
 * mark rule, so that the engine's own tick of an OpenSpec change never makes a
 * run stale (F104-FR-022, research D-4, DV-118).
 */
import {
  type SpecFinding,
  type SpecGrammar,
  type SpecPhase,
  type SpecTask,
  CRITERIA_HEADING,
  DOTTED_TASK_ID,
  type Level2Section,
  level2SectionsOf,
  linesOf,
  readCheckboxLine,
  structuredTaskOfLine,
  textOfSection,
} from "../model.ts";
import { duplicateAndContiguityFindings, finding } from "./native.ts";

/**
 * B-2004 and B-2005 are "(all formats)", and `finding` is the one shape of a
 * finding: all three are re-exported here rather than restated, so that the
 * sharing is OBSERVABLE (the parity test of T018 compares the three adapters'
 * exports by identity) and a second copy of either text cannot appear.
 */
export { duplicateAndContiguityFindings, finding };

/** The name of the format this module is the grammar of. */
export const FORMAT = "openspec-change" as const;

/** The name that also selects this grammar (F104-FR-006, F104-FR-013). */
export const ALIAS = "openspec" as const;

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F104-FR-013", "F104-FR-014", "F104-FR-015", "F104-FR-017"] as const;

/** The records of the baseline it is measured against. */
export const BEHAVIOUR_ROWS = Object.freeze([
  "B-2031",
  "B-2032",
  "B-2008",
  "B-2009",
  "B-2046",
  "B-2054",
]);

/**
 * B-2031 — the phase heading: `## <digits>` with an optional `.` or `)`, then
 * a title. Group 1 is the number, group 2 the title.
 */
export const PHASE_HEADING = /^##[ \t]*(\d+)[.)]?[ \t]*(.*)$/;

/** The two closers B-2031 allows after the number. */
export const HEADING_CLOSERS = Object.freeze([".", ")"]);

/**
 * B-2032 — a task line: a checkbox followed by a dotted id. The id is exported
 * through `model.ts` (`DOTTED_TASK_ID`), because the hasher's mark rule needs
 * the same form (F104-FR-022).
 */
export { DOTTED_TASK_ID };

/** The phase number of a heading line, or `undefined` where it is none. */
export function phaseNumberOfHeading(headingLine: string): number | undefined {
  const found = PHASE_HEADING.exec(headingLine);
  if (found === null) return undefined;
  return Number.parseInt(found[1] as string, 10);
}

/** B-2031 — the title of an OpenSpec phase heading. */
export function titleOfHeading(headingLine: string): string {
  const found = PHASE_HEADING.exec(headingLine);
  if (found === null) return "";
  return (found[2] as string).trimEnd();
}

/**
 * B-2032 — the criterion of a line, or `undefined`. The criterion is
 * `<id> <text>`: the dotted id and the rest of the line, joined by one space.
 * A checkbox WITHOUT a dotted id is not a criterion, which is what separates
 * this format's criteria from the "every checkbox" rule of `speckit-tasks`.
 */
export function criterionOfLine(line: string): string | undefined {
  const box = readCheckboxLine(line);
  if (box === undefined) return undefined;
  const head = /^(\d+(?:\.\d+)+)(?![\p{L}\p{N}_.])[ \t]*/u.exec(box.text);
  if (head === null) return undefined;
  const id = head[1] as string;
  const rest = box.text.slice(head[0].length);
  return rest === "" ? id : `${id} ${rest}`;
}

/** B-2032 — the criteria of an OpenSpec section, in document order. */
export function criteriaOf(section: string): readonly string[] {
  return Object.freeze(
    linesOf(section)
      .map((line) => criterionOfLine(line))
      .filter((criterion): criterion is string => criterion !== undefined),
  );
}

/** The structured tasks of a section, with the file's own line numbers. */
export function tasksOf(section: Level2Section, file: string): readonly SpecTask[] {
  const tasks: SpecTask[] = [];
  section.lines.forEach((line, offset) => {
    const task = structuredTaskOfLine(line, section.headingLine + offset, file, "dotted-id");
    if (task !== undefined) tasks.push(task);
  });
  return Object.freeze(tasks);
}

/** F104-FR-013 — the phases of an OpenSpec change. A pure function of the text. */
export function phasesOf(text: string, file: string): readonly SpecPhase[] {
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
        tasks: tasksOf(section, file),
      }),
    );
  }
  return Object.freeze(phases);
}

/* ------------------------------------------------------------------ *
 * The findings of `validate` (F104-FR-015).
 * ------------------------------------------------------------------ */

/** B-2008 — the OpenSpec "zero phases" finding. */
export const ZERO_PHASES =
  'OpenSpec tasks.md has zero phases (need task-bearing "## <N>. <title>" sections)';

/** B-2009 — the OpenSpec "no task checkboxes" finding, per phase. */
export function noTaskCheckboxes(number: number, title: string): string {
  return `phase ${number} (${title}) has no OpenSpec task checkboxes ("- [ ] N.N ..." lines)`;
}

/**
 * F104-FR-015 — the OpenSpec findings: zero phases, then the per-phase
 * message in scan order, then the duplicate and contiguity messages of B-2004
 * and B-2005, which are "(all formats)".
 */
export function findingsOf(phases: readonly SpecPhase[], _text: string): readonly SpecFinding[] {
  if (phases.length === 0) return Object.freeze([finding(ZERO_PHASES)]);
  const findings: SpecFinding[] = [];
  for (const phase of phases) {
    if (phase.criteria.length === 0) {
      findings.push(finding(noTaskCheckboxes(phase.number, phase.title)));
    }
  }
  findings.push(...duplicateAndContiguityFindings(phases.map((p) => p.number)));
  return Object.freeze(findings);
}

/** F104-FR-014, B-2042 — the title of a bare OpenSpec section, or `undefined`. */
export function titleOfASection(section: string): string | undefined {
  const heading = linesOf(section).find((line) => PHASE_HEADING.test(line));
  if (heading === undefined) return undefined;
  return titleOfHeading(heading);
}

/** F104-FR-017, B-2054 — an OpenSpec change MAY be ticked. */
export function mayBeTicked(_text: string): boolean {
  return true;
}

/** The `openspec-change` grammar. */
export const grammar: SpecGrammar = Object.freeze({
  name: FORMAT,
  taskIdForm: "dotted-id" as const,
  criteriaHeading: CRITERIA_HEADING[FORMAT],
  phasesOf,
  findingsOf,
  titleOfASection,
  mayBeTicked,
});
