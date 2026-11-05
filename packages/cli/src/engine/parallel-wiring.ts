/**
 * THE WIRING OF ONE GROUP INTO ONE PHASE ATTEMPT (step 3 of
 * `prompts/specstride-parallel-units.md`): the slice `parallel-attempt.ts`
 * calls "the wiring slice". The composition root (`run-feature.ts`) holds one
 * wiring per phase attempt and uses it in four places:
 *
 *     reservedBlock()               — the main-line prompts while the group waits
 *     startIfTheBoundaryIsClean()   — the group run at a clean pass boundary
 *     handoffForTheCritic()         — the before-critic input of a kept group
 *     the totals and `parallelLoopLineField` — the `parallel=` fields of `[LOOP]`
 *
 * THE DECISIONS THIS SLICE TAKES (the layer decides, it never executes —
 * F142-FR-006 — and every decision below is the layer's own, applied at the
 * place the engine holds the state):
 *
 *  - The group of the phase is the FIRST group of its plan (`groups[0]`);
 *    this wiring starts one group per phase attempt.
 *  - The boundary is `cleanPassBoundary` of the layer (F142-FR-018): no
 *    session open (the wiring is read between passes, where none can be), no
 *    yield wait open, no phase evidence in the attempt, and every task of the
 *    phase that precedes the group named by a kept unit of work in the
 *    ledger (the composition root reads the ledger of kept units, which
 *    survives across attempts, together with the attempt's own units). At an
 *    unclean boundary the group does not start, and the reserved-tasks block
 *    keeps the main line away from the group's tasks until it does.
 *  - A directive `keep` carries the handoff to the critic before it judges
 *    the attempt (F142-FR-069); `repair` and `none` leave the tasks on the
 *    main line, which the standing prompt already names; `layerOffForAttempt`
 *    and the layer's own `layerOffDecision` over the closed groups of the
 *    attempt (F142-FR-023) emit the layer's event, say what carries on, and
 *    stop further groups of the decision's scope.
 *  - The counts of the `[LOOP] parallel=` field are the layer's `report`
 *    (F142-FR-022) over the run totals this slice keeps moving, one entry per
 *    closed group, `worker-caches=shared` (no toolchain profile of this host
 *    moves a cache per worker).
 *
 * WHAT IS NOT HERE: the persisted plan (`parallel-launch.ts`), the group run
 * itself (`parallel-attempt.ts` over `parallel-group.ts` and
 * `parallel-drive.ts`), and the run-record fields' file home (the engine
 * writes no `run-record.json` today; the fields are returned by the launch
 * and carried on the `[LOOP]` line, which is where DV-088 says a run says
 * what it ran with).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import type { CheckRunner, ManifestEntry } from "@specstride/contracts/ep/check-runner";
import type { RegistryAccess } from "../../../core/src/pass-supervision/ports.ts";
import type { TickOutcome } from "../../../core/src/parallel/integrate.ts";
import {
  cleanPassBoundary,
  groupFailed,
  layerOffDecision,
  layerOffFor,
  report as reportOfTheLayer,
  reservedTasksBlockText,
  workerBlockText,
  workerCachesReading,
  type BoundaryVerdict,
  type ClosedGroup,
  type FallbackReason,
  type LayerOffDecision,
  type LayerOffReason,
  type ParallelPlan,
  type PlannedGroup,
  type WorkerCaches,
} from "../../../layer-parallel/src/index.ts";
import { tickFile } from "../../../spec-formats/src/tick.ts";
import {
  dshStartDoor,
  membersOfTheGroup,
  placesOfTheParallelStore,
  theParallelHomeOfARun,
  type PreparedWorker,
} from "./parallel-group.ts";
import {
  runTheGroupOfTheAttempt,
  type TheGroupAttempt,
  type TheGroupAttemptRefused,
  type TheGroupAttemptStoppedNow,
} from "./parallel-attempt.ts";
import {
  carryOutTheResumeOfTheOpenGroup,
  endTheHoldersOfTheOpenGroup,
  theOpenParallelGroupOf,
} from "./parallel-resume.ts";
import type { TheTailOfTheResumeDrive } from "./parallel-resume-drive.ts";

/** The worker count of a group whose plan carries no count of its own. */
const WORKERS_AT_A_TIME_DEFAULT = 2;

