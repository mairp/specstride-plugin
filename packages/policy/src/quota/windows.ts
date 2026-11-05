/**
 * T022 — the limit-window state and the query over it (F127-FR-009).
 *
 * The engine keeps, PER HARNESS AND MODEL TIER, the last limit-window facts it
 * observed: the class, the reset time, the utilization and the rate-limit
 * type. Two readers ask the same question of that state:
 *
 *  - the ESCALATION SKIP of this feature (ruling 47): an escalation target, or
 *    a target of the model-tier bump, whose quota is exhausted is SKIPPED, the
 *    work runs on the base model, and the skip is recorded. Such an exhaustion
 *    never pauses the run while the base model is not limited;
 *  - the HEADROOM CHECK of feature 142, which asks the same query before it
 *    spends a limited target on a parallel unit.
 *
 * The facts live in the spend ledger under `windows.byTarget`
 * (`../budget/ledger.ts`, annex B §B.20), so they survive a relaunch; this
 * module is the pure state machine over them and reads no clock: `now` is an
 * argument.
 */
import type { LimitWindowFact } from "../budget/ledger.ts";
import type { QuotaClass } from "@specstride/contracts/ep/quota-classifier";
import type { QuotaClassification } from "./classify.ts";

/* ------------------------------------------------------------------ *
 * The target and the state.
 * ------------------------------------------------------------------ */

/** One target of the limit-window state: a harness and a model tier. */
export type Target = {
  readonly harness: string;
  /** The model tier, as the router names it (`base`, `escalation`, a model id). */
  readonly modelTier: string;
};

/** The key of a target in `windows.byTarget` of the ledger. */
export function targetKey(target: Target): string {
  return `${target.harness}/${target.modelTier}`;
}

/** The limit-window state: the last fact per target. */
export type LimitWindowState = Readonly<Record<string, LimitWindowFact>>;

/** An empty state: nothing observed yet. */
export function emptyWindowState(): LimitWindowState {
  return Object.freeze({});
}

/**
 * The classes that make a target LIMITED (§Q.1): a window a reset ends, and
 * credit, which no clock refills. `rate_limit_transient` is a delay of
 * seconds inside the pass and is not a limited target; `overload` is the
 * provider's own load and not the consumer's limit.
 */
export const CLASSES_THAT_LIMIT_A_TARGET: readonly QuotaClass[] = Object.freeze([
  "quota_window",
  "quota_credit",
]);

/* ------------------------------------------------------------------ *
 * Writing the state.
 * ------------------------------------------------------------------ */

/** One observation the engine hands this module. */
export type WindowObservation = {
  readonly target: Target;
  readonly quotaClass: string;
  readonly resetsAt: string | null;
  readonly utilization: number | null;
  readonly rateLimitType: string | null;
  /** The instant of the observation; the caller reads its clock port. */
  readonly observedAt: string;
};

/**
 * Keep the fact of one observation (F127-FR-009). The state is replaced, never
 * mutated, so a caller may hold the old reading.
 */
export function observeLimitWindow(
  state: LimitWindowState,
  observation: WindowObservation,
): LimitWindowState {
  const fact: LimitWindowFact = Object.freeze({
    quotaClass: observation.quotaClass,
    resetsAt: observation.resetsAt,
    utilization: observation.utilization,
    rateLimitType: observation.rateLimitType,
    observedAt: observation.observedAt,
  });
  return Object.freeze({ ...state, [targetKey(observation.target)]: fact });
}

/** The same, from a classification of `./classify.ts`. */
export function observeClassification(
  state: LimitWindowState,
  target: Target,
  classification: QuotaClassification,
  observedAt: string,
): LimitWindowState {
  return observeLimitWindow(state, {
    target,
    quotaClass: classification.quotaClass,
    resetsAt: classification.resetsAt,
    utilization: classification.utilization,
    rateLimitType: classification.rateLimitType,
    observedAt,
  });
}

