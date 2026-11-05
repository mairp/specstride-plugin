/**
 * The rules of `tasks.md`, the coverage rule and the claims file
 * (F140-FR-013, F140-FR-014).
 *
 * A port of `lint_tasks`, `lint_claims_file` and the coverage block of `lint`
 * of the Specstride baseline (`lib/reverse.py` at `9cab15d`), with the
 * baseline's message bytes.
 *
 * `tasks.grammar` is NOT a rule of this module: it is the verdict of the
 * `speckit-tasks` validation of `@specstride/spec-formats`, the one owner of
 * the spec grammar (Principle IV, EP-03, decision D-3 of `research.md`).
 * Every other `tasks.*` rule is the lint's own, because it is about the
 * reverse output and not about the grammar of a spec.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

import { model, validate as specValidate } from "@specstride/spec-formats";

import { compareCodePoint } from "../inventory/serialize.ts";
import type { EvidenceContext } from "./evidence.ts";
import { lintClaims, pythonRepr } from "./evidence.ts";
import type { Findings } from "./findings.ts";
import { splitLines, stripFrontMatter } from "./templates.ts";

/** The two modes the marker of F140-FR-013 may set. */
export const TASK_MODES = Object.freeze(["done", "open"] as const);

/** The marker that sets the mode; without it no box state is checked. */
export const TASKS_MODE_RE = /<!--\s*specstride-reverse:\s*tasks=(\w+)\s*-->/;

/**
 * The grammar of a checkbox line and of a task id belongs to
 * `@specstride/spec-formats`, the ONE owner of the spec grammar (Principle IV,
 * F104-SC-001): this module never carries a pattern that recognises one. It
 * asks `model.readCheckboxLine` whether a line is a checkbox line and
 * `model.TASK_ID_AT_THE_HEAD` what an id looks like, and then applies the
 * REVERSE LINT's own conventions — exactly three digits, the order of the
 * markers, the shape of the description — to what the owner read
 * (F140-FR-013).
 */

/** Is this line a checkbox line at all, that is: does it MEAN to be a task? */
export function isACheckboxLine(line: string): boolean {
  return model.readCheckboxLine(line) !== undefined;
}

/** The marker the reverse lint reads as "may run in parallel". */
export const PARALLEL_MARKER = model.PARALLEL_MARKER;

/** The one further marker the reverse lint reads: a story label `[US<n>]`. */
export const STORY_MARKER_PREFIX = "[US" as const;

/** The three digits an id of the reverse output carries, and nothing else. */
const THREE_DIGITS = /^\d{3}$/;

/** The digits of a story label. */
const DIGITS = /^\d+$/;

/** The id form of the `speckit-tasks` format, as its owner writes it. */
const TASK_ID_FORM = model.TASK_ID_AT_THE_HEAD["T-id"];

/** One task line of the reverse output, as F140-FR-013 fixes its shape. */
export interface TaskLineReading {
  /** ` `, `x` or `X`. */
  readonly box: string;
  /** The three-digit number of the id. */
  readonly id: number;
  readonly parallel: boolean;
  /** The digits of the `[US<n>]` label, or undefined. */
  readonly story: string | undefined;
  readonly description: string;
}

/**
 * Read one line as a task line of the REVERSE OUTPUT (F140-FR-013): `- [ |x|X]
 * Tddd`, then optional ` [P]`, then optional ` [USn]` in that order, then a
 * description that does not start with another marker, the id being exactly
 * three digits. `undefined` where the line does not have that shape, which is
 * what `tasks.line-format` reports.
 *
 * Whether the line is a checkbox line at all, and what an id looks like, are
 * the grammar owner's answers; the shape above is this feature's own rule and
 * is read off the raw line so that the ONE space the as-is form puts between
 * its parts is measured and not assumed.
 */
