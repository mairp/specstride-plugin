/**
 * T022 — the worker count of a group (feature 142, F142-FR-019; rules PU-31,
 * PU-39).
 *
 * What the requirement fixes, and what this module decides:
 *
 *  - `loop.parallel.workers` defaults to **2**;
 *  - its ceiling is the value of the key `loop.parallel.workersMax`, a whole
 *    number of 1 or more that defaults to **4** and is a widening key. The
 *    ceiling is no constant: the consumer can set it, so a ceiling of 6 with 5
 *    workers is accepted;
 *  - a configured value of `loop.parallel.workers` above the ceiling in force
 *    is a **configuration error at launch** — not a fallback, not a silent
 *    clamp: a ceiling of 3 with 4 workers is an error;
 *  - two rate limits classified as transient in one group **halve** the worker
 *    count, to no less than 1, for the rest of the phase attempt; at 1 no group
 *    starts.
 *
 * Trust classes (F100-FR-202): both keys are widening, so project
 * configuration cannot raise either of them. A widening key that project
 * configuration carries is ignored with a launch message and a doctor warning,
 * which is why `workersInForce` reads the two trusted places and reports what a
 * project declaration asked for.
 *
 * The module is pure: it reads no file and starts no process. The plan it
 * belongs to is computed once, at launch (F142-FR-017, T051).
 */
import { admitEveryPhase, ALONE } from "./admission.ts";
import type { AdmissionInputs, AdmissionResult, TaskAsReadAtLaunch } from "./admission.ts";
import { optionIsOn } from "./register.ts";
import type { UnitsConfiguration } from "./register.ts";
import {
  GROUP_MIN_TASKS,
  PARALLEL_PLAN_LOGICAL_NAME,
  PARALLEL_PLAN_SCHEMA,
  WORKERS_DEFAULT,
  WORKERS_MAX_DEFAULT,
} from "./types.ts";
import type { FallbackReason, ParallelPlan, PhasePlan, SerialTask } from "./types.ts";

/** `loop.parallel.workers` — the worker count of a group (row 21 of annex X §X.7). */
export const WORKERS_KEY = "loop.parallel.workers" as const;

/** `loop.parallel.workersMax` — its ceiling (row 130 of annex X §X.7). */
export const WORKERS_MAX_KEY = "loop.parallel.workersMax" as const;

/** Both keys are widening keys (F100-FR-127, F100-FR-202). */
export const BOTH_KEYS_ARE_WIDENING = true as const;

/** The least the ceiling may be: a whole number of 1 or more (F142-FR-019). */
export const WORKERS_MAX_LEAST = 1 as const;

/** The least the worker count may fall to when it is halved (F142-FR-019). */
export const WORKERS_LEAST_AFTER_HALVING = 1 as const;

/** At one worker no group starts (F142-FR-019). */
export const NO_GROUP_STARTS_AT_ONE_WORKER = true as const;

/** The two rate limits of one group that halve the worker count (F142-FR-019). */
export const TRANSIENT_RATE_LIMITS_THAT_HALVE = 2 as const;

/**
 * What configuration says about the two keys. `userConfiguration` and
 * `launchContract` are the trusted places for a widening key;
 * `projectConfiguration` is read only to report that it is ignored.
 */
export type WorkerCountConfiguration = {
  readonly userConfiguration?: { readonly workers?: number; readonly workersMax?: number };
  readonly launchContract?: { readonly workers?: number; readonly workersMax?: number };
  readonly projectConfiguration?: { readonly workers?: number; readonly workersMax?: number };
};

/** A value configuration gave that is not a whole number of 1 or more. */
function isWholeAtLeast(value: number | undefined, least: number): value is number {
  return value !== undefined && Number.isInteger(value) && value >= least;
}

/**
 * The ceiling in force: the value of `loop.parallel.workersMax` the consumer
 * set in user configuration or in the promoted launch contract, else the
 * default 4 (F142-FR-019). A value that is not a whole number of 1 or more is
 * a configuration error, reported by `workersInForce`.
 */
export function workersMaxInForce(configuration: WorkerCountConfiguration = {}): number {
  const declared =
    configuration.userConfiguration?.workersMax ?? configuration.launchContract?.workersMax;
  return isWholeAtLeast(declared, WORKERS_MAX_LEAST) ? declared : WORKERS_MAX_DEFAULT;
}

