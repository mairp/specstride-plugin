/**
 * T020 — the mutable draft the fold works on.
 *
 * `reduce` takes a view and one event and returns the next view (F129-FR-002).
 * It copies the groups it touches into a draft, lets the function of the signal
 * change the draft, and freezes the draft again. Nothing else of the view is
 * touched, so the fields that come from the state files and the observations
 * are never recomputed by `reduce` — only by `project`.
 */
import type {
  AttentionItem,
  BudgetRow,
  ProcessHolder,
  RunView,
  SeqGap,
  StreamMark,
  TelemetryRow,
  TimelineRow,
  ViewCard,
  ViewLane,
  ViewParallel,
  ViewPhase,
  ViewSettled,
  ViewSignature,
  ViewState,
} from "../model/view.ts";

export type PhaseDraft = {
  number: number;
  title: string | null;
  evidence: boolean;
  approved: boolean;
  feedback: boolean;
};

export type BudgetDraft = { -readonly [K in keyof BudgetRow]: BudgetRow[K] };

export type ViewDraft = {
  schema: RunView["schema"];
  now: string;
  runId: string | null;
  workspaceId: string | null;
  feature: string | null;
  cursor: { file: string | null; offset: number; lastSeq: number };
  state: ViewState;
  stateSince: string | null;
  transition: string | null;
  display: string;
  liveness: RunView["liveness"];
  conditions: {
    dead: boolean;
    stale: RunView["conditions"]["stale"];
    launchAbandoned: boolean;
  };
  launch: {
    launchId: string | null;
    reason: string | null;
    outcome: string | null;
    engineStartId: string | number | null;
  };
  progress: {
    phase: number | null;
    phases: number | null;
    phaseAttempt: number | null;
    pass: number | null;
    rejects: number;
    malformed: number;
    units: { done: number; declared: number | null } | null;
    elapsedSeconds: number;
  };
  strategy: {
    strategy: "classic" | "micro" | null;
    microLevel: number | null;
    layerOffReason: string | null;
  };
  phases: PhaseDraft[];
  cards: ViewCard[];
  lanes: ViewLane[];
  laneTable: { id: string; version: string };
  attention: AttentionItem[];
  attentionOmitted: number;
  budget: BudgetDraft[];
  budgetOmitted: number;
  processes: { holders: ProcessHolder[]; omitted: number; cut: number };
  supervision: RunView["supervision"];
  activity: {
    latestTool: { name: string | null; summary: string | null } | null;
    observabilityMode: string | null;
    observabilityReason: string | null;
  };
  telemetry: TelemetryRow[];
  timeline: { rows: TimelineRow[]; omitted: number };
  parallel: ViewParallel | null;
  diagnostics: {
    skippedLines: number;
    gaps: SeqGap[];
    majorsSeen: number[];
    majorsAccepted: { from: number; to: number };
    majorsOutOfRange: number;
    tornLastLine: boolean;
    fieldsCut: string[];
    fieldsDropped: string[];
    redactorFailed: boolean;
  };
  signature: ViewSignature;
  stream: {
    first: StreamMark | null;
    last: StreamMark | null;
    runStartedAt: string | null;
    runEndedAt: string | null;
    passSeconds: number;
    passStartedAt: string | null;
  };
  settled: { heartbeatLate: boolean; staleEventSec: number };
  /**
   * T055 — the settle-only values the raising of the attention items reads
   * (`../attention/raise.ts`). They come from the state files and the
   * observations, so `reduce` never recomputes them: a draft started from a
   * view holds none.
   */
  raise: {
    stateRaw: string | null;
    blocked: import("../attention/raise.ts").BlockedInput | null;
    pause: Readonly<Record<string, unknown>> | null;
    refusalFile: string | null;
    /** The `refusal` of the newest launch record, when the consumer caused it (T052). */
    refusal: string | null;
  };
};