/** The format of the task list the engine reads (F104; the one Wave 1 reader). */
const THE_TASK_LIST_FORMAT = "speckit-tasks" as const;

/* ================================================================== *
 * 1. The plan read at the wiring: the group of the phase.
 * ================================================================== */

/** The first group of a phase of the plan, or `undefined` where none is. */
export function theGroupOfThePhase(plan: ParallelPlan, phase: number): PlannedGroup | undefined {
  return plan.phases.find((entry) => entry.phase === phase)?.groups[0];
}

/**
 * The tasks of the phase that precede the group, in the order at launch —
 * the first input of the boundary's kept-unit condition (F142-FR-018).
 */
export function tasksBeforeTheGroup(plan: ParallelPlan, phase: number): readonly string[] {
  const entry = plan.phases.find((candidate) => candidate.phase === phase);
  const group = theGroupOfThePhase(plan, phase);
  if (entry === undefined || group === undefined) return Object.freeze([]);
  const first = group.tasks[0];
  if (first === undefined) return Object.freeze([]);
  const ids = entry.tasks.map((task) => task.id);
  const at = ids.indexOf(first);
  return Object.freeze(at <= 0 ? [] : ids.slice(0, at));
}

/** The verdict on the boundary, as the layer computes it (F142-FR-018). */
export function theBoundaryOfNow(input: {
  readonly sessionOpen: boolean;
  readonly yieldWaitOpen: boolean;
  readonly evidencePresent: boolean;
  readonly plan: ParallelPlan;
  readonly phase: number;
  readonly keptUnits: readonly string[];
}): BoundaryVerdict {
  return cleanPassBoundary({
    sessionOpen: input.sessionOpen,
    yieldWaitOpen: input.yieldWaitOpen,
    phaseEvidencePresent: input.evidencePresent,
    tasksBeforeTheGroup: tasksBeforeTheGroup(input.plan, input.phase),
    tasksNamedByKeptUnits: input.keptUnits,
  });
}

/* ================================================================== *
 * 2. The closed group of one attempt, as the layer reads a group.
 * ================================================================== */

/**
 * The layer's `ClosedGroup` of one group attempt (F142-FR-023): the workers
 * an audit refused, the workers a time limit or a watchdog ended, and whether
 * the group's merge check passed — `null` where no check was due.
 */
export function theClosedGroupOf(attempt: TheGroupAttempt | TheGroupAttemptRefused): ClosedGroup {
  if (!attempt.ok) {
    // A start refusal is a worker the harness refused: the group closed as
    // failed at the survivor search, and the refusal is the cause here too.
    return Object.freeze({
      groupId: attempt.groupId,
      refused: Object.freeze([attempt.workerId]),
      killed: Object.freeze([]),
      mergeCheckPassed: null,
    });
  }
  return Object.freeze({
    groupId: attempt.groupId,
    refused: Object.freeze(attempt.audit.refused.map((row) => row.workerId)),
    killed: Object.freeze(
      attempt.barrier.perWorker
        .filter((row) => row.outcome.outcome === "killed")
        .map((row) => row.workerId),
    ),
    mergeCheckPassed:
      attempt.merge === undefined ? null : attempt.merge.outcome.directive === "keep",
  });
}

/* ================================================================== *
 * 3. The real doors the wiring hands the group run.
 * ================================================================== */

