/**
 * T049 — table 1, `relaunch-observe`, and the relaunch by `supervise observe`
 * (F123-FR-028).
 *
 * Table 1 classifies the end of a run for `supervise observe` and reproduces
 * the baseline: the first failing condition names the refusal. The table is
 * versioned data of the kernel's table evaluator; the data file is loaded
 * through the loader of T005. A relaunch by `supervise observe` re-invokes
 * the recorded argument list in the recorded working directory with the
 * environment of the supervisor at that moment, decrements the remaining
 * count, appends the justification of the decision to the record, and resets
 * the cadence state.
 */
import { appendFileSync } from "node:fs";
import { readTerminalRecord } from "../executor/outcome.ts";
import { loadRelaunchObserveTable } from "../output/load-data.ts";
import { evaluateTable, type LoadedTable } from "@specstride/kernel";
import type { Observation } from "../supervisor/observe.ts";
import {
  appendRelaunch,
  resetCadence,
  type SupervisionRecord,
  type SupervisionRelaunch,
} from "../supervisor/record.ts";

/** The id and version of table 1 as the data file holds them. */
export const OBSERVE_TABLE_ID = "relaunch-observe";
export const OBSERVE_TABLE_VERSION = "1.0.0";

/** The table 1 data file, loaded through the kernel's table evaluator. */
export function loadObserveTable(): LoadedTable {
  return loadRelaunchObserveTable();
}

/** The signals of the decision point `relaunch` of table 1 (§R.6). */
export type ObserveSignals = {
  noRelaunch: boolean;
  terminal: boolean;
  stopRequested: boolean;
  status: string;
  launcherExit: number | null;
  runState: string;
  stageKnown: boolean;
  stageReasonClass: string;
  blocked: boolean;
  retryable: boolean;
  parityProfile: boolean;
  childExitListed: boolean;
  reasonAllowed: boolean;
  contractChanged: boolean;
  learningChanged: boolean;
  launcherEdited: boolean;
  budgetRemaining: number;
  deadlinePassed: boolean;
};

/** Build the vector of signals of table 1 from an observation and the flags. */
export function buildObserveSignals(input: {
  observation: Observation;
  noRelaunch?: boolean;
  parityProfile?: boolean;
  childExitListed?: boolean;
  reasonAllowed?: boolean;
  contractChanged?: boolean;
  learningChanged?: boolean;
  launcherEdited?: boolean;
  budgetRemaining?: number;
  deadlinePassed?: boolean;
}): ObserveSignals {
  const observation = input.observation;
  const terminal = !["running", "starting"].includes(observation.status);
  return {
    noRelaunch: input.noRelaunch ?? false,
    terminal,
    stopRequested: false,
    status: observation.status,
    launcherExit: observation.launcherExit,
    runState: observation.runState ?? "unknown",
    stageKnown: observation.stageId !== null,
    stageReasonClass: observation.stageReason ?? "other",
    blocked: observation.blocked,
    retryable: observation.retryable,
    parityProfile: input.parityProfile ?? false,
    childExitListed: input.childExitListed ?? false,
    reasonAllowed: input.reasonAllowed ?? true,
    contractChanged: input.contractChanged ?? false,
    learningChanged: input.learningChanged ?? false,
    launcherEdited: input.launcherEdited ?? false,
    budgetRemaining: input.budgetRemaining ?? 0,
    deadlinePassed: input.deadlinePassed ?? false,
  };
}

/** The decision a choice of table 1 stands for: a relaunch only for a classified transient. */
export function decisionOfChoice(choice: string): "relaunch" | "refuse" {
  return choice === "classified-transient" ? "relaunch" : "refuse";
}

/**
 * With `relaunch.owner: root` the verbs `watch`, `observe` and `auto` read
 * and print and never relaunch (F123-FR-040); only the owner `supervise`
 * relaunches, and `--no-relaunch` reports a classified transient instead.
 */
export function observeRelaunchAllowed(owner: string, noRelaunch = false): boolean {
  return owner === "supervise" && !noRelaunch;
}

/** The relaunch count as `supervise` reads it under the owner `root`: from the events of the root. */
export function relaunchCountFromEvents(events: readonly { readonly type: string }[]): number {
  return events.filter((event) => event.type === "supervisor.relaunch").length;
}

/** The relaunch line projected from one event `supervisor.relaunch` of the root. */
export function projectRelaunchFromEvent(event: {
  attempt: number;
  maximum: number;
  reason: string;
  stage?: string | null;
}): { attempt: number; maximum: number; reason: string; stage: string | null } {
  return {
    attempt: event.attempt,
    maximum: event.maximum,
    reason: event.reason,
    stage: event.stage ?? null,
  };
}

