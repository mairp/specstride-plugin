/**
 * T030 — `tick` (F104-FR-017).
 *
 * `tick` edits CHECKBOXES IN PLACE and changes nothing else: line ends and
 * every other byte stay. That is not a promise this module makes in prose — it
 * is how it is built. The file is read as one string, the LINE ENDS ARE NEVER
 * NORMALISED, and a ticked line is produced by replacing the ONE character
 * inside its box, at the offset `readCheckboxLine` of `model.ts` reports. No
 * line is rebuilt, so no indent, no trailing space and no `\r` can be lost.
 *
 * The records it is measured against, read by research report R18 at their
 * lines of `lib/specstride_spec.py`:
 *
 *  - B-2053 an unticked line is a checkbox followed by NON-EMPTY text; it
 *    becomes `[x]`; an already ticked line is untouched;
 *  - B-2054 only `speckit-tasks` with EXPLICIT `## Phase N` headings and
 *    `openspec-change` are ticked; native specs and the priority form are left
 *    as they are, with 0 ticked;
 *  - B-2055 only lines inside phase N's section count; any other level-2
 *    heading ends it; EVERY unticked checkbox there is ticked, not only lines
 *    with a task id;
 *  - B-2056 line ends and every other byte are preserved;
 *  - B-2010 the file is rewritten atomically, the mode is copied, and NOTHING
 *    is written when no line changed.
 *
 * One reading is recorded rather than chosen silently: **the empty box `[]`**.
 * B-2053 opens "An unticked line is a checkbox `[ ]` or `[]` followed by
 * non-empty text" and closes "empty boxes are untouched". F104-FR-017, the
 * authority, settles it — "an already ticked line and an EMPTY BOX are
 * untouched" — and so does F104-FR-022, which keeps `[]` outside the mark rule
 * of the hash. The empty box is therefore left alone, and
 * `UNTICKED_FORMS` names the two forms a tick does write over, so the reading
 * is in the code and measurable.
 *
 * The atomic write is the kernel's (`atomicWrite` of feature 100), not a
 * second one: this feature holds the grammar, not the file discipline.
 */
import { chmodSync, readFileSync, statSync } from "node:fs";
import { atomicWrite } from "@specstride/kernel/atomic-write";
import {
  type CanonicalSpecModel,
  type ModelFormatName,
  type SpecGrammar,
  MARK_WRITTEN_BY_TICK,
  isALevel2Heading,
  joinKeepingLineEnds,
  readCheckboxLine,
  splitKeepingLineEnds,
  structuredTaskOfLine,
} from "./model.ts";
import { grammarOf } from "./adapters/index.ts";
import { UnknownFormatError } from "./errors.ts";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F104-FR-017"] as const;

/** The records of the baseline it is measured against. */
export const BEHAVIOUR_ROWS = Object.freeze([
  "B-2010",
  "B-2053",
  "B-2054",
  "B-2055",
  "B-2056",
  "B-1983",
]);

/** B-2053, F104-FR-017 — the two box forms a tick writes over. `[]` is not one. */
export const UNTICKED_FORMS = Object.freeze([" ", ""]);

/** F104-FR-017 — the forms a tick writes over, the empty box EXCLUDED. */
export const FORMS_A_TICK_WRITES_OVER = Object.freeze([" "]);

/** F104-FR-017 — the empty box `[]` is untouched. */
export const EMPTY_BOX_IS_UNTOUCHED = true as const;

/** F104-FR-017 — a tick never undoes an approval (annex C §C.7). */
export const NEVER_UNDOES_AN_APPROVAL = true as const;

/** F104-FR-017 — nothing is written when no line changed (B-2010). */
export const WRITES_NOTHING_WHEN_NO_LINE_CHANGED = true as const;

/** What `tick` is asked to tick: named task ids, or a phase (F104-FR-017). */
export type TickRequest = { readonly taskIds: readonly string[] } | { readonly phase: number };

/** True where the request names task ids rather than a phase. */
export function isByTaskIds(
  request: TickRequest,
): request is { readonly taskIds: readonly string[] } {
  return Object.hasOwn(request, "taskIds");
}

/** What a tick changed. `lines` are 1-based line numbers, in order. */
export type TickResult = {
  /** The number of lines changed, which is what `spec tick` prints. */
  readonly changed: number;
  readonly lines: readonly number[];
  /** The ids of the tasks whose line was ticked, where the line carried one. */
  readonly taskIds: readonly string[];
  /** F104-FR-017: a tick changes checkboxes only. */
  readonly otherBytesChanged: false;
  /** The text after the tick; equal to the input where nothing changed. */
  readonly text: string;
  /** Whether the format and the file may be ticked at all (B-2054). */
  readonly tickable: boolean;
};

/**
 * B-2055 — the 1-based line numbers of the lines inside phase N's section:
 * from its heading to the next LEVEL-2 heading or the end of the file. The
 * heading line itself is included, which is harmless (a heading is no
 * checkbox) and keeps the range the same one the grammar reports.
 */
export function linesOfThePhaseSection(
  lines: readonly string[],
  phase: number,
  headingNumberOf: (line: string) => number | undefined,
): readonly number[] {
  const inside: number[] = [];
  let within = false;
  lines.forEach((line, index) => {
    if (isALevel2Heading(line)) {
      within = headingNumberOf(line) === phase;
    }
    if (within) inside.push(index + 1);
  });
  return Object.freeze(inside);
}

/** The heading reader of a grammar: the number of a level-2 heading, if any. */
export function headingNumberReaderOf(grammar: SpecGrammar): (line: string) => number | undefined {
  return (line: string) => {
    const phases = grammar.phasesOf(line, "");
    return phases[0]?.number;
  };
}