/** The real check runner: the command runs as a process with its real exit. */
export function theRealCheckRunner(): CheckRunner {
  const results = new Map<string, { exitCode: number; durationMs: number; out: string }>();
  let next = 0;
  return {
    pin: async (entry) => ({
      kind: "command",
      executable: entry.argv[0] ?? "node",
      argv: entry.argv.slice(1),
    }),
    start: async (probe) => {
      const id = `check-${String(++next)}`;
      const began = Date.now();
      const done = spawnSync(probe.identity.executable ?? "node", probe.identity.argv ?? [], {
        cwd: probe.workingDirectory,
        encoding: "utf8",
        timeout: probe.timeLimitMs,
      });
      results.set(id, {
        exitCode: done.status ?? 1,
        durationMs: Date.now() - began,
        out: `${done.stdout ?? ""}${done.stderr ?? ""}`,
      });
      return { id };
    },
    poll: async () => ({ state: "ended" as const }),
    result: async (handle) => {
      const one = results.get(handle.id);
      if (one === undefined) throw new Error(`no result for the handle ${handle.id}`);
      return {
        exitCode: one.exitCode,
        durationMs: one.durationMs,
        output: { logicalName: "merge-check-output", hash: one.out, size: one.out.length },
        tainted: false,
        cached: false,
        flaky: false,
        interrupted: false,
        unchecked: false,
      };
    },
    cancel: async () => {},
    environment: () => ({}),
  };
}

/**
 * The tick of the integrated tasks over the REAL task list (F143-FR-021): the
 * one byte a tick may change is the character inside the box, and the file is
 * rewritten atomically by the format reader's own tick. A task the tick did
 * not find is named in `notFound`.
 */
export function theTickOfTheTaskList(
  tasksPath: string,
): (taskIds: readonly string[]) => Promise<TickOutcome> {
  return async (taskIds) => {
    const result = tickFile({
      path: tasksPath,
      format: THE_TASK_LIST_FORMAT,
      request: { taskIds: [...taskIds] },
    });
    const ticked = new Set(result.taskIds);
    return Object.freeze({
      ticked: Object.freeze(
        result.taskIds.map((taskId, at) => ({ taskId, line: result.lines[at] ?? 0 })),
      ),
      ...(result.taskIds.length === taskIds.length
        ? {}
        : { notFound: Object.freeze([...taskIds].filter((taskId) => !ticked.has(taskId))) }),
    });
  };
}

/**
 * The worker's prompt, from the layer's own block (F142-FR-069), with the
 * checkpoint duty the engine adds (F143-FR-011: one pass that ENDS AT A
 * CHECKPOINT naming its assigned task). The duty names the worker's own
 * outbox — a runtime place only the engine knows — and nothing else: no
 * sibling, no count, no index, no group, which `forbiddenWordsIn` of the
 * layer holds the prompt to.
 */
export function thePromptOfTheWorker(input: {
  readonly taskId: string;
  readonly taskText: string;
  readonly prefixes: readonly string[];
  readonly hash: (text: string) => string;
  /** The worker's own outbox; without it the prompt is the block alone. */
  readonly outboxPath?: string | undefined;
}): string {
  const block = workerBlockText({
    taskId: input.taskId,
    taskText: input.taskText,
    prefixes: input.prefixes,
    hash: input.hash,
  });
  if (input.outboxPath === undefined || input.outboxPath === "") return block;
  const checkpoint = join(input.outboxPath, `${input.taskId}.checkpoint.json`);
  return [
    block,
    `End the work by writing the file ${checkpoint} with the exact content ` +
      `{"task":"${input.taskId}"} — create the directory of the file when it is missing.`,
  ].join("\n");
}

/** Where the two outputs of one worker pass go (the run's own directory). */
export function theOutputRootOfTheWorker(
  controlRoot: string,
  runId: string,
  workerId: string,
): string {
  return join(controlRoot, "runs", runId, "worker-outputs", workerId);
}

/**
 * The secrets of one worker's own places, as the path-leak audit reads them
 * (F142-FR-057): the worker root, the tree store and the control plane, and
 * the opaque token of THIS worker, which only the group run knows and which
 * the run slice hands over with the worker's id.
 */