/** The worker count `loop.parallel.workers` names, before the ceiling is applied. */
export function workersDeclared(configuration: WorkerCountConfiguration = {}): number {
  const declared =
    configuration.userConfiguration?.workers ?? configuration.launchContract?.workers;
  return isWholeAtLeast(declared, 1) ? declared : WORKERS_DEFAULT;
}

/** A configuration error at launch: the run does not start with it (F142-FR-019). */
export type ConfigurationError = {
  readonly configurationError: true;
  readonly key: typeof WORKERS_KEY | typeof WORKERS_MAX_KEY;
  readonly message: string;
};

/** The worker count in force, or the configuration error that stops the launch. */
export type WorkersInForce =
  | {
      readonly configurationError: false;
      readonly workers: number;
      readonly workersMax: number;
      /** The lines the doctor prints for a widening key project configuration carried. */
      readonly doctorLines: readonly string[];
    }
  | ConfigurationError;

/** True where the result is the configuration error of F142-FR-019. */
export function isConfigurationError(result: WorkersInForce): result is ConfigurationError {
  return result.configurationError;
}

/**
 * The worker count in force at launch (F142-FR-019).
 *
 * The default is 2. The ceiling is the value of `loop.parallel.workersMax` in
 * force, 4 by default and set by the consumer where they set it: with a ceiling
 * of 6, five workers are accepted. A configured worker count **above** the
 * ceiling in force is a configuration error at launch, named with its key, and
 * is never clamped into range: with a ceiling of 3, four workers are an error.
 *
 * A widening key in project configuration is ignored, with a doctor line
 * (F100-FR-202); it never raises the count or the ceiling, and it never makes
 * the launch an error.
 */
export function workersInForce(configuration: WorkerCountConfiguration = {}): WorkersInForce {
  const doctorLines: string[] = [];
  const fromTheProject = configuration.projectConfiguration ?? {};
  for (const [field, key] of [
    ["workers", WORKERS_KEY],
    ["workersMax", WORKERS_MAX_KEY],
  ] as const) {
    if (fromTheProject[field] !== undefined) {
      doctorLines.push(
        `${key} in project configuration is ignored: it is a widening key (F100-FR-202)`,
      );
    }
  }

  const declaredMax =
    configuration.userConfiguration?.workersMax ?? configuration.launchContract?.workersMax;
  if (declaredMax !== undefined && !isWholeAtLeast(declaredMax, WORKERS_MAX_LEAST)) {
    return Object.freeze({
      configurationError: true,
      key: WORKERS_MAX_KEY,
      message: `${WORKERS_MAX_KEY}=${String(declaredMax)} is not a whole number of ${WORKERS_MAX_LEAST} or more`,
    });
  }
  const workersMax = workersMaxInForce(configuration);

  const declared =
    configuration.userConfiguration?.workers ?? configuration.launchContract?.workers;
  if (declared !== undefined && !isWholeAtLeast(declared, 1)) {
    return Object.freeze({
      configurationError: true,
      key: WORKERS_KEY,
      message: `${WORKERS_KEY}=${String(declared)} is not a whole number of 1 or more`,
    });
  }
  const workers = workersDeclared(configuration);
  if (workers > workersMax) {
    return Object.freeze({
      configurationError: true,
      key: WORKERS_KEY,
      message: `${WORKERS_KEY}=${workers} is above the ceiling ${WORKERS_MAX_KEY}=${workersMax} in force`,
    });
  }
  return Object.freeze({
    configurationError: false,
    workers,
    workersMax,
    doctorLines: Object.freeze(doctorLines),
  });
}

/**
 * Halve the worker count after two rate limits classified as transient in one
 * group (F142-FR-019, PU-39): the count falls to no less than 1 and stays
 * there for the rest of the phase attempt. Fewer than two transient limits in
 * the group leave the count as it was.
 */
export function halvedAfterTransientRateLimits(
  workers: number,
  transientRateLimitsInTheGroup: number,
): number {
  if (transientRateLimitsInTheGroup < TRANSIENT_RATE_LIMITS_THAT_HALVE) return workers;
  return Math.max(WORKERS_LEAST_AFTER_HALVING, Math.floor(workers / 2));
}

