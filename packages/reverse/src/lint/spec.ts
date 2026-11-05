/**
 * The rules of `spec.md`, of the design artifacts and of the checklist
 * (F140-FR-011, F140-FR-012).
 *
 * A port of `lint_spec`, `lint_research`, `lint_data_model` and
 * `lint_checklist` of the Specstride baseline (`lib/reverse.py` at `9cab15d`),
 * with the baseline's message bytes. Every rule here is the lint's own: the
 * grammar of `tasks.md` is NOT, and goes through the spec-format adapter
 * (`tasks.ts`, Principle IV).
 */

import { model } from "@specstride/spec-formats";

import type { EvidenceContext } from "./evidence.ts";
import { EVIDENCE_RE, lintClaims, sectionLookup } from "./evidence.ts";
import type { Findings } from "./findings.ts";
import { splitLines } from "./templates.ts";

/** A requirement line of `spec.md`: `- **FR-ddd**: <text>` at column 0. */
export const FR_LINE = /^- \*\*FR-(\d{3})\*\*: \S/;
/** A success-criterion line: `- **SC-ddd**: <text>` at column 0. */
export const SC_LINE = /^- \*\*SC-(\d{3})\*\*: \S/;
/** `**FR-<digits>**` anywhere in a line. */
export const FR_MENTION = /\*\*FR-(\d+)\*\*/;
/** `**SC-<digits>**` anywhere in a line. */
export const SC_MENTION = /\*\*SC-(\d+)\*\*/;
/** Any line that means to be a user-story heading. */
export const STORY_ANY = /^###\s+User Story\b/;
/** A well-formed story heading, with the optional target-emoji suffix. */
export const STORY_HEAD = /^### User Story (\d+) - (.+?) \(Priority: P(\d+)\)\s*(?:🎯.*)?$/;
/** A Given/When/Then scenario, across lines. */
export const GIVEN_WHEN_THEN = /\*\*Given\*\*[\s\S]*?\*\*When\*\*[\s\S]*?\*\*Then\*\*/;
/** A claim of `spec.md`: a requirement or a criterion line. */
export const SPEC_CLAIM = /^- \*\*(FR|SC)-\d+\*\*/;
/** A research decision, after an optional bullet. */
export const DECISION_LINE = /^\s*(?:[-*]\s+)?\*\*Decision\*\*/;
/** A data-model entity: a heading of exactly level 3. */
export const ENTITY_HEAD = /^### (?!#)\s*(.+?)\s*$/;
/**
 * A checklist item of F140-FR-012: `- [ ] `, `- [x] ` or `- [X] ` at column 0.
 *
 * Whether a line is a checkbox line at all is the grammar owner's answer
 * (`@specstride/spec-formats`, Principle IV, F104-SC-001); "at column 0, one
 * space before the box and one after it" is the reverse lint's own rule, read
 * off the raw line. The box state is returned, or `undefined` where the line
 * is no checklist item.
 */
export function readChecklistItem(line: string): string | undefined {
  const box = model.readCheckboxLine(line);
  if (box === undefined || box.empty) return undefined;
  // `- [` at column 0, and one space after the closing bracket.
  if (box.indent !== "" || box.markIndex !== 3) return undefined;
  if (line.slice(box.markIndex + 2, box.markIndex + 3) !== " ") return undefined;
  return box.mark;
}
/** The marker whose count F140-FR-011 caps. */
export const NEEDS_CLARIFICATION = "[NEEDS CLARIFICATION" as const;
/** At most three of them (F140-FR-011). */
export const MAX_CLARIFICATIONS = 3;

/** What `lintSpec` tells the rest of the lint. */
export interface SpecSurvey {
  /** The story numbers `spec.md` declares, for `tasks.story-exists`. */
  readonly stories: ReadonlySet<number>;
  /** The three-digit FR ids, for the coverage rule of level 5. */
  readonly requirements: ReadonlySet<string>;
}

