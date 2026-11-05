/**
 * T048 of feature 118 — the resume block and the log slice (F118-FR-023;
 * PT-118-C-056 family, prompt block EP-15).
 *
 * When the predicate is satisfied the next pass gets one resume block, headed
 * `## The job you yielded on has ENDED — resume from its result`, with the
 * yield reason, the seconds waited, the log path, the job's exit code, the
 * pass's own `on_resume` text on one line, and a slice of the job log: the
 * whole log when it has at most as many lines as head plus tail (default 40
 * plus 80), else the head, the tail and the marker
 * `[<n> lines elided from the middle ...]`. The exit code comes from the
 * job's exit-code file; for an adopted job, or when the file is missing, it
 * is `unknown`. The block is consumed by exactly one pass and cleared right
 * after it was appended.
 *
 * The reason, the `on_resume` text and the log slice are texts from outside
 * the runtime: the caller admits each through the one ingress before it
 * reaches the prompt (F118-FR-044).
 */
import type { FileReader, Ingress } from "../../ports.ts";
import { admitForWrite, admitLines, INGRESS_DROPPED_LINE } from "../../ingress.ts";

/** The default head of the log slice, in lines (F118-FR-025). */
export const LOG_HEAD_DEFAULT = 40;

/** The default tail of the log slice, in lines (F118-FR-025). */
export const LOG_TAIL_DEFAULT = 80;

/** The heading of the resume block, byte for byte under `parity`. */
export function resumeBlockHeading(): string {
  return "## The job you yielded on has ENDED — resume from its result";
}

/** The slice of a log: whole, or head, tail and the elision marker. */
export function logSlice(
  logText: string,
  head: number = LOG_HEAD_DEFAULT,
  tail: number = LOG_TAIL_DEFAULT,
): string {
  const lines = logText.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length <= head + tail) return lines.join("\n");
  const elided = lines.length - head - tail;
  return [
    ...lines.slice(0, head),
    `[${elided} lines elided from the middle ...]`,
    ...lines.slice(lines.length - tail),
  ].join("\n");
}

/** The exit code read from the job's exit-code file, or `unknown`. */
export function exitCodeOf(
  exitCodePath: string | undefined,
  files: FileReader,
  adopted: boolean,
): number | "unknown" {
  if (adopted || exitCodePath === undefined) return "unknown";
  const slice = files.readAfter(exitCodePath, 0);
  if (slice === undefined) return "unknown";
  const parsed = Number(new TextDecoder().decode(slice.bytes).trim());
  return Number.isInteger(parsed) ? parsed : "unknown";
}

/** What the block is built from. */
export interface ResumeBlockInput {
  /** The yield reason (outside text; admitted when `ingress` is handed in). */
  readonly reason: string;
  readonly secondsWaited: number;
  readonly logPath: string | undefined;
  readonly exitCode: number | "unknown";
  /** The `on_resume` text of the pass (outside text; admitted as free text). */
  readonly onResume: string | undefined;
  /** The log text, or `undefined` when the log is missing (admitted as check output). */
  readonly logText: string | undefined;
  readonly logHead?: number | undefined;
  readonly logTail?: number | undefined;
  /**
   * The one ingress (T077, F118-FR-044): when it is handed in the reason,
   * the `on_resume` text and the log slice are admitted inside this writer,
   * and a drop is recorded in the block itself.
   */
  readonly ingress?: Ingress | undefined;
}

/** The resume block of F118-FR-023, one text ready for the prompt. */
export function resumeBlock(input: ResumeBlockInput): string {
  const dropped: string[] = [];
  const reason =
    input.ingress !== undefined
      ? (() => {
          const one = admitForWrite(input.ingress, input.reason, "free-text");
          if (one.held) dropped.push("the yield reason");
          return one.text;
        })()
      : input.reason;
  const onResume =
    input.ingress !== undefined && input.onResume !== undefined
      ? (() => {
          const one = admitForWrite(input.ingress, input.onResume, "free-text");
          if (one.held) dropped.push("the on_resume text");
          return one.text;
        })()
      : input.onResume;
  let logText = input.logText;
  if (input.ingress !== undefined && logText !== undefined) {
    const lines = admitLines(
      input.ingress,
      logSlice(logText, input.logHead ?? LOG_HEAD_DEFAULT, input.logTail ?? LOG_TAIL_DEFAULT).split(
        "\n",
      ),
      "check-output",
    );
    if (lines.held) dropped.push("lines of the job log");
    logText = lines.lines.join("\n");
  }
  const lines: string[] = [
    resumeBlockHeading(),
    `Reason: ${reason}`,
    `Waited: ${input.secondsWaited}s`,
  ];
  if (input.logPath !== undefined) lines.push(`Log: ${input.logPath}`);
  lines.push(`Exit code: ${input.exitCode}`);
  if (onResume !== undefined) lines.push(`Resume: ${onResume}`);
  if (logText !== undefined) {
    lines.push(
      "Log slice:",
      logSlice(logText, input.logHead ?? LOG_HEAD_DEFAULT, input.logTail ?? LOG_TAIL_DEFAULT),
    );
  }
  // The record says so (F100-FR-205): a dropped text is named in the block.
  if (dropped.length > 0) {
    lines.push("", INGRESS_DROPPED_LINE, `Dropped by the ingress: ${dropped.join("; ")}.`);
  }
  return lines.join("\n");
}
