/**
 * T052 — the failure summary (F105-FR-037).
 *
 * The failure summary renders a result record of the verification gate as
 * text: it is the text the feedback of a phase attempt holds under
 * `## What actually failed` (F105-FR-006), and it is what tells a proposer
 * WHICH command failed and WHY. Without it the proposer re-asserts its
 * evidence every attempt and the loop burns to the reject limit on an
 * unchanged failure.
 *
 * Per failed command, in this order:
 *
 *  1. `### <commandId> — exit <code>`
 *  2. the argument list with `(cwd: <dir>)`
 *  3. the lines of standard output that start with `FAILED `, `ERROR ` or
 *     `E   ` — FIRST, under `Failing assertions / tests:`, at most 40, then
 *     `… <n> more`
 *  4. the ends of the streams, `stdout (last <n> lines):` and
 *     `stderr (last <n> lines):`; AN EMPTY STREAM IS LEFT OUT
 *
 * The numbers of lines are settable, with the defaults 80 and 40 and the as-is
 * variables `SPECSTRIDE_VERIFY_TAIL_LINES` and
 * `SPECSTRIDE_VERIFY_TAIL_ERR_LINES` as aliases of the keys of rows 126 of
 * annex X §X.7.
 *
 * A record that cannot be read gives `Could not read the verification
 * evidence (<error>).`; a record without a failed command gives the as-is note
 * of two lines. THE RESULT CODE IS 0 IN ALL THESE CASES, and 2 with a usage
 * line when it is not given exactly one record — a failure summary is
 * best-effort and never the thing that fails a caller.
 *
 * Output of a command reaches this text only through the one ingress
 * (F105-FR-054): the record this module reads holds the fields a result record
 * holds, which are written from `throughTheIngress` and from nothing else, and
 * `renderFailureSummaryFromText` takes the already-safe strings. The entry
 * point `renderFailureSummary` therefore does no reading of a raw stream.
 */
import { TAIL_ERR_LINES_KEY, TAIL_LINES_KEY } from "../mode/switches.ts";

/** The default number of lines of standard output (row 126 of §X.7). */
export const DEFAULT_TAIL_LINES = 80 as const;

/** The default number of lines of standard error (row 126 of §X.7). */
export const DEFAULT_TAIL_ERR_LINES = 40 as const;

/** At most this many marker lines are listed, then `… <n> more`. */
export const MAX_MARKERS = 40 as const;

/** The as-is variables that are aliases of the two keys (annex X §X.8). */
export const TAIL_LINES_VARIABLE = "SPECSTRIDE_VERIFY_TAIL_LINES" as const;
export const TAIL_ERR_LINES_VARIABLE = "SPECSTRIDE_VERIFY_TAIL_ERR_LINES" as const;

/** The keys the two variables are aliases of (rows 126 of annex X §X.7). */
export const TAIL_KEYS = Object.freeze({
  tailLines: TAIL_LINES_KEY,
  tailErrLines: TAIL_ERR_LINES_KEY,
});

/** The prefixes of a line that is a failing assertion or test (B-1036). */
export const MARKER_PREFIXES = ["FAILED ", "ERROR ", "E   "] as const;

/** The heading the marker lines are listed under. */
export const MARKERS_HEADING = "Failing assertions / tests:" as const;

/** The result code of a failure summary that was produced: 0, always. */
export const SUMMARY_OK_CODE = 0 as const;

/** The result code of a call that was not given exactly one record: 2. */
export const SUMMARY_USAGE_CODE = 2 as const;

/**
 * The logical component name of the module that renders the failure summary
 * (annex X §X.8, the row of the verification-plan module). The baseline's own
 * usage line names its implementation file there; rule N-15 maps the one onto
 * the other and compares the text after the name.
 */
export const SUMMARY_COMPONENT = "verification" as const;

/** The text of the usage line AFTER the name of the component. */
export const USAGE_TEXT_AFTER_THE_NAME = " <evidence.json>" as const;

/** The usage line of a call that was not given exactly one record. */
export const USAGE_LINE = `usage: ${SUMMARY_COMPONENT}${USAGE_TEXT_AFTER_THE_NAME}`;

/** How many records the call takes: exactly one. */
export const RECORDS_TAKEN = 1 as const;

/** The two lines a record without a failed command gives (B-1033). */
export const NO_FAILED_COMMAND_NOTE: readonly string[] = Object.freeze([
  "The gate failed but no command was recorded as failing; inspect the",
  "evidence document directly.",
]);

