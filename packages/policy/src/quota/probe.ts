/**
 * T018 — the confirming probe (F127-FR-006; §Q.2, row "Confirming probe").
 *
 * A classification whose confidence is `text`, `stall` or `host` is not
 * evidence enough to stop a run for hours. §Q.2 therefore puts ONE minimal
 * real call between the signal and the pause:
 *
 *  - it is made through the SAME harness adapter, role and model as the call
 *    that failed, so that it tests the same limit;
 *  - it CONFIRMS when it fails with the class `quota_window` or
 *    `quota_credit`; the pause then begins;
 *  - it REFUTES when it succeeds, or fails with any other class; the original
 *    failure then takes the path of the refuted class, and `provider_other`
 *    where the probe named none (a probe that simply succeeded);
 *  - it is a CALL: real spend, written to the ledger with `isProbe: true`. It
 *    is not a pass, not a phase attempt and not a call of the `calls` ceiling,
 *    and it spends nothing of the pass limit (§Q.3, "Dimensions": "a probe is
 *    not one");
 *  - it is NOT MADE when a hard ceiling of spend is already reached: the one
 *    thing a reached cap forbids is another billed call. The failure then
 *    takes the budget path of F127-FR-034 (`budget-cap`), and no pause on weak
 *    evidence begins.
 *
 * Decision D-2 of `research.md`: one probe, before the pause. R14's second
 * rule ("downgraded after 2 probes") has nothing to apply to, because a pause
 * on weak evidence cannot exist without a confirmation.
 *
 * The module reads no clock and no file: the call is a port, and the usage
 * record it produces is handed to the ledger by the caller.
 */
import {
  CONFIDENCES_THAT_NEED_A_PROBE,
  type Confidence,
  type QuotaClass,
} from "@specstride/contracts/ep/quota-classifier";
import type { UsageRecord } from "../budget/ledger.ts";
import type { CeilingReading } from "../budget/ceilings.ts";
import type { QuotaClassification } from "./classify.ts";

/* ------------------------------------------------------------------ *
 * Which classifications need a probe at all.
 * ------------------------------------------------------------------ */

/** The three confidences of §Q.2 that pause only after a confirming probe. */
export const CONFIDENCES_THAT_PAUSE_AFTER_A_PROBE: readonly Confidence[] =
  CONFIDENCES_THAT_NEED_A_PROBE;

/** The two confidences of §Q.2 that pause at once, with no probe. */
export const CONFIDENCES_THAT_PAUSE_AT_ONCE: readonly Confidence[] = Object.freeze([
  "structured",
  "status",
]);

/** The classes a probe CONFIRMS with (§Q.2): a limit the provider still holds. */
export const CLASSES_THAT_CONFIRM: readonly QuotaClass[] = Object.freeze([
  "quota_window",
  "quota_credit",
]);

/** The class a refuted probe falls back to where it named none (§Q.2). */
export const CLASS_WHEN_THE_PROBE_NAMED_NONE: QuotaClass = "provider_other";

/** True where a classification of this confidence may pause only after a probe. */
export function needsAConfirmingProbe(confidence: Confidence): boolean {
  return CONFIDENCES_THAT_PAUSE_AFTER_A_PROBE.includes(confidence);
}

/** True where a classification of this confidence pauses at once (§Q.2). */
export function pausesAtOnce(confidence: Confidence): boolean {
  return CONFIDENCES_THAT_PAUSE_AT_ONCE.includes(confidence);
}

/* ------------------------------------------------------------------ *
 * The port: one minimal real call.
 * ------------------------------------------------------------------ */

/** What the probe asks of the harness port: the same adapter, role and model. */
export type ProbeRequest = {
  readonly role: string;
  readonly harness: string;
  readonly model: string;
  /** Why the call is made, for the adapter's own log. */
  readonly reason: "confirming-probe";
  /** The `usageId` the ledger deduplicates the probe's spend by. */
  readonly usageId: string;
};

