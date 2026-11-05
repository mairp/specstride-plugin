/**
 * T020 — the signal table of the view, AS DATA
 * (`specs/129-run-view-and-status/contracts/signal-table.md`).
 *
 * The reducer names no event type. It reads this table of rows
 * `event type -> signal -> what the view holds`. A type that the table does
 * not hold is ignored: it changes no field, it moves the cursor, and it makes
 * nothing fail (rule 3 of the contract; F100-FR-199, F129-FR-005). A type
 * that carries the mark `ignored` is treated the same way at run time; the
 * mark says that the omission is a decision and not an oversight (rule 4).
 */

/** The signals of the table; one function of `src/reduce/signals.ts` per signal. */
export const SIGNALS = [
  "run",
  "launch",
  "pause",
  "quota",
  "billing",
  "alert",
  "capExceeded",
  "usage",
  "strategy",
  "phase",
  "phaseAttempt",
  "pass",
  "yield",
  "evidence",
  "verification",
  "check",
  "job",
  "unit",
  "criticSelected",
  "criticCall",
  "verdict",
  "blocked",
  "supervision",
  "countsReset",
  "latestTool",
  "observability",
  "streamDiagnostic",
  "telemetry",
  "parallel",
] as const;
export type Signal = (typeof SIGNALS)[number];

/** One row of the table: the types it covers, its signal, and what the view holds. */
export type SignalRow = {
  readonly types: readonly string[];
  readonly signal: Signal;
  readonly holds: string;
};

/** The 29 rows of "Types the view reads" of `contracts/signal-table.md`. */
export const SIGNAL_TABLE: readonly SignalRow[] = Object.freeze([
  {
    types: ["run.started", "run.ended"],
    signal: "run",
    holds: "Start of the elapsed time; end of the run; `synthesized`",
  },
  {
    types: ["run.launched"],
    signal: "launch",
    holds: "Launch, engine start ordinal, the counts that survive",
  },
  {
    types: ["run.paused", "run.resumed"],
    signal: "pause",
    holds: "State cross-check with the pause record; the timeline",
  },
  { types: ["quota.signal"], signal: "quota", holds: "Quota state of the budget row" },
  {
    types: ["fallback.switched", "fallback.restored"],
    signal: "billing",
    holds: "Cost class of later budget rows",
  },
  { types: ["alert"], signal: "alert", holds: "Level of the budget row; the item `budget-alert`" },
  { types: ["budget.exceeded"], signal: "capExceeded", holds: "Level `over`" },
  { types: ["usage.reported", "usage.unavailable"], signal: "usage", holds: "Budget rows" },
  {
    types: ["strategy.selected"],
    signal: "strategy",
    holds: "`strategy`; the fallback reason of the group `parallel`",
  },
  {
    types: ["phase.started", "phase.ended"],
    signal: "phase",
    holds: "Current phase; number of phases; `phases[]` title; approved",
  },
  {
    types: ["attempt.started", "attempt.ended"],
    signal: "phaseAttempt",
    holds: "Phase attempt ordinal; strategy",
  },
  {
    types: ["pass.started", "pass.ended"],
    signal: "pass",
    holds: "Pass ordinal; lane `proposing`; agent hours",
  },
  {
    types: ["yield.started", "yield.ended"],
    signal: "yield",
    holds: "The flag `yielded` of the card; the timeline",
  },
  {
    types: ["evidence.present", "evidence.written"],
    signal: "evidence",
    holds: "`phases[]`: evidence exists",
  },
  {
    types: ["verification.started", "verification.ended"],
    signal: "verification",
    holds: "Lane `verifying`",
  },
  { types: ["check.started", "check.ended"], signal: "check", holds: "Lane `verifying`" },
  {
    types: ["job.started", "job.step", "job.first_failure", "job.ended"],
    signal: "job",
    holds: "Lane `verifying`; the timeline",
  },
  { types: ["microloop.unit"], signal: "unit", holds: "Units done; reason a layer is off" },
  { types: ["critic.selected"], signal: "criticSelected", holds: "The timeline" },
  { types: ["critic.started", "critic.call"], signal: "criticCall", holds: "Lane `reviewing`" },
  {
    types: ["verdict.recorded"],
    signal: "verdict",
    holds: "The reject count, the MALFORMED count, `phases[]`: feedback exists, the timeline",
  },
  {
    types: ["blocked", "unblocked"],
    signal: "blocked",
    holds: "The item `blocked-on-human` or `source-changed`; the need",
  },
  {
    types: ["supervisor.observed", "supervisor.relaunch", "supervisor.stopped"],
    signal: "supervision",
    holds: "Relaunch counts; the timeline",
  },
  { types: ["counters.reset"], signal: "countsReset", holds: "The counts" },
  { types: ["tool.call"], signal: "latestTool", holds: "`activity.latestTool`" },
  {
    types: ["stream.mode"],
    signal: "observability",
    holds: "`activity`: observability mode and reason",
  },
  {
    types: ["stream.missing_terminal", "stream.diagnostic"],
    signal: "streamDiagnostic",
    holds: "The timeline",
  },
  { types: ["telemetry.delivery"], signal: "telemetry", holds: "`telemetry[]`" },
  {
    types: [
      "parallel.plan",
      "parallel.admission",
      "parallel.group.started",
      "parallel.group.ended",
      "parallel.worker.started",
      "parallel.worker.ended",
      "parallel.integration",
    ],
    signal: "parallel",
    holds: "The group `parallel`; worker passes count as passes",
  },
] as const);

