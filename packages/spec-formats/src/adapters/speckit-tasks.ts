/**
 * T025 — the `speckit-tasks` adapter: the as-is Spec Kit grammar
 * (F104-FR-012) and its findings (F104-FR-015).
 *
 * The records it is measured against, each read at its line of
 * `lib/specstride_spec.py` by research report R18:
 *
 *  - B-2024 the explicit heading, `## Phase <digits>` with an optional `:` and
 *    free title text;
 *  - B-2025 the priority form, `## P<N>` / `## p<N>` with an optional `-`, em
 *    dash or `:` separator;
 *  - B-2026 the criteria: every checkbox line with non-empty text ANYWHERE in
 *    the phase section, under any `###` heading, not only `T###` lines;
 *  - B-2027 the priority form's phases and their contiguous numbering;
 *  - B-2028 the level-2 sections after the last task-bearing group, appended
 *    to every phase's section as shared constraints;
 *  - B-2029 the priority title, which keeps the priority label;
 *  - B-2030 explicit headings win; the priority form is used only when no
 *    explicit phase exists;
 *  - B-2006, B-2007 the two findings of this format.
 *
 * Two readings are recorded in the code rather than chosen silently; both are
 * exported, so a test MEASURES where they differ.
 *
 *  1. **What makes a priority section a phase.** F104-FR-012, the authority,
 *     says "only sections that hold CHECKBOXES are phases"; B-2027 says "task
 *     checkboxes", and B-2007's text names `"- [ ] T### ..."` lines. The
 *     requirement is followed (`holdsACheckbox`); `holdsATaskCheckbox` carries
 *     the narrower reading.
 *  2. **Where the criteria and the tasks of a priority phase come from.** The
 *     shared constraints of B-2028 are appended to the phase's `section`, but
 *     the criteria and the tasks are read from the phase's OWN section: B-2028
 *     calls them constraints, not criteria. `criteriaOf` is exported, so the
 *     other reading is one call away and the difference is measurable.
 */
