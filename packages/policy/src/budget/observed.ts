/**
 * T053 — provider warnings and the observation-based alerts of a subscription
 * (F127-FR-038).
 *
 * Two halves of one requirement:
 *
 *  - **a provider's own warning** of an approaching limit — a warning status
 *    with a utilization, say — PASSES THROUGH as an alert of kind
 *    `provider-warning` and level `warn`, WITH THE RATE-LIMIT TYPE AND THE
 *    RESET TIME. It passes through: the engine neither invents it nor
 *    suppresses it, because the provider knows the allowance and the engine
 *    does not;
 *  - **with a subscription** the engine TRACKS WHAT IT OBSERVES — tokens per
 *    role per window, notional cost, passes, and the utilization the provider
 *    gives — and ALERTS ON IT, since the allowance itself is unknown until the
 *    provider signals it. Those alerts are the SOFT budget of §Q.3
 *    (`budget.role.<role>.softTokens`), whose levels are the
 *    `soft-on-a-subscription` case of §Q.4: 50 is `info`, 75 and 90 are
 *    `warn`.
 *
 * The window is the harness's own where it reports a reset, and the whole run
 * otherwise (§Q.3, the row "Soft"), so the state here is keyed by role and
 * window.
 */
import { alert, type EmitOptions } from "../quota/events.ts";
import type { EventWriter, PolicyEvent } from "../quota/ports.ts";
import type { QuotaClassification } from "../quota/classify.ts";
import { SOFT_DIMENSION, type Ceiling, type CeilingReading } from "./ceilings.ts";
import {
  dedupeKeyOf,
  hasFired,
  markFired,
  levelForThreshold,
  readThresholds,
  thresholdsCrossed,
  DEFAULT_THRESHOLDS,
  type AlertKind,
  type AlertLevel,
  type AlertState,
  type DecidedAlert,
} from "./alerts.ts";

/* ------------------------------------------------------------------ *
 * 1. A provider's own warning (F127-FR-038).
 * ------------------------------------------------------------------ */

/** The kind of the alert; row 205 of annex X §X.6. */
export const ALERT_KIND_PROVIDER_WARNING: AlertKind = "provider-warning";

/** Its level is FIXED at `warn` (§Q.4, "Fixed levels"). */
export const PROVIDER_WARNING_LEVEL: AlertLevel = "warn";

/** F127-FR-038 — the warning PASSES THROUGH; the engine does not compute it. */
export const A_PROVIDER_WARNING_PASSES_THROUGH = true as const;

/** The two facts a provider warning carries beyond the figure (F127-FR-038). */
export const PROVIDER_WARNING_CARRIES = Object.freeze(["rateLimitType", "resetsAt"]);

/** What a provider told the engine. */
export type ProviderWarning = {
  readonly role: string;
  /** The utilization the provider gave, in `[0, 1]`, or null. */
  readonly utilization: number | null;
  /** The rate-limit type the provider named, or null. */
  readonly rateLimitType: string | null;
  /** The reset time the provider gave, or null. */
  readonly resetsAt: string | null;
  /** The harness that saw it. */
  readonly harness?: string | undefined;
};

/**
 * A provider warning read off a classification (F127-FR-038). A classification
 * that carries a utilization or a rate-limit type is a warning of an
 * approaching limit; one that carries neither is not, and the answer is null
 * rather than an alert with nothing in it.
 */
export function warningOfClassification(
  classification: QuotaClassification,
  role: string,
): ProviderWarning | null {
  const utilization = classification.utilization ?? null;
  const rateLimitType = classification.rateLimitType ?? null;
  if (utilization === null && rateLimitType === null) return null;
  return Object.freeze({
    role,
    utilization,
    rateLimitType,
    resetsAt: classification.resetsAt ?? null,
  });
}

/** The deduplication key of a provider warning (§Q.4: kind, role, threshold). */
export function providerWarningKey(warning: ProviderWarning): string {
  return dedupeKeyOf({ kind: ALERT_KIND_PROVIDER_WARNING, role: warning.role, threshold: null });
}

/**
 * Pass a provider's warning through as an alert (F127-FR-038). The level is
 * `warn`, fixed; the `rateLimitType` and `resetsAt` ride in the payload, and
 * `rateLimitType` is free text of the provider, so it goes out through the
 * `message` field, which `../quota/events.ts` redacts and cuts.
 */
export function providerWarningAlert(
  writer: EventWriter,
  warning: ProviderWarning,
  options: EmitOptions = {},
): PolicyEvent {
  return alert(
    writer,
    {
      kind: ALERT_KIND_PROVIDER_WARNING,
      level: PROVIDER_WARNING_LEVEL,
      role: warning.role,
      threshold: null,
      value: warning.utilization,
      limit: 1,
      dedupeKey: providerWarningKey(warning),
      message: warning.rateLimitType,
    },
    options,
  );
}

