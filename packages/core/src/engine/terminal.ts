/**
 * T016 of feature 101 — the terminal record and the work of the end of the run
 * (F101-FR-036; feature 100 annex B §B.15, F100-FR-148).
 *
 * The engine writes the terminal record BEFORE it exits, on EVERY path by which
 * it exits. That is what makes an ended run tellable from a run that was killed:
 * a supervisor, `resume` and the view all read this one record, and a path that
 * forgot to write it would look like a crash.
 *
 * `retryable` is decided for the ONE stop and is never read off the `transient`
 * attribute of the stop reason; it is never true for a stop reason that is not
 * transient (F101-FR-036, §E.3).
 *
 * AFTER the record the engine runs the work of the end of the run — the release
 * of the lock in start mode `standalone`, the end of the presenter, the summary
 * of learning — in the order in which it was REGISTERED, and a failure of one
 * step does not keep the others from running. The order is the registration
 * order and not a fixed list, so a feature that registers a step of its own
 * lands where it registered.
 *
 * CQ-174: an exit for which the enumeration of stop reasons has no member (an
 * invalid argument or specification with exit 3, the refusal of F101-FR-032 with
 * exit 3, a held lock with exit 5, an internal error with exit 1, an uncaught
 * error with exit 70) carries NO stop reason: the field is null, the
 * compatibility projection writes no stop line, and `retryable` is false.
 */
import { validate } from "@specstride/contracts/records/compile";
import {
  STOP_REASONS,
  type StopReason,
  isTransient,
} from "@specstride/contracts/codes/stop-reasons";
import type { AtomicWrite } from "@specstride/contracts/ep/kernel-services";
import { gateWriter } from "../gate/writers.ts";

/** The schema id of the terminal record (annex B, §B.15). */
export const SCHEMA_ID = "specstride.terminal/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "run:<runId>:terminal" as const;

/** F101-FR-036 — the record is written on every path by which the engine exits. */
export const WRITTEN_ON_EVERY_EXIT_PATH = true as const;

/** F101-FR-036 — the work of the end of the run runs AFTER the record. */
export const WORK_RUNS_AFTER_THE_RECORD = true as const;

/** CQ-174 — the exit codes for which the enumeration has no member. */
export const EXITS_WITHOUT_A_STOP_REASON = [1, 3, 5, 70] as const;

/**
 * The terminal record, with the fields of annex B §B.15. The type is declared
 * here and not imported, because `@specstride/contracts` exports the generated
 * type under no subpath; the VALIDATOR of §B.15 is imported and is what decides
 * whether a record is valid, so the two cannot drift.
 */
export type TerminalRecord = {
  readonly schema: typeof SCHEMA_ID;
  readonly exitCode: number;
  readonly stopReason: StopReason | null;
  readonly retryable: boolean;
  readonly cause: "normal" | "crash" | "owner-lost";
  readonly causedBy: "self" | "operator" | "supervisor" | "host" | "crash";
  readonly blocked?: { readonly reason: string; readonly needed: string; readonly file?: string };
  readonly runId: string;
  readonly launchId: string;
  readonly engineStartId: string;
  readonly phase?: number;
  readonly attemptId?: string;
  readonly at: string;
  readonly synthesized: boolean;
  readonly verificationParallelism?: number;
};

/** What the caller knows about the one stop the record is about. */
export type StopInputs = {
  readonly exitCode: number;
  /** A member of §E.3, or null where the exit has none (CQ-174). */
  readonly stopReason: StopReason | null;
  readonly cause: TerminalRecord["cause"];
  readonly causedBy: TerminalRecord["causedBy"];
  readonly runId: string;
  readonly launchId: string;
  readonly engineStartId: string;
  readonly at: string;
  /** Where the run stood. */
  readonly phase?: number | undefined;
  readonly attemptId?: string | undefined;
  /** When the run rests blocked on a human (annex E §E.2). */
  readonly blocked?: TerminalRecord["blocked"] | undefined;
  /** True only when the runtime root wrote the record. */
  readonly synthesized?: boolean | undefined;
  /** The parallelism in force at the exit, where the engine lowered it (F148-FR-014). */
  readonly verificationParallelism?: number | undefined;
  /**
   * Whether THIS stop may be relaunched. Decided for the one stop; a stop
   * reason that is not transient can never be relaunched, whatever is passed.
   */
  readonly retryable?: boolean | undefined;
};

/**
 * F101-FR-036 — `retryable` for the ONE stop. It is decided for this stop and
 * never read off the `transient` attribute of the stop reason; but it is NEVER
 * true for a stop reason that is not transient, and an exit with no stop reason
 * is never retryable (CQ-174).
 */
