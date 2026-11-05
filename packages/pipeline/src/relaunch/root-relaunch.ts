/**
 * T029 — the relaunch procedure of the runtime root (F123-FR-033).
 *
 * A relaunch ends every `owned` process of the run, waits the declared
 * backoff (the backoff of the failed stage at the index of the relaunch, or
 * 0), mints a new launch identity and a new engine start, starts the engine
 * with a fresh session, and re-enters the pipeline entry after the lock:
 * preflight again, then the stage loop, which skips the stages that are
 * complete and so resumes at the failed stage. The counts and identities of
 * attempts come from the ledger. The run state is `relaunching` (T10) from
 * the decision to the start. Each decision is an event `supervisor.observed`
 * and each start an event `supervisor.relaunch`, with the rule id and the
 * table version.
 */
import type { Clock } from "../executor/types.ts";
import type { EventPort } from "../executor/events.ts";
import { emitSupervisorObserved, emitSupervisorRelaunch } from "../executor/events.ts";
import { exitCodeForState } from "../executor/exit.ts";
import {
  consumeRelaunch,
  deadlinePassed,
  relaunchAllowedByBudget,
  type RelaunchBudget,
} from "./budget.ts";
import {
  evaluateRootTable,
  decisionOfChoice,
  type RelaunchSignals,
  type RootDecision,
} from "./root-table.ts";
import {
  transitionT10RunningToRelaunching,
  transitionT11RelaunchingToRunning,
  transitionT12RelaunchingToFailed,
  transitionT16ToFailed,
  type RunStateRecord,
} from "./transitions.ts";
import { waitWhileHeld, holdDeadlineOutcome } from "./hold.ts";
import type { LoadedTable } from "@specstride/kernel";

/** The ledger of attempts: the counts and identities come from here (F123-FR-033). */
export type RelaunchLedger = {
  runId: string;
  launchId: string;
  engineStartId: string;
  /** The attempt the ledger is at: 1 on the first launch. */
  attempt: number;
  maximum: number;
  remaining: number;
};

/** What one pass of the pipeline (preflight, stage loop) reported. */
export type PipelinePass = {
  /** The pipeline state of §R.4 the pass ended in. */
  state: "preflight" | "ready" | "running" | "failed" | "stopped" | "completed";
  childExit: number | null;
  digest: string | null;
  /** The signals the root observes from this pass, for the next decision. */
  signals: RelaunchSignals;
};

/** The ports and records one relaunch needs. Every port is injected. */
export type RelaunchPorts = {
  table: LoadedTable;
  clock: Clock;
  events: EventPort;
  /** End every `owned` process of the run. */
  endOwnedProcesses: () => Promise<void>;
  /** Mint a new launch identity (F123-FR-033). */
  mintLaunchId: () => string;
  /** Mint a new engine start identity. */
  mintEngineStartId: () => string;
  /** Start the engine, always with a fresh session. */
  startEngine: (input: {
    launchId: string;
    engineStartId: string;
    attempt: number;
    freshSession: true;
  }) => Promise<void>;
  /** Re-enter the pipeline entry after the lock: preflight, then the stage loop. */
  enterPipeline: (input: {
    launchId: string;
    engineStartId: string;
    attempt: number;
  }) => Promise<PipelinePass>;
  /** The durable writer of the run-state record. */
  writeRunState: (record: RunStateRecord) => void;
  /** The path of the inbox request `hold-relaunch`. */
  holdRequestPath?: string;
};

/** The backoff before a relaunch: the failed stage's declared backoff, or 0 (CQ-049). */
export function backoffForRelaunch(
  declaredBackoffSeconds: readonly number[],
  attempt: number,
): number {
  if (declaredBackoffSeconds.length === 0) return 0;
  const index = Math.min(attempt - 1, declaredBackoffSeconds.length - 1);
  return declaredBackoffSeconds[index] ?? 0;
}

/** The observation of one decision, written before anything moves (F123-FR-033). */
export function recordDecision(
  ports: Pick<RelaunchPorts, "events" | "clock">,
  decision: RootDecision,
): void {
  emitSupervisorObserved(
    ports.events,
    {
      tableId: decision.tableId,
      ruleId: decision.ruleId,
      choice: decision.choice,
      signals: decision.signals,
    },
    ports.clock.now(),
  );
}