export function readTaskLine(line: string): TaskLineReading | undefined {
  const box = model.readCheckboxLine(line);
  if (box === undefined) return undefined;
  // `- [` at column 0: no indent and exactly one space before the box.
  if (box.indent !== "" || box.markIndex !== 3 || box.empty) return undefined;
  const after = line.slice(box.markIndex + 2);
  if (!after.startsWith(" ")) return undefined;
  const idEnd = after.indexOf(" ", 1);
  if (idEnd === -1) return undefined;
  const token = after.slice(1, idEnd);
  if (TASK_ID_FORM.exec(token) === null) return undefined;
  if (!THREE_DIGITS.test(token.slice(1))) return undefined;
  let cursor = idEnd;
  const parallel = after.startsWith(` ${PARALLEL_MARKER}`, cursor);
  if (parallel) cursor += PARALLEL_MARKER.length + 1;
  let story: string | undefined;
  if (after.startsWith(` ${STORY_MARKER_PREFIX}`, cursor)) {
    const close = after.indexOf("]", cursor);
    const digits = close === -1 ? "" : after.slice(cursor + 1 + STORY_MARKER_PREFIX.length, close);
    if (close !== -1 && DIGITS.test(digits)) {
      story = digits;
      cursor = close + 1;
    }
  }
  if (!after.startsWith(" ", cursor)) return undefined;
  const description = after.slice(cursor + 1);
  // The description must start with a non-space and with no further marker.
  if (description === "" || description.startsWith(" ") || description.startsWith("\t")) {
    return undefined;
  }
  if (description.startsWith(PARALLEL_MARKER)) return undefined;
  if (description.startsWith(STORY_MARKER_PREFIX)) {
    const close = description.indexOf("]");
    if (close !== -1 && DIGITS.test(description.slice(STORY_MARKER_PREFIX.length, close))) {
      return undefined;
    }
  }
  return Object.freeze({
    box: box.mark,
    id: Number.parseInt(token.slice(1), 10),
    parallel,
    story,
    description,
  });
}

/**
 * The phase number and the title of a `## ` heading of `tasks.md`. The pattern
 * reads a heading's TEXT, which `h2Headings` has already separated from the
 * document, and therefore recognises no heading of a document itself.
 */
const PHASE_IN_A_TITLE = /^Phase (\d+):?\s*(.*)$/;

/** A user story named in a phase title. */
export const STORY_IN_TITLE = /\bUser Story (\d+)\b/;

/** `FR-ddd` as a task description mentions it, for the coverage rule. */
export const FR_IN_A_DESCRIPTION = /\bFR-(\d{3})\b/g;

/**
 * A path token of a task description (F140-FR-013): a backticked token, a
 * `dir/file.ext` token or a `dir/` token. The lookbehinds keep a token that
 * is part of a longer word out.
 */
export const PATH_TOKEN = new RegExp(
  "`([^`\\s]+)`" +
    "|(?<![\\w/`])((?:[\\w.-]+/)*[\\w-]+\\.[A-Za-z][\\w]{0,7})(?![\\w/`])" +
    "|(?<![\\w`])((?:[\\w.-]+/)+[\\w.-]*)(?![\\w`])",
  "g",
);

/** An id, never a path. */
const AN_ID_RE = /^(FR|SC|US|T)-?\d+/;
/** A file extension at the end of a token. */
const AN_EXTENSION_RE = /\.[A-Za-z]\w{0,7}$/;

/** `str.strip("./")`: every leading and trailing `.` or `/` removed. */
function stripDotsAndSlashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && (value[start] === "." || value[start] === "/")) start += 1;
  while (end > start && (value[end - 1] === "." || value[end - 1] === "/")) end -= 1;
  return value.slice(start, end);
}

/** The paths a task description names (F140-FR-013). */
export function taskPaths(description: string): ReadonlySet<string> {
  const paths = new Set<string>();
  for (const match of description.matchAll(PATH_TOKEN)) {
    const token = match[1] ?? match[2] ?? match[3];
    if (token === undefined || token === "") continue;
    if (!(token.includes("/") || AN_EXTENSION_RE.test(token))) continue;
    if (AN_ID_RE.test(token)) continue;
    if (token.includes("://")) continue;
    paths.add(token.startsWith("./") ? stripDotsAndSlashes(token) : token);
  }
  return paths;
}

/** One task line, parsed. */
interface ParsedTask {
  readonly line: number;
  readonly box: string;
  readonly id: number;
  readonly parallel: boolean;
  readonly story: string | undefined;
  readonly description: string;
}

/** One `## ` section of `tasks.md` and the tasks it holds. */
interface TaskPhase {
  readonly line: number;
  /** The phase number, or null for a `## ` heading that is not `Phase <n>`. */
  readonly number: number | null;
  readonly title: string;
  readonly tasks: ParsedTask[];
}

/** `T%03d`, the id as every message of F140-FR-013 writes it. */
function taskId(id: number): string {
  return `T${String(id).padStart(3, "0")}`;
}

