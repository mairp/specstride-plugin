/**
 * T036 — the supervision ceilings and the bound of the stages (F107-FR-025;
 * R16 F5.7).
 *
 * The values of the relaunch budget — `configuration.relaunch` with its
 * `max_relaunches` (0 to 5, default 2) and `wall_clock_seconds` (a positive
 * number) — MUST lie within the ceilings of user configuration
 * (`supervise.maxRelaunches`, `supervise.wallClockSec`), and the wall-clock
 * seconds MUST also not exceed the bound that the stages themselves declare:
 * the sum over the stages of maximum stage attempts times time limit plus
 * every backoff, times the maximum of relaunches plus one. A derived value
 * must not widen a budget (research.md row 10).
 */
import type { ValidationProblem } from "./rules.ts";

function problem(path: string, message: string): ValidationProblem {
  return { rule: "supervision", path, message, class: "structure", exit: 20 };
}

/** The member names of the relaunch block (F107-FR-024). */
export const RELAUNCH_MEMBERS: readonly string[] = Object.freeze([
  "max_relaunches",
  "wall_clock_seconds",
]);

/** The default of `max_relaunches` and its ceiling of shapes. */
export const DEFAULT_MAX_RELAUNCHES = 2;
export const MAX_RELAUNCHES_CEILING = 5;

/** The ceilings of user configuration, as validation receives them. */
export type SupervisionCeilings = {
  readonly maxRelaunches: number;
  readonly wallClockSec: number;
};

/** The ceilings of user configuration, resolved (the defaults of `supervise`). */
export function resolvedCeilings(overrides?: Partial<SupervisionCeilings>): SupervisionCeilings {
  return { maxRelaunches: 5, wallClockSec: 86_400, ...overrides };
}

/** The time limit of one stage, in seconds (F107-FR-015: default 3,600). */
export function stageTimeLimitSec(stage: { readonly time_limit_sec?: unknown }): number {
  const limit = stage.time_limit_sec;
  return typeof limit === "number" && Number.isInteger(limit) && limit > 0 ? limit : 3600;
}

/**
 * The bound the stages declare (F107-FR-025): the sum over the stages of
 * maximum stage attempts times time limit plus every backoff, times the
 * maximum of relaunches plus one.
 */
export function stageBound(
  stages: readonly {
    readonly time_limit_sec?: unknown;
    readonly recovery?: unknown;
  }[],
  maxRelaunches: number,
): number {
  let sum = 0;
  for (const stage of stages) {
    const recovery = (stage.recovery ?? {}) as {
      max_attempts?: unknown;
      backoff_seconds?: unknown;
    };
    const attempts =
      typeof recovery.max_attempts === "number" && recovery.max_attempts >= 1
        ? recovery.max_attempts
        : 1;
    const backoff = Array.isArray(recovery.backoff_seconds)
      ? (recovery.backoff_seconds as number[]).reduce((total, one) => total + one, 0)
      : 0;
    sum += attempts * stageTimeLimitSec(stage) + backoff;
  }
  return sum * (maxRelaunches + 1);
}

/** The default stage time limit derivation resolves (F107-FR-025). */
export const DERIVE_DEFAULT_STAGE_TIMEOUT_SEC = 86_400;

/**
 * The relaunch block derivation writes (F107-FR-025, last sentences): the
 * block is written ONLY when the resolved value of one of the two keys
 * differs from its default (2 relaunches; the bound of the stages), WITH the
 * resolved values, and is omitted otherwise. Derivation never widens a
 * budget: the two keys come from user configuration, the environment or a
 * flag — never from the comment (F107-FR-035).
 */
export function relaunchBlockForDerivation(
  input: {
    readonly maxRelaunches?: unknown;
    readonly stageTimeoutSec?: unknown;
    readonly stages?: readonly { readonly time_limit_sec?: unknown; readonly recovery?: unknown }[];
  } = {},
): { readonly max_relaunches: number; readonly wall_clock_seconds: number } | undefined {
  const maxRelaunches =
    typeof input.maxRelaunches === "number" &&
    Number.isInteger(input.maxRelaunches) &&
    input.maxRelaunches >= 0
      ? input.maxRelaunches
      : DEFAULT_MAX_RELAUNCHES;
  const stageTimeoutSec =
    typeof input.stageTimeoutSec === "number" && input.stageTimeoutSec > 0
      ? input.stageTimeoutSec
      : DERIVE_DEFAULT_STAGE_TIMEOUT_SEC;
  if (
    maxRelaunches === DEFAULT_MAX_RELAUNCHES &&
    stageTimeoutSec === DERIVE_DEFAULT_STAGE_TIMEOUT_SEC
  ) {
    return undefined;
  }
  const stages = (input.stages ?? []).map((one) => ({ ...one, time_limit_sec: stageTimeoutSec }));
  return { max_relaunches: maxRelaunches, wall_clock_seconds: stageBound(stages, maxRelaunches) };
}

