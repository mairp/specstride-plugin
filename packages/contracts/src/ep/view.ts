/**
 * T150 — the interface types of EP-09, the UI read model (`RunView`), from
 * `contracts/extension-points/EP-09.view.json` and annex G, §G.6
 * (F100-FR-188).
 *
 * `specstride.view/1`. One read model of a run for every renderer, so that no
 * renderer opens the event file or derives a lane by itself. The schema of
 * the view is delivered by feature 129 to this package under the same id.
 */
import type { EventEnvelope } from "../envelope/event.ts";

export const POINT_ID = "specstride.view/1" as const;
export const EP = "EP-09" as const;
export const ANNEX_SECTION = "annex G, §G.6" as const;

/** F100-FR-188 — the two pure operations of the point. */
export const OPERATIONS = ["project", "reduce"] as const;
export type ViewOperation = (typeof OPERATIONS)[number];

/** The derived conditions the view carries (§G.6, Outputs). */
export const DERIVED_CONDITIONS = ["dead", "stale", "launch-abandoned"] as const;
export type DerivedCondition = (typeof DERIVED_CONDITIONS)[number];

/** The named state files the read model may read, and no other input (F100-FR-188). */
export const NAMED_STATE_FILES = [
  "the run record",
  "the terminal record",
  "the pause record",
] as const;

/**
 * The cursor the CALLER holds: file, offset, last `seq`, and 8 hexadecimal
 * characters of a hash of the change signature, so that a change of a state
 * file or of the clock moves the cursor too.
 */
export type Cursor = {
  readonly file: string;
  readonly offset: number;
  readonly lastSeq: number;
  /** Eight hexadecimal characters. */
  readonly changeSignature: string;
};

/** The length of the hash of the change signature, in hexadecimal characters. */
export const CHANGE_SIGNATURE_LENGTH = 8 as const;

/** One attention item of the view. */
export type AttentionItem = {
  readonly id: string;
  readonly text: string;
  /** For a run blocked on a human: what the run needs. For a changed source: the file. */
  readonly needs?: string;
  readonly file?: string;
};

/** One lane of the view, derived in the read model and never in a renderer. */
export type Lane = {
  readonly id: string;
  readonly label: string;
  readonly state: string;
};

/** The budget levels of the view. */
export type BudgetLevels = Readonly<
  Record<string, { readonly spent: number; readonly limit: number | null }>
>;

/** The read model of a run (§G.6, Outputs). */
export type RunView = {
  readonly state: string;
  readonly dead: boolean;
  readonly stale: boolean;
  readonly launchAbandoned: boolean;
  readonly lanes: readonly Lane[];
  readonly attention: readonly AttentionItem[];
  readonly budgets: BudgetLevels;
  readonly phase: number | null;
  readonly attempt: number | null;
  readonly pass: number | null;
  readonly strategy: string | null;
  /** The owner text of the lock that `status` prints for a running run. */
  readonly ownerText: string | null;
  readonly cursor: Cursor;
  /** The reason where the view is marked `stale`. */
  readonly staleReason?: string;
};

/** The values the caller supplies to the pure function `project` (§G.6, Inputs). */
export type ProjectInput = {
  readonly events: readonly EventEnvelope[];
  readonly runRecord: unknown;
  readonly terminalRecord: unknown;
  readonly pauseRecord: unknown;
  readonly leaseProbe: string;
  readonly newestLaunchRecord: unknown;
  readonly supervisionRecord: unknown;
  readonly processTableSearch: readonly number[];
  readonly handshakeLimitMs: number;
  readonly now: string;
  readonly cursor?: Cursor;
};

/** F100-FR-188 — the read model. */
export type ViewPort = {
  project(input: ProjectInput): RunView;
  reduce(view: RunView, event: EventEnvelope): RunView;
};

/** "Guarantees of the core" of §G.6, as data. */
export const CORE_GUARANTEES = [
  "lanes, attention items and budget levels are derived in the read model, never in a renderer",
  "projecting a batch equals folding event by event",
  "a cached view is disposable",
  "fields are additive inside a major",
  "the cursor is held by the caller",
] as const;

/** "Errors" of §G.6: a torn last line of the event file is tolerated. */
export const A_TORN_LAST_LINE_IS_TOLERATED = true as const;
/** An event major outside the accepted range gives a `stale` view and a doctor warning. */
export const MAJOR_OUTSIDE_THE_RANGE_MARKS: DerivedCondition = "stale";

/** "Guarantees of an implementation" of §G.6: a renderer is given no file handle. */
export const A_RENDERER_IS_GIVEN_A_FILE_HANDLE = false as const;
/** It renders every text that comes from a run as text. */
export const TEXT_FROM_A_RUN_IS_RENDERED_AS_TEXT = true as const;

/**
 * "Failure of an implementation" of §G.6 — the plainer path: a renderer that
 * fails prints one line that names the command `status --json`, and changes
 * no state.
 */
export const FAILURE_PATH =
  "a renderer that fails prints one line that names the command `status --json`; it changes no state" as const;
export const FAILURE_PATHS: Readonly<Record<ViewOperation, string>> = Object.freeze({
  project: FAILURE_PATH,
  reduce: FAILURE_PATH,
});

/**
 * Unknown-value rule of §G.6: an unknown event type and an unknown field are
 * ignored; an unknown state of the run is shown as `unknown` with an
 * attention item.
 */
export const STATE_WHEN_UNKNOWN = "unknown" as const;
export function unknownStateItem(state: string): AttentionItem {
  return Object.freeze({
    id: "state-unknown",
    text: `the state \`${state}\` is not a state of the run-state machine; shown as \`unknown\` (annex G, §G.6)`,
  });
}
