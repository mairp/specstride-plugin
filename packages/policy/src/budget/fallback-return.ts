/**
 * T049 — the return, `stay`, and the exhaustion pause (F127-FR-023).
 *
 * Three rules:
 *
 *  - **the return** — at the FIRST PHASE-ATTEMPT BOUNDARY after the reset time
 *    of the PRIMARY entry has passed, the role returns to it and writes
 *    `fallback.restored`. Not at the reset itself: a phase attempt that is
 *    running keeps the entry it started on, so that a verdict is given by the
 *    model that produced the claim;
 *  - **`stay`** — unless `roles.<role>.fallbackReturn` is `stay` (default
 *    `restore`), in which case the role keeps the entry it switched to and
 *    nothing is written;
 *  - **the exhaustion pause** — where EVERY entry is limited or skipped, the
 *    role PAUSES until the EARLIEST reset time. That is the edge case of the
 *    specification ("Every fallback entry is limited: the role pauses until
 *    the earliest reset"), and it is the quota pause of F127-FR-010, entered
 *    through `../quota/pause.ts`; this module computes the instant it waits
 *    for and the reason.
 *
 * And one rule about the ledger: every usage record carries the HARNESS, the
 * PROVIDER and the BILLING MODE, so that spend per entry is visible
 * (`assertEntryFacts`).
 *
 * No clock is read: `nowMs` is an argument.
 */
import { emit, type EmitOptions } from "../quota/events.ts";
import type { EventWriter, PolicyEvent } from "../quota/ports.ts";
import type { UsageRecord } from "./ledger.ts";
import { entryLabel, type FallbackEntry, type Skip, type WalkResult } from "./fallback.ts";

/* ------------------------------------------------------------------ *
 * 1. `restore` and `stay`.
 * ------------------------------------------------------------------ */

/** The two values of `roles.<role>.fallbackReturn` (F127-FR-023). */
export const FALLBACK_RETURN_MODES = ["restore", "stay"] as const;
export type FallbackReturnMode = (typeof FALLBACK_RETURN_MODES)[number];

/** The default is `restore` (F127-FR-023). */
export const DEFAULT_FALLBACK_RETURN: FallbackReturnMode = "restore";

/** A value outside the two is read as the default, `restore`. */
export function readFallbackReturn(value: string | null | undefined): FallbackReturnMode {
  return (FALLBACK_RETURN_MODES as readonly string[]).includes(value as string)
    ? (value as FallbackReturnMode)
    : DEFAULT_FALLBACK_RETURN;
}

/** The return happens at a phase-attempt boundary and nowhere else. */
export const RETURN_AT = "phase-attempt-boundary" as const;

/** What the return decision asks for. */
export const RETURN_ACTS = ["restore", "stay", "wait"] as const;
export type ReturnAct = (typeof RETURN_ACTS)[number];