/**
 * The grammar of `tasks.md` as the spec-format adapter validates it
 * (F140-FR-013, EP-03): every error of the `speckit-tasks` validation is one
 * `tasks.grammar` finding, with the adapter's own text.
 */
export function lintTasksGrammar(findings: Findings, text: string, feature: string): void {
  const parsed = specValidate.parse({
    file: "tasks.md",
    text,
    format: "speckit-tasks",
    feature,
  });
  const errors = specValidate.validate(parsed, text);
  if (model.isValid(errors)) return;
  for (const error of errors) findings.error("tasks.grammar", "tasks.md", null, error.message);
}

/**
 * The rules of `tasks.md` (F140-FR-013). Returns the description of every
 * task, which the coverage rule of level 5 reads.
 *
 * Checkbox lines inside fenced code and inside the front matter are ignored,
 * and the phase-order checks consider only numbered `## Phase <n>` sections
 * that hold a task.
 */
export function lintTasks(
  findings: Findings,
  text: string,
  specStories: ReadonlySet<number> | null,
  feature: string,
): readonly string[] {
  const rel = "tasks.md";
  lintTasksGrammar(findings, text, feature);
  const lines = splitLines(text);
  const bodyOffset = lines.length - splitLines(stripFrontMatter(text)).length;
  const ids: { readonly line: number; readonly id: number }[] = [];
  const phases: TaskPhase[] = [];
  let fenced = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    const number = index + 1;
    if (line.trimStart().startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced || number <= bodyOffset) continue;
    if (line.startsWith("## ")) {
      const heading = line.slice(3).trim();
      const numbered = PHASE_IN_A_TITLE.exec(heading);
      phases.push({
        line: number,
        number: numbered === null ? null : Number.parseInt(numbered[1] as string, 10),
        title: numbered === null ? heading : (numbered[2] as string).trim(),
        tasks: [],
      });
      continue;
    }
    if (!isACheckboxLine(line)) continue;
    const read = readTaskLine(line);
    if (read === undefined) {
      findings.error(
        "tasks.line-format",
        rel,
        number,
        "task must be '- [ ] T### [P]? [USn]? description'",
      );
      continue;
    }
    const task: ParsedTask = {
      line: number,
      box: read.box,
      id: read.id,
      parallel: read.parallel,
      story: read.story,
      description: read.description,
    };
    ids.push({ line: number, id: task.id });
    const last = phases[phases.length - 1];
    if (last !== undefined) last.tasks.push(task);
  }
  let highest = 0;
  const seen = new Set<number>();
  for (const { line, id } of ids) {
    if (seen.has(id)) {
      findings.error("tasks.ids", rel, line, `${taskId(id)} is not unique`);
    } else if (id <= highest) {
      findings.error(
        "tasks.ids",
        rel,
        line,
        `${taskId(id)} is not increasing (after ${taskId(highest)})`,
      );
    }
    seen.add(id);
    highest = Math.max(highest, id);
  }
  const taskPhases = phases.filter((phase) => phase.number !== null && phase.tasks.length > 0);
  if (taskPhases.length > 0) {
    const first = taskPhases[0] as TaskPhase;
    const second = taskPhases[1];
    const final = taskPhases[taskPhases.length - 1] as TaskPhase;
    if (!first.title.toLowerCase().startsWith("setup")) {
      findings.error(
        "tasks.phase-order",
        rel,
        first.line,
        `the first phase must be Setup (got '${first.title}')`,
      );
    }
    if (second === undefined || !second.title.toLowerCase().startsWith("foundational")) {
      findings.error(
        "tasks.phase-order",
        rel,
        second === undefined ? first.line : second.line,
        "the second phase must be Foundational",
      );
    }
    if (taskPhases.length < 3 || !final.title.toLowerCase().startsWith("polish")) {
      findings.error(
        "tasks.phase-order",
        rel,
        final.line,
        `the last phase must be Polish (got '${final.title}')`,
      );
    }
    const middle = taskPhases.slice(2, -1);
    const storyOrder: number[] = [];
    for (const phase of middle) {
      const named = STORY_IN_TITLE.exec(phase.title);
      if (named === null) {
        findings.error(
          "tasks.phase-order",
          rel,
          phase.line,
          `a phase between Foundational and Polish must name a user story (got '${phase.title}')`,
        );
      } else {
        storyOrder.push(Number.parseInt(named[1] as string, 10));
      }
    }
    const sorted = [...storyOrder].sort((a, b) => a - b);
    if (storyOrder.join(",") !== sorted.join(",")) {
      findings.error(
        "tasks.phase-order",
        rel,
        middle.length > 0 ? (middle[0] as TaskPhase).line : null,
        `user story phases are not in priority order: ${storyOrder
          .map((story) => `US${story}`)
          .join(", ")}`,
      );
    }
  }
  const mode = TASKS_MODE_RE.exec(text);
  for (const phase of phases) {
    const named = STORY_IN_TITLE.exec(phase.title);
    const own =
      named !== null && phase.number !== null ? Number.parseInt(named[1] as string, 10) : null;
    const generic =
      phase.number !== null &&
      ["setup", "foundational", "polish"].some((word) =>
        phase.title.toLowerCase().startsWith(word),
      );
    const parallel = new Map<string, number>();
    for (const task of phase.tasks) {
      const story = task.story;
      if (story !== undefined) {
        if (generic || own === null) {
          findings.error(
            "tasks.story-labels",
            rel,
            task.line,
            `[US${story}] outside a user-story phase`,
          );
        } else if (Number.parseInt(story, 10) !== own) {
          findings.error(
            "tasks.story-labels",
            rel,
            task.line,
            `[US${story}] in the phase of User Story ${own}`,
          );
        }
        if (specStories !== null && !specStories.has(Number.parseInt(story, 10))) {
          findings.error(
            "tasks.story-exists",
            rel,
            task.line,
            `[US${story}] names a story spec.md does not have`,
          );
        }
      }
      if (task.parallel) {
        for (const path of [...taskPaths(task.description)].sort(compareCodePoint)) {
          const first = parallel.get(path);
          if (first !== undefined) {
            findings.error(
              "tasks.parallel-files",
              rel,
              task.line,
              `[P] task names ${path}, as does the [P] task on line ${first}`,
            );
          } else {
            parallel.set(path, task.line);
          }
        }
      }
      if (mode !== null) {
        const declared = mode[1] as string;
        if (declared === "done" && task.box !== "x" && task.box !== "X") {
          findings.error("tasks.mode", rel, task.line, "tasks=done but this task is not [x]");
        } else if (declared === "open" && task.box !== " ") {
          findings.error("tasks.mode", rel, task.line, "tasks=open but this task is ticked");
        }
      }
    }
  }
  if (mode !== null && !(TASK_MODES as readonly string[]).includes(mode[1] as string)) {
    findings.error("tasks.mode", rel, null, `unknown tasks mode ${pythonRepr(mode[1] as string)}`);
  }
  return Object.freeze(phases.flatMap((phase) => phase.tasks.map((task) => task.description)));
}

