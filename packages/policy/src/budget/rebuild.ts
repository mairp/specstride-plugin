/**
 * T008 — the rebuild of an unreadable ledger, and the UNKNOWN state
 * (F127-FR-032).
 *
 * "An unreadable ledger MUST never reset spend." Lisa's `budgets.ts` loaded an
 * unreadable ledger as zero, which is unsafe for a hard cap; register row
 * DV-063 records the fix, and this module is it (decision D-4 of
 * `research.md`).
 *
 * The order F127-FR-032 gives, and `rebuildLedger` follows it exactly:
 *
 *  1. read the ledger. It reads: nothing to rebuild (`state: "read"`);
 *  2. it does not read: read the PREVIOUS GENERATION, which the engine keeps
 *     beside the ledger (`./ledger.ts`, `writeLedger`), and REPLAY the usage
 *     records of the event stream that FOLLOW IT — the ones whose `seq` is
 *     above the generation's high-water mark (`state: "rebuilt"`);
 *  3. the previous generation does not read either, but the event stream holds
 *     usage records: rebuild from the events alone (`state: "rebuilt"`);
 *  4. NEITHER gives a value: the ledger is UNKNOWN (`state: "unknown"`).
 *
 * The unknown state is the whole point of the requirement:
 *
 *  - every HARD CEILING OF SPEND is read as REACHED (`hardCeilingsReadAsReached`);
 *  - the run stops at the next safe boundary with the reason `budget-cap` and
 *    the note `ledger-unreadable`;
 *  - an alert of kind `ledger-unreadable` is written — at level `loud` where
 *    any hard ceiling of spend is set, else `warn` (§Q.4, "Fixed levels");
 *  - where NO hard ceiling of spend is set, the alert is still written and the
 *    run GOES ON, with the ledger rebuilt from zero and marked `partial`.
 */
import {
  applyUsageRecord,
  emptyLedger,
  parseLedger,
  readBillingMode,
  type ApplyOptions,
  type LedgerPaths,
  type SpendLedger,
  type UsageRecord,
} from "./ledger.ts";
import { CAPS_OF_SPEND, isActive, SOFT_DIMENSION, type Ceiling } from "./ceilings.ts";
import type { AtomicWrite } from "../quota/ports.ts";

/** The kind of the alert this module writes (row 205 of annex X §X.6). */
export const LEDGER_UNREADABLE_ALERT = "ledger-unreadable" as const;

/** The blocked reason the unknown state stops with (F127-FR-032, F127-FR-017). */
export const UNKNOWN_BLOCKED_REASON = "budget-cap" as const;

/** The note the stop carries (F127-FR-032). */
export const UNKNOWN_NOTE = "ledger-unreadable" as const;

/** The three outcomes of F127-FR-032. */
export const REBUILD_STATES = ["read", "rebuilt", "unknown"] as const;
export type RebuildState = (typeof REBUILD_STATES)[number];

/** Where each outcome's figures came from. */
export const REBUILD_SOURCES = ["ledger", "previous-generation", "events", "zero"] as const;
export type RebuildSource = (typeof REBUILD_SOURCES)[number];

/**
 * One line of the event stream, as the rebuild reads it. The engine hands over
 * what it already parsed; this module opens no event file.
 */
export type LedgerEvent = {
  /** The sequence number of the envelope (annex X §X.1). */
  readonly seq?: number | undefined;
  /** The event type; only `usage` carries a usage record. */
  readonly type: string;
  /** The usage record the event carries, where its type is `usage`. */
  readonly usage?: UsageRecord | undefined;
  /** The generation of the ledger at the time of the event, where it is known. */
  readonly generation?: number | undefined;
};

/** The alert the rebuild writes (§Q.4). */
export type LedgerUnreadableAlert = {
  readonly kind: typeof LEDGER_UNREADABLE_ALERT;
  /** `loud` where any hard ceiling of spend is set, else `warn` (§Q.4). */
  readonly level: "loud" | "warn";
  readonly role: string | null;
  readonly threshold: number | null;
  readonly value: number | null;
  readonly limit: number | null;
  /** The deduplication key of §Q.4: kind, role, threshold. */
  readonly dedupeKey: string;
  /** What the consumer is told, in one line. */
  readonly message: string;
};

