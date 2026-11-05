/**
 * T028 — the relaunch budget (F123-FR-031).
 *
 * The budget defaults to 2 relaunches; a declared budget allows 0 to 5,
 * whatever the mode. The wall-clock ceiling is at most (relaunches + 1)
 * times the declared seconds of the pipeline — by default exactly that
 * value. The deadline is fixed at the first launch and is never extended by
 * a relaunch; every relaunch decrements the remaining count and records why.
 * The budget is one per launch, shared by all stages; a launch or a `resume`
 * started by the consumer starts a new budget, and only relaunches by the
 * runtime root or by `supervise observe` consume it.
 *
 * The declared budget is read from the launch contract under the key
 * `configuration.relaunch`, which accepts only the maximum of relaunches (a
 * whole number from 0 to 5) and the wall-clock seconds (above 0 and not
 * above (relaunches + 1) times the declared seconds of the pipeline); the
 * compatibility projection prints the as-is key names `max_relaunches` and
 * `wall_clock_seconds`.
 */

/** The default maximum of relaunches (F123-FR-031). */
export const RELAUNCH_BUDGET_DEFAULT = 2;

/** The ceiling of the declared maximum: no run is relaunched more than 5 times. */
export const RELAUNCH_BUDGET_CEILING = 5;

/** Where the maximum came from. */
export type BudgetSource = "declared" | "default";

/** A budget that the launch contract declares, or the budget of a call, refused. */
export class RelaunchBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelaunchBudgetError";
  }
}

/** The relaunch budget of one launch (F123-FR-031). */
export type RelaunchBudget = {
  /** The maximum of relaunches: 0 to 5. */
  maximum: number;
  /** How many relaunches are left; never below 0. */
  remaining: number;
  /** `declared` or `default` (F123-FR-031). */
  source: BudgetSource;
  /** The declared seconds of the pipeline, from the launch contract. */
  declaredPipelineSeconds: number;
  /** The wall-clock ceiling of this launch, in seconds. */
  wallClockSeconds: number;
  /** The deadline, fixed at the first launch, in milliseconds since the epoch. */
  deadline: number;
  /** Why every consumed relaunch was spent, in order. */
  reasonLog: string[];
};

function isWhole(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * Create the budget of a launch: the deadline is fixed at `launchTime` and
 * never moves. Pure: no clock, no I/O.
 */
export function createRelaunchBudget(input: {
  /** The declared maximum of relaunches; absent reads the default 2. */
  maximum?: number;
  /** The declared seconds of the pipeline (attempts × time limit + backoff). */
  declaredPipelineSeconds: number;
  /** The declared wall-clock seconds; absent reads the ceiling. */
  wallClockSeconds?: number;
  /** The time of the first launch, in milliseconds since the epoch. */
  launchTime: number;
}): RelaunchBudget {
  if (!isWhole(input.declaredPipelineSeconds) || input.declaredPipelineSeconds <= 0) {
    throw new RelaunchBudgetError(
      `the declared seconds of the pipeline must be a whole number above 0, got ${String(input.declaredPipelineSeconds)}`,
    );
  }
  let maximum: number;
  let source: BudgetSource;
  if (input.maximum === undefined) {
    maximum = RELAUNCH_BUDGET_DEFAULT;
    source = "default";
  } else {
    if (!isWhole(input.maximum) || input.maximum < 0 || input.maximum > RELAUNCH_BUDGET_CEILING) {
      throw new RelaunchBudgetError(
        `a declared budget allows 0 to ${RELAUNCH_BUDGET_CEILING} relaunches, got ${String(input.maximum)}`,
      );
    }
    maximum = input.maximum;
    source = "declared";
  }
  const ceiling = (maximum + 1) * input.declaredPipelineSeconds;
  let wallClockSeconds: number;
  if (input.wallClockSeconds === undefined) {
    wallClockSeconds = ceiling;
  } else {
    if (
      !isWhole(input.wallClockSeconds) ||
      input.wallClockSeconds <= 0 ||
      input.wallClockSeconds > ceiling
    ) {
      throw new RelaunchBudgetError(
        `the wall-clock seconds must be a whole number above 0 and at most ${ceiling} ` +
          `((relaunches + 1) times the declared seconds of the pipeline), got ${String(input.wallClockSeconds)}`,
      );
    }
    wallClockSeconds = input.wallClockSeconds;
  }
  return {
    maximum,
    remaining: maximum,
    source,
    declaredPipelineSeconds: input.declaredPipelineSeconds,
    wallClockSeconds,
    // The deadline is fixed at the first launch and is never extended (F123-FR-031).
    deadline: input.launchTime + wallClockSeconds * 1000,
    reasonLog: [],
  };
}

/** Whether the wall-clock deadline of the budget has passed. */
export function deadlinePassed(budget: RelaunchBudget, now: number): boolean {
  return now >= budget.deadline;
}

/** Whether the budget still allows a relaunch (count and wall clock). */
export function relaunchAllowedByBudget(budget: RelaunchBudget, now: number): boolean {
  return budget.remaining > 0 && !deadlinePassed(budget, now);
}

/**
 * Consume one relaunch: decrement the remaining count (never below 0) and
 * record why. Returns the updated budget and the remaining count.
 */
export function consumeRelaunch(
  budget: RelaunchBudget,
  why: string,
): { budget: RelaunchBudget; remaining: number } {
  const remaining = Math.max(0, budget.remaining - 1);
  return {
    budget: { ...budget, remaining, reasonLog: [...budget.reasonLog, why] },
    remaining,
  };
}

/**
 * Read the declared budget from the launch contract under
 * `configuration.relaunch` (the as-is names `max_relaunches` and
 * `wall_clock_seconds`); a contract that declares nothing reads the default.
 */
export function budgetFromContract(input: {
  contract: Record<string, unknown>;
  launchTime: number;
  declaredPipelineSeconds: number;
}): RelaunchBudget {
  const configuration = input.contract["configuration"];
  const relaunch =
    typeof configuration === "object" && configuration !== null
      ? (configuration as Record<string, unknown>)["relaunch"]
      : undefined;
  if (relaunch === undefined) {
    return createRelaunchBudget({
      declaredPipelineSeconds: input.declaredPipelineSeconds,
      launchTime: input.launchTime,
    });
  }
  if (typeof relaunch !== "object" || relaunch === null) {
    throw new RelaunchBudgetError("configuration.relaunch must be a record");
  }
  const record = relaunch as Record<string, unknown>;
  const maximum = record["max_relaunches"];
  const wallClockSeconds = record["wall_clock_seconds"];
  return createRelaunchBudget({
    maximum: maximum === undefined ? undefined : (maximum as number),
    wallClockSeconds: wallClockSeconds === undefined ? undefined : (wallClockSeconds as number),
    declaredPipelineSeconds: input.declaredPipelineSeconds,
    launchTime: input.launchTime,
  });
}
