/**
 * T032 — the run-state transitions that belong to the runtime root
 * (F123-FR-013; feature 100, annex E §E.2).
 *
 * The root writes T4, T5, T10, T11, T12, T14, T15, T16, and its part of T8
 * and T9 — and no other transition. `relaunching` is a state of this
 * machine, not a value of the pipeline state of §R.4. Every transition is a
 * pure function over the run-state record; the durable write goes through
 * the injected writer (atomic, sorted keys), so every transition has a
 * fake-clock test.
 */
import { atomicWriteJson } from "@specstride/kernel";
import { readFileSync } from "node:fs";

/** The states of the run-state machine the root moves the run through. */
export const RUN_STATES = [
  "created",
  "starting",
  "running",
  "relaunching",
  "stopping",
  "stopped",
  "failed",
  "finished",
  "blocked-on-human",
  "paused-quota",
  "dead",
] as const;
export type RunState = (typeof RUN_STATES)[number];

/** The run-state record the root writes (feature 100, annex E §E.2). */
export type RunStateRecord = {
  runId: string;
  state: RunState;
  /** Whole seconds since the epoch (§R.4). */
  updatedAt: number;
  launchId: string | null;
  engineStartId: string | null;
  relaunchAttempt: number;
  relaunchRemaining: number;
  /** The rule id and table version of the decision that moved the run (T10). */
  decisionRuleId: string | null;
  decisionTableVersion: string | null;
  /** The reason of a terminal state, and its detail (T5, T12, T14, T16). */
  exitReason: string | null;
  detail: string | null;
  /** The digest of the ended run (T12, T15, T16). */
  digest: string | null;
  /** The child exit the run ended with (T12, T14, T16). */
  childExit: number | null;
};

/** The empty record of a run: `created`, no launch. */
export function emptyRunState(runId: string, now: number): RunStateRecord {
  return {
    runId,
    state: "created",
    updatedAt: Math.trunc(now / 1000),
    launchId: null,
    engineStartId: null,
    relaunchAttempt: 0,
    relaunchRemaining: 0,
    decisionRuleId: null,
    decisionTableVersion: null,
    exitReason: null,
    detail: null,
    digest: null,
    childExit: null,
  };
}

function requireState(record: RunStateRecord, from: readonly RunState[], transition: string): void {
  if (!(from as readonly string[]).includes(record.state)) {
    throw new RangeError(
      `${transition}: the run is in ${record.state}, not in ${from.join(" or ")}`,
    );
  }
}

function moved(record: RunStateRecord, state: RunState, now: number): RunStateRecord {
  return { ...record, state, updatedAt: Math.trunc(now / 1000) };
}

/** T2: `created` → `starting`. The detach strategy started the root (CLI's write; the root reads it). */
export function transitionT2CreatedToStarting(record: RunStateRecord, now: number): RunStateRecord {
  requireState(record, ["created"], "T2");
  return moved(record, "starting", now);
}

/** T4: `starting` → `running`. Lock acquired, lease written with the launch nonce. */
export function transitionT4StartingToRunning(
  record: RunStateRecord,
  input: { launchId: string; engineStartId: string; now: number },
): RunStateRecord {
  requireState(record, ["starting"], "T4");
  return {
    ...moved(record, "running", input.now),
    launchId: input.launchId,
    engineStartId: input.engineStartId,
  };
}

/** T5: `starting` → `failed`. Lock conflict, stale sources, invalid contract, failed check. */
export function transitionT5StartingToFailed(
  record: RunStateRecord,
  input: { now: number; exitReason: string; pipelineExitCode: number },
): RunStateRecord {
  requireState(record, ["starting"], "T5");
  return {
    ...moved(record, "failed", input.now),
    exitReason: input.exitReason,
    detail: `pipeline exit ${input.pipelineExitCode}`,
  };
}