/**
 * The provider warning with the deduplication of §Q.4: once per key, and
 * again after a reset re-arms it (`rearm` of `./alerts.ts`).
 */
export function raiseProviderWarning(
  writer: EventWriter,
  warning: ProviderWarning,
  state: AlertState,
  options: EmitOptions = {},
): { readonly state: AlertState; readonly event: PolicyEvent | null } {
  const key = providerWarningKey(warning);
  if (hasFired(state, key)) return Object.freeze({ state, event: null });
  return Object.freeze({
    state: markFired(state, key),
    event: providerWarningAlert(writer, warning, options),
  });
}

/* ------------------------------------------------------------------ *
 * 2. What the engine observes under a subscription (F127-FR-038).
 * ------------------------------------------------------------------ */

/** F127-FR-038 — the allowance is unknown until the provider signals it. */
export const THE_ALLOWANCE_IS_UNKNOWN_UNTIL_THE_PROVIDER_SIGNALS_IT = true as const;

/** The four things the engine tracks under a subscription (F127-FR-038). */
export const OBSERVED_FACTS = Object.freeze(["tokens", "notionalCostUsd", "passes", "utilization"]);

/** The window a figure belongs to: the harness's own, or the whole run. */
export const WINDOW_OF_THE_RUN = "run" as const;

/** What the engine has observed for one role in one window. */
export type ObservedWindow = {
  readonly role: string;
  /** The harness's reset time, or `run` where the harness reports none. */
  readonly window: string;
  /** Every observed token of the role in the window (§Q.3, the row "Soft"). */
  readonly tokens: number;
  /** Notional cost: a subscription's reported figure, never real spend. */
  readonly notionalCostUsd: number | null;
  /** Passes observed in the window. */
  readonly passes: number;
  /** The last utilization the provider gave, or null. */
  readonly utilization: number | null;
};

/** The whole observation state: one window per role. */
export type ObservedState = Readonly<Record<string, ObservedWindow>>;

/** Nothing observed yet. */
export function emptyObservedState(): ObservedState {
  return Object.freeze({});
}

/** The key of a role's window in the state. */
export function windowKeyOf(role: string, window: string): string {
  return `${role}@${window}`;
}

/** One observation the engine hands this module. */
export type Observation = {
  readonly role: string;
  /** The harness's reset time; absent means the window is the run (§Q.3). */
  readonly resetsAt?: string | null | undefined;
  readonly tokens?: number | null | undefined;
  readonly notionalCostUsd?: number | null | undefined;
  readonly closesAPass?: boolean | undefined;
  readonly utilization?: number | null | undefined;
};

/**
 * Keep one observation (F127-FR-038). The state is replaced, never mutated. A
 * reset time the harness reports opens a window of its own; a role whose
 * harness reports none accumulates for the whole run.
 */
export function observe(state: ObservedState, observation: Observation): ObservedState {
  const window = observation.resetsAt ?? WINDOW_OF_THE_RUN;
  const key = windowKeyOf(observation.role, window);
  const before: ObservedWindow =
    state[key] ??
    Object.freeze({
      role: observation.role,
      window,
      tokens: 0,
      notionalCostUsd: null,
      passes: 0,
      utilization: null,
    });
  const tokens = before.tokens + (observation.tokens ?? 0);
  const notional =
    observation.notionalCostUsd === null || observation.notionalCostUsd === undefined
      ? before.notionalCostUsd
      : (before.notionalCostUsd ?? 0) + observation.notionalCostUsd;
  return Object.freeze({
    ...state,
    [key]: Object.freeze({
      role: observation.role,
      window,
      tokens,
      notionalCostUsd: notional,
      passes: before.passes + (observation.closesAPass === true ? 1 : 0),
      utilization: observation.utilization ?? before.utilization,
    }),
  });
}

/** The windows of one role, in the order they were opened. */
export function windowsOf(state: ObservedState, role: string): readonly ObservedWindow[] {
  return Object.freeze(Object.values(state).filter((window) => window.role === role));
}

/** The observed tokens of one role, across every window of the state. */
export function observedTokensOf(state: ObservedState, role: string): number {
  return windowsOf(state, role).reduce((sum, window) => sum + window.tokens, 0);
}

/**
 * Forget the window a reset has ended (F127-FR-038, §Q.3 "per window"). The
 * alert keys of that role are re-armed by `rearm` of `./alerts.ts`; this
 * forgets the figures the alert was raised on.
 */
