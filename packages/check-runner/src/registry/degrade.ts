/**
 * T033 — the PLAINER PATH of a check runner that fails: one that throws, one
 * that runs over its own time, and one that returns a value outside the closed
 * sets of its operation (F148-FR-018; feature 100, annex A §A.4, F100-FR-019,
 * F100-FR-021).
 *
 * F148-FR-018 asks for two things of a failing runner, and this module is
 * both of them:
 *
 *  1. it takes the plainer path of feature 100, annex A §A.4 — for EP-05 the
 *     sub-heading "Failure of an implementation" of
 *     `specs/100-specstride/contracts/extension-points/EP-05.check-runner.json`
 *     states it: *a runner that cannot start a command returns `cannot-start`;
 *     at the verification gate that is a failed command, and in an inner check
 *     the loop layer is off for the phase attempt. A runner that throws is
 *     treated as `cannot-start`*;
 *  2. it never produces a verdict, an exit code or a stop reason of its own.
 *     `FIELDS_A_DEGRADATION_NEVER_CARRIES` of feature 100 is the field list,
 *     and `holdsNoVerdictExitCodeOrStopReason` is the check over the record.
 *
 * Why a module of the registry and not of `result/`: the three causes are
 * failures of the RUNNER — of an implementation of EP-05 behind the registry —
 * and not of the command the runner ran. A command that exits non-zero, runs
 * over ITS time limit or is cancelled is not a degradation at all: that is the
 * ordinary result of `result/errors.ts` (F148-FR-004). The two are kept apart
 * by `CAUSE_IS_A_FAILURE_OF_THE_RUNNER_NOT_OF_THE_COMMAND`.
 *
 * Where the plainer path differs by operation it follows the unknown-value
 * rule of the point, which for EP-05 states two cases of its own: an unknown
 * KIND of identity refuses the entry at `pin`, at launch; an unknown CONDITION
 * in a result makes the result `unchecked`. Everything else falls back to
 * `cannot-start`, which is also the unknown value of row 54.
 */
import { FIELDS_A_DEGRADATION_NEVER_CARRIES } from "@specstride/contracts/ep/extension-point";
import { IDENTITY_KINDS, OPERATIONS, POINT_ID } from "@specstride/contracts/ep/check-runner";
import { RUNNER_ERRORS, type RunnerError } from "../result/closed-sets.ts";
import { cannotStartResult, messageOf } from "../result/errors.ts";
import {
  UNKNOWN_CONDITION_REASON,
  readResult,
  statedAsPass,
  type RunnerResult,
} from "../result/result.ts";
import { UnknownIdentityKindError } from "./runner.ts";

/** The point whose plainer path this module takes. */
export const EXTENSION_POINT_OF_THE_PLAINER_PATH = POINT_ID;

/** The sub-heading of the contract file that states the plainer path (§A.4). */
export const FAILURE_SUB_HEADING = "Failure of an implementation" as const;

/** The sub-heading that states the unknown-value rule of the point (§A.4). */
export const UNKNOWN_VALUE_SUB_HEADING = "Unknown-value rule" as const;

/** The contract file of EP-05, which is the authority for the two readings. */
export const CONTRACT_FILE =
  "specs/100-specstride/contracts/extension-points/EP-05.check-runner.json" as const;

/** F100-FR-019 — the three ways an implementation of a point fails. */
export const RUNNER_DEGRADATION_CAUSES = ["threw", "time-limit", "outside-result-set"] as const;
export type RunnerDegradationCause = (typeof RUNNER_DEGRADATION_CAUSES)[number];

/**
 * The plainer path of EP-05, as the contract file states it under
 * "Failure of an implementation". It is kept here as data so that the
 * degradation record can carry it, and `plainerPathMatchesTheContract` of
 * `test/degrade-148.test.ts` compares it with the contract file.
 */