/**
 * One relaunch (F123-FR-033): `relaunching` (T10) with the decision
 * recorded, end the owned processes, wait the backoff, mint the new
 * identities, `running` (T11), start the engine with a fresh session, and
 * re-enter the pipeline after the lock. The caller evaluates the table
 * before calling and hands the decision in; this function consumes one
 * relaunch from the budget and emits `supervisor.relaunch`.
 */
export async function relaunchOnce(input: {
  decision: RootDecision;
  ledger: RelaunchLedger;
  budget: RelaunchBudget;
  runState: RunStateRecord;
  ports: RelaunchPorts;
  /** The declared backoff of the failed stage, at the index of the relaunch. */
  backoffSeconds?: readonly number[];
}): Promise<{
  ledger: RelaunchLedger;
  runState: RunStateRecord;
  budget: RelaunchBudget;
  pass: PipelinePass;
}> {
  const { ports } = input;
  const consumed = consumeRelaunch(
    input.budget,
    `${input.decision.ruleId}:${input.decision.choice}`,
  );
  recordDecision(ports, input.decision);
  emitSupervisorRelaunch(
    ports.events,
    {
      attempt: input.ledger.attempt + 1,
      maximum: consumed.budget.maximum,
      remaining: consumed.remaining,
      reason: input.decision.choice,
      ruleId: input.decision.ruleId,
      tableVersion: input.decision.tableVersion,
    },
    ports.clock.now(),
  );

  let runState = transitionT10RunningToRelaunching(input.runState, {
    now: ports.clock.now(),
    ruleId: input.decision.ruleId,
    tableVersion: input.decision.tableVersion,
    relaunchRemaining: consumed.remaining,
  });
  ports.writeRunState(runState);

  // End every owned process of the run, then wait the declared backoff.
  await ports.endOwnedProcesses();
  const backoffSeconds = backoffForRelaunch(input.backoffSeconds ?? [], input.ledger.attempt + 1);
  if (backoffSeconds > 0) await ports.clock.sleep(backoffSeconds * 1000);

  // A new launch identity and a new engine start, counts carried from the ledger.
  const launchId = ports.mintLaunchId();
  const engineStartId = ports.mintEngineStartId();
  const ledger: RelaunchLedger = {
    runId: input.ledger.runId,
    launchId,
    engineStartId,
    attempt: input.ledger.attempt + 1,
    maximum: consumed.budget.maximum,
    remaining: consumed.remaining,
  };

  runState = transitionT11RelaunchingToRunning(runState, {
    now: ports.clock.now(),
    engineStartId,
  });
  ports.writeRunState(runState);

  await ports.startEngine({ launchId, engineStartId, attempt: ledger.attempt, freshSession: true });
  const pass = await ports.enterPipeline({ launchId, engineStartId, attempt: ledger.attempt });
  return { ledger, runState, budget: consumed.budget, pass };
}

/** How the root's supervision of the run ended. */
export type RootSupervisionResult = {
  /** The run-state record the root leaves behind. */
  runState: RunStateRecord;
  ledger: RelaunchLedger;
  budget: RelaunchBudget;
  /** The pipeline code the root finally exits with, when it does. */
  exitCode: number;
  /** The last pass of the pipeline. */
  pass: PipelinePass | null;
  relaunches: number;
};

/**
 * The supervision loop of the root with `relaunch.owner: root` (F123-FR-029,
 * F123-FR-033): run the pipeline, observe, classify with table 2, and — for
 * a relaunch decision under an open budget and no hold — relaunch and go
 * again. A refusal, a hold past the deadline (T12) and a spent budget (T16)
 * end the loop with the pipeline code the root finally exits with.
 */
