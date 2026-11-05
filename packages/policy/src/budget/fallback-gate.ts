/**
 * T043 — the terms gate at every switch (F127-FR-020).
 *
 * EVERY entry is evaluated by the terms gate — EP-11 `specstride.terms/1`,
 * operation `evaluate` — with its PROVIDER, its AUTH TIER, the AUDIENCE and
 * the consumer's ACKNOWLEDGEMENTS, AT THE MOMENT OF THE SWITCH. The decision
 * of the role plan was taken at launch; a switch happens hours later, and the
 * data may have been corrected since, so the gate is asked again and the
 * recorded decision is never reused as an answer.
 *
 * An entry the gate does not allow is SKIPPED with `fallback.skipped`, which
 * names the entry and the reason — a member of row 208 of annex X §X.6, here
 * `terms-refused` — NEVER SILENTLY, and the next entry is tried.
 *
 * No comment, flag, mode or project key bypasses the gate (F127-FR-020;
 * `NOTHING_BYPASSES_IT` of annex C §C.12). `refuseBypass` is the one place that
 * says so, and it throws rather than answering `allowed`.
 */
import {
  NOTHING_BYPASSES_IT,
  OPERATIONS as TERMS_OPERATIONS,
  POINT_ID as TERMS_POINT_ID,
  STATUS_WHEN_UNKNOWN,
  type TermsDecision,
  type TermsGate,
  type TermsQuery,
} from "@specstride/contracts/ep/terms";
import { fallbackSkipped, type EmitOptions } from "../quota/events.ts";
import type { EventWriter, PolicyEvent } from "../quota/ports.ts";
import type { EntryCheck, FallbackEntry, RolePlan, SkipReason } from "./fallback.ts";

export { NOTHING_BYPASSES_IT, STATUS_WHEN_UNKNOWN, TERMS_POINT_ID };

/** The one operation this feature calls on EP-11 (F127-FR-020). */
export const TERMS_OPERATION = "evaluate" as const;

/** The operation is one of the point's own (annex C §C.12). */
export const TERMS_OPERATION_IS_OF_THE_POINT = (TERMS_OPERATIONS as readonly string[]).includes(
  TERMS_OPERATION,
);

/** F127-FR-020 — the gate is asked at EVERY switch, not once at launch. */
export const EVALUATE_AT_EVERY_SWITCH = true as const;

/** The skip reason of a refused entry; row 208 of annex X §X.6. */
export const SKIP_REASON_TERMS_REFUSED: SkipReason = "terms-refused";

/** The four inputs of `evaluate` the requirement names (F127-FR-020). */
export const GATE_INPUTS = ["provider", "authTier", "audience", "acknowledgements"] as const;

/** The decisions that let a switch happen (annex C §C.12). */
export const DECISIONS_THAT_ALLOW = ["allowed", "allowed-with-warning"] as const;

/** What the caller knows that the entry does not. */
export type GateContext = {
  /** The consumer's acknowledgements (§C.12, `acknowledgements`). */
  readonly acknowledgements: readonly string[];
  /** The audience; the entry's own value is used where this is absent. */
  readonly audience?: string;
};

/** The query one entry makes of the gate (F127-FR-020). */
export function queryOf(entry: FallbackEntry, context: GateContext): TermsQuery {
  return Object.freeze({
    provider: entry.provider,
    authTier: entry.authTier,
    audience: (context.audience ?? entry.audience) as TermsQuery["audience"],
    acknowledgements: Object.freeze([...context.acknowledgements]),
  });
}

/** The gate's answer about one entry. */
export type EntryDecision = {
  readonly entry: FallbackEntry;
  readonly decision: TermsDecision;
  /** True where the switch may happen. */
  readonly allowed: boolean;
  /** The gate's warning, where it allowed with one. */
  readonly warning: string | null;
  /** The skip reason where it refused, else null. */
  readonly skipReason: SkipReason | null;
};