export const PLAINER_PATH =
  "A runner that cannot start a command returns `cannot-start`; at the verification gate that " +
  "is a failed command, and in an inner check the loop layer is off for the phase attempt. A " +
  "runner that throws is treated as `cannot-start`.";

/**
 * The unknown-value rule of EP-05, as the contract file states it. It is the
 * reason `pin` and `result` have a plainer path of their own.
 */
export const UNKNOWN_VALUE_RULE =
  "An unknown kind of identity refuses the entry at `pin`, at launch. An unknown condition in a " +
  "result makes the result `unchecked`.";

/**
 * F148-FR-018 — the three causes are failures of the RUNNER. A command that
 * exits non-zero, runs over its own time limit or is cancelled is the ordinary
 * result of F148-FR-004 and is never a degradation.
 */
export const CAUSE_IS_A_FAILURE_OF_THE_RUNNER_NOT_OF_THE_COMMAND = Object.freeze({
  ofTheRunner: RUNNER_DEGRADATION_CAUSES,
  ofTheCommand: Object.freeze(["a non-zero exit code", "the time limit of the command", "cancel"]),
  requirementOfTheCommand: "F148-FR-004",
  requirementOfTheRunner: "F148-FR-018",
});

/**
 * F148-FR-018 — at the verification gate a degraded runner is a FAILED
 * command, and in an inner check the loop layer is off for the phase attempt.
 * The two consequences are the plainer path, stated as data so a caller reads
 * them from the record rather than from prose.
 */
export const CONSEQUENCES_OF_THE_PLAINER_PATH = Object.freeze({
  atTheVerificationGate: "a failed command",
  inAnInnerCheck: "the loop layer is off for the phase attempt",
});

/** F100-FR-019 — the field names a degradation record never carries. */
export { FIELDS_A_DEGRADATION_NEVER_CARRIES };

/**
 * The error of row 54 a cause degrades to, by the operation it happened in.
 * `pin` with an unknown kind REFUSES the entry and so has no result at all;
 * `result` with an unknown condition keeps the exit result and adds
 * `unchecked`. Everything else is `cannot-start`, the unknown value of row 54.
 */
export const ERROR_OF_THE_PLAINER_PATH: RunnerError = "cannot-start";

/** What a degradation of one call of a runner is. */
export type RunnerDegradation = {
  readonly degraded: true;
  /** The point, so a reader of the record knows which contract was read. */
  readonly pointId: string;
  /** The kind of identity the runner serves, or "" where none is known yet. */
  readonly kind: string;
  /** One of `OPERATIONS` of EP-05. */
  readonly operation: string;
  readonly cause: RunnerDegradationCause;
  /** The plainer path the contract file documents, carried with the record. */
  readonly plainerPath: string;
  /** `a failed command` at the gate; the loop layer off in an inner check. */
  readonly consequences: typeof CONSEQUENCES_OF_THE_PLAINER_PATH;
  /** The member of row 54 the call degrades to, or null where the entry is refused. */
  readonly error: RunnerError | null;
  /** True where the plainer path REFUSES the entry instead of returning a result. */
  readonly entryRefused: boolean;
  readonly detail: string;
};

/** Raised where a call of a runner ran over its own time (F100-FR-019). */
export class RunnerTimeLimitExceeded extends Error {
  readonly limitMs: number;
  constructor(limitMs: number, operation: string) {
    super(
      `the operation \`${operation}\` of the runner ran over its own time limit of ` +
        `${limitMs} ms, which is a failure of the runner and not of the command ` +
        `(F100-FR-019, F148-FR-018)`,
    );
    this.name = "RunnerTimeLimitExceeded";
    this.limitMs = limitMs;
  }
}

/** True where the operation is one of the six of EP-05. */
export function isAnOperationOfThePoint(operation: string): boolean {
  return (OPERATIONS as readonly string[]).includes(operation);
}