/**
 * The worker count for the rest of the phase attempt after a number of groups
 * in each of which two transient rate limits were seen: each such group halves
 * the count once, never below 1 (F142-FR-019).
 */
export function workersForTheRestOfTheAttempt(
  workers: number,
  groupsWithTwoTransientRateLimits: number,
): number {
  let count = workers;
  for (let i = 0; i < groupsWithTwoTransientRateLimits; i += 1) {
    count = halvedAfterTransientRateLimits(count, TRANSIENT_RATE_LIMITS_THAT_HALVE);
  }
  return count;
}

/** True where the worker count in force lets a group start (F142-FR-019). */
export function aGroupMayStartAt(workers: number): boolean {
  return workers > WORKERS_LEAST_AFTER_HALVING;
}

/* ================================================================== *
 * T051 — the plan: computed at launch, hashed, handed to the engine,
 * printed by the dry run and the doctor (F142-FR-017; rules PU-15, PU-98).
 * ================================================================== */

/**
 * What F142-FR-017 fixes, and what this part of the module does:
 *
 *  - the plan of every phase is computed **at launch**, as a pure function of
 *    the task list as read at launch and of configuration
 *    (`computeThePlanAtLaunch`);
 *  - it is stored in the control plane under `run:<runId>:parallel-plan` with
 *    its hash, and the hash is an event (`storePlanDirective`,
 *    `planHashEvent`). The layer hands the plan to the engine, **which stores
 *    it**: the layer writes no file (F142-FR-006);
 *  - it is never computed again inside a run (`planForTheRun`): a relaunch
 *    that derives another plan announces the difference and uses the **stored**
 *    plan;
 *  - a stored plan whose hash does not match starts no group and switches the
 *    layer off for the **run**, with an integrity event (`planIntegrity`);
 *  - the dry run of a launch and the doctor print the plan **only with the
 *    option on**: per phase the groups, the tasks made serial with the reason,
 *    and the ceiling of the speed-up under equal task cost (`printThePlan`).
 */

/** The logical name the engine stores the plan under (annex B §B.5). */
export const PLAN_LOGICAL_NAME = PARALLEL_PLAN_LOGICAL_NAME;

/** The event that carries the hash of the plan (row 74 of annex X §X.6). */
export const PLAN_EVENT = "parallel.plan" as const;

/** The plan is computed once, at launch, and never again inside a run. */
export const COMPUTED_AT_LAUNCH_ONLY = true as const;

/** Who stores the plan: the engine, from the value the layer hands it. */
export const STORED_BY = "the engine" as const;

/** The reason the layer is off for the **run** where the hash does not match. */
export const PLAN_HASH_REASON = "plan-hash" as const;

/**
 * The ceiling of the speed-up of a phase under equal task cost (F142-FR-017,
 * R29 F-2).
 *
 * Under equal task cost a phase of `n` tasks whose groups hold `g1..gk` tasks
 * costs `n - sum(gi) + k` task-times instead of `n`: every group of `gi` tasks
 * costs one task-time, because its tasks are worked at the same time. The
 * ceiling is the ratio of the two, and it is 1 where the plan holds no group.
 */
export function ceilingOfTheSpeedUp(result: {
  readonly tasks: readonly { readonly id: string }[];
  readonly groups: readonly { readonly tasks: readonly string[] }[];
}): number {
  const n = result.tasks.length;
  if (n === 0) return 1;
  const grouped = result.groups.reduce((sum, group) => sum + group.tasks.length, 0);
  const cost = n - grouped + result.groups.length;
  return cost === 0 ? 1 : n / cost;
}

/** The serial list of a phase of the plan, with the reason each task carries. */
export function serialListOf(result: AdmissionResult): readonly SerialTask[] {
  return Object.freeze(
    result.serial.map((placement) =>
      Object.freeze({ id: placement.id, reason: placement.reason, detail: placement.detail }),
    ),
  );
}

/** One phase of the plan, from the admission of its tasks (annex D §D.3). */
export function phasePlanOf(result: AdmissionResult): PhasePlan {
  return Object.freeze({
    phase: result.phase,
    groups: Object.freeze([...result.groups]),
    tasks: Object.freeze([...result.tasks]),
    serial: serialListOf(result),
    ceiling: ceilingOfTheSpeedUp(result),
  });
}

