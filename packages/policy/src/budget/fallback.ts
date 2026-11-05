/**
 * T040 — the fallback walk (F127-FR-018, F127-FR-019).
 *
 * A fallback is OPT-IN per role, an ordered list of entries in USER-scope
 * configuration (`roles.<role>.fallback`), OFF BY DEFAULT. Project
 * configuration cannot set it: the key is WIDENING, so the filter of annex X
 * §X.2 drops it with the launch message and the doctor warning (F127-FR-018).
 * Every entry comes from the resolved role plan of feature 100 annex C §C.6,
 * and NOTHING is resolved after launch — an entry the registry did not resolve
 * is skipped with the reason `not-in-plan` rather than looked up now.
 *
 * The TRIGGER is a `quota_window` or `quota_credit` classification on the
 * CURRENT entry of the role, once `roles.<role>.fallbackAfterMs` (default 0,
 * switch at once) has passed. Where the reset time of the window is earlier
 * than that delay, the role WAITS and does not switch — the cheapest answer to
 * a window that is about to end on its own. A classification `auth` never
 * triggers a fallback (F127-FR-019; `../quota/blocked.ts`,
 * `AUTH_TAKES_NO_FALLBACK`).
 *
 * This module is the WALK and nothing else: it holds the list, the trigger and
 * the four skip reasons of row 208 of annex X §X.6, and takes the per-entry
 * checks as functions. The checks themselves are the three modules beside it,
 * each of which owns one requirement, so that no check can be forgotten in one
 * caller and present in another:
 *
 *  - `./fallback-gate.ts` — the terms gate at every switch (F127-FR-020);
 *  - `./fallback-billing.ts` — the cap and the `loud` alert (F127-FR-021);
 *  - `./fallback-switch.ts` — what a switch does (F127-FR-022);
 *  - `./fallback-return.ts` — the return, `stay` and the exhaustion pause
 *    (F127-FR-023).
 *
 * No clock is read here: `nowMs` is an argument (`plan.md`, *Time*).
 */
import { closedSet } from "@specstride/contracts/enums/all-sets";
import type { AuthTier } from "@specstride/contracts/ep/terms";
import { AUTH_TIERS } from "@specstride/contracts/ep/terms";
import { filterProjectKey, type FilterOutcome } from "@specstride/contracts/envelope/trust-classes";
import type { QuotaClass } from "@specstride/contracts/ep/quota-classifier";
import { fallbackSkipped, type EmitOptions } from "../quota/events.ts";
import type { EventWriter } from "../quota/ports.ts";
import { readBillingMode, type BillingMode } from "./ledger.ts";

/* ------------------------------------------------------------------ *
 * 1. The keys, their trust class, and the default (F127-FR-018).
 * ------------------------------------------------------------------ */

/** The key of the list itself (§Q.3, "Keys"; feature 110 owns the spelling). */
export const FALLBACK_KEY_TEMPLATE = "roles.<role>.fallback" as const;
/** The delay before a switch (F127-FR-019). */
export const FALLBACK_AFTER_MS_KEY_TEMPLATE = "roles.<role>.fallbackAfterMs" as const;
/** What happens when the primary's window has reset (F127-FR-023). */
export const FALLBACK_RETURN_KEY_TEMPLATE = "roles.<role>.fallbackReturn" as const;

/** The key of one role. */
export function fallbackKeyOf(role: string): string {
  return `roles.${role}.fallback`;
}
/** The delay key of one role. */
export function fallbackAfterMsKeyOf(role: string): string {
  return `roles.${role}.fallbackAfterMs`;
}
/** The return key of one role. */
export function fallbackReturnKeyOf(role: string): string {
  return `roles.${role}.fallbackReturn`;
}

/**
 * The trust class of every fallback key: WIDENING (§Q.3, "Trust class";
 * F127-FR-018, "Project configuration MUST NOT be able to set it: the key is
 * widening").
 */
export const FALLBACK_TRUST_CLASS = "widening" as const;

/** The scope a fallback list may be set in (F127-FR-018). */
export const FALLBACK_SCOPE = "user" as const;

/** A fallback is OFF BY DEFAULT: the empty list (F127-FR-018). */
export const FALLBACK_OFF_BY_DEFAULT: readonly FallbackEntry[] = Object.freeze([]);