/** A draft of the view: the groups the fold touches are copied, the rest shared. */
export function draftOf(view: RunView): ViewDraft {
  return {
    schema: view.schema,
    now: view.now,
    runId: view.runId,
    workspaceId: view.workspaceId,
    feature: view.feature,
    cursor: { ...view.cursor },
    state: view.state,
    stateSince: view.stateSince,
    transition: view.transition,
    display: view.display,
    liveness: view.liveness,
    conditions: { ...view.conditions },
    launch: { ...view.launch },
    progress: {
      ...view.progress,
      units: view.progress.units === null ? null : { ...view.progress.units },
    },
    strategy: { ...view.strategy },
    phases: view.phases.map((phase) => ({ ...phase })),
    cards: [...view.cards],
    lanes: [...view.lanes],
    laneTable: { ...view.laneTable },
    attention: [...view.attention],
    attentionOmitted: view.attentionOmitted,
    budget: view.budget.map((row) => ({ ...row })),
    budgetOmitted: view.budgetOmitted,
    processes: {
      holders: [...view.processes.holders],
      omitted: view.processes.omitted,
      cut: view.processes.cut,
    },
    supervision: view.supervision,
    activity: {
      latestTool: view.activity.latestTool === null ? null : { ...view.activity.latestTool },
      observabilityMode: view.activity.observabilityMode,
      observabilityReason: view.activity.observabilityReason,
    },
    telemetry: [...view.telemetry],
    timeline: { rows: [...view.timeline.rows], omitted: view.timeline.omitted },
    parallel: view.parallel === null ? null : { ...view.parallel },
    diagnostics: {
      ...view.diagnostics,
      gaps: view.diagnostics.gaps.map((gap) => ({ ...gap })),
      majorsSeen: [...view.diagnostics.majorsSeen],
      majorsAccepted: { ...view.diagnostics.majorsAccepted },
      fieldsCut: [...view.diagnostics.fieldsCut],
      fieldsDropped: [...view.diagnostics.fieldsDropped],
    },
    signature: view.signature,
    stream: {
      first: view.stream.first === null ? null : { ...view.stream.first },
      last: view.stream.last === null ? null : { ...view.stream.last },
      runStartedAt: view.stream.runStartedAt,
      runEndedAt: view.stream.runEndedAt,
      passSeconds: view.stream.passSeconds,
      passStartedAt: view.stream.passStartedAt,
    },
    settled: { ...view.settled },
    raise: { stateRaw: null, blocked: null, pause: null, refusalFile: null, refusal: null },
  };
}

/** The draft as a frozen view again. */
export function viewOf(draft: ViewDraft): RunView {
  return Object.freeze({
    schema: draft.schema,
    now: draft.now,
    runId: draft.runId,
    workspaceId: draft.workspaceId,
    feature: draft.feature,
    cursor: Object.freeze({ ...draft.cursor }),
    state: draft.state,
    stateSince: draft.stateSince,
    transition: draft.transition,
    display: draft.display,
    liveness: draft.liveness,
    conditions: Object.freeze({ ...draft.conditions }),
    launch: Object.freeze({ ...draft.launch }),
    progress: Object.freeze({
      ...draft.progress,
      units: draft.progress.units === null ? null : Object.freeze({ ...draft.progress.units }),
    }),
    strategy: Object.freeze({ ...draft.strategy }),
    phases: Object.freeze(
      draft.phases.map((phase) => Object.freeze({ ...phase })),
    ) as readonly ViewPhase[],
    cards: Object.freeze([...draft.cards]),
    lanes: Object.freeze([...draft.lanes]),
    laneTable: Object.freeze({ ...draft.laneTable }),
    attention: Object.freeze([...draft.attention]),
    attentionOmitted: draft.attentionOmitted,
    budget: Object.freeze(draft.budget.map((row) => Object.freeze({ ...row }))),
    budgetOmitted: draft.budgetOmitted,
    processes: Object.freeze({
      holders: Object.freeze([...draft.processes.holders]),
      omitted: draft.processes.omitted,
      cut: draft.processes.cut,
    }),
    supervision: draft.supervision,
    activity: Object.freeze({
      latestTool:
        draft.activity.latestTool === null ? null : Object.freeze({ ...draft.activity.latestTool }),
      observabilityMode: draft.activity.observabilityMode,
      observabilityReason: draft.activity.observabilityReason,
    }),
    telemetry: Object.freeze([...draft.telemetry]),
    timeline: Object.freeze({
      rows: Object.freeze([...draft.timeline.rows]),
      omitted: draft.timeline.omitted,
    }),
    parallel: draft.parallel === null ? null : Object.freeze({ ...draft.parallel }),
    diagnostics: Object.freeze({
      ...draft.diagnostics,
      gaps: Object.freeze(draft.diagnostics.gaps.map((gap) => Object.freeze({ ...gap }))),
      majorsSeen: Object.freeze([...draft.diagnostics.majorsSeen]),
      majorsAccepted: Object.freeze({ ...draft.diagnostics.majorsAccepted }),
      fieldsCut: Object.freeze([...draft.diagnostics.fieldsCut]),
      fieldsDropped: Object.freeze([...draft.diagnostics.fieldsDropped]),
    }),
    signature: draft.signature,
    stream: Object.freeze({
      first: draft.stream.first === null ? null : Object.freeze({ ...draft.stream.first }),
      last: draft.stream.last === null ? null : Object.freeze({ ...draft.stream.last }),
      runStartedAt: draft.stream.runStartedAt,
      runEndedAt: draft.stream.runEndedAt,
      passSeconds: draft.stream.passSeconds,
      passStartedAt: draft.stream.passStartedAt,
    }),
    settled: Object.freeze({ ...draft.settled }) as ViewSettled,
  });
}