/** T10: `running` → `relaunching`. Transient, budget remains, no hold in force. */
export function transitionT10RunningToRelaunching(
  record: RunStateRecord,
  input: {
    now: number;
    ruleId: string;
    tableVersion: string;
    /** The remaining count after the relaunch consumed one. */
    relaunchRemaining: number;
  },
): RunStateRecord {
  requireState(record, ["running"], "T10");
  return {
    ...moved(record, "relaunching", input.now),
    decisionRuleId: input.ruleId,
    decisionTableVersion: input.tableVersion,
    relaunchAttempt: record.relaunchAttempt + 1,
    relaunchRemaining: input.relaunchRemaining,
  };
}

/** T11: `relaunching` → `running`. The backoff is over; a new engine start. */
export function transitionT11RelaunchingToRunning(
  record: RunStateRecord,
  input: { now: number; engineStartId: string },
): RunStateRecord {
  requireState(record, ["relaunching"], "T11");
  return { ...moved(record, "running", input.now), engineStartId: input.engineStartId };
}

/** T12: `relaunching` → `failed`. A hold past the deadline, or the budget spent. */
export function transitionT12RelaunchingToFailed(
  record: RunStateRecord,
  input: {
    now: number;
    exitReason: string;
    detail: string;
    digest?: string | null;
    childExit?: number | null;
  },
): RunStateRecord {
  requireState(record, ["relaunching"], "T12");
  return {
    ...moved(record, "failed", input.now),
    exitReason: input.exitReason,
    detail: input.detail,
    digest: input.digest ?? record.digest,
    childExit: input.childExit ?? record.childExit,
  };
}

/** T14: `stopping` → `stopped`. The engine exits 6. */
export function transitionT14StoppingToStopped(
  record: RunStateRecord,
  input: { now: number; childExit: number },
): RunStateRecord {
  requireState(record, ["stopping"], "T14");
  return {
    ...moved(record, "stopped", input.now),
    exitReason: "deliberate-stop",
    childExit: input.childExit,
  };
}

/** T15: `running` → `finished`. The last stage completes. */
export function transitionT15RunningToFinished(
  record: RunStateRecord,
  input: { now: number; digest: string },
): RunStateRecord {
  requireState(record, ["running"], "T15");
  return { ...moved(record, "finished", input.now), digest: input.digest };
}

/** T16: `running` or `relaunching` → `failed`. Not retryable, or no budget left. */
export function transitionT16ToFailed(
  record: RunStateRecord,
  input: {
    now: number;
    exitReason: string;
    detail?: string;
    digest?: string | null;
    childExit?: number | null;
  },
): RunStateRecord {
  requireState(record, ["running", "relaunching"], "T16");
  return {
    ...moved(record, "failed", input.now),
    exitReason: input.exitReason,
    detail: input.detail ?? null,
    digest: input.digest ?? record.digest,
    childExit: input.childExit ?? record.childExit,
  };
}

/**
 * The root's part of T8 and T9: the run reads `blocked-on-human` while the
 * engine rests blocked (a quota pause that hit its ceiling, or a blocked
 * reason), the pipeline ends 22 with the state `failed`, and nothing
 * relaunches it.
 */
export function transitionRootToBlockedOnHuman(
  record: RunStateRecord,
  input: { now: number; blocked: string; digest?: string | null; childExit?: number | null },
): RunStateRecord {
  requireState(record, ["running", "paused-quota"], "T8/T9 (root)");
  return {
    ...moved(record, "blocked-on-human", input.now),
    exitReason: "blocked-on-human",
    detail: input.blocked,
    digest: input.digest ?? record.digest,
    childExit: input.childExit ?? record.childExit,
  };
}

/** The durable write of the run-state record: atomic, as JSON. */
export function writeRunState(path: string, record: RunStateRecord): void {
  atomicWriteJson(path, record);
}

/** Read the run-state record; an unreadable file reads as absent (null). */
export function readRunState(path: string): RunStateRecord | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as RunStateRecord;
  } catch {
    return null;
  }
}
