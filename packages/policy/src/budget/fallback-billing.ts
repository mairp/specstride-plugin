/**
 * T045 — the cap requirement and the `loud` alert `billing-mode-change`
 * BEFORE the first call on the key (F127-FR-021).
 *
 * A switch from an entry whose billing mode is `subscription` to one whose
 * billing mode is `api` is the one event of this product that can cost money
 * the consumer did not expect (user story 2). Two rules follow:
 *
 *  1. the API-key entry MUST have a DECLARED CAP. An entry without one is
 *     skipped with `fallback.skipped` and the reason `no-cap` — row 208 of
 *     annex X §X.6 — and is never used;
 *  2. the switch MUST write an alert of kind `billing-mode-change` and level
 *     `loud` BEFORE THE FIRST CALL ON THE KEY, and the alert appears in the
 *     attention items, the digest and the announcement of the next launch or
 *     `resume`. It is the loudest alert of the product.
 *
 * "Before the first call" is an ORDER, so this module hands out a guard rather
 * than a boolean: `openKeyGuard` is closed, `alertBeforeTheFirstCall` opens it
 * and writes the alert, and `firstCallOnTheKey` THROWS while it is closed. A
 * caller cannot make a call on the key and announce it afterwards.
 */
import { closedSet } from "@specstride/contracts/enums/all-sets";
import { alert, type EmitOptions } from "../quota/events.ts";
import type { EventWriter, PolicyEvent } from "../quota/ports.ts";
import type { BillingMode } from "./ledger.ts";
import type { EntryCheck, FallbackEntry, SkipReason } from "./fallback.ts";

/* ------------------------------------------------------------------ *
 * 1. The kind, the level and where the alert appears.
 * ------------------------------------------------------------------ */

/** The kind of the alert; row 205 of annex X §X.6. */
export const ALERT_KIND_BILLING_MODE_CHANGE = "billing-mode-change" as const;

/** Its level is FIXED at `loud` (§Q.4, "Fixed levels"). */
export const BILLING_MODE_CHANGE_LEVEL = "loud" as const;

/** F127-FR-021 — "It is the loudest alert of the product." */
export const THE_LOUDEST_ALERT_OF_THE_PRODUCT = ALERT_KIND_BILLING_MODE_CHANGE;

/** Where the alert must appear (F127-FR-021). */
export const BILLING_MODE_CHANGE_APPEARS_IN = Object.freeze([
  "attention-items",
  "digest",
  "announcement-of-the-next-launch-or-resume",
]);

/** Row 205 as the contracts package registers it, for the kind above. */
export const ALERT_KIND_SET = closedSet(205);

/** The skip reason of an API-key entry with no declared cap; row 208. */
export const SKIP_REASON_NO_CAP: SkipReason = "no-cap";

/* ------------------------------------------------------------------ *
 * 2. The change of billing mode and the cap it needs.
 * ------------------------------------------------------------------ */

/** The billing mode a switch moves AWAY from when a cap becomes necessary. */
export const FROM_BILLING_MODE: BillingMode = "subscription";
/** The billing mode a switch moves TO when a cap becomes necessary. */
export const TO_BILLING_MODE: BillingMode = "api";

/**
 * True where the switch changes the billing mode at all (F127-FR-022 writes
 * the change into `fallback.switched`).
 */
export function isBillingModeChange(from: BillingMode, to: BillingMode): boolean {
  return from !== to;
}

/**
 * True where the switch is the one F127-FR-021 is about: `subscription` to
 * `api`. A switch to `api` from `unknown` is also metered spend the consumer
 * did not have before, so it needs the cap and the alert as well; a switch
 * that stays on `api`, or moves to a subscription, does not.
 */
export function needsACap(from: BillingMode, to: BillingMode): boolean {
  return to === TO_BILLING_MODE && from !== TO_BILLING_MODE;
}

/**
 * The cap DECLARED on an entry (F127-FR-021). The entry's own `capUsd` is the
 * declaration; where it is absent, `budget.role.<role>.costUsd` of the
 * configuration is read, because that is the key the cap is spelled with
 * (§Q.3, "Keys"; F127-FR-036 for the critic). A cap of 0, absent or not finite
 * is OFF (§Q.3) and is therefore NOT a declared cap.
 */
export function declaredCapOf(
  entry: FallbackEntry,
  configuredCapUsd?: number | null,
): number | null {
  for (const candidate of [entry.capUsd, configuredCapUsd]) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }
  }
  return null;
}

/** True where the entry carries a declared cap (F127-FR-021). */
export function hasADeclaredCap(entry: FallbackEntry, configuredCapUsd?: number | null): boolean {
  return declaredCapOf(entry, configuredCapUsd) !== null;
}

/** What the cap check knows beyond the entry. */
export type CapContext = {
  /** The billing mode the role is on now. */
  readonly from: BillingMode;
  /** `budget.role.<role>.costUsd`, per entry harness where a caller has it. */
  readonly configuredCapUsd?: ((entry: FallbackEntry) => number | null) | undefined;
};