export function theSecretsOfTheWorker(input: {
  readonly controlRoot: string;
  readonly home: string;
  readonly runId: string;
}): (
  workerId: string,
  workerToken: string,
) => {
  readonly workerRoot: string;
  readonly treeStore: string;
  readonly controlPlane: string;
  readonly workerToken: string;
} {
  const places = placesOfTheParallelStore({
    controlRoot: input.controlRoot,
    runId: input.runId,
    home: input.home,
  });
  return (workerId, workerToken) => {
    void workerId;
    return {
      workerRoot: places.workerRoot,
      treeStore: places.store,
      controlPlane: places.control,
      workerToken,
    };
  };
}

/* ================================================================== *
 * 4. The run totals and the `parallel=` fields of the `[LOOP]` line.
 * ================================================================== */

/** The run's totals of the layer, as the wiring keeps them moving. */
export type ParallelRunTotals = {
  readonly units: "on" | "off";
  readonly workers: number;
  groups: number;
  groupFailures: number;
  refused: number;
  wallMs: number;
  agentMs: number;
};

export function theEmptyRunTotals(units: "on" | "off", workers: number): ParallelRunTotals {
  return { units, workers, groups: 0, groupFailures: 0, refused: 0, wallMs: 0, agentMs: 0 };
}

/** One closed group enters the totals: groups, failures, refusals, times. */
export function totalsAfterTheGroup(
  totals: ParallelRunTotals,
  closed: ClosedGroup,
  counts: { readonly wallMs: number; readonly agentMs: number; readonly refused: number },
): void {
  totals.groups += 1;
  if (groupFailed(closed).failed) totals.groupFailures += 1;
  totals.refused += counts.refused;
  totals.wallMs += Math.max(0, counts.wallMs);
  totals.agentMs += Math.max(0, counts.agentMs);
}

/**
 * The `parallel=` fields of the `[LOOP]` line (F142-FR-022), from the layer's
 * own `report`. `worker-caches=shared` where no toolchain profile moves a
 * cache per worker, which is every host this engine runs on today.
 */
export function parallelLoopLineField(input: {
  readonly totals: ParallelRunTotals;
  /** The reason of row 185, where the layer was switched off in the run. */
  readonly layerOffReason?: LayerOffReason | null;
  /** The fallback reason of row 60, where the launch fell back. */
  readonly fallback?: FallbackReason | null;
}): string {
  const caches: WorkerCaches = workerCachesReading(undefined).value;
  const report = reportOfTheLayer({
    units: input.totals.units,
    workers: input.totals.workers,
    groups: input.totals.groups,
    groupFailures: input.totals.groupFailures,
    refused: input.totals.refused,
    workerCaches: caches,
    wallMs: input.totals.wallMs,
    agentMs: input.totals.agentMs,
    ...(input.layerOffReason ? { layerOff: input.layerOffReason } : {}),
    ...(input.fallback ? { fallback: input.fallback } : {}),
  });
  return report.loopLineField;
}

/* ================================================================== *
 * 5. The wiring of one phase attempt.
 * ================================================================== */

