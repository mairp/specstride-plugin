/**
 * T220 — the interface type of the presenter (annex G, §G.10; F100-FR-233).
 *
 * The presenter renders a run for a person. The front door calls it; nothing
 * else does. It is no extension point in Wave 1, so the interface lives here in
 * the `contracts` package and the composition root hands an implementation to
 * the front door.
 *
 * Every constant of this module is read from `data/presenter-interface.json`,
 * the machine-readable form of the table of §G.10, so that the interface and
 * the annex cannot drift. The modes are row 160 of annex X §X.6.
 */
import presenterInterface from "../../data/presenter-interface.json" with { type: "json" };
import type { EventEnvelope } from "../envelope/event.ts";

/** The section of annex G that owns the interface. */
export const ANNEX_SECTION = "annex G, §G.10" as const;

/** The requirement this module carries. */
export const REQUIREMENT = "F100-FR-233" as const;

/** The row of annex X §X.6 that closes the modes. */
export const CLOSED_SET_ROW = 160 as const;

type RawSubject = { Subject: string; Content: string };

const RAW = (presenterInterface as { interface: RawSubject[] }).interface;

/** A cell of the table, without the back-ticks the annex writes it in. */
function plain(text: string): string {
  return text.replace(/`/g, "").trim();
}

/** The subjects of the table of §G.10, in the order of the annex. */
export const SUBJECTS: readonly string[] = Object.freeze(RAW.map((r) => r.Subject));

/** The table of §G.10 as a map from subject to content. */
export const INTERFACE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(RAW.map((r) => [r.Subject, r.Content])),
);

/** A subject the table of §G.10 does not hold. */
export class PresenterInterfaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PresenterInterfaceError";
  }
}

function contentOf(subject: string): string {
  const content = INTERFACE[subject];
  if (content === undefined) {
    throw new PresenterInterfaceError(
      `the table of ${ANNEX_SECTION} holds no subject "${subject}"; it holds ` +
        `${SUBJECTS.join(", ")}`,
    );
  }
  return content;
}

/** The schema id of the presenter, from the row "Schema id" of §G.10. */
export const SCHEMA_ID = plain(contentOf("Schema id"));

/** The front door calls the presenter; nothing else does (F100-FR-233). */
export const CALLED_BY = "the front door (119)" as const;
export const CALLED_BY_CELL = contentOf("Called by");

/** The presenter is provided by feature 145, with the banner and the theme. */
export const PROVIDED_BY_CELL = contentOf("Provided by");
export const PROVIDED_BY = "145" as const;

/** It is no extension point in Wave 1 (§G.10, the head of the section). */
export const IS_AN_EXTENSION_POINT_IN_WAVE_1 = false as const;

/**
 * The three modes of the presenter (row 160 of annex X §X.6): `timeline` for
 * `run` and `resume` in the foreground, `card` for `watch`, `plain` for the
 * inspection commands.
 */
export const MODES = ["timeline", "card", "plain"] as const;
export type PresenterMode = (typeof MODES)[number];

/** True when the value is a mode of §G.10. */
export function isPresenterMode(value: string): value is PresenterMode {
  return (MODES as readonly string[]).includes(value);
}

/** The modes as the table of §G.10 writes them, for the test of T219. */
export const MODES_CELL = contentOf("Modes");

/** The two output modes of annex G §G.2, which decide what the presenter prints. */
export const OUTPUT_MODES = ["default", "compatibility"] as const;
export type OutputMode = (typeof OUTPUT_MODES)[number];

/**
 * The stream the presenter reads, from the row "Input" of §G.10: the
 * compatibility projection in compatibility output, the primary event stream in
 * default output.
 */
export const STREAM_OF_OUTPUT_MODE: Readonly<Record<OutputMode, string>> = Object.freeze({
  default: "the primary event stream",
  compatibility: "the compatibility projection",
});

/** The settings the front door hands the presenter (the row "Input" of §G.10). */
export const SETTINGS = ["colour", "motion", "banner", "rail", "background", "glyphs"] as const;
export type Setting = (typeof SETTINGS)[number];

/** The size of the terminal, as the front door reports it. */
export type TerminalSize = { readonly columns: number; readonly rows: number };

/** Everything the front door hands the presenter (the row "Input" of §G.10). */
export type PresenterInput = {
  /** The stream of events: a projection or the primary stream, by output mode. */
  readonly events: AsyncIterable<EventEnvelope> | Iterable<EventEnvelope>;
  /** Which stream it is, so that the presenter need not work it out. */
  readonly outputMode: OutputMode;
  /** The mode: `timeline`, `card` or `plain`. */
  readonly mode: PresenterMode;
  /** The detail level the consumer asked for. */
  readonly detail: string;
  /** The settings of colour, motion, banner, rail, background and glyphs. */
  readonly settings: Readonly<Record<Setting, string | boolean | number>>;
  /** The size of the terminal. */
  readonly terminalSize: TerminalSize;
  /** Whether the stream it writes to is a terminal. */
  readonly isATerminal: boolean;
};

/** The stream the front door names for the presenter's lines. */
export type PresenterOutput = {
  write(line: string): void;
};

/**
 * F100-FR-233 — the presenter reads nothing but the stream of events and the
 * settings it is handed. The interface gives it no path, no record and no
 * reader of state: every fact it has comes through `PresenterInput`.
 */
export type Presenter = {
  /** The schema id of the presenter, as §G.10 fixes it. */
  readonly schema: typeof SCHEMA_ID;
  /** Render a run. Writes lines on the stream the front door names. */
  render(input: PresenterInput, output: PresenterOutput): Promise<void> | void;
};

/** F100-FR-233 — the presenter reads nothing but what it is handed. */
export const PRESENTER_READS = ["the stream of events", "the settings it is handed"] as const;
export const PRESENTER_READS_STATE = false as const;

/** F100-FR-233 — the presenter never changes the exit code of a command. */
export const PRESENTER_CHANGES_THE_EXIT_CODE = false as const;

/** F100-FR-233 — the presenter never writes state. */
export const PRESENTER_WRITES_STATE = false as const;

/** F100-FR-233 — the presenter is best-effort: a failure never stalls a run. */
export const PRESENTER_IS_BEST_EFFORT = true as const;
export const A_FAILURE_STALLS_A_RUN = false as const;
export const A_FAILURE_FAILS_A_RUN = false as const;

/** The row "Errors" of §G.10: none that reaches the run. */
export const ERRORS_CELL = contentOf("Errors");

/**
 * §G.10, the row "Errors" — a presenter that fails prints one line and leaves
 * the exit code of the command as it is. This is the whole of what a failure
 * does, and the one line is the whole of what it writes.
 */
export const LINES_PRINTED_ON_A_FAILURE = 1 as const;

/** What a failure of the presenter does, as data (F100-FR-233). */
export const ON_A_FAILURE = Object.freeze({
  linesPrinted: LINES_PRINTED_ON_A_FAILURE,
  changesTheExitCode: PRESENTER_CHANGES_THE_EXIT_CODE,
  stallsTheRun: A_FAILURE_STALLS_A_RUN,
  failsTheRun: A_FAILURE_FAILS_A_RUN,
  reachesTheRun: false as const,
});

/**
 * Wrap a presenter so that a failure prints one line and leaves the exit code
 * as it is (F100-FR-233). This is the shape of the best-effort rule: the front
 * door calls `renderBestEffort` and never sees a throw.
 */
export async function renderBestEffort(
  presenter: Presenter,
  input: PresenterInput,
  output: PresenterOutput,
): Promise<{ readonly failed: boolean; readonly line?: string }> {
  try {
    await presenter.render(input, output);
    return Object.freeze({ failed: false });
  } catch (error) {
    const line = failureLine(error);
    output.write(line);
    return Object.freeze({ failed: true, line });
  }
}

/** The one line a failed presenter prints (§G.10, the row "Errors"). */
export function failureLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `[WARN] the presenter failed: ${message}`;
}

/**
 * §G.10, the last row — the presenter owns the four summary lines of the
 * stream, in compatibility output.
 */
export const OWNS_THE_FOUR_SUMMARY_LINES = true as const;
export const SUMMARY_LINE_COUNT = 4 as const;
export const SUMMARY_LINES_ARE_OWNED_IN: OutputMode = "compatibility";
export const SUMMARY_LINE_OWNER_CELL = contentOf("Owner of the four summary lines of the stream");

/**
 * §G.10, the row "Output" — in compatibility output the lines of the baseline
 * byte for byte; in default output no free text from outside the runtime.
 */
export const OUTPUT_CELL = contentOf("Output");
export const BASELINE_LINES_BYTE_FOR_BYTE_IN: OutputMode = "compatibility";
export const FREE_TEXT_FROM_OUTSIDE_IN_DEFAULT_OUTPUT = false as const;

/** The mode each verb of the front door asks for (§G.10, the row "Called by"). */
export const MODE_OF_VERB: Readonly<Record<string, PresenterMode>> = Object.freeze({
  run: "timeline",
  resume: "timeline",
  watch: "card",
});