/**
 * Forget the fact of a target: the next call of the role SUCCEEDED, so the
 * window is open again (F127-FR-009, F127-FR-014 "ends when a model call of
 * the role succeeds").
 */
export function clearLimitWindow(state: LimitWindowState, target: Target): LimitWindowState {
  const key = targetKey(target);
  if (!(key in state)) return state;
  const next: Record<string, LimitWindowFact> = { ...state };
  delete next[key];
  return Object.freeze(next);
}

/* ------------------------------------------------------------------ *
 * The query: is a target limited?
 * ------------------------------------------------------------------ */

/** The answer of the query, for the escalation skip and for feature 142. */
export type LimitReading = {
  readonly target: Target;
  readonly key: string;
  /** True where the target's quota is exhausted now. */
  readonly limited: boolean;
  /** The fact the answer rests on, or null where nothing was observed. */
  readonly fact: LimitWindowFact | null;
  /** The class of the fact, or null. */
  readonly quotaClass: string | null;
  /** When the window resets, or null where no reset time is known. */
  readonly resetsAt: string | null;
  /** The milliseconds until the reset; null where the reset time is unknown. */
  readonly msUntilReset: number | null;
  /** The utilization the harness gave, or null — the headroom of feature 142. */
  readonly utilization: number | null;
  readonly rateLimitType: string | null;
};