/**
 * F148-FR-018 — the degradation record of one failed call. It carries the
 * plainer path and its two consequences, and it carries NO verdict, NO exit
 * code and NO stop reason: the field names of
 * `FIELDS_A_DEGRADATION_NEVER_CARRIES` are absent from it by construction.
 */
export function degradedRunner(options: {
  readonly operation: string;
  readonly cause: RunnerDegradationCause;
  readonly kind?: string;
  readonly detail?: unknown;
}): RunnerDegradation {
  const refused = options.operation === "pin" && options.cause === "outside-result-set";
  return Object.freeze({
    degraded: true as const,
    pointId: POINT_ID,
    kind: options.kind ?? "",
    operation: options.operation,
    cause: options.cause,
    plainerPath: PLAINER_PATH,
    consequences: CONSEQUENCES_OF_THE_PLAINER_PATH,
    error: refused ? null : ERROR_OF_THE_PLAINER_PATH,
    entryRefused: refused,
    detail: messageOf(options.detail),
  });
}

/**
 * F148-FR-018, F100-FR-019 — a degradation carries no verdict, no exit code
 * and no stop reason of its own. The check holds over the whole record.
 */
export function holdsNoVerdictExitCodeOrStopReason(record: Readonly<Record<string, unknown>>) {
  return FIELDS_A_DEGRADATION_NEVER_CARRIES.every((field) => !(field in record));
}

/**
 * F148-FR-018 — the RESULT a caller gets for a degraded runner: the plainer
 * path of EP-05, which is `cannot-start`. It counts as failed at the
 * verification gate (`statedAsPass` is false) and it carries the detail of the
 * degradation on standard error, as the baseline's start error does.
 */
export function resultOfADegradedRunner(
  degradation: RunnerDegradation,
  parts: { readonly commandId: string; readonly durationMs?: number } = { commandId: "" },
): RunnerResult {
  const result = cannotStartResult(
    {
      commandId: parts.commandId,
      executable: "",
      args: Object.freeze([]),
      cwd: "",
      durationMs: parts.durationMs ?? 0,
    },
    `${degradation.operation}: ${degradation.detail}`,
  );
  return Object.freeze({ ...result, error: ERROR_OF_THE_PLAINER_PATH });
}

/** True where the result of the plainer path is never stated as a pass. */
export function degradedResultIsNeverAPass(result: RunnerResult): boolean {
  return !statedAsPass(result);
}

/**
 * The unknown-value rule of EP-05 at `pin`: a kind of identity that no runner
 * registered REFUSES the entry, at launch. The refusal is the registry's
 * `UnknownIdentityKindError`, so the plainer path and the operation agree.
 */
export function refusalOfAnUnknownKind(
  kind: string,
  registered: readonly string[],
): UnknownIdentityKindError {
  return new UnknownIdentityKindError(kind, registered);
}

/**
 * The kinds of identity the contract of the point DECLARES (`command`,
 * `steps`). The registry of this feature is OPEN to a kind outside the list, so
 * `plainerPathOfAnEntry` reads the kind of an entry as a string: an author of a
 * later runner registers a kind the contract does not declare, and only a kind
 * that NO runner registered is refused (F148-FR-001, F148-FR-018).
 */
export const KINDS_THE_CONTRACT_DECLARES = IDENTITY_KINDS;

/**
 * The unknown-value rule of EP-05 at `result`: a condition the reader does not
 * know makes the result `unchecked`, with the reason `unknown-condition`. The
 * exit result is kept, because a condition never replaces it (F148-FR-003).
 */
export function uncheckedForAnUnknownCondition(value: unknown): RunnerResult {
  return readResult(value);
}

/** The reason an unknown condition gives the result. */
export { UNKNOWN_CONDITION_REASON };

/** A value outside the closed result set of `poll` (row: `running`, `ended`). */
export const POLL_MEMBERS = Object.freeze(["running", "ended"]);

/** True where the value is a member of the closed result set of `poll`. */
export function pollIsInItsSet(value: unknown): boolean {
  const state = (value as { state?: unknown } | null)?.state;
  return typeof state === "string" && POLL_MEMBERS.includes(state);
}