/** The types of "Types marked `ignored`" of `contracts/signal-table.md`. */
export const IGNORED_TYPES: readonly string[] = Object.freeze([
  "harness.error",
  "host.quota_observed",
  "pipeline.started",
  "pipeline.ended",
  "stage.started",
  "stage.ended",
  "launch.checked",
  "digest.written",
  "attempt.archived",
  "attempt.acceleration_note",
  "attempt.tier_bumped",
  "attempt.tier_bump_skipped",
  "escalation.skipped",
  "recovery.triggered",
  "recovery.diagnosis_started",
  "recovery.diagnosis_done",
  "recovery.diagnosis_failed",
  "gate.oscillation",
  "pass.limits_set",
  "pass.killed",
  "pass.short",
  "pass.halted",
  "prompt.built",
  "prompt.block_dropped",
  "prompt.block_protected",
  "progress.swept",
  "commit.made",
  "plugin.installed",
  "plugin.install_failed",
  "plugin.install_denied",
  "stream.init",
  "stream.text",
  "stream.result",
  "stream.evidence_writing",
  "verification.release_passed",
  "verification.prestaged",
  "yield.waiting",
  "yield.refused",
  "resource.wait",
  "task.planned",
  "task.ticked",
  "tasks.ticked",
  "critic.grounding_gap",
  "critic.grounding_carried",
  "critic.malformed",
  "verdict.adjudicated",
  "route.decided",
  "integrity.noted",
  "integrity.events_changed",
  "learning.observed",
  "learning.knob_adjusted",
  "learning.knob_auto_reverted",
  "learning.knob_evaluated",
  "event.dropped",
  "redaction.commit_blocked",
  "redaction.dropped",
  "microloop.inert",
  "checkpoint.accepted",
  "checkpoint.refused",
  "checkpoint.removed",
  "check.excluded",
  "check.admission",
  "check.parallelism_lowered",
  "tripwire.raised",
  "tripwire.cleared",
  "source.change_accepted",
  "fallback.skipped",
  "terms.override_used",
  "critic.citation_unresolved",
]);

/**
 * T057 (CT-129-16) — the event types that OPEN one of the five pairs the lane
 * table reads (`contracts/lane-and-attention.md`, F129-FR-016), as data beside
 * the signal table: the opening event of a pair has it open, and any later
 * event of the stream is the newest word on the run, so no pair reads open
 * behind it. The reducer reads this table and names no type itself.
 */
export const PAIR_OPENERS: Readonly<
  Record<string, "critic" | "verification" | "pass" | "unit" | "workerPass">
> = Object.freeze({
  "critic.started": "critic",
  "critic.call": "critic",
  "verification.started": "verification",
  "check.started": "verification",
  "job.started": "verification",
  "pass.started": "pass",
  "microloop.unit": "unit",
  "parallel.worker.started": "workerPass",
});

/** The prefix of an event type that is free for third parties (F100-FR-199). */
export const THIRD_PARTY_PREFIX = "x." as const;

const BY_TYPE: ReadonlyMap<string, Signal> = new Map(
  SIGNAL_TABLE.flatMap((row) => row.types.map((type) => [type, row.signal] as const)),
);

/** The types the view reads, in the order of the table. */
export const TYPES_WITH_A_ROW: readonly string[] = Object.freeze([...BY_TYPE.keys()]);

/**
 * The signal of an event type, or `undefined` when the table holds no row for
 * it — a marked type, a type added to the catalogue later, a type of a later
 * minor, or a type with the prefix `x.` (rules 3 and 4).
 */
export function signalOf(type: string): Signal | undefined {
  return BY_TYPE.get(type);
}

/** True when the table carries the mark `ignored` for the type (rule 4). */
export function isMarkedIgnored(type: string): boolean {
  return type.startsWith(THIRD_PARTY_PREFIX) || IGNORED_TYPES.includes(type);
}
