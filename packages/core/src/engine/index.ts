/**
 * T001 — the module group `engine` of feature 101 (plan.md, "Path
 * Conventions"): the gated phase loop over a run, its phases and its phase
 * attempts.
 *
 * | Module | Task | Requirement |
 * |---|---|---|
 * | `index.ts` | T001 | — (the entry of the group) |
 * | `boundaries.ts` | T015 | F101-FR-040 |
 * | `terminal.ts` | T016 | F101-FR-036 |
 * | `start-position.ts` | T036 | F101-FR-002 |
 * | `run-loop.ts` | T037 | F101-FR-001, F101-FR-003, F101-FR-018 |
 * | `phase.ts` | T038 | F101-FR-004 |
 * | `index.ts` (the entry `runEngine`) | T047 | F101-FR-001 |
 *
 * The group holds no I/O: a core package reads the tree through the port of
 * the tree store and writes through the kernel (F100-FR-012, F100-FR-234).
 * Phase 1 creates the group; the later tasks of the feature fill it, and each
 * adds its export here.
 */
export * from "./boundaries.ts";
export * from "./terminal.ts";
export * from "./start-position.ts";
export * from "./phase.ts";
export * from "./run-loop.ts";

import {
  siteOfTheLaunchReason,
  startPositionAt,
  type StartPositionInputs,
} from "./start-position.ts";
import { runLoop, type RunEnd, type RunLoopDependencies } from "./run-loop.ts";
import {
  refuseToStart,
  type PhaseWithTasks,
  type RefusedStart,
} from "../approval/ticked-without-record.ts";
import type { ApprovalIntegrityEvent } from "../approval/verify.ts";

/* ==================================================================== *
 * T047 — the engine entry the command `run` of CLI protocol 1 calls
 * (F101-FR-001).
 *
 * The entry takes OPTIONS ONLY and no positional argument (B-0008,
 * C-005): its one parameter is a RECORD, so there is no place for a
 * positional argument to be passed. `run` starts it in the FOREGROUND,
 * in the start mode `standalone`.
 * ==================================================================== */

/** F101-FR-001 — the verb of CLI protocol 1 that calls this entry. */
export const VERB = "run" as const;

/** F101-FR-001 — the entry takes options only. */
export const POSITIONAL_ARGUMENTS = 0 as const;

/** B-0008 — and takes no positional argument at all. */
export const TAKES_A_POSITIONAL_ARGUMENT = false as const;

/** F101-FR-001 — `run` starts the engine in the foreground. */
export const START_MODE_OF_THE_COMMAND_RUN = "standalone" as const;

/**
 * The options of the engine entry. Every one of them is named, so a caller
 * that passes a value in the wrong place is refused by the type and not by a
 * guess about the order of arguments.
 */
export type EngineOptions = {
  /** The working directory as an absolute path (B-0794). */
  readonly workdir: string;
  readonly featureSlug: string;
  readonly specFormat: string;
  /** The phase numbers of the specification, in its order. */
  readonly phases: readonly number[];
  /** The start phase the consumer gave, where one was given (F101-FR-002). */
  readonly startPhase?: number | undefined;
  readonly runId: string;
  readonly engineStartId: string;
  /** The reject limit; 3 by default (F101-FR-014). */
  readonly rejectLimit?: number | undefined;
  /** The MALFORMED limit; 3 by default, 0 switches it off (F101-FR-015). */
  readonly malformedLimit?: number | undefined;
  /** The time limit of a critic-class call, in seconds; 300 by default. */
  readonly criticTimeoutSeconds?: number | undefined;
  /** The verification mode (`required`, `plan`, `off`). */
  readonly verificationMode?: string | undefined;
  /** Whether ticking is on; only the literal that means false switches it off. */
  readonly tickTasks?: string | boolean | undefined;
  /** The value of the approval-commit switch; `auto` enables it (B-0050). */
  readonly gitCommits?: string | undefined;
  /**
   * The reason of the launch record of this start (`specstride.launch/1`,
   * annex B §B.7): `first`, `resume`, `relaunch` or `manual`. It names the
   * read site of F101-FR-031 the start position is derived at (T075); the
   * derivation itself is the same at all three.
   */
  readonly launchReason?: string | undefined;
  /**
   * The profile of the run. Under `parity` the refusal of F101-FR-032 is off
   * (row 129 of annex X §X.7, DV-029).
   */
  readonly profile?: string | undefined;
};