/** True where every error a runner names is a member of row 54. */
export function errorIsInItsSet(value: unknown): boolean {
  return typeof value === "string" && (RUNNER_ERRORS as readonly string[]).includes(value);
}

/** What one guarded call of a runner produced. */
export type GuardedRunnerOutcome<T> =
  { readonly degraded: false; readonly value: T } | RunnerDegradation;

/** What `guardTheRunner` needs to guard one call (F100-FR-019). */
export type GuardOptions<T> = {
  /** One of the six operations of EP-05. */
  readonly operation: string;
  /** The kind of identity the runner serves, for the record. */
  readonly kind?: string;
  /** The time limit of the CALL — the runner's own, not the command's. */
  readonly timeLimitMs?: number;
  /** True where the returned value is inside the closed set of the operation. */
  readonly inResultSet?: (value: T) => boolean;
};

/**
 * F148-FR-018, F100-FR-019 — one call of a runner, guarded. A throw, a run
 * over the runner's own time limit and a value outside the closed set of the
 * operation each take the plainer path, with a record that carries no verdict,
 * no exit code and no stop reason. The function itself never throws.
 */
export async function guardTheRunner<T>(
  call: () => T | Promise<T>,
  options: GuardOptions<T>,
): Promise<GuardedRunnerOutcome<T>> {
  let value: T;
  try {
    value =
      options.timeLimitMs === undefined
        ? await call()
        : await withATimeLimit(call, options.timeLimitMs, options.operation);
  } catch (thrown) {
    return degradedRunner({
      operation: options.operation,
      cause: thrown instanceof RunnerTimeLimitExceeded ? "time-limit" : "threw",
      ...(options.kind === undefined ? {} : { kind: options.kind }),
      detail: thrown,
    });
  }
  if (options.inResultSet !== undefined && !options.inResultSet(value)) {
    return degradedRunner({
      operation: options.operation,
      cause: "outside-result-set",
      ...(options.kind === undefined ? {} : { kind: options.kind }),
      detail:
        `the value ${JSON.stringify(value)} is outside the closed set of ` +
        `\`${options.operation}\` of ${POINT_ID}`,
    });
  }
  return Object.freeze({ degraded: false as const, value });
}

async function withATimeLimit<T>(
  call: () => T | Promise<T>,
  limitMs: number,
  operation: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(call),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new RunnerTimeLimitExceeded(limitMs, operation)), limitMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * F148-FR-018 — a guarded call read as a RESULT: the value where the runner
 * held, the plainer path where it failed. This is what a caller of the gate
 * uses, because it never has to tell an exception from a result.
 */
export async function runnerResultOrThePlainerPath(
  call: () => RunnerResult | Promise<RunnerResult>,
  options: GuardOptions<RunnerResult> & { readonly commandId: string },
): Promise<{ readonly result: RunnerResult; readonly degradation: RunnerDegradation | null }> {
  const outcome = await guardTheRunner(call, options);
  if (!outcome.degraded) return Object.freeze({ result: outcome.value, degradation: null });
  return Object.freeze({
    result: resultOfADegradedRunner(outcome, { commandId: options.commandId }),
    degradation: outcome,
  });
}

/**
 * F148-FR-018 — the plainer path of a runner whose ENTRY names a kind nobody
 * registered: the entry is refused at `pin` and no check runs. The helper is
 * the one place that decides between a refusal and a result, so a caller does
 * not have to.
 */
export function plainerPathOfAnEntry(
  entry: { readonly id: string; readonly kind: string },
  registered: readonly string[],
): { readonly refused: boolean; readonly refusal: UnknownIdentityKindError | null } {
  const known = registered.includes(String(entry.kind));
  return Object.freeze({
    refused: !known,
    refusal: known ? null : refusalOfAnUnknownKind(String(entry.kind), registered),
  });
}
