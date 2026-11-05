/**
 * T023 of feature 118 — the process-level repetition check with its default
 * ignore expression (F118-FR-004; C-058; B-0602, B-0708, B-0709, B-0710,
 * B-0669; defect D-02 kept: the repeat limit is 12, not 5).
 *
 * Every tick the check samples every process of the pass tree (the command
 * line cut to 400 characters), counts each distinct process id and command
 * line once, and ends the pass with the kill reason `repeat_stall` when one
 * key — the latest tool call plus a command line — reaches the repeat limit.
 *
 * A process whose command basename is `sleep` is never counted. A command
 * line that matches the repeat-ignore expression is never counted. An
 * explicitly empty expression switches the default OFF, so that everything
 * except `sleep` is counted (an unset expression keeps the default). A
 * repeat limit of 0 disables both repetition checks.
 *
 * F118-FR-013: the exact argument lists of the inner check set are exempt
 * from this count (the engine carries the exemption through the directive
 * `exemptRepeatCounter`; the tool-level count is unchanged).
 */

/** The repeat limit of the baseline code (D-02): 12, not the documented 5. */
export const REPEAT_LIMIT_DEFAULT = 12;

/** The command line is cut to this length before it enters a key. */
export const REPEAT_COMMAND_LINE_CAP = 400;

/**
 * The default repeat-ignore expression: the test runners, linters, formatters
 * and type checkers of the baseline (pytest and its distributed-run
 * bootstrap, ruff, mypy, black, flake8, eslint, prettier, tsc, jest, vitest,
 * `go test`, `go vet`, `cargo test`, `cargo clippy`, `cargo fmt`, `make test`,
 * `make lint`, `make check`) and the batch tools tesseract, convert, magick,
 * compare, ffmpeg, pdftotext and identify, the last group anchored on the
 * command name.
 */
export const DEFAULT_REPEAT_IGNORE_SOURCE =
  "(^|/)(pytest|python[0-9.]* -m pytest( .*)?|ruff|mypy|black|flake8|eslint|prettier|tsc|jest|vitest)( |$)|(^|/)(go (test|vet)|cargo (test|clippy|fmt)|make (test|lint|check))( |$)|(^|/)(tesseract|convert|magick|compare|ffmpeg|pdftotext|identify)( |$)";

/** The default expression, compiled. */
export function defaultRepeatIgnore(): RegExp {
  return new RegExp(DEFAULT_REPEAT_IGNORE_SOURCE);
}

/** The basename of a command line (the first word, after the last slash). */
export function commandBasename(commandLine: string): string {
  const first = commandLine.trim().split(/\s+/)[0] ?? "";
  const base = first.split("/").pop() ?? first;
  return base;
}

/**
 * How the repeat-ignore setting was handed in. `undefined` is an UNSET
 * variable (the default expression counts); `""` is an EXPLICITLY EMPTY one
 * (the default is switched off); any other text is the expression itself.
 */
export type RepeatIgnoreSetting = string | undefined;

/** True when `commandLine` must never be counted by this check. */
export function excludedFromProcessRepeat(
  commandLine: string,
  repeatIgnore: RepeatIgnoreSetting,
): boolean {
  // A process whose command basename is `sleep` is never counted.
  if (commandBasename(commandLine) === "sleep") return true;
  // An explicitly empty expression switches the default off.
  if (repeatIgnore === "") return false;
  const expression = repeatIgnore === undefined ? defaultRepeatIgnore() : new RegExp(repeatIgnore);
  return expression.test(commandLine);
}

/** One key of the process-level check: the latest tool call + a command line. */
export function processRepeatKey(latestToolCall: string, commandLine: string): string {
  const cut =
    commandLine.length > REPEAT_COMMAND_LINE_CAP
      ? commandLine.slice(0, REPEAT_COMMAND_LINE_CAP)
      : commandLine;
  return JSON.stringify([latestToolCall, cut]);
}

/** One sample of the pass tree this tick (from the `ProcessList` port). */
export interface ProcessSample {
  readonly pid: number;
  readonly commandLine: string;
}

/** One counted key with the number of ticks it has now been seen on. */
export interface RepeatCount {
  readonly key: string;
  readonly count: number;
}

/** What the process-level repetition check decided. */
export interface ProcessRepeatKill {
  readonly reason: "repeat_stall";
  readonly check: "process";
  readonly offender: RepeatCount;
}

/** The inputs of one process-level repetition check. */
export interface ProcessRepeatCheck {
  /** The samples of the pass tree at this tick. */
  readonly samples: readonly ProcessSample[];
  /** The latest tool call of the pass (empty before the first one). */
  readonly latestToolCall: string;
  /** The repeat limit in force; 0 disables both repetition checks. */
  readonly repeatLimit: number;
  /** The repeat-ignore setting: unset keeps the default, "" switches it off. */
  readonly repeatIgnore: RepeatIgnoreSetting;
  /** The counts the previous ticks accumulated (key -> count). */
  readonly previousCounts: Readonly<Record<string, number>>;
  /** The exact argument lists of the inner check set, exempt (F118-FR-013). */
  readonly exemptArgvs?: readonly string[];
}

/** The counts after this tick, and the kill when one key reached the limit. */
export function processRepetitionCheck(check: ProcessRepeatCheck): {
  counts: Record<string, number>;
  kill: ProcessRepeatKill | undefined;
} {
  const counts: Record<string, number> = { ...check.previousCounts };
  if (check.repeatLimit === 0) return { counts, kill: undefined };
  const seen = new Set<number>();
  const exempt = new Set(check.exemptArgvs ?? []);
  for (const sample of check.samples) {
    // Each distinct process id and command line is counted once per tick.
    if (seen.has(sample.pid)) continue;
    seen.add(sample.pid);
    if (excludedFromProcessRepeat(sample.commandLine, check.repeatIgnore)) continue;
    // F118-FR-013: the exact argument lists of the inner check set are exempt.
    if (exempt.has(sample.commandLine)) continue;
    const key = processRepeatKey(check.latestToolCall, sample.commandLine);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  let kill: ProcessRepeatKill | undefined;
  for (const [key, count] of Object.entries(counts)) {
    if (count >= check.repeatLimit) {
      kill = { reason: "repeat_stall", check: "process", offender: { key, count } };
      break;
    }
  }
  return { counts, kill };
}