/**
 * The coverage rule (F140-FR-014): at level 5 and above every `FR-ddd` of
 * `spec.md` must be mentioned as `FR-ddd` in at least one task description.
 * The caller runs it only at level 5 and above; the check itself never runs
 * below that level because it is reached nowhere else.
 */
export function lintCoverage(
  findings: Findings,
  requirements: ReadonlySet<string>,
  descriptions: readonly string[],
): void {
  const mentioned = new Set<string>();
  for (const description of descriptions) {
    for (const match of description.matchAll(FR_IN_A_DESCRIPTION)) {
      mentioned.add(match[1] as string);
    }
  }
  const missing = [...requirements].filter((id) => !mentioned.has(id)).sort(compareCodePoint);
  for (const id of missing) {
    findings.error("coverage.fr", "tasks.md", null, `FR-${id} is not covered by any task`);
  }
}

/**
 * The scratch claims file of an oversize run's unit phase (F140-FR-014): it
 * must have been written and must hold at least one `- ` claim, and every
 * such line is a claim that needs an evidence comment. Findings name the file
 * by its BASE name, not by the path it was given.
 */
export function lintClaimsFile(
  findings: Findings,
  path: string,
  ectx: EvidenceContext | null,
): void {
  const rel = basename(path);
  let isFile = false;
  try {
    isFile = existsSync(path) && statSync(path).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    findings.error("claims.missing", rel, null, `claims file not written: ${path}`);
    return;
  }
  const text = readFileSync(path, "utf8");
  if (!splitLines(text).some((line) => line.startsWith("- "))) {
    findings.error("claims.missing", rel, null, "claims file holds no '- ' claim");
  }
  lintClaims(findings, rel, text, (_index, line) => line.startsWith("- "), ectx, "claim");
}