export function closeWindow(state: ObservedState, role: string, window: string): ObservedState {
  const key = windowKeyOf(role, window);
  const out: Record<string, ObservedWindow> = {};
  for (const [each, value] of Object.entries(state)) {
    if (each !== key) out[each] = value;
  }
  return Object.freeze(out);
}

/* ------------------------------------------------------------------ *
 * 3. The soft-token alerts of a subscription (F127-FR-038).
 * ------------------------------------------------------------------ */

/** The soft ceiling of a role (§Q.3: `budget.role.<role>.softTokens`). */
export function softCeilingOf(role: string, limit: number | null | undefined): Ceiling {
  return Object.freeze({ scope: "role" as const, role, dimension: SOFT_DIMENSION, limit });
}

/** The key of the soft ceiling of a role (§Q.3, "Keys"). */
export function softTokensKeyOf(role: string): string {
  return `budget.role.${role}.softTokens`;
}

/**
 * The reading of a role's soft budget against what the engine observed
 * (F127-FR-038). A soft budget ONLY raises alerts (F127-FR-025), so the
 * reading is marked `soft` and is never a cap of spend.
 */
export function softReading(
  role: string,
  limit: number | null | undefined,
  state: ObservedState,
): CeilingReading {
  const ceiling = softCeilingOf(role, limit);
  const active = typeof limit === "number" && Number.isFinite(limit) && limit !== 0;
  const used = observedTokensOf(state, role);
  const over = active && used > (limit as number) ? used - (limit as number) : 0;
  return Object.freeze({
    ceiling,
    key: softTokensKeyOf(role),
    dimension: SOFT_DIMENSION,
    scope: "role" as const,
    role,
    kind: "soft" as const,
    active,
    limit: active ? (limit as number) : null,
    used,
    exhausted: active && used >= (limit as number),
    over,
    resumable: true,
    isCapOfSpend: false,
  });
}

/**
 * The soft-token alerts of a subscription that have not yet fired
 * (F127-FR-038). The levels are the `soft-on-a-subscription` case of §Q.4: 50
 * is `info`, 75 and 90 are `warn` — never `loud`, because no metered money is
 * at risk.
 *
 * A soft reading PAST its limit still alerts, unlike a hard one: there is no
 * `budget.exceeded` for a soft budget (F127-FR-025), so the highest threshold
 * is the loudest thing a consumer gets.
 */
export function decideSoftAlerts(input: {
  readonly reading: CeilingReading;
  readonly state: AlertState;
  readonly thresholds?: unknown;
}): readonly DecidedAlert[] {
  const thresholds = Array.isArray(input.thresholds)
    ? readThresholds(input.thresholds)
    : DEFAULT_THRESHOLDS;
  if (!input.reading.active || input.reading.limit === null) return Object.freeze([]);
  const percent = ((input.reading.used ?? 0) / input.reading.limit) * 100;
  const capped = Math.min(percent, 99.999);
  const decided: DecidedAlert[] = [];
  for (const threshold of thresholdsCrossed(capped, thresholds)) {
    const key = dedupeKeyOf({
      kind: "budget-threshold",
      role: input.reading.role,
      threshold,
    });
    if (hasFired(input.state, key)) continue;
    decided.push(
      Object.freeze({
        kind: "budget-threshold" as AlertKind,
        level: levelForThreshold(
          threshold,
          {
            billingMode: "subscription",
            scope: "role" as const,
            dimension: SOFT_DIMENSION,
          },
          thresholds,
        ),
        role: input.reading.role,
        threshold,
        value: input.reading.used,
        limit: input.reading.limit,
        dedupeKey: key,
      }),
    );
  }
  return Object.freeze(decided);
}

/**
 * Raise the soft-token alerts of a subscription (F127-FR-038). Each is the
 * event `alert`, once per key, re-armed by `rearm` of `./alerts.ts` when the
 * window resets.
 */
export function raiseSoftAlerts(
  writer: EventWriter,
  input: {
    readonly reading: CeilingReading;
    readonly state: AlertState;
    readonly thresholds?: unknown;
  },
  options: EmitOptions = {},
): {
  readonly state: AlertState;
  readonly raised: readonly DecidedAlert[];
  readonly events: readonly PolicyEvent[];
} {
  const decided = decideSoftAlerts(input);
  let state = input.state;
  const events: PolicyEvent[] = [];
  for (const item of decided) {
    events.push(
      alert(
        writer,
        {
          kind: item.kind,
          level: item.level,
          role: item.role,
          threshold: item.threshold,
          value: item.value,
          limit: item.limit,
          dedupeKey: item.dedupeKey,
        },
        options,
      ),
    );
    state = markFired(state, item.dedupeKey);
  }
  return Object.freeze({ state, raised: decided, events: Object.freeze(events) });
}