/** The message of a record that cannot be read (B-1032). */
export function unreadableMessage(error: unknown): string {
  return `Could not read the verification evidence (${messageOf(error)}).`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The numbers of lines in force. */
export type TailLines = {
  readonly tailLines: number;
  readonly tailErrLines: number;
};

/** What a caller may offer for the two numbers. */
export type TailOffers = {
  /** The value of the key `verification.summary.tailLines`. */
  readonly tailLines?: unknown;
  /** The value of the key `verification.summary.tailErrLines`. */
  readonly tailErrLines?: unknown;
  /** The environment; the two as-is variables are read from it as aliases. */
  readonly environment?: Readonly<Record<string, string | undefined>> | undefined;
};

/**
 * The numbers of lines in force: the key, then the as-is variable as its
 * alias, then the default. A value that is not a positive whole number is the
 * default, as the baseline's own reading of its variables is.
 */
export function resolveTailLines(offers: TailOffers = {}): TailLines {
  return Object.freeze({
    tailLines: wholeNumber(
      offers.tailLines ?? offers.environment?.[TAIL_LINES_VARIABLE],
      DEFAULT_TAIL_LINES,
    ),
    tailErrLines: wholeNumber(
      offers.tailErrLines ?? offers.environment?.[TAIL_ERR_LINES_VARIABLE],
      DEFAULT_TAIL_ERR_LINES,
    ),
  });
}

function wholeNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^[0-9]+$/.test(value.trim())) return Number(value.trim());
  return fallback;
}

/** One command of a result record, as the failure summary reads it. */
export type SummaryCommand = {
  readonly commandId?: unknown;
  readonly executable?: unknown;
  readonly args?: unknown;
  readonly cwd?: unknown;
  readonly exitCode?: unknown;
  readonly stdout?: unknown;
  readonly stderr?: unknown;
  readonly passed?: unknown;
};

/** The result record the failure summary reads. */
export type SummaryRecord = {
  readonly commands?: unknown;
};

/**
 * The ends of a text: its last `n` lines, with the trailing blank space of the
 * whole text removed first. An empty text gives the empty string.
 */
export function tail(text: string | undefined, lines: number): string {
  const body = (text ?? "").replace(/\s+$/u, "");
  if (body === "") return "";
  return body.split("\n").slice(-lines).join("\n");
}

/** The lines of standard output that are failing assertions or tests. */
export function markerLines(stdout: string | undefined): readonly string[] {
  return Object.freeze(
    (stdout ?? "")
      .split("\n")
      .filter((line) => MARKER_PREFIXES.some((prefix) => line.startsWith(prefix)))
      .map((line) => line.trim()),
  );
}

/** The commands of a record that failed. A command without `passed` passed. */
export function failedCommands(record: SummaryRecord | undefined): readonly SummaryCommand[] {
  const commands = record?.commands;
  if (!Array.isArray(commands)) return Object.freeze([]);
  return Object.freeze(
    (commands as SummaryCommand[]).filter((command) => (command?.passed ?? true) !== true),
  );
}

/** The argument list of a command as one line, as the summary prints it. */
export function argumentLine(command: SummaryCommand): string {
  const args = Array.isArray(command.args) ? (command.args as unknown[]) : [];
  return [String(command.executable ?? ""), ...args.map((value) => String(value))].join(" ").trim();
}

/** The heading of a failed command (B-1034). */
export function commandHeading(command: SummaryCommand): string {
  return `### ${String(command.commandId ?? "?")} — exit ${stringOfCode(command.exitCode)}`;
}

/**
 * How the ABSENT result code is spelled in the heading of a failed command.
 *
 * A command that ran over its time limit or could not be started has no exit
 * code: the check runner returns none and the result record holds `null`
 * (F105-FR-009, feature 100 annex C §C.8). The baseline's own failure digest
 * prints `exit None` for that case, and `### <commandId> — exit <code>` is an
 * as-is literal of this feature's contract (B-1034) — so the text is BOUND BY
 * PARITY and is reproduced here rather than respelled.
 *
 * It is a named constant and not an inline literal because it is the one
 * place in this feature's output where the spelling comes from the baseline's
 * language and not from this product's: a reader who wonders why should find
 * the answer at the value, and a later reading that is allowed to change it
 * has one place to change.
 */
export const ABSENT_EXIT_CODE_TEXT = "None" as const;

/**
 * How a result code is spelled in the heading. A number is itself; an absent
 * code is `ABSENT_EXIT_CODE_TEXT`.
 */
export function stringOfCode(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (value === null || value === undefined) return ABSENT_EXIT_CODE_TEXT;
  return String(value);
}

/** The heading of the ends of one stream (B-1035). */
export function tailHeading(stream: "stdout" | "stderr", lines: number): string {
  return `${stream} (last ${lines} lines):`;
}