/** Everything the wiring of one attempt needs, as the composition root holds it. */
export type ParallelWiringInput = {
  /** The plan of the launch; `null` with the option off or a fallback plan. */
  readonly plan: ParallelPlan | null;
  readonly phase: number;
  /** The boundary's reads, in the engine's own view. */
  readonly evidencePresent: () => boolean;
  readonly keptUnitsOf: () => readonly string[];
  /** The failed groups of this phase attempt BEFORE this wiring runs. */
  readonly failedGroupsBefore: number;
  /* The group run's facts, as the composition root holds them. */
  readonly controlRoot: string;
  readonly home: string;
  readonly runId: string;
  readonly workspace: string;
  readonly slug: string;
  readonly taskListPath: string;
  readonly taskTextAtLaunch: string;
  readonly taskTextOf: (taskId: string) => string;
  readonly model: string;
  readonly modelTierOrEffort: string;
  readonly containment: "C0" | "C1" | "C2" | "C3";
  readonly runToken: string;
  readonly timeLimitMs: number;
  readonly enginePid: number;
  readonly engineStartedAtMs: number;
  readonly registry: RegistryAccess;
  readonly guardScriptPath: string;
  readonly hash: (text: string) => string;
  /** The manifest entries of the merge check (the gate's own commands). */
  readonly innerCheckSet: readonly ManifestEntry[];
  /** Only a test hands another start door; the engine hands the real one. */
  readonly startDoor?: (worker: PreparedWorker) => Promise<unknown>;
  /** Only a test hands another check runner; the engine hands the real one. */
  readonly runner?: CheckRunner;
  /**
   * THE PATH OF THE STOP REQUEST (`inbox:stop`, annex B §B.5), which the
   * group's wait polls at its boundaries (F143-FR-026). Left out, no poll
   * runs. The composition root resolves it through the layout table.
   */
  readonly stopRequestPath?: string | undefined;
  /**
   * `--reset-counts` (F100-FR-045): zeroes the counters THIS start writes,
   * fresh group and carried resume alike. The composition root reads it from
   * the launch argv (`run --reset-counts`, the flag the verb table
   * documents); left out, the counters carry as they always did.
   */
  readonly resetCounts?: boolean | undefined;
  /* The carry-out. */
  readonly emit: (type: string, data: Readonly<Record<string, unknown>>) => void;
  readonly say: (line: string) => void;
  readonly onClosed: (
    closed: ClosedGroup,
    counts: { readonly wallMs: number; readonly agentMs: number; readonly refused: number },
  ) => void;
  readonly onHandoff: (text: string) => void;
};

/** What one wiring of one attempt gives the composition root. */
export type TheParallelWiring = {
  /** The group this attempt may start, or `undefined` where none is planned. */
  readonly group: PlannedGroup | undefined;
  /** The tasks of the phase that precede the group, in the order at launch. */
  readonly tasksBeforeTheGroup: readonly string[];
  /** The reserved-tasks block while the group waits (F142-FR-018). */
  reservedBlock(): string;
  /**
   * Run the group at this boundary, where the boundary is clean (F142-FR-018)
   * and no switch-off has stopped it. Returns whether a group ran.
   */
  startIfTheBoundaryIsClean(): Promise<boolean>;
  /**
   * THE STOP THE GROUP SAW (F143-FR-026), where a request stood in the inbox
   * while it ran: `now` true where `stop --now` cut the workers and left the
   * group to the resume states, false where a clean stop stood and the group
   * closed whole — the stop takes effect at the boundary that follows.
   * `null` where no request stood or no group ran.
   */
  theStopSeenOfTheGroup(): { readonly now: boolean } | null;
  /** The before-critic input of a kept group (F142-FR-069), "" before one. */
  handoffForTheCritic(): string;
  /** True where a decision switched the layer off for the whole run. */
  layerOffForTheRun(): boolean;
  /** True where no further group of this attempt may start. */
  layerOffForTheAttempt(): boolean;
};

/**
 * One wiring of one phase attempt: the state the composition root passes and
 * the carry-out of every directive the group's end hands back.
 */
