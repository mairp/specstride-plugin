/**
 * T021 — the inputs of `project`, and EXACTLY those (F129-FR-001).
 *
 * The four inputs the requirement names are the four keys of this record: the
 * event stream of the run, the named state files, the observations the caller
 * supplies, and the time now. There is no other input. `project` does no input
 * or output, reads no clock and uses no randomness: `now` is a value the caller
 * hands in, and the event stream arrives as values that the event reader
 * outside the pure core produced (F129-FR-032).
 */
import type { EventEnvelope } from "@specstride/contracts/envelope/event";
import type { RunView, SeqGap } from "./view.ts";

/** The names of the four inputs of F129-FR-001, in the order of the requirement. */
export const PROJECT_INPUT_KEYS = ["events", "stateFiles", "observations", "now"] as const;
export type ProjectInputKey = (typeof PROJECT_INPUT_KEYS)[number];

/** What the event reader of F129-FR-032 found, besides the events themselves. */
export type ReaderDiagnostics = {
  /** A last line without its line end, or one that is not a complete record. */
  readonly tornLastLine?: boolean;
  /** Complete lines in the middle that are not a record of the schema. */
  readonly skippedLines?: number;
  /** Gaps in the sequence of `seq`, with the numbers on both sides. */
  readonly gaps?: readonly SeqGap[];
};

/**
 * The event stream of the run, as the caller read it: the events, where the
 * reader stopped, and — for F129-FR-003 — a cached view and the events AFTER
 * its cursor instead of the whole file.
 */
export type EventStreamInput = {
  readonly events: readonly EventEnvelope[];
  /** The logical name of the event file the cursor names. */
  readonly file?: string | null;
  /** The byte offset after the last complete line the reader read. */
  readonly offset?: number;
  /** A cached view to continue from, or null to project from the first event. */
  readonly cachedView?: RunView | null;
  readonly diagnostics?: ReaderDiagnostics;
};

/** The three named state files of F129-FR-001 and annex G §G.6. */
export type StateFilesInput = {
  readonly runRecord: Readonly<Record<string, unknown>> | null;
  readonly terminalRecord: Readonly<Record<string, unknown>> | null;
  readonly pauseRecord: Readonly<Record<string, unknown>> | null;
};

/** The result of a probe of the lease, with the lease's own fields. */
export type LeaseObservation = {
  /** A member of the closed set row 23 of annex X §X.6 (EP-13 `probe`). */
  readonly probe: string;
  readonly lease?: Readonly<Record<string, unknown>> | null;
};

/** The five observations of `contracts/observations.md`, and nothing else. */
export type ObservationsInput = {
  readonly lease: LeaseObservation | null;
  readonly newestLaunchRecord: Readonly<Record<string, unknown>> | null;
  readonly supervisionRecord: Readonly<Record<string, unknown>> | null;
  readonly processTableSearch: readonly Readonly<Record<string, unknown>>[] | null;
  /** The limit of the handshake, in seconds. */
  readonly handshakeLimitSec: number | null;
};

/** The inputs of `project`: exactly the four of F129-FR-001. */
export type ProjectInputs = {
  readonly events: EventStreamInput;
  readonly stateFiles: StateFilesInput;
  readonly observations: ObservationsInput;
  readonly now: string;
};