/**
 * The split and the join that keep the LINE ENDS are `model.ts`'s, once: the
 * grammar needs a line without its end and `tick` needs the end back, and one
 * function cannot be two. They are re-exported here so that the parity test of
 * B-2056 measures the very pair this module uses.
 */
export { joinKeepingLineEnds, splitKeepingLineEnds };

/** What a tick over a TEXT is given. */
export type TickTextInput = {
  readonly text: string;
  /** A format of Wave 1, or an added format's own name (F104-FR-009). */
  readonly format: ModelFormatName;
  readonly request: TickRequest;
  /** The file name a task's `file` carries; only the ids are read from it. */
  readonly file?: string | undefined;
};

/**
 * F104-FR-017 — a tick over a TEXT, with no file touched. This is the whole
 * rule; `tickFile` below adds only the read, the atomic write and the mode.
 */
export function tickText(input: TickTextInput, grammar?: SpecGrammar): TickResult {
  const resolved = grammar ?? grammarOf(input.format);
  if (resolved === undefined) throw new UnknownFormatError(input.format, []);
  // B-2054 — native and the priority form are left as they are, with 0 ticked.
  if (!resolved.mayBeTicked(input.text)) {
    return Object.freeze({
      changed: 0,
      lines: Object.freeze([]),
      taskIds: Object.freeze([]),
      otherBytesChanged: false as const,
      text: input.text,
      tickable: false,
    });
  }
  const split = splitKeepingLineEnds(input.text);
  const lines = [...split.lines];
  const scope = isByTaskIds(input.request)
    ? undefined
    : new Set(
        linesOfThePhaseSection(split.lines, input.request.phase, headingNumberReaderOf(resolved)),
      );
  const wanted = isByTaskIds(input.request) ? new Set(input.request.taskIds) : undefined;
  const changedLines: number[] = [];
  const changedIds: string[] = [];
  split.lines.forEach((line, index) => {
    const number = index + 1;
    if (scope !== undefined && !scope.has(number)) return;
    const box = readCheckboxLine(line);
    // B-2053 — a checkbox with NON-EMPTY text, not already ticked, and not the
    // empty box `[]` (F104-FR-017, the authority over B-2053's first clause).
    if (box === undefined || box.text === "" || box.ticked || box.empty) return;
    const task = structuredTaskOfLine(line, number, input.file ?? "", resolved.taskIdForm);
    if (wanted !== undefined && (task === undefined || !wanted.has(task.id))) return;
    // The ONE byte a tick may change: the character inside the box.
    lines[index] =
      line.slice(0, box.markIndex) + MARK_WRITTEN_BY_TICK + line.slice(box.markIndex + 1);
    changedLines.push(number);
    if (task !== undefined) changedIds.push(task.id);
  });
  return Object.freeze({
    changed: changedLines.length,
    lines: Object.freeze(changedLines),
    taskIds: Object.freeze(changedIds),
    otherBytesChanged: false as const,
    text: changedLines.length === 0 ? input.text : joinKeepingLineEnds(lines, split.ends),
    tickable: true,
  });
}

/** What a tick over a FILE is given. */
export type TickFileInput = {
  readonly path: string;
  /** A format of Wave 1, or an added format's own name (F104-FR-009). */
  readonly format: ModelFormatName;
  readonly request: TickRequest;
  /** The repository-relative name a task's `file` carries. */
  readonly file?: string | undefined;
};

/**
 * F104-FR-017, B-2010 — a tick over a FILE: the file is rewritten ATOMICALLY,
 * its MODE is kept, and NOTHING is written when no line changed. A failed tick
 * leaves the file unchanged, because `atomicWrite` of the kernel removes its
 * temporary name and never renames on an error.
 */
export function tickFile(input: TickFileInput, grammar?: SpecGrammar): TickResult {
  const text = readFileSync(input.path, "utf8");
  const result = tickText(
    {
      text,
      format: input.format,
      request: input.request,
      file: input.file ?? input.path,
    },
    grammar,
  );
  if (result.changed === 0) return result;
  // B-2010 — the mode of the file is COPIED, not replaced by the default of
  // the atomic write, which is owner-only (F100-FR-043).
  const mode = statSync(input.path).mode & 0o7777;
  atomicWrite(input.path, result.text, { mode });
  // The atomic write creates its temporary file with `openSync(…, mode)`, and
  // the process UMASK masks that mode: a file of `0o664` comes back `0o644`
  // under the usual `0o022`. B-2010 COPIES the file mode, so the mode is put
  // back wherever the mask took something off it. The second `statSync` is the
  // measurement, not an assumption: nothing is changed when nothing was lost.
  // Measured in `test/tick-round-trip.test.ts` (CT-104-5, T047).
  if ((statSync(input.path).mode & 0o7777) !== mode) chmodSync(input.path, mode);
  return result;
}

/**
 * F104-FR-017 — the unticked task ids of a phase of a MODEL, which is what a
 * caller that already parsed the spec ticks by id. The model is the one reader
 * of the task lines (F104-FR-008); this function adds no grammar.
 */
export function untickedTaskIdsOf(model: CanonicalSpecModel, phase: number): readonly string[] {
  const found = model.phases.find((p) => p.number === phase);
  if (found === undefined) return Object.freeze([]);
  return Object.freeze(found.tasks.filter((task) => !task.ticked).map((task) => task.id));
}

/** `spec tick <n>` prints the COUNT of changed lines (F104-FR-019, B-1983). */
export function countPrintedBy(result: TickResult): number {
  return result.changed;
}