export function parallelWiringOfTheAttempt(input: ParallelWiringInput): TheParallelWiring {
  const plan = input.plan;
  const group = plan === null ? undefined : theGroupOfThePhase(plan, input.phase);
  const members = plan === null || group === undefined ? [] : membersOfTheGroup(plan, input.phase);
  const before = plan === null ? [] : tasksBeforeTheGroup(plan, input.phase);
  const secretsOf = theSecretsOfTheWorker({
    controlRoot: input.controlRoot,
    home: input.home,
    runId: input.runId,
  });
  const promptOf = (worker: { readonly taskId: string; readonly outboxPath: string }): string => {
    const member = members.find((one) => one.taskId === worker.taskId);
    return thePromptOfTheWorker({
      taskId: worker.taskId,
      taskText: input.taskTextOf(worker.taskId),
      prefixes: member?.scopePrefixes ?? [],
      hash: input.hash,
      outboxPath: worker.outboxPath,
    });
  };

  let started = false;
  let layerOffAttempt = false;
  let layerOffRun = false;
  let handoff = "";
  let stopSeen: { readonly now: boolean } | null = null;
  const closedGroups: ClosedGroup[] = [];

  const carryOut = (decision: LayerOffDecision): void => {
    input.emit(decision.event.type, decision.event.data);
    input.say(`[LOOP] parallel: ${decision.reason} — ${decision.detail}`);
    input.say(`[LOOP] parallel: ${decision.carriesOn}`);
    if (decision.scope === "attempt") layerOffAttempt = true;
    else layerOffRun = true;
  };

  return {
    group,
    tasksBeforeTheGroup: before,
    reservedBlock: () =>
      group === undefined || started || layerOffAttempt || layerOffRun
        ? ""
        : reservedTasksBlockText(group.tasks),
    handoffForTheCritic: () => handoff,
    layerOffForTheRun: () => layerOffRun,
    layerOffForTheAttempt: () => layerOffAttempt,
    theStopSeenOfTheGroup: () => stopSeen,
    startIfTheBoundaryIsClean: async () => {
      if (plan === null || group === undefined) return false;
      if (started || layerOffAttempt || layerOffRun) return false;
      /* ---- THE RESUME JOIN (step 4, F143-FR-025): a group of an earlier
       * engine start may stand open over this feature. Before a fresh start
       * is even considered, the holders of that run's token are ended after
       * the identity check, the decision over the last ledger record is
       * carried out, and where a state stands that this engine cannot carry
       * out, the group does NOT start: an engine that cannot carry a resume
       * state out must never answer it by starting the group again over the
       * open ledger. ---- */
      let attempt: TheGroupAttempt | TheGroupAttemptRefused | TheGroupAttemptStoppedNow | undefined;
      const open = theOpenParallelGroupOf({
        controlRoot: input.controlRoot,
      });
      if (open !== undefined) {
        const search = await endTheHoldersOfTheOpenGroup({
          open,
          controlRoot: input.controlRoot,
          say: input.say,
        });
        // THE TAIL of the eight states, carried out with the facts of THIS
        // pass boundary — the same audits' inputs, tick, check runner and
        // hash the fresh group run below takes.
        const tailDrive: TheTailOfTheResumeDrive = {
          plan,
          phase: input.phase,
          groupOrdinal: 1,
          workspace: input.workspace,
          slug: input.slug,
          taskListPath: input.taskListPath,
          taskTextAtLaunch: input.taskTextAtLaunch,
          secretsOf: (workerId: string, workerToken: string) => secretsOf(workerId, workerToken),
          singleWriter: {
            taskList: join(input.workspace, input.taskListPath),
            phaseEvidence: [],
            notebook: join(input.controlRoot, "notebook.md"),
            handoff: join(
              theParallelHomeOfARun(open.runId),
              ".specstride",
              "worker-roots",
              open.runId,
              "handoff.json",
            ),
            workspacePart: join(input.workspace, ".specstride"),
          },
          tick: theTickOfTheTaskList(join(input.workspace, input.taskListPath)),
          runner: input.runner ?? theRealCheckRunner(),
          innerCheckSet: input.innerCheckSet,
          containment: input.containment,
          hash: input.hash,
          emit: (type, data) => input.emit(type, data),
        };
        const carried = await carryOutTheResumeOfTheOpenGroup({
          open,
          controlRoot: input.controlRoot,
          say: input.say,
          drive: tailDrive,
          ...(input.resetCounts === true ? { resetCounts: true } : {}),
          // THE STOP THE CARRIED RESTART RUNS UNDER (F143-FR-026, owed item 4
          // of par-4): the same request the fresh group runs — a restart runs
          // worker passes, and its boundaries poll `inbox:stop` exactly as the
          // fresh group's do.
          ...(input.stopRequestPath === undefined
            ? {}
            : { stopRequestPath: input.stopRequestPath }),
          // THE RESTART of the two states a worker process has to start for
          // (F143-FR-025 states 1 and 2): the interrupted run's ledger, THIS
          // start's supervision and start door — the restarted passes run
          // under this engine's token, the records go on the interrupted
          // run's ledger.
          restart: {
            tail: tailDrive,
            search,
            model: input.model,
            modelTierOrEffort: input.modelTierOrEffort,
            containment: input.containment,
            runToken: input.runToken,
            runId: input.runId,
            timeLimitSec: Math.ceil(input.timeLimitMs / 1000),
            enginePid: input.enginePid,
            engineStartedAtMs: input.engineStartedAtMs,
            workersAtATime: Math.max(WORKERS_AT_A_TIME_DEFAULT, group.tasks.length),
            guardScriptPath: input.guardScriptPath,
            registry: input.registry,
            promptOf,
            outputRootOf: (worker) =>
              theOutputRootOfTheWorker(input.controlRoot, input.runId, worker.workerId),
            ...(input.startDoor === undefined ? {} : { startDoor: input.startDoor as never }),
          },
        });
        const stateOfTheResume = carried.carried
          ? "attempt" in carried
            ? ` (state ${String(carried.state)} of the resume carried out as this start's group run)`
            : ""
          : `, state ${String(carried.state)} of the resume`;
        input.say(
          `[LOOP] parallel: a group of run ${open.runId} (${open.groupId}) stands open from an earlier engine start — ${carried.action}${stateOfTheResume}; the survivor search ended ${String(search.ended.length)} worker(s), ${String(
            search.alreadyGone.length,
          )} had gone, ${String(search.refused.length)} refused by the identity check`,
        );
        if (!carried.carried) return false;
        if ("attempt" in carried) {
          /* The tail of F143-FR-025 was carried out: the group's work stands
           * in the workspace already, and the carried attempt IS this start's
           * group run — the same close, counts and directives the fresh path
           * reports below. A fresh start over an open ledger that this engine
           * just carried is never considered. */
          started = true;
          attempt = carried.attempt;
          if (carried.stopped !== undefined) {
            // F143-FR-025 state 6 — the loop layer goes off FOR THE RUN.
            layerOffRun = true;
            input.say(
              `[LOOP] parallel: ${carried.stopped.event} — the application of group ${open.groupId} stopped (${carried.stopped.integrityKind}); the loop layer is off for the run`,
            );
          }
        }
      }
      if (attempt === undefined) {
        const verdict = cleanPassBoundary({
          sessionOpen: false,
          yieldWaitOpen: false,
          phaseEvidencePresent: input.evidencePresent(),
          tasksBeforeTheGroup: before,
          tasksNamedByKeptUnits: input.keptUnitsOf(),
        });
        if (!verdict.clean) {
          input.say(
            `[LOOP] parallel: the group does not start yet — ${verdict.condition}: ${verdict.detail}`,
          );
          return false;
        }
        started = true;
        const workersAtATime = Math.max(WORKERS_AT_A_TIME_DEFAULT, group.tasks.length);
        attempt = await runTheGroupOfTheAttempt({
          controlRoot: input.controlRoot,
          runId: input.runId,
          home: input.home,
          plan,
          phase: input.phase,
          groupOrdinal: 1,
          workspace: input.workspace,
          slug: input.slug,
          taskListPath: input.taskListPath,
          model: input.model,
          modelTierOrEffort: input.modelTierOrEffort,
          containment: input.containment,
          runToken: input.runToken,
          timeLimitSec: Math.ceil(input.timeLimitMs / 1000),
          promptOf,
          outputRootOf: (worker) =>
            theOutputRootOfTheWorker(input.controlRoot, input.runId, worker.workerId),
          ...(input.startDoor === undefined
            ? {
                startDoor: dshStartDoor({
                  model: input.model,
                  modelTierOrEffort: input.modelTierOrEffort,
                  containment: input.containment,
                  runToken: input.runToken,
                  timeLimitMs: input.timeLimitMs,
                  promptOf: (worker) => promptOf(worker),
                  outputRootOf: (worker) =>
                    theOutputRootOfTheWorker(input.controlRoot, input.runId, worker.workerId),
                }),
              }
            : { startDoor: input.startDoor as never }),
          enginePid: input.enginePid,
          engineStartedAtMs: input.engineStartedAtMs,
          workersAtATime,
          guardScriptPath: input.guardScriptPath,
          registry: input.registry,
          taskTextAtLaunch: input.taskTextAtLaunch,
          secretsOf: (workerId: string, workerToken: string) => secretsOf(workerId, workerToken),
          singleWriter: {
            taskList: join(input.workspace, input.taskListPath),
            phaseEvidence: [],
            notebook: join(input.controlRoot, "notebook.md"),
            handoff: join(input.home, ".specstride", "worker-roots", input.runId, "handoff.json"),
            workspacePart: join(input.workspace, ".specstride"),
          },
          tick: theTickOfTheTaskList(join(input.workspace, input.taskListPath)),
          runner: input.runner ?? theRealCheckRunner(),
          innerCheckSet: input.innerCheckSet,
          hash: input.hash,
          ...(input.resetCounts === true ? { resetCounts: true } : {}),
          ...(input.stopRequestPath === undefined
            ? {}
            : { stopRequestPath: input.stopRequestPath }),
          emit: (event) => input.emit(event.type, event.data),
          say: input.say,
        });
      }
      if (attempt !== undefined && "stoppedByStopNow" in attempt) {
        /* ---- `stop --now` cut the group (F143-FR-026): nothing was closed,
         * the ledger stands as the kill left it, and the run stops. ---- */
        stopSeen = { now: true };
        input.say(
          `[LOOP] parallel: stop --now cut group ${attempt.groupId} — no further worker starts, the resume states decide at the next engine start (F143-FR-025, F143-FR-026)`,
        );
        return true;
      }
      // A clean stop the group ran under takes effect AFTER the group
      // (F143-FR-026); the composition root reads it at this boundary.
      if (attempt.ok === true && attempt.stopAfterTheGroup === true) stopSeen = { now: false };
      const closed = theClosedGroupOf(attempt as TheGroupAttempt | TheGroupAttemptRefused);
      const counts = attempt.ok
        ? {
            wallMs: attempt.counts.wallMs,
            agentMs: attempt.counts.agentMs,
            refused: attempt.counts.refused,
          }
        : { wallMs: 0, agentMs: 0, refused: 1 };
      closedGroups.push(closed);
      input.onClosed(closed, counts);
      if (attempt.ok) {
        if (attempt.directive === "keep") {
          handoff = attempt.handoff;
          input.onHandoff(attempt.handoff);
        } else if (attempt.directive === "layerOffForAttempt" && attempt.layerOff !== null) {
          carryOut(attempt.layerOff);
        }
        if (attempt.directive === "repair" || attempt.directive === "none") {
          input.say(
            `[LOOP] parallel: ${attempt.tasksOnTheMainLine.join(", ")} run on the main line (${attempt.directive})`,
          );
        }
      } else {
        carryOut(
          layerOffFor("harness-error", {
            groupId: attempt.groupId,
            detail: attempt.message,
          }),
        );
      }
      const decision = layerOffDecision({
        closedGroups,
        failedGroupsBefore: input.failedGroupsBefore,
      });
      if (decision !== null) carryOut(decision);
      return attempt.ok;
    },
  };
}
