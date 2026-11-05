/**
 * T051 — the alert rules of §Q.4 (F127-FR-037): the thresholds, the levels by
 * billing mode, the deduplication and the re-arm.
 *
 * The engine raises alerts at the thresholds of §Q.4
 * (`budget.alerts.thresholds`, default 50, 75 and 90 per cent), at the levels
 * of §Q.4, ONCE PER KEY (kind, role, threshold) and AGAIN AFTER A RESET
 * RE-ARMS IT. Every free-text field of an alert passes the redactor — which
 * `../quota/events.ts` does for the field `message` of every `alert` it writes,
 * so this module never formats text of its own into a payload. Under the
 * `parity` profile no ceiling is set, so no threshold is reached.
 *
 * The levels are the interesting part, and §Q.4 states them per case rather
 * than per level, so `levelForThreshold` is a transcription of that table and
 * nothing else:
 *
 * | Case | 50 | 75 | 90 |
 * |---|---|---|---|
 * | With an API key | `info` | `loud` | `loud` |
 * | A soft budget on a subscription | `info` | `warn` | `warn` |
 * | Any other ceiling | `info` | `warn` | `warn` |
 *
 * "Any other ceiling" is a role whose billing mode is `subscription` or
 * `unknown`, or a RUN-SCOPE ceiling while no role of the run is on an API key.
 * A run-scope ceiling while SOME role is on an API key is therefore the
 * API-key case, which is the reading the table forces: the money at risk is
 * metered.
 *
 * Reaching 100 per cent of a hard ceiling is the event `budget.exceeded` and
 * NOT an alert (§Q.4), so `thresholdsCrossed` never answers 100.
 */
import { closedSet } from "@specstride/contracts/enums/all-sets";
import { alert, type EmitOptions } from "../quota/events.ts";
import type { EventWriter, PolicyEvent } from "../quota/ports.ts";
import {
  ALERT_THRESHOLDS,
  SOFT_DIMENSION,
  budgetLevelOf,
  type BudgetDimension,
  type BudgetLevel,
  type BudgetScope,
  type CeilingReading,
} from "./ceilings.ts";
import type { BillingMode } from "./ledger.ts";

/* ------------------------------------------------------------------ *
 * 1. Levels and kinds — rows 48 and 205 of annex X §X.6.
 * ------------------------------------------------------------------ */

/** The three levels of §Q.4; row 48, owned by 127. */
export const ALERT_LEVELS = ["info", "warn", "loud"] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

/** Row 48's unknown-value rule: an unknown level is read as `warn`. */
export const ALERT_LEVEL_WHEN_UNKNOWN: AlertLevel = "warn";

/** Row 48 as the contracts package registers it. */
export const ALERT_LEVEL_SET = closedSet(48);