import {
  type SpecFinding,
  type SpecGrammar,
  type SpecPhase,
  type SpecTask,
  CRITERIA_HEADING,
  isACheckboxWithText,
  level2SectionsOf,
  linesOf,
  readCheckboxLine,
  structuredTaskOfLine,
  textOfSection,
  type Level2Section,
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
export const FORMAT = "speckit-tasks" as const;

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F104-FR-012", "F104-FR-014", "F104-FR-015", "F104-FR-017"] as const;

/** The records of the baseline it is measured against. */
export const BEHAVIOUR_ROWS = Object.freeze([
  "B-2024",
  "B-2025",
  "B-2026",
  "B-2027",
  "B-2028",
  "B-2029",
  "B-2030",
  "B-2006",
  "B-2007",
  "B-2054",
]);

/**
 * B-2024 — the EXPLICIT heading: `## Phase <digits>`, an optional `:`, then
 * free title text. Case-sensitive: a lower-case `## phase 1:` is not a phase
 * heading (DV-119, CQ-045).
 */
export const EXPLICIT_PHASE_HEADING = /^##[ \t]+Phase[ \t]+(\d+)[ \t]*:?[ \t]*(.*)$/;

/** B-2025 — the PRIORITY heading: `## P<N>` or `## p<N>`, then a separator. */
export const PRIORITY_PHASE_HEADING = /^##[ \t]*([Pp])(\d+)[ \t]*[-—:]?[ \t]*(.*)$/;

/** The separators B-2025 allows after the priority number. */
export const PRIORITY_SEPARATORS = Object.freeze(["-", "—", ":"]);

/** The number of an explicit heading, or `undefined`. */
export function explicitPhaseNumberOf(headingLine: string): number | undefined {
  const found = EXPLICIT_PHASE_HEADING.exec(headingLine);
  if (found === null) return undefined;
  return Number.parseInt(found[1] as string, 10);
}

/** B-2024 — the title of an explicit heading: the free text after the colon. */
export function titleOfAnExplicitHeading(headingLine: string): string {
  const found = EXPLICIT_PHASE_HEADING.exec(headingLine);
  if (found === null) return "";
  return (found[2] as string).trimEnd();
}

/** The priority number of a priority heading, or `undefined`. */
export function priorityNumberOf(headingLine: string): number | undefined {
  const found = PRIORITY_PHASE_HEADING.exec(headingLine);
  if (found === null) return undefined;
  return Number.parseInt(found[2] as string, 10);
}

/**
 * B-2029 — the title of a priority phase KEEPS the priority label: it is the
 * whole heading text after `##`.
 */
export function titleOfAPriorityHeading(headingLine: string): string {
  return headingLine.replace(/^##[ \t]*/, "").trimEnd();
}

/** B-2030 — true where the text holds at least one EXPLICIT phase heading. */
export function hasAnExplicitPhase(text: string): boolean {
  return linesOf(text).some((line) => EXPLICIT_PHASE_HEADING.test(line));
}

/**
 * B-2026 — the criteria: every checkbox line with non-empty text anywhere in
 * the section, under any `###` heading. The TEXT of the line is the criterion,
 * `T###` lines included.
 */
export function criteriaOf(section: string): readonly string[] {
  return Object.freeze(
    linesOf(section)
      .map((line) => readCheckboxLine(line))
      .filter((box): box is NonNullable<typeof box> => box !== undefined && box.text !== "")
      .map((box) => box.text),
  );
}

/** F104-FR-012 — a section is a phase of the priority form when it holds a checkbox. */
export function holdsACheckbox(section: string): boolean {
  return linesOf(section).some((line) => isACheckboxWithText(line));
}

/**
 * The NARROWER reading of B-2027 and B-2007: a section holds a checkbox whose
 * text opens with a `T` task id. It is not the rule — F104-FR-012 is — but the
 * difference between the two is measured by the parity tests of T019.
 */
export function holdsATaskCheckbox(section: string): boolean {
  return linesOf(section).some(
    (line, index) => structuredTaskOfLine(line, index + 1, "", "T-id") !== undefined,
  );
}

/** The structured tasks of a section, with the file's own line numbers. */
export function tasksOf(section: Level2Section, file: string): readonly SpecTask[] {
  const tasks: SpecTask[] = [];
  section.lines.forEach((line, offset) => {
    const task = structuredTaskOfLine(line, section.headingLine + offset, file, "T-id");
    if (task !== undefined) tasks.push(task);
  });
  return Object.freeze(tasks);
}

/**
 * F104-FR-012 — the phases of a Spec Kit task list. Explicit headings win
 * (B-2030); the priority form is read only when there is no explicit phase.
 * A pure function of the text.
 */
export function phasesOf(text: string, file: string): readonly SpecPhase[] {
  const sections = level2SectionsOf(text);
  if (hasAnExplicitPhase(text)) {
    const phases: SpecPhase[] = [];
    for (const section of sections) {
      const number = explicitPhaseNumberOf(section.heading);
      if (number === undefined) continue;
      const body = textOfSection(section);
      phases.push(
        Object.freeze({
          number,
          title: titleOfAnExplicitHeading(section.heading),
          section: body,
          criteria: criteriaOf(body),
          tasks: tasksOf(section, file),
        }),
      );
    }
    return Object.freeze(phases);
  }
  return priorityPhasesOf(sections, file);
}

/**
 * B-2027, B-2028, B-2029 — the priority form. Only sections that hold a
 * checkbox are phases; they are numbered contiguously in document order from
 * the FIRST priority number, so a repeated priority is valid; the level-2
 * sections after the last such group are appended to every phase's section as
 * shared constraints.
 */
export function priorityPhasesOf(
  sections: readonly Level2Section[],
  file: string,
): readonly SpecPhase[] {
  const bearing = sections
    .map((section, index) => ({ section, index, priority: priorityNumberOf(section.heading) }))
    .filter(
      (entry): entry is { section: Level2Section; index: number; priority: number } =>
        entry.priority !== undefined && holdsACheckbox(textOfSection(entry.section)),
    );
  if (bearing.length === 0) return Object.freeze([]);
  const first = (bearing[0] as { priority: number }).priority;
  const last = bearing[bearing.length - 1] as { index: number };
  // B-2028 — every level-2 section AFTER the last task-bearing group.
  const shared = sections.slice(last.index + 1).map((section) => textOfSection(section));
  return Object.freeze(
    bearing.map((entry, offset) => {
      const own = textOfSection(entry.section);
      return Object.freeze({
        number: first + offset,
        title: titleOfAPriorityHeading(entry.section.heading),
        // The shared constraints are part of what an agent is shown...
        section: [own, ...shared].join("\n"),
        // ...but the criteria and the tasks are the phase's OWN (see the note
        // at the head of this module, reading 2).
        criteria: criteriaOf(own),
        tasks: tasksOf(entry.section, file),
      });
    }),
  );
}

/** B-2028 — the shared constraints of a priority-form task list, as text. */
export function sharedConstraintsOf(text: string): readonly string[] {
  const sections = level2SectionsOf(text);
  if (hasAnExplicitPhase(text)) return Object.freeze([]);
  let last = -1;
  sections.forEach((section, index) => {
    if (priorityNumberOf(section.heading) !== undefined && holdsACheckbox(textOfSection(section))) {
      last = index;
    }
  });
  if (last === -1) return Object.freeze([]);
  return Object.freeze(sections.slice(last + 1).map((section) => textOfSection(section)));
}

/* ------------------------------------------------------------------ *
 * The findings of `validate` (F104-FR-015).
 * ------------------------------------------------------------------ */

/** B-2006 — the Spec Kit "zero phases" finding. */
export const ZERO_PHASES =
  'tasks.md has zero phases (need task-bearing "## Phase <N>:" or "## P<N>" sections)';

/** B-2007 — the Spec Kit "no task checkboxes" finding, per phase. */
export function noTaskCheckboxes(number: number, title: string): string {
  return `phase ${number} (${title}) has no task checkboxes ("- [ ] T### ..." lines)`;
}

/**
 * F104-FR-015 — the Spec Kit findings: zero phases, then the per-phase
 * "no task checkboxes" message in scan order, then the duplicate and
 * contiguity messages of B-2004 and B-2005, which are "(all formats)".
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

/** F104-FR-014, B-2042 — the title of a bare section, explicit form first. */
export function titleOfASection(section: string): string | undefined {
  const lines = linesOf(section);
  const explicit = lines.find((line) => EXPLICIT_PHASE_HEADING.test(line));
  if (explicit !== undefined) return titleOfAnExplicitHeading(explicit);
  const priority = lines.find((line) => PRIORITY_PHASE_HEADING.test(line));
  if (priority !== undefined) return titleOfAPriorityHeading(priority);
  return undefined;
}

/** F104-FR-014 — the title of a bare section read as the PRIORITY form only. */
export function titleOfAPrioritySection(section: string): string | undefined {
  const priority = linesOf(section).find((line) => PRIORITY_PHASE_HEADING.test(line));
  if (priority === undefined) return undefined;
  return titleOfAPriorityHeading(priority);
}

/** F104-FR-014 — the title of a bare section read as the EXPLICIT form only. */
export function titleOfAnExplicitSection(section: string): string | undefined {
  const explicit = linesOf(section).find((line) => EXPLICIT_PHASE_HEADING.test(line));
  if (explicit === undefined) return undefined;
  return titleOfAnExplicitHeading(explicit);
}

/**
 * F104-FR-017, B-2054 — only a Spec Kit file with EXPLICIT `## Phase N`
 * headings may be ticked; the priority form is left as it is, with 0 ticked.
 */
export function mayBeTicked(text: string): boolean {
  return hasAnExplicitPhase(text);
}

/** The `speckit-tasks` grammar. */
export const grammar: SpecGrammar = Object.freeze({
  name: FORMAT,
  taskIdForm: "T-id" as const,
  criteriaHeading: CRITERIA_HEADING[FORMAT],
  phasesOf,
  findingsOf,
  titleOfASection,
  mayBeTicked,
});