/** What the plan is computed from: the task list as read at launch, and configuration. */
export type PlanAtLaunchInput = {
  readonly runId: string;
  /** The task list exactly as it was read at launch (F142-FR-007, F142-FR-017). */
  readonly tasks: readonly TaskAsReadAtLaunch[];
  /** Everything the eight admission checks read (F142-FR-011). */
  readonly admission?: AdmissionInputs;
  /** The worker count in force, from `workersInForce` (F142-FR-019). */
  readonly workers?: number;
  /** The fallback reason the preconditions found, or `null` where none did. */
  readonly fallback?: FallbackReason | null;
};

/**
 * Compute the plan at launch (T051, F142-FR-017).
 *
 * The function is pure: the same task list and the same configuration give the
 * same plan, byte for byte, and therefore the same hash. It reads no file,
 * starts no process and asks no service. The hash is left empty here and is
 * filled by `hashedPlan`, which is the only place the hasher is used, so that
 * the plan the hash is taken over is exactly the plan that is stored.
 */
export function computeThePlanAtLaunch(input: PlanAtLaunchInput): ParallelPlan {
  const workers = input.workers ?? input.admission?.workers ?? WORKERS_DEFAULT;
  const admission: AdmissionInputs = Object.freeze({ ...(input.admission ?? {}), workers });
  const phases = admitEveryPhase(input.tasks, admission).map(phasePlanOf);
  return Object.freeze({
    schema: PARALLEL_PLAN_SCHEMA,
    runId: input.runId,
    hash: "",
    workers,
    phases: Object.freeze(phases),
    fallback: input.fallback ?? null,
  });
}

/** The number of groups a plan holds, over every phase (F142-FR-002, `no-group`). */
export function groupsInThePlan(plan: ParallelPlan): number {
  return plan.phases.reduce((sum, phase) => sum + phase.groups.length, 0);
}

/**
 * The record the hash of the plan is taken over: the plan without its own
 * `hash` field, so that the value is a hash of the plan and not of itself.
 */
export function planRecordForTheHash(plan: ParallelPlan): Readonly<Record<string, unknown>> {
  const { hash: _hash, ...rest } = plan;
  return Object.freeze({ ...rest });
}

/** The canonical record text of a plan, and its hash (annex X §X.5). */
export type PlanHashing = {
  /** The canonical record text, with sorted keys and no final line end. */
  readonly text: string;
  /** The canonical record hash of that text with one line end added. */
  readonly hash: string;
};

/** The hasher the layer is handed from the composition root (annex X §X.5). */
export type PlanHasher = {
  canonicalRecordText(record: unknown): string;
  canonicalRecordHash(record: unknown): string;
};

/** The canonical text and hash of a plan (F142-FR-017, annex X §X.5). */
export function hashOfThePlan(plan: ParallelPlan, hasher: PlanHasher): PlanHashing {
  const record = planRecordForTheHash(plan);
  return Object.freeze({
    text: hasher.canonicalRecordText(record),
    hash: hasher.canonicalRecordHash(record),
  });
}

/**
 * The plan with its hash in it (F142-FR-017). This is the value the layer hands
 * the engine: the engine stores exactly it, under `PLAN_LOGICAL_NAME`.
 */
export function hashedPlan(plan: ParallelPlan, hasher: PlanHasher): ParallelPlan {
  return Object.freeze({ ...plan, hash: hashOfThePlan(plan, hasher).hash });
}

/** Compute the plan at launch and hash it, in one step (T051). */
export function planAtLaunch(input: PlanAtLaunchInput, hasher: PlanHasher): ParallelPlan {
  return hashedPlan(computeThePlanAtLaunch(input), hasher);
}

/**
 * What the layer hands the engine at launch: the plan to store under its
 * logical name, and the event that carries its hash (F142-FR-017,
 * F142-FR-025). The layer writes neither: the engine stores the one and emits
 * the other (F142-FR-006).
 */
export type PlanHandover = {
  readonly store: {
    readonly logicalName: typeof PLAN_LOGICAL_NAME;
    readonly schema: typeof PARALLEL_PLAN_SCHEMA;
    readonly plan: ParallelPlan;
    readonly storedBy: typeof STORED_BY;
  };
  readonly event: {
    readonly type: typeof PLAN_EVENT;
    readonly data: Readonly<Record<string, unknown>>;
  };
};