/** The five kinds of §Q.4; row 205, owned by 127. */
export const ALERT_KINDS = [
  "budget-threshold",
  "provider-warning",
  "billing-mode-change",
  "spend-unmeasurable",
  "ledger-unreadable",
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** Row 205 as the contracts package registers it. */
export const ALERT_KIND_SET = closedSet(205);

/**
 * Row 205's unknown-value rule: an unknown kind is SHOWN AS TEXT at level
 * `warn` — it still reaches the consumer, because an alert nobody sees is
 * worse than an alert nobody has a rule for.
 */
export const ALERT_KIND_WHEN_UNKNOWN = Object.freeze({
  shownAs: "text" as const,
  level: "warn" as AlertLevel,
});

/** Read a level; a value outside row 48 is `warn`. */
export function readAlertLevel(value: string | null | undefined): AlertLevel {
  return (ALERT_LEVELS as readonly string[]).includes(value as string)
    ? (value as AlertLevel)
    : ALERT_LEVEL_WHEN_UNKNOWN;
}

/** True where the value is one of the five kinds. */
export function isAlertKind(value: string): value is AlertKind {
  return (ALERT_KINDS as readonly string[]).includes(value);
}

/**
 * The FIXED levels of §Q.4. `ledger-unreadable` is the one that depends on
 * the run: `loud` where any hard ceiling is set, else `warn`, so
 * `fixedLevelOf` takes that fact.
 */
export const FIXED_LEVELS: Readonly<Record<string, AlertLevel | "depends">> = Object.freeze({
  "billing-mode-change": "loud",
  "provider-warning": "warn",
  "spend-unmeasurable": "warn",
  "ledger-unreadable": "depends",
});

/** The fixed level of a kind (§Q.4, "Fixed levels"), or null for a threshold. */
export function fixedLevelOf(
  kind: string,
  context: { readonly anyHardCeilingSet?: boolean } = {},
): AlertLevel | null {
  if (kind === "ledger-unreadable") return context.anyHardCeilingSet === true ? "loud" : "warn";
  const fixed = FIXED_LEVELS[kind];
  if (fixed === undefined || fixed === "depends") return null;
  return fixed;
}

/* ------------------------------------------------------------------ *
 * 2. The thresholds (§Q.4, F127-FR-037).
 * ------------------------------------------------------------------ */

/** The key of the thresholds (§Q.3, "Keys"; feature 110 owns the spelling). */
export const THRESHOLDS_KEY = "budget.alerts.thresholds" as const;

/** The default thresholds: 50, 75 and 90 per cent (F127-FR-037). */
export const DEFAULT_THRESHOLDS: readonly number[] = ALERT_THRESHOLDS;

/** The kind of a threshold alert; row 205. */
export const ALERT_KIND_BUDGET_THRESHOLD: AlertKind = "budget-threshold";

/** 100 per cent of a hard ceiling is `budget.exceeded`, not an alert (§Q.4). */
export const ONE_HUNDRED_PER_CENT_IS_AN_EVENT_NOT_AN_ALERT = "budget.exceeded" as const;

/** Under the `parity` profile no ceiling is set, so no threshold is reached. */
export const PARITY_SETS_NO_CEILING = true as const;

/** Read the configured thresholds; a value that is not a list is the default. */
export function readThresholds(value: unknown): readonly number[] {
  if (!Array.isArray(value)) return DEFAULT_THRESHOLDS;
  const kept = value
    .filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    .filter((item) => item > 0 && item < 100)
    .sort((a, b) => a - b);
  return kept.length === 0 ? DEFAULT_THRESHOLDS : Object.freeze(kept);
}

/**
 * The percentage of a reading, or null where it cannot be computed — an
 * inactive ceiling, a limit of null, or spend that is UNKNOWN because the
 * harness reported none (F127-FR-035). An unknown figure never raises an
 * alert of a threshold.
 */
export function percentOf(reading: CeilingReading): number | null {
  if (!reading.active || reading.limit === null || reading.limit === 0) return null;
  if (reading.used === null) return null;
  return (reading.used / reading.limit) * 100;
}

/**
 * The thresholds a reading has crossed, in order (F127-FR-037). A reading at
 * or over the limit crosses NO threshold: that is `budget.exceeded`, not an
 * alert (§Q.4).
 */
export function thresholdsCrossed(
  percent: number | null,
  thresholds: readonly number[] = DEFAULT_THRESHOLDS,
): readonly number[] {
  if (percent === null || !Number.isFinite(percent)) return Object.freeze([]);
  if (percent >= 100) return Object.freeze([]);
  return Object.freeze(thresholds.filter((threshold) => percent >= threshold));
}

/** The HIGHEST threshold a reading has crossed, or null (F127-FR-037). */
export function highestThresholdCrossed(
  percent: number | null,
  thresholds: readonly number[] = DEFAULT_THRESHOLDS,
): number | null {
  const crossed = thresholdsCrossed(percent, thresholds);
  return crossed.length === 0 ? null : crossed[crossed.length - 1];
}

/* ------------------------------------------------------------------ *
 * 3. The levels by billing mode (§Q.4, "Thresholds").
 * ------------------------------------------------------------------ */

/** The three cases of the level table of §Q.4. */
export const LEVEL_CASES = ["api-key", "soft-on-a-subscription", "any-other-ceiling"] as const;
export type LevelCase = (typeof LEVEL_CASES)[number];

/** What decides which case a ceiling is in. */
export type LevelContext = {
  /** The billing mode of the role, where the ceiling is a role ceiling. */
  readonly billingMode?: BillingMode | undefined;
  /** The scope of the ceiling. */
  readonly scope: BudgetScope;
  /** The dimension; `softTokens` is the soft budget of §Q.3. */
  readonly dimension: BudgetDimension | typeof SOFT_DIMENSION;
  /** True where some role of the run is on an API key (a run-scope ceiling). */
  readonly anyRoleOnAnApiKey?: boolean | undefined;
};

/** Which case of §Q.4 the ceiling is in (F127-FR-037). */
export function levelCaseOf(context: LevelContext): LevelCase {
  const soft = context.dimension === SOFT_DIMENSION;
  if (context.scope === "run") {
    return context.anyRoleOnAnApiKey === true ? "api-key" : "any-other-ceiling";
  }
  if (soft && context.billingMode === "subscription") return "soft-on-a-subscription";
  if (context.billingMode === "api") return "api-key";
  return "any-other-ceiling";
}

/** The level table of §Q.4, transcribed: case by threshold. */
export const LEVEL_TABLE: Readonly<Record<LevelCase, Readonly<Record<string, AlertLevel>>>> =
  Object.freeze({
    "api-key": Object.freeze({ "50": "info", "75": "loud", "90": "loud" }),
    "soft-on-a-subscription": Object.freeze({ "50": "info", "75": "warn", "90": "warn" }),
    "any-other-ceiling": Object.freeze({ "50": "info", "75": "warn", "90": "warn" }),
  });

/**
 * The level of one threshold (§Q.4, "Thresholds"; F127-FR-037).
 *
 * The lowest threshold of a case is `info` and every higher one is the case's
 * loud-or-warn value, so a consumer who configures thresholds of their own —
 * 60 and 95, say — gets the same shape of answer as the default 50, 75, 90.
 */
export function levelForThreshold(
  threshold: number,
  context: LevelContext,
  thresholds: readonly number[] = DEFAULT_THRESHOLDS,
): AlertLevel {
  const kase = levelCaseOf(context);
  const table = LEVEL_TABLE[kase];
  const exact = table[String(threshold)];
  if (exact !== undefined) return exact;
  const lowest = thresholds.length === 0 ? threshold : Math.min(...thresholds);
  return threshold <= lowest ? "info" : kase === "api-key" ? "loud" : "warn";
}

/* ------------------------------------------------------------------ *
 * 4. Deduplication and the re-arm (§Q.4, F127-FR-037).
 * ------------------------------------------------------------------ */

/** The three parts of a deduplication key (§Q.4, "Deduplication"). */
export const DEDUPE_KEY_PARTS = ["kind", "role", "threshold"] as const;

/** The deduplication key of an alert (§Q.4). A run-scope alert has no role. */
export function dedupeKeyOf(fields: {
  readonly kind: string;
  readonly role?: string | null;
  readonly threshold?: number | null;
}): string {
  const role = fields.role ?? "-";
  const threshold =
    fields.threshold === null || fields.threshold === undefined ? "-" : String(fields.threshold);
  return `${fields.kind}:${role}:${threshold}`;
}

/** The keys that have fired. The ledger keeps them (`alertsFired`, annex B §B.20). */
export type AlertState = {
  readonly fired: readonly string[];
};

/** No alert has fired yet. */
export function emptyAlertState(): AlertState {
  return Object.freeze({ fired: Object.freeze([]) });
}

/** An alert state over the keys a ledger already holds. */
export function alertStateOf(fired: readonly string[]): AlertState {
  return Object.freeze({ fired: Object.freeze([...fired]) });
}

/** True where the key has already fired and is still armed shut (§Q.4). */
export function hasFired(state: AlertState, key: string): boolean {
  return state.fired.includes(key);
}

/** Remember that a key fired (§Q.4, "A threshold fires once per window"). */
export function markFired(state: AlertState, key: string): AlertState {
  return hasFired(state, key)
    ? state
    : Object.freeze({ fired: Object.freeze([...state.fired, key]) });
}

/**
 * RE-ARM the keys of a role after a reset (§Q.4: "and again after a reset
 * re-arms it"). Every key of that role is forgotten, so the next crossing of
 * the same threshold fires again in the new window. A run-scope key, whose
 * role part is `-`, is re-armed by passing no role.
 */
export function rearm(state: AlertState, role?: string | null): AlertState {
  const part = `:${role ?? "-"}:`;
  return Object.freeze({
    fired: Object.freeze(state.fired.filter((key) => !key.includes(part))),
  });
}

/** Re-arm one key alone (§Q.4). */
export function rearmKey(state: AlertState, key: string): AlertState {
  return Object.freeze({ fired: Object.freeze(state.fired.filter((fired) => fired !== key)) });
}

/* ------------------------------------------------------------------ *
 * 5. Raising the alerts of a reading (F127-FR-037).
 * ------------------------------------------------------------------ */

/** One alert this module decided to raise. */
export type DecidedAlert = {
  readonly kind: AlertKind;
  readonly level: AlertLevel;
  readonly role: string | null;
  readonly threshold: number | null;
  readonly value: number | null;
  readonly limit: number | null;
  readonly dedupeKey: string;
};

/** What `decideThresholdAlerts` is handed. */
export type ThresholdInput = {
  readonly reading: CeilingReading;
  readonly state: AlertState;
  readonly context: LevelContext;
  readonly thresholds?: readonly number[] | undefined;
};

/**
 * The threshold alerts of one reading that have not yet fired (F127-FR-037).
 *
 * Every crossed threshold is considered, not only the highest, so a jump from
 * 40 to 95 per cent in one record raises 50, 75 and 90 — the consumer is told
 * what was passed, not only where the figure landed. A reading at or over the
 * limit raises none: that is `budget.exceeded`.
 */
export function decideThresholdAlerts(input: ThresholdInput): readonly DecidedAlert[] {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const percent = percentOf(input.reading);
  const role = input.reading.scope === "role" ? input.reading.role : null;
  const decided: DecidedAlert[] = [];
  for (const threshold of thresholdsCrossed(percent, thresholds)) {
    const key = dedupeKeyOf({ kind: ALERT_KIND_BUDGET_THRESHOLD, role, threshold });
    if (hasFired(input.state, key)) continue;
    decided.push(
      Object.freeze({
        kind: ALERT_KIND_BUDGET_THRESHOLD,
        level: levelForThreshold(threshold, input.context, thresholds),
        role,
        threshold,
        value: input.reading.used,
        limit: input.reading.limit,
        dedupeKey: key,
      }),
    );
  }
  return Object.freeze(decided);
}

/** What the raise did. */
export type RaiseResult = {
  readonly state: AlertState;
  readonly raised: readonly DecidedAlert[];
  readonly events: readonly PolicyEvent[];
  /** The budget level for readers: the highest threshold reached (§Q.4). */
  readonly budgetLevel: BudgetLevel;
};

/**
 * Raise the threshold alerts of one reading (F127-FR-037). Each is written as
 * the event `alert` through `../quota/events.ts`, whose free-text field
 * `message` passes the redactor; the key is then marked fired, so the same
 * threshold is silent until a reset re-arms it.
 */
export function raiseThresholdAlerts(
  writer: EventWriter,
  input: ThresholdInput,
  options: EmitOptions = {},
): RaiseResult {
  const decided = decideThresholdAlerts(input);
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
  return Object.freeze({
    state,
    raised: decided,
    events: Object.freeze(events),
    budgetLevel: budgetLevelOf(input.reading),
  });
}

/**
 * Raise an alert of a FIXED-level kind (§Q.4, "Fixed levels"), once per key.
 * `billing-mode-change` has its own entry point in `./fallback-billing.ts`,
 * because its order against the first call on the key is part of F127-FR-021.
 */
export function raiseFixedAlert(
  writer: EventWriter,
  input: {
    readonly kind: AlertKind;
    readonly role?: string | null;
    readonly state: AlertState;
    readonly value?: number | null;
    readonly limit?: number | null;
    readonly message?: string | null;
    readonly anyHardCeilingSet?: boolean;
  },
  options: EmitOptions = {},
): { readonly state: AlertState; readonly event: PolicyEvent | null; readonly level: AlertLevel } {
  const level =
    fixedLevelOf(input.kind, { anyHardCeilingSet: input.anyHardCeilingSet }) ??
    ALERT_KIND_WHEN_UNKNOWN.level;
  const key = dedupeKeyOf({ kind: input.kind, role: input.role ?? null, threshold: null });
  if (hasFired(input.state, key)) return Object.freeze({ state: input.state, event: null, level });
  const event = alert(
    writer,
    {
      kind: input.kind,
      level,
      role: input.role ?? null,
      threshold: null,
      value: input.value ?? null,
      limit: input.limit ?? null,
      dedupeKey: key,
      message: input.message ?? null,
    },
    options,
  );
  return Object.freeze({ state: markFired(input.state, key), event, level });
}

/* ------------------------------------------------------------------ *
 * 6. Delivery (§Q.5, F127-FR-039).
 * ------------------------------------------------------------------ */

/** F127-FR-039 — the engine is the ONLY source of alerts. */
export const THE_ENGINE_IS_THE_ONLY_SOURCE = true as const;

/** The readers of §Q.5. None of them computes an alert or a budget level. */
export const READERS = Object.freeze(["status", "digest", "doctor", "host-hooks"]);

/** The channels an alert of each level reaches (§Q.4, "Levels"; §Q.5). */
export const CHANNELS_BY_LEVEL: Readonly<Record<AlertLevel, readonly string[]>> = Object.freeze({
  info: Object.freeze(["status", "doctor"]),
  warn: Object.freeze(["status", "doctor", "digest"]),
  loud: Object.freeze(["status", "doctor", "digest", "host-hooks", "announcement"]),
});

/** Where a host has no host hooks, these three carry every alert (§Q.5, ruling 62). */
export const CHANNELS_WITHOUT_HOST_HOOKS = Object.freeze(["status", "digest", "doctor"]);

/**
 * The channels one alert reaches (§Q.5). On a host WITHOUT host hooks, a
 * `loud` alert still reaches the consumer, through `status`, the digest and
 * the doctor — the delivery never silently drops a level.
 */
export function channelsFor(
  level: AlertLevel,
  host: { readonly hasHostHooks?: boolean } = {},
): readonly string[] {
  const all = CHANNELS_BY_LEVEL[level];
  if (host.hasHostHooks === false) {
    return Object.freeze(all.filter((channel) => channel !== "host-hooks"));
  }
  return all;
}

/** F127-FR-039 — "An alert MUST never stall or fail a run." */
export const AN_ALERT_NEVER_STALLS_OR_FAILS_A_RUN = true as const;

/**
 * Deliver an alert without ever stalling or failing the run (F127-FR-039). A
 * sink that throws is swallowed and reported as a failed channel; the caller
 * goes on.
 */
export function deliver(
  alertEvent: PolicyEvent,
  level: AlertLevel,
  sinks: Readonly<Record<string, (event: PolicyEvent) => void>>,
  host: { readonly hasHostHooks?: boolean } = {},
): { readonly delivered: readonly string[]; readonly failed: readonly string[] } {
  const delivered: string[] = [];
  const failed: string[] = [];
  for (const channel of channelsFor(level, host)) {
    const sink = sinks[channel];
    if (sink === undefined) continue;
    try {
      sink(alertEvent);
      delivered.push(channel);
    } catch {
      failed.push(channel);
    }
  }
  return Object.freeze({ delivered: Object.freeze(delivered), failed: Object.freeze(failed) });
}