export function retryableFor(stopReason: StopReason | null, decided: boolean | undefined): boolean {
  if (stopReason === null) return false;
  if (decided !== true) return false;
  return isTransient(stopReason);
}

/** True when the literal is a member of the enumeration of §E.3. */
export function isStopReason(value: unknown): value is StopReason {
  return typeof value === "string" && (STOP_REASONS as readonly string[]).includes(value);
}

/** F101-FR-036 — the terminal record of one stop, with the fields of §B.15. */
export function terminalRecord(stop: StopInputs): TerminalRecord {
  const record: Record<string, unknown> = {
    schema: SCHEMA_ID,
    exitCode: stop.exitCode,
    stopReason: stop.stopReason,
    retryable: retryableFor(stop.stopReason, stop.retryable),
    cause: stop.cause,
    causedBy: stop.causedBy,
    runId: stop.runId,
    launchId: stop.launchId,
    engineStartId: stop.engineStartId,
    at: stop.at,
    synthesized: stop.synthesized ?? false,
  };
  // A field that does not apply is ABSENT, never null (annex B, §B.4).
  if (stop.blocked !== undefined) record.blocked = stop.blocked;
  if (stop.phase !== undefined) record.phase = stop.phase;
  if (stop.attemptId !== undefined) record.attemptId = stop.attemptId;
  if (stop.verificationParallelism !== undefined) {
    record.verificationParallelism = stop.verificationParallelism;
  }
  return record as unknown as TerminalRecord;
}

/** Whether a record validates against `specstride.terminal/1` (annex B, §B.15). */
export function validatesAgainstTheSchema(record: unknown): boolean {
  return validate(record).ok;
}

/* ------------------------------------------------------------------ *
 * The work of the end of the run, in the order of registration.
 * ------------------------------------------------------------------ */

/**
 * The three steps F101-FR-036 names, in the order the engine registers them in
 * a standalone run. The order of the LIST is not the rule — the order of
 * REGISTRATION is; this is what a standalone run happens to register.
 */
export const WORK_OF_THE_END_OF_THE_RUN = [
  "release-the-lock-in-standalone",
  "end-the-presenter",
  "summarize-learning",
] as const;

/** The release of the lock is registered only in start mode `standalone`. */
export const LOCK_IS_RELEASED_IN_START_MODE = "standalone" as const;

/** One registered step of the work of the end of the run. */
export type EndStep = {
  /** The name of the step, for the report. */
  readonly name: string;
  /** What the step does. A throw is caught and does not stop the others. */
  run(): void | Promise<void>;
};

/** What one step did. */
export type EndStepOutcome = {
  readonly name: string;
  /** The position at which the step was registered, from 1. */
  readonly registeredAt: number;
  readonly ran: true;
  /** The message of the error the step threw, where it threw one. */
  readonly failed?: string;
};

/** What the end of the run reports back. */
export type EndOfTheRunOutcome = {
  /** The record that was written, and where. */
  readonly record: TerminalRecord;
  readonly recordPath: string;
  /** Every step, in the order in which it was registered. */
  readonly steps: readonly EndStepOutcome[];
  /** True when every step ran, whether or not it failed. */
  readonly everyStepRan: true;
};

/**
 * The registry of the work of the end of the run. `register` keeps the order;
 * `steps` gives it back unchanged. A step registered twice stands twice, as the
 * caller asked.
 */
export function endOfRunRegistry(): {
  register(step: EndStep): void;
  readonly steps: readonly EndStep[];
} {
  const registered: EndStep[] = [];
  return {
    register(step: EndStep): void {
      registered.push(step);
    },
    get steps(): readonly EndStep[] {
      return [...registered];
    },
  };
}

/**
 * F101-FR-036 — write the terminal record, then run the work of the end of the
 * run in the order in which it was registered. A failure of one step does NOT
 * keep the others from running: every step runs, and a step that threw is
 * reported with its message.
 *
 * The record goes through the single writer of the records of the phase gate
 * (T012), so it too is written to a temporary name and renamed into place
 * (F101-FR-028).
 */
export async function endTheRun(
  stop: StopInputs,
  path: string,
  atomicWrite: AtomicWrite,
  steps: readonly EndStep[],
): Promise<EndOfTheRunOutcome> {
  const record = terminalRecord(stop);
  const written = gateWriter(atomicWrite).json("terminal record", path, record);
  const outcomes: EndStepOutcome[] = [];
  for (const [index, step] of steps.entries()) {
    try {
      await step.run();
      outcomes.push({ name: step.name, registeredAt: index + 1, ran: true });
    } catch (error) {
      outcomes.push({
        name: step.name,
        registeredAt: index + 1,
        ran: true,
        failed: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    record,
    recordPath: written.path,
    steps: outcomes,
    everyStepRan: true,
  };
}