/** How many times a needle occurs in a text, as `str.count` counts it. */
function countOf(text: string, needle: string): number {
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * The rules of `spec.md` (F140-FR-011): the format and the uniqueness of the
 * requirement and criterion lines, the story headings, their numbering and
 * their three parts, the cap on clarification markers, and then every claim's
 * evidence comment.
 */
export function lintSpec(
  findings: Findings,
  text: string,
  ectx: EvidenceContext | null,
): SpecSurvey {
  const rel = "spec.md";
  const lines = splitLines(text);
  for (const [lineRe, mentionRe, label] of [
    [FR_LINE, FR_MENTION, "FR"],
    [SC_LINE, SC_MENTION, "SC"],
  ] as const) {
    const seen = new Map<string, number>();
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] as string;
      const number = index + 1;
      const mention = mentionRe.exec(line);
      if (mention === null || !line.trimStart().startsWith(`- **${label}-`)) continue;
      const id = mention[1] as string;
      const code = label === "FR" ? "spec.fr-format" : "spec.sc-format";
      if (!lineRe.test(line) || id.length !== 3) {
        findings.error(
          code,
          rel,
          number,
          `${label} must be written '- **${label}-###**: …' with a 3-digit id`,
        );
        continue;
      }
      const first = seen.get(id);
      if (first !== undefined) {
        findings.error(
          label === "FR" ? "spec.fr-unique" : "spec.sc-unique",
          rel,
          number,
          `${label}-${id} duplicates line ${first}`,
        );
      } else {
        seen.set(id, number);
      }
    }
  }
  const stories: { readonly line: number; readonly number: number }[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (!STORY_ANY.test(line)) continue;
    const head = STORY_HEAD.exec(line);
    if (head === null) {
      findings.error(
        "spec.story-format",
        rel,
        index + 1,
        "user story heading must be '### User Story <n> - <title> (Priority: P<n>)'",
      );
      continue;
    }
    stories.push({ line: index + 1, number: Number.parseInt(head[1] as string, 10) });
  }
  if (stories.length === 0) {
    findings.error("spec.story-format", rel, null, "no '### User Story <n> - …' found");
  }
  const numbers = stories.map((story) => story.number);
  const expected = numbers.map((_value, index) => index + 1);
  if (numbers.length > 0 && numbers.join(",") !== expected.join(",")) {
    findings.error(
      "spec.story-numbers",
      rel,
      (stories[0] as { line: number }).line,
      `user story numbers must run 1..${numbers.length} in order (got ${numbers.join(", ")})`,
    );
  }
  const bounds = [...stories.map((story) => story.line), lines.length + 1];
  for (let index = 0; index < stories.length; index += 1) {
    const story = stories[index] as { line: number; number: number };
    const end = bounds[index + 1] as number;
    const body = lines
      .slice(story.line, end - 1)
      .join("\n")
      .split("\n## ")[0] as string;
    for (const [needle, label] of [
      ["**Why this priority**", "Why this priority"],
      ["**Independent Test**", "Independent Test"],
    ] as const) {
      if (!body.includes(needle)) {
        findings.error(
          "spec.story-parts",
          rel,
          story.line,
          `User Story ${story.number} lacks **${label}**`,
        );
      }
    }
    if (!GIVEN_WHEN_THEN.test(body)) {
      findings.error(
        "spec.story-parts",
        rel,
        story.line,
        `User Story ${story.number} has no **Given** … **When** … **Then** scenario`,
      );
    }
  }
  const clarifications = countOf(text, NEEDS_CLARIFICATION);
  if (clarifications > MAX_CLARIFICATIONS) {
    findings.error(
      "spec.clarifications",
      rel,
      null,
      `${clarifications} [NEEDS CLARIFICATION markers; Spec Kit allows at most ${MAX_CLARIFICATIONS}`,
    );
  }
  lintClaims(
    findings,
    rel,
    text,
    (_index, line) => SPEC_CLAIM.test(line),
    ectx,
    "requirement/success criterion",
    { fr: true, specSections: sectionLookup(text) },
  );
  const requirements = new Set<string>();
  for (const line of lines) {
    const match = FR_LINE.exec(line);
    if (match !== null) requirements.add(match[1] as string);
  }
  return Object.freeze({
    stories: new Set(stories.map((story) => story.number)),
    requirements,
  });
}

/** The rule of `research.md` (F140-FR-012): at least one `**Decision**`. */
export function lintResearch(findings: Findings, text: string, ectx: EvidenceContext | null): void {
  const rel = "research.md";
  const lines = splitLines(text);
  if (!lines.some((line) => DECISION_LINE.test(line))) {
    findings.error(
      "research.decisions",
      rel,
      null,
      "no '**Decision**' entry (Decision / Rationale / Alternatives)",
    );
  }
  lintClaims(
    findings,
    rel,
    text,
    (_index, line) => DECISION_LINE.test(line),
    ectx,
    "research decision",
  );
}

/** The rule of `data-model.md` (F140-FR-012): the level-3 headings. */
export function lintDataModel(
  findings: Findings,
  text: string,
  ectx: EvidenceContext | null,
): void {
  const rel = "data-model.md";
  const lines = splitLines(text);
  if (!lines.some((line) => ENTITY_HEAD.test(line))) {
    findings.warn("data-model.entities", rel, null, "no '### <Entity>' heading");
  }
  lintClaims(
    findings,
    rel,
    text,
    (_index, line) => ENTITY_HEAD.test(line),
    ectx,
    "data-model entity",
  );
}

/**
 * The rule of `checklists/requirements.md` (F140-FR-012): an unchecked item
 * needs an indented `Fails:` note, the note needs an evidence comment, and a
 * checklist with no item at all is a finding of its own.
 */
export function lintChecklist(
  findings: Findings,
  text: string,
  ectx: EvidenceContext | null,
): void {
  const rel = "checklists/requirements.md";
  const lines = splitLines(text);
  let items = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const box = readChecklistItem(lines[index] as string);
    if (box === undefined) continue;
    items += 1;
    if (box === "x" || box === "X") continue;
    const next = index + 1 < lines.length ? (lines[index + 1] as string) : "";
    if (!/^\s+Fails:/.test(next)) {
      findings.error(
        "checklist.items",
        rel,
        index + 1,
        "unchecked item without an indented 'Fails:' note",
      );
      continue;
    }
    if (!new RegExp(EVIDENCE_RE.source).test(next)) {
      findings.error(
        "checklist.items",
        rel,
        index + 2,
        "'Fails:' note carries no evidence comment",
      );
    }
  }
  if (items === 0) findings.error("checklist.items", rel, null, "no checklist items");
  lintClaims(findings, rel, text, () => false, ectx, "item");
}
