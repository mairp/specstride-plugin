/**
 * T066 — the ENFORCEMENT of a hard ceiling (F127-FR-033).
 *
 * The requirement has five parts, and each is a named export here so that a
 * test can question it on its own:
 *
 *  1. **at every usage record and at the safe boundaries of §Q.3** —
 *     `ENFORCEMENT_POINTS` names the five points; `enforce` takes the point it
 *     was called at and never decides a different one;
 *  2. **on the sum of every live harness process** — `sumOverLiveProcesses`
 *     adds the recorded spend of every live process, so two processes that are
 *     each under the ceiling cannot pass it together;
 *  3. **ending the live pass or critic-class call through the stop operation
 *     of the harness port (polite first)** — `endLiveProcesses` walks
 *     `STOP_KIND_ORDER`, which begins at `POLITE_FIRST`, and the module calls
 *     nothing of the platform: the port is handed in;
 *  4. **the work of the pass kept as a claim, no verdict** —
 *     `KEEPS_THE_WORK_AS_A_CLAIM` and `GIVES_NO_VERDICT`;
 *  5. **the remaining headroom passed as a process-level spending limit at the
 *     start of a pass, where the descriptor declares one** — `headroomFor` and
 *     `spendingLimitForAPass`, which answers the field
 *     `processSpendingLimit` of `StartPassInput` of EP-02.
 *
 * And the bound the requirement closes with: recorded real spend MUST NOT
 * exceed a cap by more than ONE MODEL CALL PER LIVE HARNESS PROCESS —
 * `maxOvershootCalls` and `overshootIsWithinBound`.
 *
 * `wallClock` never comes through here as a cap: it is a ceiling of time, and
 * a trip takes the path of F127-FR-027 (CQ-192). `enforce` reports it apart,
 * in `wallClockTripped`, and never puts it in `exhausted`.
 */
import type { HarnessPort, PassHandle, StopKind } from "@specstride/contracts/ep/harness";
import {
  CEILING_OF_TIME,
  SOFT_DIMENSION,
  type BudgetDimension,
  type Ceiling,
  type CeilingEvaluation,
  type CeilingReading,
  type UsageSnapshot,
  evaluateCeilings,
  isActive,
  usedFor,
} from "./ceilings.ts";
import { type SpendLedger, type UsageRecord } from "./ledger.ts";

/* ------------------------------------------------------------------ *
 * 1. Where a hard ceiling is enforced (§Q.3, the row "Enforced").
 * ------------------------------------------------------------------ */

/** The four SAFE BOUNDARIES of §Q.3, in the order a pass meets them. */
export const SAFE_BOUNDARIES = [
  "before-a-phase-attempt",
  "before-a-pass",
  "before-a-critic-class-call",
  "between-units-of-work",
] as const;
export type SafeBoundary = (typeof SAFE_BOUNDARIES)[number];

/** The point `enforce` was called at: a usage record, or a safe boundary. */
export const ENFORCEMENT_POINTS = ["usage-record", ...SAFE_BOUNDARIES] as const;
export type EnforcementPoint = (typeof ENFORCEMENT_POINTS)[number];

/** True where the point is one of the four safe boundaries (§Q.3). */
export function isSafeBoundary(point: EnforcementPoint): point is SafeBoundary {
  return (SAFE_BOUNDARIES as readonly string[]).includes(point);
}

/** A point outside the five is refused rather than read as another one. */
export class EnforcementPointError extends Error {
  constructor(point: string) {
    super(
      `the enforcement point ${JSON.stringify(point)} is not one of the five of §Q.3 ` +
        `(${ENFORCEMENT_POINTS.join(", ")}); a hard ceiling is enforced at every usage record ` +
        `and at the safe boundaries, and nowhere else is a decision taken (F127-FR-033)`,
    );
    this.name = "EnforcementPointError";
  }
}

/** Read a point; one outside the five throws. */
export function readEnforcementPoint(point: string): EnforcementPoint {
  if (!(ENFORCEMENT_POINTS as readonly string[]).includes(point)) {
    throw new EnforcementPointError(point);
  }
  return point as EnforcementPoint;
}

/* ------------------------------------------------------------------ *
 * 2. The live harness processes, and the sum over them.
 * ------------------------------------------------------------------ */

/** The two kinds of live call a cap can end (F127-FR-033). */
export const LIVE_KINDS = ["pass", "critic-class-call"] as const;
export type LiveKind = (typeof LIVE_KINDS)[number];

/**
 * One LIVE HARNESS PROCESS. The handle is the one `startPass` of EP-02
 * returned, which `stop` of the same port takes; a process whose handle is
 * absent can still be summed over but cannot be ended through the port.
 */