/**
 * Call `evaluate` for one entry (F127-FR-020). A gate that throws is read as a
 * REFUSAL — the fail-closed rule of §C.12's unknown status
 * (`STATUS_WHEN_UNKNOWN` is `refused`), never as permission.
 */
export function evaluateEntry(
  gate: TermsGate,
  entry: FallbackEntry,
  context: GateContext,
): EntryDecision {
  let decision: TermsDecision;
  try {
    decision = gate.evaluate(queryOf(entry, context));
  } catch (error) {
    decision = {
      decision: "refused",
      row: null,
      explanation:
        `the terms gate failed: ${String(error).slice(0, 120)}; read as ` +
        `\`${STATUS_WHEN_UNKNOWN}\` (§C.12, the unknown-value rule)`,
    };
  }
  const allowed = (DECISIONS_THAT_ALLOW as readonly string[]).includes(decision.decision);
  return Object.freeze({
    entry,
    decision,
    allowed,
    warning: decision.warning ?? null,
    skipReason: allowed ? null : SKIP_REASON_TERMS_REFUSED,
  });
}

/**
 * Write `fallback.skipped` for a refused entry (F127-FR-020). The event names
 * the entry — its index, harness, provider, auth tier and audience — and the
 * reason `terms-refused`.
 */
export function skipRefusedEntry(
  writer: EventWriter,
  entry: FallbackEntry,
  options: { readonly role?: string; readonly emitOptions?: EmitOptions } = {},
): PolicyEvent {
  return fallbackSkipped(
    writer,
    {
      entry: entry.index,
      entryHarness: entry.harness,
      entryProvider: entry.provider,
      authTier: String(entry.authTier),
      audience: entry.audience,
      reason: SKIP_REASON_TERMS_REFUSED,
      role: options.role,
    },
    options.emitOptions ?? {},
  );
}

/**
 * The gate as a check for the walk of `./fallback.ts` (F127-FR-020). Every
 * entry the walk considers passes through it, and a refusal becomes the reason
 * `terms-refused`, which the walk writes as `fallback.skipped` before it tries
 * the next entry.
 */
export function gateCheck(gate: TermsGate, context: GateContext): EntryCheck {
  return (entry: FallbackEntry) => evaluateEntry(gate, entry, context).skipReason;
}

/**
 * Evaluate every entry of a plan at the moment of a switch, in order
 * (F127-FR-020). Used by a caller that wants the whole picture — the doctor and
 * the announcement — and by the test that counts the calls.
 */
export function evaluateEveryEntry(
  gate: TermsGate,
  plan: RolePlan,
  context: GateContext,
): readonly EntryDecision[] {
  return Object.freeze(plan.entries.map((entry) => evaluateEntry(gate, entry, context)));
}

/* ------------------------------------------------------------------ *
 * No bypass (F127-FR-020).
 * ------------------------------------------------------------------ */

/** An attempt to bypass the terms gate (F127-FR-020). */
export class TermsBypassError extends Error {
  readonly kind: string;
  constructor(kind: string) {
    super(
      `no comment, flag, mode or project key bypasses the terms gate; a \`${kind}\` asked to ` +
        `(F127-FR-020, annex C §C.12)`,
    );
    this.name = "TermsBypassError";
    this.kind = kind;
  }
}

/**
 * Refuse a bypass (F127-FR-020). The four kinds are the ones §C.12 names:
 * `comment`, `flag`, `mode`, `project key`. There is no argument that makes
 * this function answer `allowed`.
 */
export function refuseBypass(kind: string): never {
  throw new TermsBypassError(kind);
}

/**
 * The gate with a bypass request attached: the request is refused and the
 * gate is still asked, so a caller that tries both gets the gate's own answer
 * and an error for the bypass (F127-FR-020).
 */
export function evaluateWithNoBypass(
  gate: TermsGate,
  entry: FallbackEntry,
  context: GateContext,
  bypass: { readonly kind: string } | null,
): EntryDecision {
  if (bypass !== null) refuseBypass(bypass.kind);
  return evaluateEntry(gate, entry, context);
}