/** The directive to store the plan: a value the engine executes (F142-FR-017). */
export function storePlanDirective(plan: ParallelPlan): PlanHandover["store"] {
  return Object.freeze({
    logicalName: PLAN_LOGICAL_NAME,
    schema: PARALLEL_PLAN_SCHEMA,
    plan,
    storedBy: STORED_BY,
  });
}

/** The event that carries the hash of the plan (F142-FR-017, row 74). */
export function planHashEvent(plan: ParallelPlan): PlanHandover["event"] {
  return Object.freeze({
    type: PLAN_EVENT,
    data: Object.freeze({
      hash: plan.hash,
      workers: plan.workers,
      groups: groupsInThePlan(plan),
      phases: plan.phases.length,
    }),
  });
}

/** Hand the plan to the engine: it stores it, and emits its hash (T051). */
export function handThePlanToTheEngine(plan: ParallelPlan): PlanHandover {
  return Object.freeze({ store: storePlanDirective(plan), event: planHashEvent(plan) });
}

/**
 * The integrity of a stored plan (F142-FR-017): the hash the control plane
 * carries beside the plan is taken again over the plan itself. Where the two
 * do not match, no group starts and the layer is off for the **run**, with an
 * integrity event — a changed plan is never used and never repaired.
 */
export type PlanIntegrity =
  | { readonly matches: true; readonly hash: string }
  | {
      readonly matches: false;
      readonly reason: typeof PLAN_HASH_REASON;
      readonly scope: "run";
      readonly startsNoGroup: true;
      readonly event: {
        readonly type: "parallel.plan";
        readonly data: Readonly<Record<string, unknown>>;
      };
      readonly detail: string;
    };

/** Check a stored plan against the hash that was stored with it (F142-FR-017). */
export function planIntegrity(
  stored: ParallelPlan,
  storedHash: string,
  hasher: PlanHasher,
): PlanIntegrity {
  const again = hashOfThePlan(stored, hasher).hash;
  if (again === storedHash) return Object.freeze({ matches: true as const, hash: again });
  return Object.freeze({
    matches: false as const,
    reason: PLAN_HASH_REASON,
    scope: "run" as const,
    startsNoGroup: true as const,
    event: Object.freeze({
      type: "parallel.plan" as const,
      data: Object.freeze({ integrity: "hash-mismatch", stored: storedHash, recomputed: again }),
    }),
    detail: `the stored plan hashes to ${again} and the control plane carries ${storedHash}: no group starts and the layer is off for the run (${PLAN_HASH_REASON})`,
  });
}

/**
 * The plan the run uses (F142-FR-017): the **stored** plan, always. Where a
 * relaunch derives another plan — because the task list changed between launch
 * and relaunch — the difference is announced and the stored plan is used; the
 * derived plan is never silently preferred and never stored over the first.
 */
export type PlanForTheRun = {
  readonly plan: ParallelPlan;
  readonly fromTheStore: true;
  /** True where a plan derived now would differ from the stored one. */
  readonly differs: boolean;
  /** The line that announces the difference, or `null` where there is none. */
  readonly announcement: string | null;
};

/** The plan the run uses, and the announcement of a difference (F142-FR-017). */
export function planForTheRun(
  stored: ParallelPlan,
  derivedNow: ParallelPlan | undefined,
  hasher: PlanHasher,
): PlanForTheRun {
  if (derivedNow === undefined) {
    return Object.freeze({
      plan: stored,
      fromTheStore: true as const,
      differs: false,
      announcement: null,
    });
  }
  const derivedHash = hashOfThePlan(derivedNow, hasher).hash;
  const storedHash = stored.hash === "" ? hashOfThePlan(stored, hasher).hash : stored.hash;
  const differs = derivedHash !== storedHash;
  return Object.freeze({
    plan: stored,
    fromTheStore: true as const,
    differs,
    announcement: differs
      ? `the plan derived now (${derivedHash}) differs from the stored plan (${storedHash}): the stored plan applies (F142-FR-017)`
      : null,
  });
}