/** What the harness port answers. */
export type ProbeCallResult = {
  /** True where the minimal call SUCCEEDED: the limit is gone (§Q.2). */
  readonly ok: boolean;
  /** The classification of the failure, where it failed. */
  readonly classification?: QuotaClassification | null | undefined;
  /** The real cost of the call in US dollars, where the harness reported one. */
  readonly costUsd?: number | null | undefined;
  /** The billing mode of the call; `api` is the only one with real spend. */
  readonly billingMode?: string | undefined;
  readonly inputTokens?: number | null | undefined;
  readonly outputTokens?: number | null | undefined;
};

/** The one call a probe makes, as a port (no provider SDK in this package). */
export type ProbePort = {
  probe(request: ProbeRequest): ProbeCallResult | Promise<ProbeCallResult>;
};

/* ------------------------------------------------------------------ *
 * The decision.
 * ------------------------------------------------------------------ */

/** The three outcomes of a probe: it confirmed, it refuted, or it was not made. */
export const PROBE_OUTCOMES = ["confirmed", "refuted", "not-made"] as const;
export type ProbeOutcome = (typeof PROBE_OUTCOMES)[number];

/** What a probe never spends, whatever it costs (F127-FR-006, §Q.3). */
export const A_PROBE_IS_NOT = Object.freeze({
  aPass: false,
  aPhaseAttempt: false,
  aCallOfTheCallsCeiling: false,
  spendOfThePassLimit: false,
});

/** The blocked reason a probe refused by a reached cap hands on (F127-FR-034). */
export const BLOCKED_REASON_AT_A_REACHED_CAP = "budget-cap" as const;

/** What `confirmingProbe` answers. */
export type ProbeDecision = {
  /** True where the one call was made. */
  readonly made: boolean;
  /** How many calls were made: 1 where it was made, 0 where it was not. */
  readonly calls: number;
  readonly outcome: ProbeOutcome;
  /** True where the pause may now begin (F127-FR-006). */
  readonly pauses: boolean;
  /** The limit class the probe confirmed, or null. */
  readonly confirmedClass: QuotaClass | null;
  /** The class the ORIGINAL failure takes, where the probe refuted it. */
  readonly refutedAs: QuotaClass | null;
  /** The usage record of the probe's real spend, or null where none was made. */
  readonly usageRecord: UsageRecord | null;
  /** A probe is real spend and never a pass, a phase attempt or a call. */
  readonly isNot: typeof A_PROBE_IS_NOT;
  /** `budget-cap` where a reached hard ceiling forbade the call; else null. */
  readonly blockedReason: string | null;
  /** The reached ceiling that forbade the call, where one did. */
  readonly ceilingReached: CeilingReading | null;
  /** Why, in one line, for the event and the log. */
  readonly note: string;
};

/** How the probe is configured. */
export type ProbeOptions = {
  /**
   * The ceilings as the ledger reads them now. A probe is NOT MADE where any
   * hard ceiling of spend is already reached (F127-FR-006). The caller passes
   * the readings of `../budget/ceilings.ts`; an empty list means none is.
   */
  readonly ceilings?: readonly CeilingReading[] | undefined;
  /** The billing mode of the role, for the usage record of the probe. */
  readonly billingMode?: string | undefined;
};

/**
 * The reached hard ceiling of spend among the readings, or null. The caps of
 * spend are the four of §Q.3 (`costUsd`, `tokens`, `phaseAttempts`, `calls`);
 * a tripped `wallClock` is a ceiling of time and not a cap of spend, so it
 * does not forbid the probe.
 */
export function reachedHardCeiling(
  readings: readonly CeilingReading[] | undefined,
): CeilingReading | null {
  for (const reading of readings ?? []) {
    if (reading.isCapOfSpend && reading.exhausted) return reading;
  }
  return null;
}

/**
 * The confirming probe of §Q.2: ONE minimal real call that confirms or refutes
 * a classification of weak confidence (F127-FR-006).
 *
 * The port is called exactly once, and never at all where a hard ceiling of
 * spend is already reached.
 */