export async function runRootSupervisionLoop(input: {
  ledger: RelaunchLedger;
  budget: RelaunchBudget;
  runState: RunStateRecord;
  ports: RelaunchPorts;
  /** The first pass of the pipeline (the launch itself). */
  firstPass: () => Promise<PipelinePass>;
  /** The declared backoff of the failed stage, per relaunch index. */
  backoffSeconds?: readonly number[];
}): Promise<RootSupervisionResult> {
  let ledger = input.ledger;
  let budget = input.budget;
  let runState = input.runState;
  let pass = await input.firstPass();
  let relaunches = 0;

  for (;;) {
    const decision = evaluateRootTable(input.ports.table, pass.signals);
    if (decision.decision === "refuse") {
      recordDecision(input.ports, decision);
      // T16: a stop that is not retryable, or no budget left — or, with
      // `supervise`, any failed stage. The root ends with the pipeline code.
      const reason = decision.choice === "budget-exhausted" ? "budget-exhausted" : decision.choice;
      runState = transitionT16ToFailed(runState, {
        now: input.ports.clock.now(),
        exitReason: reason,
        detail: `${decision.ruleId}:${decision.choice}`,
        digest: pass.digest,
        childExit: pass.childExit,
      });
      input.ports.writeRunState(runState);
      return {
        runState,
        ledger,
        budget,
        exitCode: exitCodeForState(pass.state),
        pass,
        relaunches,
      };
    }

    if (decision.decision === "hold") {
      recordDecision(input.ports, decision);
      // A held relaunch parks the run in `relaunching` without consuming the
      // budget (F123-FR-032); the count changes only when a start happens.
      runState = {
        ...runState,
        state: "relaunching",
        decisionRuleId: decision.ruleId,
        decisionTableVersion: decision.tableVersion,
        updatedAt: Math.trunc(input.ports.clock.now() / 1000),
      };
      input.ports.writeRunState(runState);
      if (input.ports.holdRequestPath !== undefined) {
        const wait = await waitWhileHeld({
          requestPath: input.ports.holdRequestPath,
          budget,
          clock: input.ports.clock,
        });
        if (wait.held && wait.deadlinePassedUnderHold) {
          // T12: a hold past the deadline ends the run `failed`.
          const outcome = holdDeadlineOutcome();
          runState = transitionT12RelaunchingToFailed(runState, {
            now: input.ports.clock.now(),
            exitReason: outcome.exitReason,
            detail: outcome.detail,
            digest: pass.digest,
            childExit: pass.childExit,
          });
          input.ports.writeRunState(runState);
          return { runState, ledger, budget, exitCode: outcome.exitCode, pass, relaunches };
        }
      } else {
        // No inbox wired: the hold cannot lift; it stands until the deadline.
        runState = transitionT12RelaunchingToFailed(runState, {
          now: budget.deadline,
          exitReason: holdDeadlineOutcome().exitReason,
          detail: holdDeadlineOutcome().detail,
          digest: pass.digest,
          childExit: pass.childExit,
        });
        input.ports.writeRunState(runState);
        return { runState, ledger, budget, exitCode: 22, pass, relaunches };
      }
      // The hold lifted: the run is back in `running` and the table decides
      // again (F123-FR-032). T10 fires when the relaunch actually starts.
      runState = {
        ...runState,
        state: "running",
        updatedAt: Math.trunc(input.ports.clock.now() / 1000),
      };
      input.ports.writeRunState(runState);
      continue; // The hold lifted: the table decides again (F123-FR-032).
    }

    // A relaunch decision: only under an open budget and before the deadline.
    if (!relaunchAllowedByBudget(budget, input.ports.clock.now())) {
      const exhausted = budget.remaining <= 0;
      const choice = exhausted ? "budget-exhausted" : "budget-deadline-exceeded";
      const refused = exhausted ? { ruleId: "R-20", choice } : { ruleId: "R-21", choice };
      const recorded: RootDecision = {
        ...decision,
        ...refused,
        decision: decisionOfChoice(choice) as "refuse",
      };
      recordDecision(input.ports, recorded);
      runState = transitionT16ToFailed(runState, {
        now: input.ports.clock.now(),
        exitReason: choice,
        detail: `${refused.ruleId}:${choice}`,
        digest: pass.digest,
        childExit: pass.childExit,
      });
      input.ports.writeRunState(runState);
      return { runState, ledger, budget, exitCode: exitCodeForState(pass.state), pass, relaunches };
    }
    if (deadlinePassed(budget, input.ports.clock.now())) {
      runState = transitionT16ToFailed(runState, {
        now: input.ports.clock.now(),
        exitReason: "budget-deadline-exceeded",
        digest: pass.digest,
        childExit: pass.childExit,
      });
      input.ports.writeRunState(runState);
      return { runState, ledger, budget, exitCode: 22, pass, relaunches };
    }

    const next = await relaunchOnce({
      decision,
      ledger,
      budget,
      runState,
      ports: input.ports,
      backoffSeconds: input.backoffSeconds,
    });
    ledger = next.ledger;
    budget = next.budget;
    runState = next.runState;
    pass = next.pass;
    relaunches++;
  }
}