/** The default delay: 0, switch at once (F127-FR-019). */
export const DEFAULT_FALLBACK_AFTER_MS = 0;

/** Nothing of the list is resolved after launch (F127-FR-018). */
export const NOTHING_IS_RESOLVED_AFTER_LAUNCH = true as const;

/** True where the key is one of the three fallback keys of a role. */
export function isFallbackKey(key: string): boolean {
  return /^roles\.[^.]+\.fallback(AfterMs|Return)?$/.test(key);
}

/** The trust class of a key of this feature; a fallback key is widening. */
export function trustClassOfFallbackKey(key: string): typeof FALLBACK_TRUST_CLASS | undefined {
  return isFallbackKey(key) ? FALLBACK_TRUST_CLASS : undefined;
}

/**
 * What project configuration does with a fallback key: it is DROPPED, with the
 * launch message and the doctor warning of F100-FR-202. The decision is the
 * filter of annex X §X.2 itself — this feature states the class and never
 * writes a second filter (F127-FR-018).
 */
export function refuseProjectFallbackKey(
  key: string,
  value: unknown,
  fromLowerRanks?: unknown,
): FilterOutcome {
  return filterProjectKey(key, value, trustClassOfFallbackKey(key), fromLowerRanks);
}

/* ------------------------------------------------------------------ *
 * 2. An entry and the role plan it comes from (F127-FR-018).
 * ------------------------------------------------------------------ */

/** Read an auth tier; a value outside 1, 2 and 3 is read as the strictest, 3. */
export function readAuthTier(value: number | null | undefined): AuthTier {
  return (AUTH_TIERS as readonly number[]).includes(value as number) ? (value as AuthTier) : 3;
}

/**
 * One fallback entry. It names a harness and MAY name a model and an auth
 * tier (F127-FR-018); the billing mode, the cap and the terms decision come
 * from the role plan (`data-model.md`, "Fallback entry").
 */
export type FallbackEntry = {
  /** Its place in the list, from 0; the `entry` field of `fallback.skipped`. */
  readonly index: number;
  readonly harness: string;
  readonly model: string | null;
  readonly authTier: AuthTier;
  readonly provider: string;
  readonly billingMode: BillingMode;
  /** The declared cap in USD, or null where none is declared (F127-FR-021). */
  readonly capUsd: number | null;
  /** The reset time where this entry is itself limited, else null. */
  readonly resetsAt: string | null;
  /** The audience the terms gate is asked about (`personal` or `distributed`). */
  readonly audience: string;
  /** The model tier, for the escalation rule of F127-FR-022. */
  readonly modelTier: string;
};

/** Build an entry, filling what an entry may leave out (F127-FR-018). */
export function entryOf(
  index: number,
  fields: {
    readonly harness: string;
    readonly model?: string | null;
    readonly authTier?: number | null;
    readonly provider?: string;
    readonly billingMode?: string | null;
    readonly capUsd?: number | null;
    readonly resetsAt?: string | null;
    readonly audience?: string;
    readonly modelTier?: string;
  },
): FallbackEntry {
  return Object.freeze({
    index,
    harness: fields.harness,
    model: fields.model ?? null,
    authTier: readAuthTier(fields.authTier),
    provider: fields.provider ?? fields.harness,
    billingMode: readBillingMode(fields.billingMode),
    capUsd: fields.capUsd ?? null,
    resetsAt: fields.resetsAt ?? null,
    audience: fields.audience ?? "personal",
    modelTier: fields.modelTier ?? "base",
  });
}

/** How an entry is named in an event and in the announcement. */
export function entryLabel(entry: FallbackEntry): string {
  return entry.model === null ? entry.harness : `${entry.harness}/${entry.model}`;
}

/**
 * The resolved role plan this feature READS (feature 100 annex C §C.6,
 * `run:<runId>:registry`). The CLI writes it at launch; this feature never
 * resolves an entry (F127-FR-018).
 */
export type RolePlan = {
  readonly role: string;
  /** The entry the run started on. */
  readonly primary: FallbackEntry;
  /** The fallback entries the consumer opted into, in order; empty by default. */
  readonly entries: readonly FallbackEntry[];
  /** The harnesses the registry resolved at launch. */
  readonly resolvedHarnesses: readonly string[];
};