/** Why the decision answered as it did. */
export const RETURN_REASONS = [
  "stay-configured",
  "not-on-a-fallback",
  "reset-unknown",
  "reset-not-passed",
  "no-boundary-yet",
  "reset-passed-at-a-boundary",
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

/** What the return decision is handed. */
export type ReturnInput = {
  /** The primary entry of the role plan. */
  readonly primary: FallbackEntry;
  /** The entry the role runs on now; the primary itself where no switch happened. */
  readonly current: FallbackEntry;
  /** The reset time of the PRIMARY entry's window, or null where none is known. */
  readonly primaryResetsAt: string | null;
  /** Now, in ms. */
  readonly nowMs: number;
  /** True where the caller stands at a phase-attempt boundary. */
  readonly atBoundary: boolean;
  /** `roles.<role>.fallbackReturn`; `restore` by default. */
  readonly mode?: string | null;
};

/** The answer of the return decision. */
export type ReturnDecision = {
  readonly act: ReturnAct;
  readonly reason: ReturnReason;
  readonly mode: FallbackReturnMode;
  /** The entry the role runs on after this decision. */
  readonly entry: FallbackEntry;
};

function msOf(iso: string | null | undefined): number | null {
  if (iso === null || iso === undefined) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The return decision (F127-FR-023).
 *
 * `stay` is read first, because a consumer who set it never wants the question
 * asked. A role that is not on a fallback has nothing to return to. A reset
 * time that is unknown, or that has not passed, means the role waits; a reset
 * that has passed while no boundary is at hand also means it waits, because
 * the return happens at a boundary.
 */
export function returnDecision(input: ReturnInput): ReturnDecision {
  const mode = readFallbackReturn(input.mode);
  const stay = (reason: ReturnReason): ReturnDecision =>
    Object.freeze({ act: "stay" as const, reason, mode, entry: input.current });

  if (mode === "stay") return stay("stay-configured");
  if (
    input.current.index === input.primary.index &&
    input.current.harness === input.primary.harness
  ) {
    return stay("not-on-a-fallback");
  }

  const resetMs = msOf(input.primaryResetsAt);
  const wait = (reason: ReturnReason): ReturnDecision =>
    Object.freeze({ act: "wait" as const, reason, mode, entry: input.current });
  if (resetMs === null) return wait("reset-unknown");
  if (input.nowMs < resetMs) return wait("reset-not-passed");
  if (!input.atBoundary) return wait("no-boundary-yet");

  return Object.freeze({
    act: "restore" as const,
    reason: "reset-passed-at-a-boundary" as const,
    mode,
    entry: input.primary,
  });
}

/**
 * Write `fallback.restored` (F127-FR-023). Called only where
 * `returnDecision` answered `restore`, so that `stay` writes nothing at all.
 */
export function restorePrimary(
  writer: EventWriter,
  fields: {
    readonly role: string;
    readonly from: FallbackEntry;
    readonly to: FallbackEntry;
    readonly phaseAttempt: string;
    readonly note?: string | null;
  },
  options: EmitOptions = {},
): PolicyEvent {
  return emit(
    writer,
    "fallback.restored",
    {
      from: entryLabel(fields.from),
      to: entryLabel(fields.to),
      role: fields.role,
      phaseAttempt: fields.phaseAttempt,
      billingModeFrom: fields.from.billingMode,
      billingModeTo: fields.to.billingMode,
      at: RETURN_AT,
      note: fields.note ?? null,
    },
    options,
  );
}

/* ------------------------------------------------------------------ *
 * 2. The exhaustion pause (F127-FR-023).
 * ------------------------------------------------------------------ */

/** The reason of the pause that follows an exhausted list (F127-FR-023). */
export const EXHAUSTION_PAUSE_REASON = "every-entry-limited-or-skipped" as const;

/** The class the pause is entered with: the role waits for a window to reset. */
export const EXHAUSTION_PAUSE_CLASS = "quota_window" as const;

/** What the exhaustion check is handed. */
export type ExhaustionInput = {
  /** The primary entry, whose own reset time counts too. */
  readonly primary: FallbackEntry;
  /** The result of the walk over the list. */
  readonly walk: WalkResult;
  /** Now, in ms. */
  readonly nowMs: number;
  /** The reset time of the primary entry, where one is known. */
  readonly primaryResetsAt?: string | null;
};

/** What the exhaustion check answers. */
export type ExhaustionDecision = {
  /** True where every entry was limited or skipped and the role must pause. */
  readonly pause: boolean;
  readonly reason: typeof EXHAUSTION_PAUSE_REASON | null;
  /** The earliest reset among the primary and the skipped entries, or null. */
  readonly earliestResetAt: string | null;
  /** How long the role waits, in ms; 0 where the earliest reset has passed. */
  readonly waitMs: number;
  /** The entries that were limited or skipped, in order. */
  readonly skipped: readonly Skip[];
};

/**
 * The earliest reset time among a set of entries (F127-FR-023, "the role MUST
 * pause until the earliest reset time"). An entry with no reset time
 * contributes nothing; where none has one, the answer is null and the pause is
 * the unknown-reset pause of F127-FR-013, which probes.
 */
export function earliestResetOf(entries: readonly FallbackEntry[]): string | null {
  let best: number | null = null;
  for (const entry of entries) {
    const ms = msOf(entry.resetsAt);
    if (ms === null) continue;
    if (best === null || ms < best) best = ms;
  }
  return best === null ? null : new Date(best).toISOString();
}

/**
 * The exhaustion pause (F127-FR-023). Where the walk chose an entry there is
 * nothing to do; where it chose none, EVERY entry was limited or skipped and
 * the role pauses until the earliest reset time among the primary and the
 * entries it could not use.
 */
export function exhaustionDecision(input: ExhaustionInput): ExhaustionDecision {
  if (!input.walk.exhausted) {
    return Object.freeze({
      pause: false,
      reason: null,
      earliestResetAt: null,
      waitMs: 0,
      skipped: input.walk.skipped,
    });
  }
  const candidates: FallbackEntry[] = [
    input.primaryResetsAt === undefined
      ? input.primary
      : { ...input.primary, resetsAt: input.primaryResetsAt },
    ...input.walk.skipped.map((skip) => skip.entry),
  ];
  const earliestResetAt = earliestResetOf(candidates);
  const earliestMs = msOf(earliestResetAt);
  return Object.freeze({
    pause: true,
    reason: EXHAUSTION_PAUSE_REASON,
    earliestResetAt,
    waitMs: earliestMs === null ? 0 : Math.max(0, earliestMs - input.nowMs),
    skipped: input.walk.skipped,
  });
}

/* ------------------------------------------------------------------ *
 * 3. Spend per entry is visible (F127-FR-023).
 * ------------------------------------------------------------------ */

/**
 * A usage record of the ledger with the PROVIDER beside it (F127-FR-023).
 * `UsageRecord` of `./ledger.ts` carries the harness, the model and the
 * billing mode; the provider is the third fact this requirement names, and it
 * is the entry's provider — the back end a front harness speaks to — so a
 * reader can total spend per provider as well as per harness.
 */
export type EntryUsageRecord = UsageRecord & {
  readonly provider?: string | undefined;
};

/** The three facts every usage record carries, so spend per entry is visible. */
export const EVERY_USAGE_RECORD_CARRIES = Object.freeze(["harness", "provider", "billingMode"]);

/** A usage record that does not name its entry (F127-FR-023). */
export class UsageRecordFactsError extends Error {
  readonly missing: readonly string[];
  constructor(missing: readonly string[]) {
    super(
      `a usage record must carry ${EVERY_USAGE_RECORD_CARRIES.join(", ")}, so that spend per ` +
        `fallback entry is visible; it is missing ${missing.join(", ")} (F127-FR-023)`,
    );
    this.name = "UsageRecordFactsError";
    this.missing = Object.freeze([...missing]);
  }
}

/** The facts of a record that are missing (F127-FR-023). */
export function missingEntryFacts(record: Partial<EntryUsageRecord>): readonly string[] {
  return Object.freeze(
    EVERY_USAGE_RECORD_CARRIES.filter((fact) => {
      const value = (record as Record<string, unknown>)[fact];
      return value === undefined || value === null || value === "";
    }),
  );
}

/** Refuse a usage record that does not name its entry (F127-FR-023). */
export function assertEntryFacts(record: Partial<EntryUsageRecord>): void {
  const missing = missingEntryFacts(record);
  if (missing.length > 0) throw new UsageRecordFactsError(missing);
}

/** Stamp a usage record with the three facts of the entry it was spent on. */
export function recordOfEntry(
  record: Partial<EntryUsageRecord>,
  entry: FallbackEntry,
): EntryUsageRecord {
  return Object.freeze({
    ...record,
    harness: entry.harness,
    provider: entry.provider,
    billingMode: entry.billingMode,
  }) as EntryUsageRecord;
}
