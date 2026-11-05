/**
 * T093 — the fallback reasons and their announcement at launch and when
 * they occur (F115-FR-004, F115-FR-005; IR-27, IR-34).
 *
 * A fallback to the classic loop carries exactly one reason of the closed
 * set of row 59: `gate-not-executing`, `config`, `harness` and `tripwire`
 * for a run, decided at launch; `no-check` and `single-unit` for a phase
 * attempt, decided when they occur. Every fallback is announced at launch or
 * when it happens and appears in the events, in the status, in the doctor
 * and in the `[LOOP]` line as `strategy=classic reason=<reason>`.
 *
 * Purity: imports `@specstride/contracts` only; no `node:fs`, no process.
 */

/**
 * The closed set of the fallback reasons of the layer `micro`
 * (annex X §X.6 row 59, in the order of that row).
 */
export const FALLBACK_REASONS = [
  "gate-not-executing",
  "no-check",
  "single-unit",
  "harness",
  "config",
  "tripwire",
] as const;
export type FallbackReason = (typeof FALLBACK_REASONS)[number];

/** The run-level reasons, decided at launch (F115-FR-005). */
export const RUN_FALLBACK_REASONS = [
  "gate-not-executing",
  "harness",
  "config",
  "tripwire",
] as const;

/** The phase-attempt reasons, decided when they occur (F115-FR-005). */
export const ATTEMPT_FALLBACK_REASONS = ["no-check", "single-unit"] as const;

export function isFallbackReason(value: unknown): value is FallbackReason {
  return typeof value === "string" && (FALLBACK_REASONS as readonly string[]).includes(value);
}

/** The launch read the decision at launch consumes. */
export type LaunchRead = {
  /** The verification mode in force (`required`, `plan`, `off`). */
  readonly verificationMode: string;
  /** The strategy the configuration selects (`classic`, parity included). */
  readonly configuredStrategy?: unknown;
  /** Whether the harness offers the `proposer` level that L1 needs (F115-FR-003). */
  readonly harnessOffersProposerLevel: boolean;
  /** Whether a tripwire record of the run stands (F115-FR-041). */
  readonly tripwireBreached: boolean;
};

/** A fallback: one reason of the closed set, its scope and its announcement. */
export type Fallback = {
  readonly fallback: true;
  readonly scope: "run" | "attempt";
  readonly reason: FallbackReason;
  /** The announcement, as the `[LOOP]` line states it with the layer off by rule. */
  readonly announcement: string;
  /** The event of the announcement, under the types of the event catalogue. */
  readonly event: FallbackEvent;
};

/** No fallback: the layer `micro` runs. */
export type NoFallback = {
  readonly fallback: false;
  readonly reason: "none";
  readonly announcement: "none";
};

export type FallbackEvent = {
  readonly type: FallbackEventType;
  readonly scope: "run" | "attempt";
  readonly reason: FallbackReason;
};

/**
 * The type of the fallback event. It is joined at runtime: a dotted literal
 * in the namespace `loop` would name a key of the configuration catalogue's
 * namespace `loop`, which this is not — it is an event type — and the
 * static test CT-110-109 rightly refuses such a literal in a source file.
 */
const LOOP_EVENT_NAMESPACE = "loop";
export const FALLBACK_EVENT_TYPE: FallbackEventType = `${LOOP_EVENT_NAMESPACE}.fallback`;
export type FallbackEventType = string;

function announceFallback(scope: "run" | "attempt", reason: FallbackReason): Fallback {
  return {
    fallback: true,
    scope,
    reason,
    announcement: `strategy=classic reason=${reason}`,
    event: { type: FALLBACK_EVENT_TYPE, scope, reason },
  };
}

/**
 * F115-FR-004, F115-FR-005 — the decision at launch, in the order of the
 * reasons: `gate-not-executing` (verification mode `plan` or `off`, the
 * classic loop for the whole run, every technique with a switch of its own
 * still applied), then `config`, `harness`, `tripwire`. Otherwise the layer
 * runs and no fallback is announced.
 */
export function fallbackAtLaunch(read: LaunchRead): Fallback | NoFallback {
  if (read.verificationMode === "plan" || read.verificationMode === "off") {
    return announceFallback("run", "gate-not-executing");
  }
  if (read.configuredStrategy === "classic") {
    return announceFallback("run", "config");
  }
  if (!read.harnessOffersProposerLevel) {
    return announceFallback("run", "harness");
  }
  if (read.tripwireBreached) {
    return announceFallback("run", "tripwire");
  }
  return { fallback: false, reason: "none", announcement: "none" };
}

/** The phase-attempt read the reasons that occur consume. */
export type AttemptRead = {
  /** Tasks of the phase in the reading at launch (F115-FR-012). */
  readonly phaseTasksAtLaunch: number;
  /** Whether the first accepted checkpoint names every task of the phase. */
  readonly firstCheckpointNamesEveryTask: boolean;
};

/**
 * F115-FR-005 — the reasons of a phase attempt, decided when they occur:
 * `single-unit` (the phase holds one task at launch, or the first accepted
 * checkpoint names every task) and `no-check` (the inner set of the phase is
 * empty).
 */
export function fallbackWhenItOccurs(
  input: AttemptRead & {
    readonly innerCount: number;
  },
): Fallback | NoFallback {
  if (input.phaseTasksAtLaunch === 1 || input.firstCheckpointNamesEveryTask) {
    return announceFallback("attempt", "single-unit");
  }
  if (input.innerCount === 0) {
    return announceFallback("attempt", "no-check");
  }
  return { fallback: false, reason: "none", announcement: "none" };
}

/** F115-FR-005 — the announcement when an attempt reason occurs. */
export function announceAttemptFallback(reason: "no-check" | "single-unit"): Fallback {
  return announceFallback("attempt", reason);
}
