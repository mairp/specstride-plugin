/**
 * T005, T006 — the type of the view `specstride.view/1` and the constants of
 * its schema (`contracts/run-view.md`; F129-FR-007, F129-FR-035).
 *
 * The coarse type that the generator of `@specstride/contracts` derives from
 * the schema file is `RunView` of `@specstride/contracts/records/run-view`;
 * this module gives the precise shape of the same record. The two are checked
 * against each other in `src/model/conformance.ts`.
 */
import {
  ATTENTION_KINDS,
  BUDGET_LEVELS,
  COLLECTION_BOUNDS,
  LANES,
  LANE_TABLE_ROWS,
  LIVENESS_VALUES,
  MAJOR,
  QUOTA_STATES,
  SCHEMA_ID,
  STALE_REASONS,
  STATUS_LINE_KEYS,
  TEXT_CAP_BYTES,
} from "@specstride/contracts/records/run-view";
import { RUN_STATES } from "@specstride/contracts/state/run-state";

export {
  ATTENTION_KINDS,
  BUDGET_LEVELS,
  COLLECTION_BOUNDS,
  LANES,
  LANE_TABLE_ROWS,
  LIVENESS_VALUES,
  MAJOR,
  QUOTA_STATES,
  SCHEMA_ID,
  STALE_REASONS,
  STATUS_LINE_KEYS,
  TEXT_CAP_BYTES,
};

export type Lane = (typeof LANES)[number];
export type LaneTableRow = (typeof LANE_TABLE_ROWS)[number];
export type AttentionKind = (typeof ATTENTION_KINDS)[number];
export type BudgetLevel = (typeof BUDGET_LEVELS)[number];
export type Liveness = (typeof LIVENESS_VALUES)[number];
export type StaleReason = (typeof STALE_REASONS)[number];
export type QuotaState = (typeof QUOTA_STATES)[number];
export type StatusLineKey = (typeof STATUS_LINE_KEYS)[number];

/** A written state of annex E §E.2, `none` for a run with no record, or `unknown`. */
export const VIEW_STATES = [...RUN_STATES, "none", "unknown"] as const;
export type ViewState = (typeof VIEW_STATES)[number];

/** The range of event majors this read model accepts (F129-FR-005). */
export type MajorRange = { readonly from: number; readonly to: number };

/** The cursor the caller holds (F129-FR-003). */
export type ViewCursor = {
  readonly file: string | null;
  readonly offset: number;
  readonly lastSeq: number;
};

export type StaleCondition = {
  readonly reason: StaleReason;
  readonly majorFound: number | null;
  readonly majorsAccepted: MajorRange | null;
};

export type ViewConditions = {
  readonly dead: boolean;
  readonly stale: StaleCondition | null;
  readonly launchAbandoned: boolean;
};

export type ViewLaunch = {
  readonly launchId: string | null;
  readonly reason: string | null;
  readonly outcome: string | null;
  readonly engineStartId: string | number | null;
};

export type ViewUnits = { readonly done: number; readonly declared: number | null };

export type ViewProgress = {
  readonly phase: number | null;
  readonly phases: number | null;
  readonly phaseAttempt: number | null;
  readonly pass: number | null;
  readonly rejects: number;
  readonly malformed: number;
  readonly units: ViewUnits | null;
  readonly elapsedSeconds: number;
};

export type ViewStrategy = {
  readonly strategy: "classic" | "micro" | null;
  readonly microLevel: number | null;
  readonly layerOffReason: string | null;
};

export type ViewPhase = {
  readonly number: number;
  readonly title: string | null;
  readonly evidence: boolean;
  readonly approved: boolean;
  readonly feedback: boolean;
};

export type ViewCard = {
  readonly id: string;
  readonly feature: string | null;
  readonly phase: number | null;
  readonly lane: Lane;
  readonly ruleId: LaneTableRow;
  readonly flags: { readonly dead: boolean; readonly stale: boolean; readonly yielded: boolean };
};

export type ViewLane = { readonly lane: Lane; readonly cards: readonly string[] };

export type AttentionItem = {
  readonly kind: AttentionKind;
  readonly key: string;
  readonly since: string | null;
  readonly oneLine: string;
  readonly need: string | null;
  readonly next: string;
  readonly fields: Readonly<Record<string, unknown>>;
};

export type BudgetRow = {
  readonly scope: string;
  readonly role: string | null;
  readonly costClass: string | null;
  readonly spent: number | null;
  readonly tokens: number | null;
  readonly cap: number | null;
  readonly fraction: number | null;
  readonly level: BudgetLevel;
  readonly notional: boolean;
  readonly quota: QuotaState;
};

export type ProcessHolder = {
  readonly kind: string | null;
  readonly class: string | null;
  readonly pid: number | null;
};

export type ViewProcesses = {
  readonly holders: readonly ProcessHolder[];
  readonly omitted: number;
  readonly cut: number;
};

export type ViewSupervision = {
  readonly nextSeconds: number | null;
  readonly unchanged: number | null;
  readonly relaunchBudget: Readonly<Record<string, unknown>> | null;
};