/** What the engine entry hands back to the command. */
export type EngineResult = {
  /** The exit code of the run (annex E §E.3). */
  readonly exitCode: number;
  /** The stop reason, where the run halted. */
  readonly stopReason?: string | undefined;
  /**
   * How the run ended, as `./run-loop.ts` reported it, or the refusal of
   * F101-FR-032, which ends the start before a run begins.
   */
  readonly end: RunEnd | RefusedStart;
  /** The integrity events of the reads of F101-FR-031 made before the loop. */
  readonly integrityEvents: readonly ApprovalIntegrityEvent[];
};

/** Everything the composition root hands the engine; a core package has no I/O. */
export type EngineServices = {
  readonly position: StartPositionInputs;
  readonly runLoop: RunLoopDependencies;
  /** The count of phases the end event of F101-FR-018 carries. */
  readonly phaseCount: number;
  /**
   * The clock the as-is final line of F101-FR-018 reads (B-0232). A thunk,
   * read when the line is written at the end of the run, never baked in at
   * the start: a composition root that hands in `new Date().toISOString()`
   * as a string stamps the start of a run on its end line.
   */
  readonly time: () => string;
  /**
   * F101-FR-032 — the phases of the specification with their task checkboxes,
   * as the one grammar owner parsed them (EP-03, §C.7). Where it is absent no
   * refusal can be worked out and the start goes on, which is what a consumer
   * that hands in no specification asks for.
   */
  readonly phasesWithTasks?: readonly PhaseWithTasks[] | undefined;
  /**
   * F101-FR-031 — where the integrity event of an approval that failed goes.
   * The reads the ENTRY makes are the refusal of F101-FR-032 and the
   * derivation of the start position; phase entry emits its own through the
   * dependency of `./phase.ts`.
   */
  readonly emitIntegrityEvent?: ((event: ApprovalIntegrityEvent) => void) | undefined;
};

/**
 * F101-FR-001 — the engine entry. It derives the start position (T036), runs
 * the loop over phases (T037) and reports the exit code of the run.
 *
 * `options` is unused by the body beyond the start phase today, because every
 * other option reaches the loop through the services the composition root
 * built from the same options; it stands in the signature because the entry of
 * F101-FR-001 is the one place the command `run` calls, and the options are
 * what it passes.
 */
export async function runEngine(
  options: EngineOptions,
  services: EngineServices,
): Promise<EngineResult> {
  // F101-FR-032 — the refusal comes FIRST, before the position is derived and
  // before anything of the run is written: a workspace whose ticks cannot be
  // backed by a verified approval record never starts a run at all, and the
  // refusal changes no state.
  const refused = refuseToStart({
    phases: services.phasesWithTasks ?? [],
    readApproval: services.position.readApproval,
    profile: options.profile,
  });
  if (refused !== undefined) {
    for (const event of refused.integrityEvents) services.emitIntegrityEvent?.(event);
    return Object.freeze({
      exitCode: refused.exitCode,
      end: refused,
      integrityEvents: refused.integrityEvents,
    });
  }

  // F101-FR-031 — the read site this start enters by: a first start, a
  // `resume` or a relaunch. All three derive the position from the same
  // verified records.
  const position = startPositionAt(siteOfTheLaunchReason(options.launchReason), {
    ...services.position,
    startPhaseGivenByTheConsumer: options.startPhase,
  });
  for (const event of position.integrityEvents) services.emitIntegrityEvent?.(event);
  const end = await runLoop(
    { position, phaseCount: services.phaseCount, time: services.time },
    services.runLoop,
  );
  return Object.freeze({
    exitCode: end.exitCode,
    ...(end.ended === "halted" ? { stopReason: end.stopReason } : {}),
    end,
    integrityEvents: position.integrityEvents,
  });
}