/* ------------------------------------------------------------------ *
 * The printed plan: the dry run of a launch, and the doctor (PU-98).
 * ------------------------------------------------------------------ */

/** The two places the plan is printed, and only with the option on (PU-98). */
export const PLAN_IS_PRINTED_BY = Object.freeze(["launch --dry-run", "doctor"] as const);
export type PlanPrinter = (typeof PLAN_IS_PRINTED_BY)[number];

/** The plan is printed only with the option on (F142-FR-017, PU-98). */
export const PLAN_IS_PRINTED_ONLY_WITH_THE_OPTION_ON = true as const;

/** The reason of a serial task as the plan prints it. */
function serialReasonAsPrinted(serial: SerialTask): string {
  return serial.reason === ALONE
    ? `${serial.reason} (fewer than ${GROUP_MIN_TASKS} admitted tasks were left)`
    : serial.reason;
}

/**
 * The lines the dry run of a launch and the doctor print for a plan
 * (T051, F142-FR-017, PU-98).
 *
 * Per phase: the groups, the tasks made serial **with the reason**, and the
 * ceiling of the speed-up under equal task cost; then, once, the statement of
 * the expected saving that F142-FR-073 requires (T102,
 * `expectedSavingStatement`). With the option **off** the
 * list is empty: no plan is printed, which is what F142-FR-005 and the
 * acceptance scenario 4 of `spec.md` require.
 */
export function printThePlan(
  plan: ParallelPlan,
  configuration: UnitsConfiguration = {},
  printer: PlanPrinter = "launch --dry-run",
): readonly string[] {
  if (!optionIsOn(configuration)) return Object.freeze([]);
  const lines: string[] = [
    `parallel plan (${printer}): ${groupsInThePlan(plan)} group(s), workers=${plan.workers}, hash=${plan.hash}`,
  ];
  for (const phase of plan.phases) {
    lines.push(`phase ${phase.phase}: ceiling=${phase.ceiling.toFixed(2)} under equal task cost`);
    for (const group of phase.groups) {
      lines.push(`  group ${group.ordinal}: ${group.tasks.join(", ")}`);
    }
    for (const serial of phase.serial) {
      lines.push(`  serial ${serial.id}: reason=${serialReasonAsPrinted(serial)}`);
    }
  }
  // The ceiling of each phase is above; the statement of the expected saving
  // closes the print, so that nobody reads a ceiling as a promise (T102,
  // F142-FR-073).
  lines.push(...expectedSavingStatement());
  return Object.freeze(lines);
}

/* ------------------------------------------------------------------ *
 * T102 — the ceiling and the statement of the expected saving, printed
 * with the plan (F142-FR-073; R29 F-2 and F-8; R29v V-27; ruling P10).
 *
 * F142-FR-073 — "The documentation of the option and the printed plan MUST
 * state the expected saving as it is: a ceiling of about 3 to 4 per cent of
 * alive time at 2 workers before any cost, against one cold start per worker;
 * the option is worth switching on for single phases and not for a run."
 *
 * The figures are not invented here and no target is set (research.md D-9,
 * ruling P10):
 *
 *  - R29 F-2 computed the ceiling of a phase with task order respected and a
 *    worker cap. Under the eligibility rule (the marker, a named path, no
 *    overlap with a task already admitted) two workers reach a pooled 1.063,
 *    a median 1.038 and a p90 1.190, of the 1.104 available with no cap at
 *    all; four workers reach a pooled 1.094. End to end, with the proposer
 *    shares of R27 F-1, that is 3.0 % of alive time for the Claude baseline,
 *    4.1 % for ORD and 2.0 % for LONG — hence "about 3 to 4 per cent".
 *  - R29 F-8 priced what it costs: every worker is in a directory of its own,
 *    so its first turn is a cache **write** and not a read — one cold start
 *    per worker, 130 to 216 k tokens beyond the serial path at two workers.
 *    Money is not stated there, and none is stated here.
 *  - R29v V-27 re-ran the arithmetic of F-2 and reproduced every figure, and
 *    found R29's own central estimate of "1 to 3 %" to have no method and a
 *    lower bound that can fall below zero once the cold start is paid. So the
 *    statement is a **ceiling before any cost** and never a saving promised.
 *  - Ruling P10 made E6 a safety experiment: a default cannot be shown at its
 *    size, so the printed plan states no target and no pass mark.
 *
 * Why "single phases and not a run": the ceiling is per phase, and a phase at
 * the median gains 3.8 % of its own alive time while each of its workers pays
 * a whole cold start. Over a run the eligible phases are a minority — R29v
 * V-27 counts 85 of 399 phases (21 %) reaching 1.15 at two workers — so the
 * cost is paid on every group and the gain is diluted by every phase that has
 * no group at all.
 * ------------------------------------------------------------------ */