/** What `rebuildLedger` answers. */
export type RebuildResult = {
  readonly state: RebuildState;
  readonly source: RebuildSource;
  /** The ledger to go on with. In the unknown state it is an empty one. */
  readonly ledger: SpendLedger;
  /**
   * True in the unknown state with a hard ceiling of spend set: every hard
   * ceiling of spend is read as REACHED (F127-FR-032).
   */
  readonly hardCeilingsReadAsReached: boolean;
  /** The blocked reason to stop with, or null where the run goes on. */
  readonly blockedReason: typeof UNKNOWN_BLOCKED_REASON | null;
  /** The note of the stop, or null. */
  readonly note: typeof UNKNOWN_NOTE | null;
  /** True where the run goes on with a ledger rebuilt from zero (F127-FR-032). */
  readonly goesOnPartial: boolean;
  /** The alert to write, or null where the ledger simply read. */
  readonly alert: LedgerUnreadableAlert | null;
  /** How many usage records of the event stream were replayed. */
  readonly replayed: number;
  /** What went wrong, one line per source that did not give a value. */
  readonly reasons: readonly string[];
};

/** How `rebuildLedger` is called. */
export type RebuildInput = {
  readonly writer: AtomicWrite;
  readonly paths: LedgerPaths;
  readonly runId: string;
  /** The ceilings the consumer configured, so the alert level can be chosen. */
  readonly ceilings?: readonly Ceiling[];
  /** The event stream, already parsed by the engine; `usage` events are replayed. */
  readonly events?: readonly LedgerEvent[];
  /** The rate table, so a replay computes the same estimated cost (F127-FR-030). */
  readonly apply?: ApplyOptions;
};

/**
 * True where any HARD CEILING OF SPEND is set and active: `tokens`, `costUsd`,
 * `phaseAttempts` or `calls` with a limit that is not 0, absent or non-finite
 * (F127-FR-025, F127-FR-024). The soft budget is not one.
 */
export function anyHardCeilingOfSpendIsSet(ceilings: readonly Ceiling[] = []): boolean {
  return ceilings.some(
    (ceiling) =>
      ceiling.dimension !== SOFT_DIMENSION &&
      CAPS_OF_SPEND.includes(ceiling.dimension) &&
      isActive(ceiling.limit),
  );
}

/** The alert of §Q.4 for an unreadable ledger. */
export function ledgerUnreadableAlert(hardCeilingSet: boolean): LedgerUnreadableAlert {
  const level = hardCeilingSet ? "loud" : "warn";
  return Object.freeze({
    kind: LEDGER_UNREADABLE_ALERT,
    level,
    role: null,
    threshold: null,
    value: null,
    limit: null,
    dedupeKey: `${LEDGER_UNREADABLE_ALERT}\u0000\u0000`,
    message: hardCeilingSet
      ? "the spend ledger could not be read or rebuilt; every hard ceiling of spend is read " +
        "as reached and the run stops at the next safe boundary with the reason budget-cap " +
        "and the note ledger-unreadable (F127-FR-032)"
      : "the spend ledger could not be read or rebuilt; no hard ceiling of spend is set, so " +
        "the run goes on with a ledger rebuilt from zero and marked partial (F127-FR-032)",
  });
}

/** The usage records of the event stream that follow a generation. */
export function usageEventsAfter(
  events: readonly LedgerEvent[],
  afterGeneration: number | null,
): readonly LedgerEvent[] {
  return events.filter((event) => {
    if (event.type !== "usage" || event.usage === undefined) return false;
    if (afterGeneration === null) return true;
    // An event whose generation is not known is replayed: deduplication by
    // `usageId` makes a record that the previous generation already holds a
    // no-op, so replaying too much is safe and replaying too little is not.
    if (typeof event.generation !== "number") return true;
    return event.generation > afterGeneration;
  });
}

/** Replay usage records onto a ledger, in order (F127-FR-032). */
export function replayUsage(
  ledger: SpendLedger,
  events: readonly LedgerEvent[],
  options: ApplyOptions = {},
): { readonly ledger: SpendLedger; readonly replayed: number } {
  let current = ledger;
  let replayed = 0;
  for (const event of events) {
    const record = event.usage;
    if (record === undefined) continue;
    const result = applyUsageRecord(
      current,
      { ...record, billingMode: readBillingMode(record.billingMode) },
      options,
    );
    current = result.ledger;
    if (result.applied) replayed += 1;
  }
  return { ledger: current, replayed };
}