export type ViewActivity = {
  readonly latestTool: { readonly name: string | null; readonly summary: string | null } | null;
  readonly observabilityMode: string | null;
  readonly observabilityReason: string | null;
};

export type TelemetryRow = { readonly sink: string; readonly delivery: string | null };

export type TimelineRow = {
  readonly seq: number;
  readonly ts: string | null;
  readonly kind: string;
  readonly text: string | null;
};

export type ViewTimeline = { readonly rows: readonly TimelineRow[]; readonly omitted: number };

export type ViewParallel = {
  readonly workers: number | null;
  readonly groups: number | null;
  readonly groupFailures: number | null;
  readonly refusals: number | null;
  readonly fallbackReason: string | null;
  readonly wallHours?: number | null;
  readonly agentHours?: number | null;
};

/** A gap in the sequence of `seq`, with the numbers on both sides (F129-FR-004). */
export type SeqGap = { readonly after: number; readonly before: number };

export type ViewDiagnostics = {
  readonly skippedLines: number;
  readonly gaps: readonly SeqGap[];
  readonly majorsSeen: readonly number[];
  readonly majorsAccepted: MajorRange;
  readonly majorsOutOfRange: number;
  readonly tornLastLine: boolean;
  readonly fieldsCut: readonly string[];
  readonly fieldsDropped: readonly string[];
  readonly redactorFailed: boolean;
};

/** The change signature of F129-FR-030, and its eight-character token. */
export type ViewSignature = {
  readonly record: Readonly<Record<string, unknown>>;
  readonly token: string;
};

/** A mark of one event of the stream: the `seq`, the time and the type. */
export type StreamMark = {
  readonly seq: number;
  readonly ts: string | null;
  readonly type: string;
};

/**
 * The marks of the fold itself: the first and the newest event folded, and
 * the times of `run.started` and `run.ended` (`contracts/run-view.md`, the
 * row `stream`). They are what `project` needs to recompute the age of the
 * newest event (F129-FR-013) and the elapsed time (F129-FR-010) from a view
 * alone, so that folding `reduce` event by event gives the same view as one
 * batch (F129-FR-002).
 */
export type ViewStream = {
  readonly first: StreamMark | null;
  readonly last: StreamMark | null;
  readonly runStartedAt: string | null;
  readonly runEndedAt: string | null;
  /**
   * T074 (F129-FR-022) — the accumulated seconds of every ENDED pass of the
   * run, the passes of workers included, and the start time of the pass that
   * is open. They live on the view so folding `reduce` one event at a time
   * accumulates exactly what one batch projection accumulates (F129-FR-002).
   * The agent hours of the group `parallel` are this sum, shown only where the
   * layer is on.
   */
  readonly passSeconds: number;
  readonly passStartedAt: string | null;
};

/**
 * The values `project` settled from the state files and the observations that
 * the derivation re-reads (`contracts/run-view.md`, the row `settled`).
 * F129-FR-002 requires that such a field be recomputed by `project` at every
 * call and never by `reduce`; `project` settles them once, and the derivation
 * reads them back from the record instead of looking at an input again.
 */
export type ViewSettled = {
  /** The heartbeat of the lease is past its `validUntil` at `now` (F129-FR-013). */
  readonly heartbeatLate: boolean;
  /** `status.staleEventSec`: the age after which the newest event counts as old. */
  readonly staleEventSec: number;
};

/** The view record `specstride.view/1` (`contracts/run-view.md`). */
export type RunView = {
  readonly schema: typeof SCHEMA_ID;
  readonly now: string;
  readonly runId: string | null;
  readonly workspaceId: string | null;
  readonly feature: string | null;
  readonly cursor: ViewCursor;
  readonly state: ViewState;
  readonly stateSince: string | null;
  readonly transition: string | null;
  readonly display: string;
  readonly liveness: Liveness;
  readonly conditions: ViewConditions;
  readonly launch: ViewLaunch;
  readonly progress: ViewProgress;
  readonly strategy: ViewStrategy;
  readonly phases: readonly ViewPhase[];
  readonly cards: readonly ViewCard[];
  readonly lanes: readonly ViewLane[];
  readonly laneTable: { readonly id: string; readonly version: string };
  readonly attention: readonly AttentionItem[];
  readonly attentionOmitted: number;
  readonly budget: readonly BudgetRow[];
  readonly budgetOmitted: number;
  readonly processes: ViewProcesses;
  readonly supervision: ViewSupervision | null;
  readonly activity: ViewActivity;
  readonly telemetry: readonly TelemetryRow[];
  readonly timeline: ViewTimeline;
  readonly parallel: ViewParallel | null;
  readonly diagnostics: ViewDiagnostics;
  readonly signature: ViewSignature;
  readonly stream: ViewStream;
  readonly settled: ViewSettled;
};

/** The id and version of the lane table the view was derived with (F129-FR-016). */
export const LANE_TABLE = Object.freeze({ id: "lane", version: "specstride.table/1" });