/**
 * Render a result record as the failure summary. The record's fields are
 * already safe: they were written through the one ingress (F105-FR-054).
 */
export function renderFailureSummary(
  record: SummaryRecord | undefined,
  lines: TailLines = resolveTailLines(),
): string {
  const failed = failedCommands(record);
  if (failed.length === 0) return `${NO_FAILED_COMMAND_NOTE.join("\n")}\n`;
  const out: string[] = [];
  for (const command of failed) {
    out.push(commandHeading(command));
    out.push("");
    out.push(`\`${argumentLine(command)}\`  (cwd: ${String(command.cwd ?? "?")})`);
    out.push("");
    const markers = markerLines(stringOf(command.stdout));
    if (markers.length > 0) {
      out.push(MARKERS_HEADING);
      out.push("");
      for (const line of markers.slice(0, MAX_MARKERS)) out.push(`- \`${line}\``);
      if (markers.length > MAX_MARKERS) out.push(`- … ${markers.length - MAX_MARKERS} more`);
      out.push("");
    }
    for (const [stream, text, count] of [
      ["stdout", stringOf(command.stdout), lines.tailLines],
      ["stderr", stringOf(command.stderr), lines.tailErrLines],
    ] as const) {
      const body = tail(text, count);
      // An empty stream is left out entirely — not a heading with nothing
      // under it (F105-FR-037).
      if (body.trim() === "") continue;
      out.push(tailHeading(stream, count));
      out.push("");
      out.push("```");
      out.push(body);
      out.push("```");
      out.push("");
    }
  }
  return `${out.join("\n")}\n`;
}

function stringOf(value: unknown): string {
  return typeof value === "string"
    ? value
    : value === undefined || value === null
      ? ""
      : String(value);
}

/**
 * Read a value as a result record, or refuse it.
 *
 * A text that is not JSON at all is refused by whatever parsed it. A text that
 * IS JSON but is not a record of a verification gate — a top-level list, a
 * number, a string — reaches here, and it is refused HERE, with the message of
 * B-1032 and the result code 0.
 *
 * THE BASELINE DOES NOT DO THIS, and the difference is deliberate. The
 * baseline's own module calls `.get` on whatever `json.load` returned, so a
 * top-level list ends the module with an unhandled error and a non-zero code.
 * F105-FR-037 says the result code MUST be 0 in all these cases, and a
 * failure summary that fails its caller turns a readable rejection of a phase
 * attempt into a broken one — which is the one thing the requirement exists
 * to prevent. So a value that is not a record is "a record that cannot be
 * read", and PT-105-C-071-summary-codes records the divergence.
 */
export function readSummaryRecord(value: unknown): SummaryRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`the evidence is not a record of a verification gate: ${typeOf(value)}`);
  }
  const commands = (value as { commands?: unknown }).commands;
  if (commands !== undefined && !Array.isArray(commands)) {
    throw new Error("the field `commands` of the evidence is not a list");
  }
  return value as SummaryRecord;
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  return typeof value;
}

/** The outcome of the failure summary as a caller sees it. */
export type SummaryOutcome = {
  /** The text, which is the summary or one of the two notes. */
  readonly text: string;
  /** 0 where a text was produced, 2 where the call was not given one record. */
  readonly code: typeof SUMMARY_OK_CODE | typeof SUMMARY_USAGE_CODE;
  /** The usage line, where the code is 2. */
  readonly usage?: string | undefined;
};

/**
 * The failure summary of a call: the record is read, and a record that cannot
 * be read IS ITSELF THE NEWS — the text says so and the code stays 0. A call
 * that was not given exactly one record gives the code 2 and the usage line.
 */
export function failureSummaryOfCall(input: {
  /** The records the call was given, by whatever handle the caller uses. */
  readonly records: readonly unknown[];
  /** How a record is read: the parse, which may throw. */
  readonly read: (handle: unknown) => SummaryRecord;
  readonly lines?: TailLines | undefined;
}): SummaryOutcome {
  if (input.records.length !== RECORDS_TAKEN) {
    return Object.freeze({ text: "", code: SUMMARY_USAGE_CODE, usage: USAGE_LINE });
  }
  let record: SummaryRecord;
  try {
    record = readSummaryRecord(input.read(input.records[0]));
  } catch (error) {
    return Object.freeze({ text: `${unreadableMessage(error)}\n`, code: SUMMARY_OK_CODE });
  }
  return Object.freeze({
    text: renderFailureSummary(record, input.lines ?? resolveTailLines()),
    code: SUMMARY_OK_CODE,
  });
}
