/**
 * T036 — the refusal `source-changed`: the launch record and the derived
 * state (F102-FR-015, F102-FR-016, F102-FR-021, F102-FR-036;
 * contracts/resume-refusals.md).
 *
 * WHAT THE CLI WRITES — and what it never writes. The refusal is recorded in
 * the launch record (outcome `refused`, the file named) and NEVER as run
 * state; readers derive `blocked-on-human` with the attention item
 * `source-changed` from the record (F102-FR-016, research.md D-4). The CLI
 * writes NO event: the event `blocked`, with the reason `source-changed` and
 * the file, is written by the NEXT process that becomes the writer of the
 * event file, marked as synthesized (F102-FR-016, F102-FR-036). The record
 * this module builds therefore carries the description of that synthesized
 * event as DATA for the next writer — never the event itself.
 *
 * THE MESSAGE (F102-FR-021). In default output the refusal names the file
 * and offers the three ways out: revert the change, `resume
 * --accept-source-change`, `launch --new-run`.
 *
 * Under the `parity` profile the refusal is not raised at all (F102-FR-018;
 * T038 wires the switch `staleness.check_points` in `source-compare.ts`).
 */
import {
  COMPARED_SOURCES,
  defaultRefusalLine,
  SOURCE_CHANGED_REFUSAL,
  WAYS_OUT_OF_SOURCE_CHANGED,
  type ComparedSource,
} from "./refusals.ts";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F102-FR-015", "F102-FR-016", "F102-FR-021", "F102-FR-036"] as const;

/** The refusal code of the closed set (row 51 of annex X §X.6). */
export const REFUSAL = SOURCE_CHANGED_REFUSAL;

/** The exit code of the refusal, as ruling K2 / DV-021 fixed it. */
export const EXIT = 3 as const;

/** F102-FR-016 — readers derive this run state from the launch record. */
export const DERIVED_STATE = "blocked-on-human" as const;

/** F102-FR-016 — the attention item the derived state carries. */
export const ATTENTION_ITEM = "source-changed" as const;

/** F102-FR-016 — the CLI writes no run state and no event. */
export const THE_CLI_WRITES_NO_RUN_STATE_OR_EVENT = true as const;

/**
 * F102-FR-016, F102-FR-036 — who writes the synthesized `blocked` event: the
 * next process that becomes the writer of the event file, never the CLI.
 */
export const SYNTHESIZED_BLOCKED_WRITTEN_BY = "the next writer of the event file" as const;

/** The three sources the refusal can name (row 50 of annex X §X.6). */
export const NAMED_SOURCES = COMPARED_SOURCES;

/** The description of the synthesized `blocked` event, for the next writer. */
export type SynthesizedBlockedEvent = {
  readonly type: "blocked";
  /** The event is synthesized: the run state itself was written by nobody. */
  readonly synthesized: true;
  readonly reason: "source-changed";
  /** The changed file the event names (one of `spec`, `plan`, `tasks`). */
  readonly file: string;
  /** F102-FR-016 — who writes it: never the CLI. */
  readonly writtenBy: "the next writer of the event file";
};

/** What the refusal leaves behind, as the caller observes it. */
export type SourceChangedRefusal = {
  readonly refusal: typeof REFUSAL;
  readonly exit: typeof EXIT;
  /** Every changed file, in the order of the compared sources. */
  readonly files: readonly ComparedSource[];
  /** The files as the launch record names them (`refusalFile`). */
  readonly namedFiles: string;
  /** The fields the launch record carries for the refusal. */
  readonly launchRecordFields: {
    readonly outcome: "refused";
    readonly refusal: typeof REFUSAL;
    readonly refusalFile: string;
  };
  /** The state readers derive from the record; the CLI writes no run state. */
  readonly derivedState: typeof DERIVED_STATE;
  readonly attentionItem: typeof ATTENTION_ITEM;
  /** The lines the command prints, in order. */
  readonly lines: readonly { readonly stream: "stdout" | "stderr"; readonly text: string }[];
  /** The synthesized `blocked` event, as DATA for the next writer. */
  readonly synthesizedEventForNextWriter: SynthesizedBlockedEvent;
  /** F102-FR-021 — the three ways out, by name. */
  readonly waysOut: readonly string[];
};

/**
 * Build the refusal `source-changed` for EVERY changed file (F102-FR-015:
 * the refusal names every changed file). `message` is the comparison line of
 * `source-compare.ts`, printed on standard error.
 */
export function refuseSourceChanged(
  changed: readonly ComparedSource[],
  message: string,
): SourceChangedRefusal {
  const files = COMPARED_SOURCES.filter((source) => changed.includes(source));
  const namedFiles = (files.length > 0 ? files : changed).join(", ");
  return Object.freeze({
    refusal: REFUSAL,
    exit: EXIT,
    files,
    namedFiles,
    launchRecordFields: Object.freeze({
      outcome: "refused" as const,
      refusal: REFUSAL,
      refusalFile: namedFiles,
    }),
    derivedState: DERIVED_STATE,
    attentionItem: ATTENTION_ITEM,
    lines: Object.freeze([
      Object.freeze({ stream: "stderr" as const, text: message }),
      Object.freeze({
        stream: "stdout" as const,
        text: defaultRefusalLine(REFUSAL, `the source changed (${namedFiles})`),
      }),
    ]),
    synthesizedEventForNextWriter: Object.freeze({
      type: "blocked" as const,
      synthesized: true as const,
      reason: "source-changed" as const,
      file: namedFiles,
      writtenBy: SYNTHESIZED_BLOCKED_WRITTEN_BY,
    }),
    waysOut: WAYS_OUT_OF_SOURCE_CHANGED,
  });
}