/** The ceiling of a phase at 2 workers under the eligibility rule (R29 F-2, rule B). */
export const CEILING_AT_TWO_WORKERS = Object.freeze({
  pooled: 1.063,
  median: 1.038,
  p90: 1.19,
} as const);

/** The same at 4 workers, which is the ceiling of `loop.parallel.workersMax` (R29 F-2). */
export const CEILING_AT_FOUR_WORKERS = Object.freeze({
  pooled: 1.094,
  median: 1.052,
  p90: 1.314,
} as const);

/** The ceiling with no worker cap at all, which 2 workers reach most of (R29 F-2). */
export const CEILING_UNBOUNDED = 1.104 as const;

/**
 * The expected saving of the option, as F142-FR-073 requires it to be stated:
 * a **ceiling**, in per cent of alive time, at 2 workers, before any cost.
 */
export const EXPECTED_SAVING = Object.freeze({
  /** "About 3 to 4 per cent": 3.0 % (Claude baseline) to 4.1 % (ORD), R29 F-2. */
  perCentOfAliveTimeAtTwoWorkers: Object.freeze({ low: 3, high: 4 } as const),
  /** The figure is a ceiling and not an expectation. */
  isACeiling: true,
  /** It is stated **before** any cost of the option is subtracted. */
  beforeAnyCost: true,
  /** What the ceiling is paid against: one cold start per worker (R29 F-8). */
  against: "one cold start per worker",
  /** The tokens of that cold start beyond the serial path, at 2 workers (R29 F-8). */
  coldStartTokensAtTwoWorkers: Object.freeze({ low: 130_000, high: 216_000 } as const),
  /** Where switching the option on is worth it. */
  worthSwitchingOnFor: "single phases",
  /** And where it is not. */
  notWorthSwitchingOnFor: "a run",
  /** No target and no pass mark for a default is set (ruling P10, research.md D-9). */
  target: null,
  /** The reports the figures come from. */
  sources: Object.freeze(["R29 F-2", "R29 F-8", "R29v V-27", "ruling P10"] as const),
} as const);

/** F142-FR-073 sets no target for the saving: the figure is a ceiling (ruling P10). */
export const SAVING_HAS_NO_TARGET = true as const;

/**
 * The statement of the expected saving, word for word as F142-FR-073 asks for
 * it. The printed plan ends with these lines and the documentation of the
 * option (T105) states the same thing.
 */
export function expectedSavingStatement(): readonly string[] {
  const { low, high } = EXPECTED_SAVING.perCentOfAliveTimeAtTwoWorkers;
  const cold = EXPECTED_SAVING.coldStartTokensAtTwoWorkers;
  return Object.freeze([
    `expected saving: a ceiling of about ${low} to ${high} per cent of alive time at ` +
      `${WORKERS_DEFAULT} workers, before any cost`,
    `  against ${EXPECTED_SAVING.against}: a worker's first turn is a cache write, ` +
      `${cold.low / 1000} to ${cold.high / 1000} k tokens beyond the serial path at ` +
      `${WORKERS_DEFAULT} workers (R29 F-8)`,
    `  the ceiling of a phase at ${WORKERS_DEFAULT} workers is ` +
      `${CEILING_AT_TWO_WORKERS.pooled.toFixed(3)} pooled, ` +
      `${CEILING_AT_TWO_WORKERS.median.toFixed(3)} median, ` +
      `${CEILING_AT_TWO_WORKERS.p90.toFixed(3)} p90 (R29 F-2, confirmed by R29v V-27)`,
    `  worth switching on for ${EXPECTED_SAVING.worthSwitchingOnFor}, and not for ` +
      `${EXPECTED_SAVING.notWorthSwitchingOnFor}`,
    "  no target is set and no saving is promised (ruling P10)",
  ]);
}