export type LiveProcess = {
  /** A stable identity for the process inside the run. */
  readonly processId: string;
  readonly role: string;
  readonly kind: LiveKind;
  readonly harness?: string | undefined;
  /** The handle of EP-02, where the process was started through the port. */
  readonly handle?: PassHandle | undefined;
  /**
   * True where the HARNESS DESCRIPTOR declares a process-level spending limit
   * (the capability `processSpendingLimit` of EP-02). Only then is the
   * headroom passed at the start of a pass (F127-FR-033).
   */
  readonly declaresProcessSpendingLimit?: boolean | undefined;
};

/**
 * The spend of one dimension summed OVER EVERY LIVE HARNESS PROCESS
 * (F127-FR-033).
 *
 * The ledger keeps spend per role, so the sum is taken over the DISTINCT ROLES
 * the live processes run under — two live passes of the same role share one
 * bucket and must not be counted twice. A dimension of run scope
 * (`phaseAttempts`) is a figure of the run and is read once.
 *
 * `null` is UNKNOWN and not zero (F127-FR-028): where no live process reported
 * anything for the dimension the answer is `null`, and a ceiling then does not
 * trip on it.
 */
export function sumOverLiveProcesses(
  dimension: BudgetDimension | typeof SOFT_DIMENSION,
  processes: readonly LiveProcess[],
  usage: UsageSnapshot,
): number | null {
  if (dimension === "phaseAttempts" || dimension === CEILING_OF_TIME) {
    return usedFor(dimension, "run", undefined, usage);
  }
  const roles = [...new Set(processes.map((process) => process.role))];
  let total: number | null = null;
  for (const role of roles) {
    const value = usedFor(dimension, "role", role, usage);
    if (value === null) continue;
    total = (total ?? 0) + value;
  }
  return total;
}

/* ------------------------------------------------------------------ *
 * 3. The headroom, and the process-level spending limit.
 * ------------------------------------------------------------------ */

/** The headroom of one reading: what is left before the ceiling. */
export function headroomOf(reading: CeilingReading): number | null {
  if (!reading.active || reading.limit === null || reading.used === null) return null;
  return Math.max(0, reading.limit - reading.used);
}

/**
 * The REMAINING HEADROOM of a dimension: the SMALLEST headroom of every active
 * ceiling of that dimension, at either scope. The smallest, because a pass
 * that spends the run's headroom has also spent the role's.
 *
 * `null` where no active ceiling of the dimension is set, or where the spend
 * is unknown: there is then no figure to hand a harness process.
 */
export function headroomFor(
  dimension: BudgetDimension,
  ceilings: readonly Ceiling[],
  usage: UsageSnapshot,
  role?: string,
): number | null {
  let smallest: number | null = null;
  for (const ceiling of ceilings) {
    if (ceiling.dimension !== dimension) continue;
    if (!isActive(ceiling.limit)) continue;
    if (ceiling.scope === "role" && role !== undefined && ceiling.role !== role) continue;
    const used = usedFor(dimension, ceiling.scope, ceiling.role, usage);
    if (used === null) continue;
    const left = Math.max(0, (ceiling.limit as number) - used);
    smallest = smallest === null ? left : Math.min(smallest, left);
  }
  return smallest;
}

/** What `spendingLimitForAPass` answers. */
export type SpendingLimitDecision = {
  /** The value for `processSpendingLimit` of `StartPassInput`, or null. */
  readonly processSpendingLimit: number | null;
  /** True where the harness descriptor declares the capability. */
  readonly declared: boolean;
  /** Why no limit is passed, where none is. */
  readonly reason: string | null;
};

/**
 * The remaining headroom of `costUsd`, to be passed to a harness process AT
 * THE START OF A PASS as its own spending limit — but ONLY where the harness
 * descriptor declares that capability (F127-FR-033, EP-02
 * `processSpendingLimit`). Where it does not, nothing is passed and the engine
 * keeps the whole of the enforcement itself.
 */
export function spendingLimitForAPass(
  process: LiveProcess,
  ceilings: readonly Ceiling[],
  usage: UsageSnapshot,
): SpendingLimitDecision {
  if (process.declaresProcessSpendingLimit !== true) {
    return Object.freeze({
      processSpendingLimit: null,
      declared: false,
      reason:
        "the harness descriptor declares no process-level spending limit; the engine enforces " +
        "the cap at every usage record and at the safe boundaries instead (F127-FR-033)",
    });
  }
  const headroom = headroomFor("costUsd", ceilings, usage, process.role);
  if (headroom === null) {
    return Object.freeze({
      processSpendingLimit: null,
      declared: true,
      reason:
        "no active `costUsd` ceiling is set for the role or the run, or the spend is unknown, " +
        "so there is no headroom to pass (F127-FR-024, F127-FR-028)",
    });
  }
  return Object.freeze({ processSpendingLimit: headroom, declared: true, reason: null });
}