/** One decision of table 1, with the rule id and the table version. */
export type ObserveDecision = {
  tableId: string;
  tableVersion: string;
  ruleId: string;
  choice: string;
  decision: "relaunch" | "refuse";
  signals: Record<string, unknown>;
};

/** Evaluate table 1 over a vector of signals: exactly one row fires. */
export function evaluateObserveTable(table: LoadedTable, signals: ObserveSignals): ObserveDecision {
  const decision = evaluateTable(table, "relaunch", { ...signals });
  return {
    tableId: decision.tableId,
    tableVersion: decision.tableVersion,
    ruleId: decision.ruleId,
    choice: decision.choice,
    decision: decisionOfChoice(decision.choice),
    signals: decision.signals,
  };
}

/** The ports a relaunch by `supervise observe` needs; every one is injected. */
export type ObserveRelaunchPorts = {
  start(
    args: readonly string[],
    options: {
      cwd: string;
      env: Readonly<Record<string, string | undefined>>;
      stdinClosed: true;
      ownSession: true;
      launchLog: string;
    },
  ): Promise<{ pid: number; pgid: number }>;
  /** The environment of the supervisor at this moment. */
  env(): Readonly<Record<string, string | undefined>>;
  now(): number;
  print(text: string): void;
};

/** The result of a relaunch by `supervise observe`. */
export type ObserveRelaunchResult = {
  readonly relaunched: boolean;
  readonly reason: string;
  readonly detail: string;
  readonly remaining: number;
  readonly attempt: number;
  readonly pid?: number;
};

/**
 * Relaunch by `supervise observe` (F123-FR-028): re-invoke the recorded
 * argument list in the recorded working directory with the environment of
 * the supervisor at that moment, decrement the remaining count, append the
 * justification to the record, and reset the cadence state.
 */
export async function relaunchByObserve(input: {
  recordPath: string;
  record: SupervisionRecord;
  decision: ObserveDecision;
  observation: Observation;
  ports: ObserveRelaunchPorts;
}): Promise<ObserveRelaunchResult> {
  const record = input.record;
  const budget = record.budget;
  const remaining = (budget?.remaining ?? 0) - 1;
  const attempt = record.relaunches.length + 1;
  const header = `=== relaunch ${new Date(input.ports.now() * 1000).toISOString()} ${JSON.stringify(record.argv)} ===`;
  try {
    appendFileSync(record.launchLog, `${header}\n`);
  } catch {
    /* the launch log never blocks a relaunch */
  }
  await input.ports.start(record.argv, {
    cwd: record.cwd,
    env: input.ports.env(),
    stdinClosed: true,
    ownSession: true,
    launchLog: record.launchLog,
  });
  const justification: SupervisionRelaunch = {
    reason: input.decision.choice,
    detail: JSON.stringify(input.decision.signals),
    launcherExit: input.observation.launcherExit,
    childExit: input.observation.childExit,
    stage: input.observation.stageId,
    stageReason: input.observation.stageReason,
    stopReason: input.observation.stopReason,
    time: Math.trunc(input.ports.now()),
    pid: null,
    remaining,
  };
  const updated = appendRelaunch(input.recordPath, record, justification);
  resetCadence(input.recordPath, updated, null);
  return {
    relaunched: true,
    reason: input.decision.choice,
    detail: justification.detail,
    remaining,
    attempt,
  };
}

/**
 * T084 — the read of the terminal record by `supervise observe`
 * (F123-FR-042). Table 1 reads `blocked` and `retryable` from the terminal
 * record `run:<runId>:terminal`; a record that is absent or unreadable reads
 * as `blocked: false` and `retryable: false` (F123-SC-008), never as an
 * error and never as a blocked run.
 */
export function terminalSignalsForObserve(
  record: {
    blocked?: string | null;
    retryable?: boolean | null;
    stop_reason?: string | null;
  } | null,
): { blocked: boolean; retryable: boolean; stopReason: string | null } {
  return {
    blocked: typeof record?.blocked === "string" && record.blocked.length > 0,
    retryable: record?.retryable === true,
    stopReason: typeof record?.stop_reason === "string" ? record.stop_reason : null,
  };
}

/** Read the terminal record of the run and derive the signals of table 1 from it. */
export function readTerminalSignalsForObserve(path: string): {
  blocked: boolean;
  retryable: boolean;
  stopReason: string | null;
} {
  return terminalSignalsForObserve(readTerminalRecord(path));
}

/**
 * T083 — the text of the refusal `supervise observe` gives a blocked run
 * (F123-FR-042): it names the refusal `blocked-on-human` and the command
 * `resume`, and it never names a relaunch.
 */
export const OBSERVE_REFUSAL_BLOCKED_ON_HUMAN =
  "blocked-on-human: the supervisor never relaunches a blocked run; the human resumes it with `resume`" as const;