export async function confirmingProbe(
  port: ProbePort,
  request: ProbeRequest,
  options: ProbeOptions = {},
): Promise<ProbeDecision> {
  const reached = reachedHardCeiling(options.ceilings);
  if (reached !== null) {
    return Object.freeze({
      made: false,
      calls: 0,
      outcome: "not-made" as ProbeOutcome,
      pauses: false,
      confirmedClass: null,
      refutedAs: null,
      usageRecord: null,
      isNot: A_PROBE_IS_NOT,
      blockedReason: BLOCKED_REASON_AT_A_REACHED_CAP,
      ceilingReached: reached,
      note:
        `the hard ceiling ${reached.key} is already reached (${String(reached.used)} of ` +
        `${reached.limit}); no confirming probe is made and the run takes the budget path ` +
        `with the blocked reason ${BLOCKED_REASON_AT_A_REACHED_CAP} (F127-FR-006, F127-FR-034)`,
    });
  }

  const result = await port.probe(request);
  const usageRecord = probeUsageRecord(request, result, options);

  if (result.ok) {
    return Object.freeze({
      made: true,
      calls: 1,
      outcome: "refuted" as ProbeOutcome,
      pauses: false,
      confirmedClass: null,
      refutedAs: CLASS_WHEN_THE_PROBE_NAMED_NONE,
      usageRecord,
      isNot: A_PROBE_IS_NOT,
      blockedReason: null,
      ceilingReached: null,
      note:
        `the confirming probe succeeded, so it refutes the classification; the original ` +
        `failure takes the path of ${CLASS_WHEN_THE_PROBE_NAMED_NONE}, the class of a probe ` +
        `that named none (F127-FR-006)`,
    });
  }

  const probedClass = result.classification?.quotaClass ?? null;
  if (probedClass !== null && CLASSES_THAT_CONFIRM.includes(probedClass)) {
    return Object.freeze({
      made: true,
      calls: 1,
      outcome: "confirmed" as ProbeOutcome,
      pauses: probedClass === "quota_window",
      confirmedClass: probedClass,
      refutedAs: null,
      usageRecord,
      isNot: A_PROBE_IS_NOT,
      blockedReason: null,
      ceilingReached: null,
      note:
        `the confirming probe failed with ${probedClass}, which confirms the classification ` +
        `(F127-FR-006)`,
    });
  }

  const refutedAs = probedClass ?? CLASS_WHEN_THE_PROBE_NAMED_NONE;
  return Object.freeze({
    made: true,
    calls: 1,
    outcome: "refuted" as ProbeOutcome,
    pauses: false,
    confirmedClass: null,
    refutedAs,
    usageRecord,
    isNot: A_PROBE_IS_NOT,
    blockedReason: null,
    ceilingReached: null,
    note:
      `the confirming probe failed with ${refutedAs}, which is not a limit class, so it ` +
      `refutes the classification; the original failure takes the path of ${refutedAs} ` +
      `(F127-FR-006)`,
  });
}

/**
 * The usage record of a probe: real spend, marked `isProbe`, and never a pass,
 * a phase attempt or a call of the `calls` ceiling (F127-FR-006). The ledger
 * of `../budget/ledger.ts` puts a probe's cost in `probesUsd`.
 */
export function probeUsageRecord(
  request: ProbeRequest,
  result: ProbeCallResult,
  options: ProbeOptions = {},
): UsageRecord {
  return Object.freeze({
    usageId: request.usageId,
    role: request.role,
    billingMode: result.billingMode ?? options.billingMode ?? "unknown",
    harness: request.harness,
    model: request.model,
    costUsd: result.costUsd ?? null,
    inputTokens: result.inputTokens ?? null,
    outputTokens: result.outputTokens ?? null,
    isProbe: true,
    closesAPass: false,
    isCall: false,
  });
}