/**
 * The relaunch block of F107-FR-024 as validation reads it: the shape, the
 * range, and the ceilings and the bound of F107-FR-025. Empty when the block
 * is absent (the defaults apply) and when every value lies within them.
 */
export function supervisionProblems(
  record: {
    readonly configuration?: { readonly relaunch?: unknown; readonly auto?: unknown } | undefined;
    readonly stages?: readonly { readonly time_limit_sec?: unknown; readonly recovery?: unknown }[];
  },
  ceilings: SupervisionCeilings = resolvedCeilings(),
): readonly ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  // The old name is not accepted — with the new name beside it, or instead
  // of it (F107-FR-024; DV-055).
  if (record.configuration?.auto !== undefined) {
    problems.push(
      problem(
        "/configuration/auto",
        "the relaunch budget is named configuration.relaunch; the old name configuration.auto is not accepted (F107-FR-024; DV-055)",
      ),
    );
  }
  const relaunch = record.configuration?.relaunch;
  if (relaunch === undefined) return problems;

  if (relaunch === null || typeof relaunch !== "object" || Array.isArray(relaunch)) {
    problems.push(problem("/configuration/relaunch", "the relaunch budget must be an object"));
    return problems;
  }
  for (const member of Object.keys(relaunch as Record<string, unknown>)) {
    if (!RELAUNCH_MEMBERS.includes(member)) {
      problems.push(
        problem(
          `/configuration/relaunch/${member}`,
          `unknown member of the relaunch budget: ${member} (only ${RELAUNCH_MEMBERS.join(", ")})`,
        ),
      );
    }
  }
  const table = relaunch as Record<string, unknown>;
  const maxRelaunches = table.max_relaunches ?? DEFAULT_MAX_RELAUNCHES;
  if (
    typeof maxRelaunches !== "number" ||
    !Number.isInteger(maxRelaunches) ||
    maxRelaunches < 0 ||
    maxRelaunches > MAX_RELAUNCHES_CEILING
  ) {
    problems.push(
      problem(
        "/configuration/relaunch/max_relaunches",
        `max_relaunches must be a whole number from 0 to ${MAX_RELAUNCHES_CEILING}`,
      ),
    );
    return problems;
  }
  const wallClock = table.wall_clock_seconds;
  if (typeof wallClock !== "number" || !(wallClock > 0)) {
    problems.push(
      problem(
        "/configuration/relaunch/wall_clock_seconds",
        "wall_clock_seconds must be a positive number",
      ),
    );
    return problems;
  }
  // The ceilings of user configuration (F107-FR-025).
  if (maxRelaunches > ceilings.maxRelaunches) {
    problems.push(
      problem(
        "/configuration/relaunch/max_relaunches",
        `max_relaunches ${maxRelaunches} is above the supervise.maxRelaunches ceiling ${ceilings.maxRelaunches}`,
      ),
    );
  }
  if (wallClock > ceilings.wallClockSec) {
    problems.push(
      problem(
        "/configuration/relaunch/wall_clock_seconds",
        `wall_clock_seconds ${wallClock} is above the supervise.wallClockSec ceiling ${ceilings.wallClockSec}`,
      ),
    );
  }
  // The bound the stages themselves declare (F107-FR-025).
  const bound = stageBound(record.stages ?? [], maxRelaunches);
  if (wallClock > bound) {
    problems.push(
      problem(
        "/configuration/relaunch/wall_clock_seconds",
        `wall_clock_seconds ${wallClock} is above the bound the stages declare: ${bound} ` +
          `(the sum of stage attempts times time limit plus backoff, times max_relaunches plus one)`,
      ),
    );
  }
  return problems;
}