/* ------------------------------------------------------------------ *
 * 4. Ending the live pass through the stop operation, polite first.
 * ------------------------------------------------------------------ */

/** The order of the three kinds of stop of EP-02: POLITE FIRST. */
export const STOP_KIND_ORDER: readonly StopKind[] = Object.freeze(["polite", "terminate", "kill"]);

/** The kind the engine always tries first (F127-FR-033: "politely first"). */
export const POLITE_FIRST: StopKind = "polite";

/** F127-FR-033 — the work of the pass is KEPT AS A CLAIM. */
export const KEEPS_THE_WORK_AS_A_CLAIM = true as const;

/** F127-FR-033 — a pass ended by a cap gives NO VERDICT. */
export const GIVES_NO_VERDICT = true as const;

/** What one live process's stop did. */
export type StopOutcome = {
  readonly processId: string;
  /** The kinds tried, in order; the first is always `polite`. */
  readonly tried: readonly StopKind[];
  /** The kind that worked, or null where none did. */
  readonly stoppedBy: StopKind | null;
  readonly stopped: boolean;
  /** True where no handle was held, so the port could not be called. */
  readonly noHandle: boolean;
};

/**
 * End every live pass and critic-class call through the STOP OPERATION of the
 * harness port, POLITE FIRST (F127-FR-033).
 *
 * `stop` of EP-02 answers `false` where the kind did not work, and the failure
 * path of the operation is "the caller falls back to the next stronger kind of
 * stop" — so this walks `STOP_KIND_ORDER` until one answers `true`. A throw is
 * read as a `false` of that kind, for the same reason.
 */
export async function endLiveProcesses(
  port: Pick<HarnessPort, "stop">,
  processes: readonly LiveProcess[],
): Promise<readonly StopOutcome[]> {
  const outcomes: StopOutcome[] = [];
  for (const process of processes) {
    if (process.handle === undefined) {
      outcomes.push(
        Object.freeze({
          processId: process.processId,
          tried: Object.freeze([]),
          stoppedBy: null,
          stopped: false,
          noHandle: true,
        }),
      );
      continue;
    }
    const tried: StopKind[] = [];
    let stoppedBy: StopKind | null = null;
    for (const kind of STOP_KIND_ORDER) {
      tried.push(kind);
      let answered = false;
      try {
        answered = await port.stop(process.handle, kind);
      } catch {
        answered = false;
      }
      if (answered) {
        stoppedBy = kind;
        break;
      }
    }
    outcomes.push(
      Object.freeze({
        processId: process.processId,
        tried: Object.freeze(tried),
        stoppedBy,
        stopped: stoppedBy !== null,
        noHandle: false,
      }),
    );
  }
  return Object.freeze(outcomes);
}

/* ------------------------------------------------------------------ *
 * 5. The overshoot bound: one model call per live harness process.
 * ------------------------------------------------------------------ */

/**
 * How many model calls of overshoot F127-FR-033 allows: ONE PER LIVE HARNESS
 * PROCESS. With one live process the recorded spend may pass the cap by one
 * call; with three, by three — because each was in flight when the cap was
 * reached and each reports what it already spent.
 */
export function maxOvershootCalls(processes: readonly LiveProcess[]): number {
  return processes.length;
}

/**
 * True where the recorded spend's overshoot is within the bound of
 * F127-FR-033: at most `maxOvershootCalls` calls, each of at most
 * `costPerCall`.
 */
export function overshootIsWithinBound(input: {
  readonly recorded: number;
  readonly limit: number;
  readonly costPerCall: number;
  readonly processes: readonly LiveProcess[];
}): boolean {
  const overshoot = Math.max(0, input.recorded - input.limit);
  return overshoot <= input.costPerCall * maxOvershootCalls(input.processes);
}

/** The overshoot of a recorded figure against a limit, and its bound. */
export function overshootReport(input: {
  readonly recorded: number;
  readonly limit: number;
  readonly costPerCall: number;
  readonly processes: readonly LiveProcess[];
}): Readonly<{
  readonly overshoot: number;
  readonly allowedCalls: number;
  readonly allowedOvershoot: number;
  readonly withinBound: boolean;
}> {
  const overshoot = Math.max(0, input.recorded - input.limit);
  const allowedCalls = maxOvershootCalls(input.processes);
  return Object.freeze({
    overshoot,
    allowedCalls,
    allowedOvershoot: input.costPerCall * allowedCalls,
    withinBound: overshootIsWithinBound(input),
  });
}