function parse(instant: string | null): number | null {
  if (instant === null) return null;
  const ms = Date.parse(instant);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * F127-FR-009 — whether a target is limited, at the instant `nowMs`.
 *
 * A fact of a limiting class holds until its reset time passes. A fact with no
 * reset time holds until a success clears it (`clearLimitWindow`), which is
 * the only thing that can end `quota_credit`.
 */
export function readLimitWindow(
  state: LimitWindowState,
  target: Target,
  nowMs: number,
): LimitReading {
  const key = targetKey(target);
  const fact = state[key] ?? null;
  const resetsAtMs = parse(fact?.resetsAt ?? null);
  const limits =
    fact !== null && CLASSES_THAT_LIMIT_A_TARGET.includes(fact.quotaClass as QuotaClass);
  const stillLimited = limits && (resetsAtMs === null || resetsAtMs > nowMs);
  return Object.freeze({
    target,
    key,
    limited: stillLimited,
    fact,
    quotaClass: fact?.quotaClass ?? null,
    resetsAt: fact?.resetsAt ?? null,
    msUntilReset: resetsAtMs === null ? null : Math.max(0, resetsAtMs - nowMs),
    utilization: fact?.utilization ?? null,
    rateLimitType: fact?.rateLimitType ?? null,
  });
}

/** The short form of the query: true where the target is limited now. */
export function isLimited(state: LimitWindowState, target: Target, nowMs: number): boolean {
  return readLimitWindow(state, target, nowMs).limited;
}

/** Every limited target of the state, for the doctor and for feature 142. */
export function limitedTargets(state: LimitWindowState, nowMs: number): readonly LimitReading[] {
  const readings: LimitReading[] = [];
  for (const key of Object.keys(state)) {
    const slash = key.indexOf("/");
    const target: Target =
      slash < 0
        ? { harness: key, modelTier: "" }
        : { harness: key.slice(0, slash), modelTier: key.slice(slash + 1) };
    const reading = readLimitWindow(state, target, nowMs);
    if (reading.limited) readings.push(reading);
  }
  return Object.freeze(readings);
}

/** The earliest reset among the limited targets, or null (F127-FR-023). */
export function earliestReset(state: LimitWindowState, nowMs: number): string | null {
  let best: { at: string; ms: number } | null = null;
  for (const reading of limitedTargets(state, nowMs)) {
    const ms = parse(reading.resetsAt);
    if (ms === null) continue;
    if (best === null || ms < best.ms) best = { at: reading.resetsAt as string, ms };
  }
  return best?.at ?? null;
}

/* ------------------------------------------------------------------ *
 * The escalation skip (ruling 47).
 * ------------------------------------------------------------------ */

/** The reason of row 208 of annex X §X.6 that a limited entry is skipped. */
export const SKIP_REASON_LIMITED = "limited" as const;

/** What `decideEscalation` answers. */
export type EscalationDecision = {
  /** True where the escalation target is skipped (F127-FR-009). */
  readonly skipped: boolean;
  /** The target the work runs on: the escalation target, or the base model. */
  readonly runsOn: Target;
  /** The reason of row 208, where the target was skipped. */
  readonly reason: typeof SKIP_REASON_LIMITED | null;
  /**
   * False always: an exhausted ESCALATION target never pauses the run while
   * the base model is not limited (F127-FR-009). Where the base model is
   * limited too, the pause comes from the base model's own signal and not
   * from this decision.
   */
  readonly pausesTheRun: boolean;
  /** True where the base model is limited as well. */
  readonly baseIsLimited: boolean;
  /** The reading of the escalation target. */
  readonly escalation: LimitReading;
  /** The reading of the base model. */
  readonly base: LimitReading;
  /** The payload of the event `fallback.skipped` that records the skip. */
  readonly record: Readonly<Record<string, unknown>> | null;
  readonly note: string;
};

/**
 * F127-FR-009 and ruling 47 — an escalation target, or a target of the
 * model-tier bump, whose quota is exhausted is SKIPPED; the work runs on the
 * base model, and the skip is recorded.
 *
 * `pausesTheRun` is false whenever the base model is open: this is the whole
 * point of the ruling. Where the base model is limited as well, the decision
 * says so and the pause comes from the base model's signal.
 */
export function decideEscalation(
  state: LimitWindowState,
  base: Target,
  escalation: Target,
  nowMs: number,
): EscalationDecision {
  const escalationReading = readLimitWindow(state, escalation, nowMs);
  const baseReading = readLimitWindow(state, base, nowMs);
  if (!escalationReading.limited) {
    return Object.freeze({
      skipped: false,
      runsOn: escalation,
      reason: null,
      pausesTheRun: false,
      baseIsLimited: baseReading.limited,
      escalation: escalationReading,
      base: baseReading,
      record: null,
      note: `the escalation target ${escalationReading.key} is not limited; the work runs on it`,
    });
  }
  return Object.freeze({
    skipped: true,
    runsOn: base,
    reason: SKIP_REASON_LIMITED,
    pausesTheRun: false,
    baseIsLimited: baseReading.limited,
    escalation: escalationReading,
    base: baseReading,
    record: Object.freeze({
      reason: SKIP_REASON_LIMITED,
      harness: escalation.harness,
      model: escalation.modelTier,
      resetsAt: escalationReading.resetsAt,
      ranOn: targetKey(base),
    }),
    note:
      `the escalation target ${escalationReading.key} is limited ` +
      `(${String(escalationReading.quotaClass)}); it is skipped, the work runs on the base ` +
      `model ${baseReading.key}, and the skip is recorded (F127-FR-009, ruling 47)`,
  });
}

/* ------------------------------------------------------------------ *
 * The query feature 142 calls.
 * ------------------------------------------------------------------ */

/** What feature 142 asks before it spends a target on a parallel unit. */
export type Headroom = {
  readonly target: Target;
  /** True where the target may be used now. */
  readonly open: boolean;
  /** The share of the window used, where the harness gave one; else null. */
  readonly utilizationUsed: number | null;
  /** The milliseconds until the window reopens, or null. */
  readonly msUntilReset: number | null;
  readonly reason: typeof SKIP_REASON_LIMITED | null;
};

/**
 * The headroom of a target, for the check of feature 142 (F127-FR-009: "MUST
 * answer whether a target is limited"). One query, two readers.
 */
export function headroomOf(state: LimitWindowState, target: Target, nowMs: number): Headroom {
  const reading = readLimitWindow(state, target, nowMs);
  return Object.freeze({
    target,
    open: !reading.limited,
    utilizationUsed: reading.utilization,
    msUntilReset: reading.msUntilReset,
    reason: reading.limited ? SKIP_REASON_LIMITED : null,
  });
}