/**
 * Read the ledger, or rebuild it; never reset spend (F127-FR-032).
 *
 * The four steps of the requirement, in order, with the unknown state at the
 * end. Nothing here throws: a caller gets a `RebuildResult` whatever happened,
 * because the one thing the requirement forbids is a silent zero.
 */
export function rebuildLedger(input: RebuildInput): RebuildResult {
  const { writer, paths, runId } = input;
  const events = input.events ?? [];
  const apply = input.apply ?? {};
  const reasons: string[] = [];

  // 1. The ledger itself.
  if (writer.exists(paths.ledger)) {
    try {
      const ledger = parseLedger(writer.read(paths.ledger));
      return Object.freeze({
        state: "read",
        source: "ledger",
        ledger,
        hardCeilingsReadAsReached: false,
        blockedReason: null,
        note: null,
        goesOnPartial: false,
        alert: null,
        replayed: 0,
        reasons: Object.freeze([]),
      });
    } catch (error) {
      reasons.push(`the ledger ${paths.ledger} did not read: ${String(error)}`);
    }
  } else {
    reasons.push(`the ledger ${paths.ledger} does not exist`);
  }

  // 2. The previous generation, then the events that follow it.
  if (writer.exists(paths.previous)) {
    try {
      const previous = parseLedger(writer.read(paths.previous));
      const replay = replayUsage(previous, usageEventsAfter(events, previous.generation), apply);
      return Object.freeze({
        state: "rebuilt",
        source: "previous-generation",
        ledger: replay.ledger,
        hardCeilingsReadAsReached: false,
        blockedReason: null,
        note: null,
        goesOnPartial: false,
        alert: null,
        replayed: replay.replayed,
        reasons: Object.freeze([...reasons]),
      });
    } catch (error) {
      reasons.push(`the previous generation ${paths.previous} did not read: ${String(error)}`);
    }
  } else {
    reasons.push(`the previous generation ${paths.previous} does not exist`);
  }

  // 3. The event stream alone.
  const fromEvents = replayUsage(emptyLedger(runId), usageEventsAfter(events, null), apply);
  if (fromEvents.replayed > 0) {
    return Object.freeze({
      state: "rebuilt",
      source: "events",
      ledger: fromEvents.ledger,
      hardCeilingsReadAsReached: false,
      blockedReason: null,
      note: null,
      goesOnPartial: false,
      alert: null,
      replayed: fromEvents.replayed,
      reasons: Object.freeze([...reasons]),
    });
  }
  reasons.push("the event stream holds no usage record to replay");

  // 4. The unknown state.
  const hardCeilingSet = anyHardCeilingOfSpendIsSet(input.ceilings);
  const alert = ledgerUnreadableAlert(hardCeilingSet);
  const zero = emptyLedger(runId);
  zero.partial = true;
  return Object.freeze({
    state: "unknown",
    source: "zero",
    ledger: zero,
    hardCeilingsReadAsReached: hardCeilingSet,
    blockedReason: hardCeilingSet ? UNKNOWN_BLOCKED_REASON : null,
    note: hardCeilingSet ? UNKNOWN_NOTE : null,
    goesOnPartial: !hardCeilingSet,
    alert,
    replayed: 0,
    reasons: Object.freeze([...reasons]),
  });
}

/**
 * In the unknown state every hard ceiling of spend reads as REACHED
 * (F127-FR-032), whatever the figures of the ledger say. A caller that
 * evaluates ceilings asks this first.
 */
export function ceilingsReadAsReached(
  result: RebuildResult,
  ceilings: readonly Ceiling[],
): readonly Ceiling[] {
  if (!result.hardCeilingsReadAsReached) return Object.freeze([]);
  return Object.freeze(
    ceilings.filter(
      (ceiling) =>
        ceiling.dimension !== SOFT_DIMENSION &&
        CAPS_OF_SPEND.includes(ceiling.dimension) &&
        isActive(ceiling.limit),
    ),
  );
}