/* ------------------------------------------------------------------ *
 * The enforcement itself.
 * ------------------------------------------------------------------ */

/** What `enforce` is handed. */
export type EnforceInput = {
  /** The point of §Q.3 the engine called at. */
  readonly point: EnforcementPoint;
  readonly ceilings: readonly Ceiling[];
  readonly ledger: SpendLedger;
  /** The whole minutes of this engine start, less pause time (F127-FR-026). */
  readonly wallClockMinutes?: number | undefined;
  /** Every live harness process (F127-FR-033). */
  readonly processes?: readonly LiveProcess[] | undefined;
  /** The record that brought the engine here, where the point is a record. */
  readonly record?: UsageRecord | undefined;
};

/** What `enforce` answers. */
export type EnforcementDecision = {
  readonly point: EnforcementPoint;
  /** Every reading, as `./ceilings.ts` took it. */
  readonly evaluation: CeilingEvaluation;
  /** The exhausted CAPS OF SPEND; `wallClock` is never among them (CQ-192). */
  readonly exhausted: readonly CeilingReading[];
  /** True where a hard ceiling was brought to its limit by this point. */
  readonly mustEndThePass: boolean;
  /** The live processes to end, in the order they are ended. */
  readonly toEnd: readonly LiveProcess[];
  /** The kinds of stop, polite first (F127-FR-033). */
  readonly stopKinds: readonly StopKind[];
  /** True: the work of the pass is kept as a claim (F127-FR-033). */
  readonly keepsTheWorkAsAClaim: boolean;
  /** True: no verdict is given (F127-FR-033). */
  readonly givesNoVerdict: boolean;
  /** The tripped `wallClock`, which takes the path of F127-FR-027, not this one. */
  readonly wallClockTripped: CeilingReading | null;
  /** The remaining headroom per dimension, for a process-level spending limit. */
  readonly headroom: Readonly<Partial<Record<BudgetDimension, number | null>>>;
  /** How far the recorded spend may pass a cap (F127-FR-033). */
  readonly allowedOvershootCalls: number;
};

/**
 * Enforce the hard ceilings at one point of §Q.3 (F127-FR-033).
 *
 * The sum is taken over every live harness process; the evaluation is the one
 * of `./ceilings.ts`, so the rules "0 is off", "`api` records only" and "every
 * exhausted ceiling is reported" hold here unchanged. A tripped `wallClock` is
 * handed back APART and never ends a pass through this path.
 */
export function enforce(input: EnforceInput): EnforcementDecision {
  const point = readEnforcementPoint(input.point);
  const processes = input.processes ?? [];
  const usage: UsageSnapshot = Object.freeze({
    ledger: input.ledger,
    wallClockMinutes: input.wallClockMinutes,
  });
  const evaluation = evaluateCeilings(input.ceilings, usage);
  const exhausted = evaluation.exhaustedCapsOfSpend;
  const mustEndThePass = exhausted.length > 0;
  const headroom: Partial<Record<BudgetDimension, number | null>> = {};
  for (const dimension of ["tokens", "costUsd", "calls", "phaseAttempts"] as const) {
    headroom[dimension] = headroomFor(dimension, input.ceilings, usage);
  }
  return Object.freeze({
    point,
    evaluation,
    exhausted,
    mustEndThePass,
    toEnd: mustEndThePass ? Object.freeze([...processes]) : Object.freeze([]),
    stopKinds: STOP_KIND_ORDER,
    keepsTheWorkAsAClaim: KEEPS_THE_WORK_AS_A_CLAIM,
    givesNoVerdict: GIVES_NO_VERDICT,
    wallClockTripped: evaluation.wallClockTripped,
    headroom: Object.freeze(headroom),
    allowedOvershootCalls: maxOvershootCalls(processes),
  });
}

/**
 * Enforce AT A USAGE RECORD (F127-FR-033, the first half of "at every usage
 * record and at the safe boundaries"). The record is carried into the decision
 * so that a caller writing `budget.exceeded` can name what brought the ceiling
 * to its limit.
 */
export function enforceAtUsageRecord(
  record: UsageRecord,
  input: Omit<EnforceInput, "point" | "record">,
): EnforcementDecision {
  return enforce({ ...input, point: "usage-record", record });
}

/** Enforce AT A SAFE BOUNDARY of §Q.3 (F127-FR-033). */
export function enforceAtBoundary(
  boundary: SafeBoundary,
  input: Omit<EnforceInput, "point" | "record">,
): EnforcementDecision {
  return enforce({ ...input, point: boundary });
}