/** The list of a role, from the role plan and nowhere else (F127-FR-018). */
export function entriesFromRolePlan(plan: RolePlan): readonly FallbackEntry[] {
  return Object.freeze([...plan.entries]);
}

/** True where the entry names a harness the registry did not resolve at launch. */
export function notInPlan(plan: RolePlan, entry: FallbackEntry): boolean {
  return !plan.resolvedHarnesses.includes(entry.harness);
}

/* ------------------------------------------------------------------ *
 * 3. The skip reasons — row 208 of annex X §X.6.
 * ------------------------------------------------------------------ */

/** The four reasons that skip a fallback entry; row 208, owned by 127. */
export const SKIP_REASONS = ["terms-refused", "no-cap", "not-in-plan", "limited"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** Row 208 as the contracts package registers it. */
export const SKIP_REASON_SET = closedSet(208);

/**
 * Row 208's unknown-value rule: a reason outside the four is SHOWN AS TEXT and
 * the entry is skipped all the same — never used because its reason was not
 * understood.
 */
export const SKIP_REASON_WHEN_UNKNOWN = "shown-as-text" as const;

/** True where the value is one of the four. */
export function isSkipReason(value: string): value is SkipReason {
  return (SKIP_REASONS as readonly string[]).includes(value);
}

/** The reason as an event carries it, and whether it is a member of row 208. */
export function readSkipReason(value: string): {
  readonly reason: string;
  readonly known: boolean;
  readonly skipped: true;
} {
  return Object.freeze({ reason: value, known: isSkipReason(value), skipped: true as const });
}

/* ------------------------------------------------------------------ *
 * 4. The trigger and the delay (F127-FR-019).
 * ------------------------------------------------------------------ */

/**
 * The two classes that trigger a fallback (F127-FR-019). `auth` is NOT among
 * them: credentials are not a limit a second entry can carry.
 */
export const TRIGGER_CLASSES: readonly QuotaClass[] = Object.freeze([
  "quota_window",
  "quota_credit",
]);

/** F127-FR-019 — "A classification `auth` MUST NOT trigger a fallback". */
export const AUTH_NEVER_TRIGGERS_A_FALLBACK = true as const;

/** True where the class triggers a fallback (F127-FR-019). */
export function isTriggerClass(quotaClass: string): boolean {
  return (TRIGGER_CLASSES as readonly string[]).includes(quotaClass);
}

/** What the trigger asks for. */
export const TRIGGER_ACTS = ["switch", "wait", "none"] as const;
export type TriggerAct = (typeof TRIGGER_ACTS)[number];

/** Why the trigger answered as it did. */
export const TRIGGER_REASONS = [
  "no-trigger-class",
  "auth-never-triggers",
  "no-list",
  "delay-not-passed",
  "reset-before-delay",
  "delay-passed",
] as const;
export type TriggerReason = (typeof TRIGGER_REASONS)[number];

/** What the trigger is asked. */
export type TriggerInput = {
  /** The class of the classification on the CURRENT entry of the role. */
  readonly quotaClass: string;
  /** When the signal was first seen on this entry, in ms. */
  readonly sinceMs: number;
  /** Now, in ms; the caller read its clock port. */
  readonly nowMs: number;
  /** `roles.<role>.fallbackAfterMs`; 0 by default (switch at once). */
  readonly afterMs?: number;
  /** The reset time of the window, where the classification gave one. */
  readonly resetsAt?: string | null;
  /** How many entries the list holds; 0 means the fallback is off. */
  readonly entryCount: number;
};

/** The answer of the trigger. */
export type TriggerDecision = {
  readonly act: TriggerAct;
  readonly reason: TriggerReason;
  /** When the delay is over, in ms. */
  readonly dueAtMs: number;
  /** How long the role still waits, in ms; 0 where it does not wait. */
  readonly waitMs: number;
  /** The reset time in ms, or null. */
  readonly resetsAtMs: number | null;
};

function msOf(iso: string | null | undefined): number | null {
  if (iso === null || iso === undefined) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The trigger, the delay and the wait when the reset comes first
 * (F127-FR-019).
 *
 *  - a class outside the two, or `auth`, is no trigger;
 *  - an empty list is no trigger (a fallback is off by default);
 *  - the delay `afterMs` must have passed since the signal was first seen;
 *  - where the reset time is EARLIER than the moment the delay is over, the
 *    role WAITS for the reset and does not switch at all.
 */
export function triggerDecision(input: TriggerInput): TriggerDecision {
  const afterMs = Number.isFinite(input.afterMs)
    ? Math.max(0, input.afterMs ?? 0)
    : DEFAULT_FALLBACK_AFTER_MS;
  const dueAtMs = input.sinceMs + afterMs;
  const resetsAtMs = msOf(input.resetsAt);
  const none = (reason: TriggerReason): TriggerDecision =>
    Object.freeze({ act: "none" as const, reason, dueAtMs, waitMs: 0, resetsAtMs });

  if (input.quotaClass === "auth") return none("auth-never-triggers");
  if (!isTriggerClass(input.quotaClass)) return none("no-trigger-class");
  if (input.entryCount <= 0) return none("no-list");

  if (resetsAtMs !== null && resetsAtMs <= dueAtMs) {
    return Object.freeze({
      act: "wait" as const,
      reason: "reset-before-delay" as const,
      dueAtMs,
      waitMs: Math.max(0, resetsAtMs - input.nowMs),
      resetsAtMs,
    });
  }
  if (input.nowMs < dueAtMs) {
    return Object.freeze({
      act: "wait" as const,
      reason: "delay-not-passed" as const,
      dueAtMs,
      waitMs: dueAtMs - input.nowMs,
      resetsAtMs,
    });
  }
  return Object.freeze({
    act: "switch" as const,
    reason: "delay-passed" as const,
    dueAtMs,
    waitMs: 0,
    resetsAtMs,
  });
}

/* ------------------------------------------------------------------ *
 * 5. The walk itself (F127-FR-018, F127-FR-020).
 * ------------------------------------------------------------------ */

/** One check over an entry: the reason it is skipped, or null to take it. */
export type EntryCheck = (entry: FallbackEntry) => SkipReason | string | null;

/** One skipped entry and why. */
export type Skip = {
  readonly entry: FallbackEntry;
  readonly reason: string;
  readonly known: boolean;
};

/** What the walk found. */
export type WalkResult = {
  /** The first entry every check took, or null where none was left. */
  readonly chosen: FallbackEntry | null;
  /** Every entry the walk skipped, in order, with its reason. */
  readonly skipped: readonly Skip[];
  /** True where the list ran out: every entry was skipped (F127-FR-023). */
  readonly exhausted: boolean;
};

/** How the walk reports a skip. */
export type WalkOptions = {
  /** The event port; every skip is written, never silently (F127-FR-020). */
  readonly writer?: EventWriter | undefined;
  readonly emitOptions?: EmitOptions | undefined;
};

/**
 * Walk the list of a role (F127-FR-018, F127-FR-020).
 *
 * The entries are those of the role plan, IN ORDER. An entry the registry did
 * not resolve is skipped with `not-in-plan` before any check runs, because
 * nothing is resolved after launch. Each remaining entry runs through the
 * checks in the order they were handed in; the FIRST reason stops that entry
 * and the next one is tried. Every skip is written as `fallback.skipped` with
 * the entry and the reason, so a reader sees why an entry was not used.
 */
export function walkFallback(
  plan: RolePlan,
  checks: readonly EntryCheck[],
  options: WalkOptions = {},
): WalkResult {
  const skipped: Skip[] = [];
  let chosen: FallbackEntry | null = null;

  for (const entry of entriesFromRolePlan(plan)) {
    let reason: string | null = notInPlan(plan, entry) ? "not-in-plan" : null;
    if (reason === null) {
      for (const check of checks) {
        const answer = check(entry);
        if (answer !== null && answer !== undefined) {
          reason = answer;
          break;
        }
      }
    }
    if (reason === null) {
      chosen = entry;
      break;
    }
    const read = readSkipReason(reason);
    skipped.push(Object.freeze({ entry, reason: read.reason, known: read.known }));
    if (options.writer !== undefined) {
      fallbackSkipped(
        options.writer,
        {
          entry: entry.index,
          entryHarness: entry.harness,
          entryProvider: entry.provider,
          authTier: String(entry.authTier),
          audience: entry.audience,
          reason: read.reason,
          role: plan.role,
        },
        options.emitOptions ?? {},
      );
    }
  }

  return Object.freeze({
    chosen,
    skipped: Object.freeze(skipped),
    exhausted: chosen === null,
  });
}