/**
 * The cap requirement as a check for the walk of `./fallback.ts`
 * (F127-FR-021). An entry that needs a cap and has none is skipped with
 * `no-cap`; every other entry passes.
 */
export function capCheck(context: CapContext): EntryCheck {
  return (entry: FallbackEntry) => {
    if (!needsACap(context.from, entry.billingMode)) return null;
    const configured = context.configuredCapUsd?.(entry) ?? null;
    return hasADeclaredCap(entry, configured) ? null : SKIP_REASON_NO_CAP;
  };
}

/* ------------------------------------------------------------------ *
 * 3. The order: the alert before the first call on the key.
 * ------------------------------------------------------------------ */

/** A call made on an API key before the `loud` alert was written. */
export class BillingModeOrderError extends Error {
  constructor(entry: FallbackEntry) {
    super(
      `a call on the API-key entry ${entry.index} (${entry.harness}) was asked for before the ` +
        `\`${ALERT_KIND_BILLING_MODE_CHANGE}\` alert of level \`${BILLING_MODE_CHANGE_LEVEL}\` ` +
        `was written; the alert precedes the first call on the key (F127-FR-021)`,
    );
    this.name = "BillingModeOrderError";
  }
}

/** An entry that needs a cap and has none, asked to be used anyway. */
export class MissingCapError extends Error {
  constructor(entry: FallbackEntry) {
    super(
      `the entry ${entry.index} (${entry.harness}) has billing mode \`${entry.billingMode}\` and ` +
        `no declared cap; it is skipped with the reason \`${SKIP_REASON_NO_CAP}\` and never used ` +
        `(F127-FR-021)`,
    );
    this.name = "MissingCapError";
  }
}

/**
 * The guard over one API-key entry. It is CLOSED until the alert is written,
 * and a call on the key while it is closed is an error, not a warning.
 */
export type KeyGuard = {
  readonly entry: FallbackEntry;
  readonly capUsd: number;
  /** True once the `loud` alert has been written. */
  readonly alerted: boolean;
  /** How many calls were made on the key through this guard. */
  readonly calls: number;
};

/**
 * Open a guard over an API-key entry (F127-FR-021). An entry with no declared
 * cap cannot have a guard at all: it is skipped with `no-cap` instead.
 */
export function openKeyGuard(entry: FallbackEntry, configuredCapUsd?: number | null): KeyGuard {
  const cap = declaredCapOf(entry, configuredCapUsd);
  if (cap === null) throw new MissingCapError(entry);
  return Object.freeze({ entry, capUsd: cap, alerted: false, calls: 0 });
}

/** The deduplication key of the alert (§Q.4: kind, role, threshold). */
export function billingModeDedupeKey(role: string): string {
  return `${ALERT_KIND_BILLING_MODE_CHANGE}:${role}:-`;
}

/**
 * Write the `loud` alert and OPEN the guard (F127-FR-021). The alert carries
 * the cap as its `limit`, so a reader of the event sees the ceiling that now
 * applies without reading the configuration.
 */
export function alertBeforeTheFirstCall(
  writer: EventWriter,
  guard: KeyGuard,
  fields: {
    readonly role: string;
    readonly from: BillingMode;
    readonly message?: string | null;
  },
  options: EmitOptions = {},
): { readonly event: PolicyEvent; readonly guard: KeyGuard } {
  const event = alert(
    writer,
    {
      kind: ALERT_KIND_BILLING_MODE_CHANGE,
      level: BILLING_MODE_CHANGE_LEVEL,
      role: fields.role,
      threshold: null,
      value: null,
      limit: guard.capUsd,
      dedupeKey: billingModeDedupeKey(fields.role),
      message: fields.message ?? null,
    },
    options,
  );
  return Object.freeze({
    event,
    guard: Object.freeze({ ...guard, alerted: true }),
  });
}

/**
 * The first — and every later — call on the key (F127-FR-021). While the guard
 * is closed this THROWS, which is how "the alert precedes the first call on
 * the key" is enforced rather than merely documented.
 */
export function firstCallOnTheKey(guard: KeyGuard): KeyGuard {
  if (!guard.alerted) throw new BillingModeOrderError(guard.entry);
  return Object.freeze({ ...guard, calls: guard.calls + 1 });
}

/**
 * The whole of F127-FR-021 for one switch: the cap is required, the alert is
 * written, and the guard that is handed back is the only way to call the key.
 */
export function prepareTheKey(
  writer: EventWriter,
  entry: FallbackEntry,
  fields: {
    readonly role: string;
    readonly from: BillingMode;
    readonly configuredCapUsd?: number | null;
    readonly message?: string | null;
  },
  options: EmitOptions = {},
): { readonly event: PolicyEvent; readonly guard: KeyGuard } {
  const guard = openKeyGuard(entry, fields.configuredCapUsd);
  return alertBeforeTheFirstCall(writer, guard, fields, options);
}
