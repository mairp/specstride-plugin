/**
 * T068 — the HARD-CAP STOP (F127-FR-034).
 *
 * What the requirement asks, and where each part is:
 *
 *  1. **`budget.exceeded`** with the fields `dimension`, `limit`, `used`,
 *     `role` and `resumable` of the catalogue of feature 111 — `capStop`
 *     writes it FIRST, through `../quota/events.ts`;
 *  2. **`blocked` with the reason `budget-cap`**, as F127-FR-017 says —
 *     `capStop` then calls `blockOnAHuman` of `../quota/blocked.ts`, so the
 *     terminal record values, the one-line need and the transition T9 are the
 *     ones phase 3 already proved;
 *  3. **`wallClock` is exempt** — a reading of that dimension is REFUSED here
 *     with `WallClockIsExemptError`; its trip ends as F127-FR-027 says, and
 *     `wallClockStop` gives those values with `blockedReason: null` and no
 *     `blocked` event (CQ-192);
 *  4. **no rejection** — `IS_A_REJECTION` is false and the stop spends neither
 *     a reject nor a pass;
 *  5. **no bypass** — no comment, flag, mode or project key switches a budget
 *     off or raises it. `refuseBypass` throws for each of the four, and
 *     `RAISING_A_CEILING` names the only lawful path: a change of user
 *     configuration and a `resume`.
 */
import {
  BLOCKED_STATE,
  BLOCKED_TRANSITION,
  WALL_CLOCK_IS_NOT_BLOCKED,
  type BlockedOutcome,
  type BlockedTerminal,
  blockOnAHuman,
  terminalOf,
} from "../quota/blocked.ts";
import { budgetExceeded, type EmitOptions } from "../quota/events.ts";
import type { EventWriter, PolicyEvent } from "../quota/ports.ts";
import {
  CAPS_OF_SPEND,
  CEILING_OF_TIME,
  budgetExceededPayload,
  keyOf,
  type BudgetDimension,
  type CeilingReading,
} from "./ceilings.ts";

/* ------------------------------------------------------------------ *
 * 1. What the stop is, and what it is not.
 * ------------------------------------------------------------------ */

/** The blocked reason of a reached cap of spend (F127-FR-034, F127-FR-017). */
export const BLOCKED_REASON_BUDGET_CAP = "budget-cap" as const;

/** The two events of a hard-cap stop, in the order they are written. */
export const CAP_STOP_EVENTS = ["budget.exceeded", "blocked"] as const;

/** F127-FR-034 — the stop MUST NOT be a rejection. */
export const IS_A_REJECTION = false as const;

/** F127-FR-034 — the stop spends no reject. */
export const SPENDS_A_REJECT = false as const;

/** F127-FR-034 — the stop spends no pass. */
export const SPENDS_A_PASS = false as const;

/** The four caps of spend whose trip takes this path (F127-FR-025, §Q.3). */
export const DIMENSIONS_THAT_TAKE_THIS_PATH: readonly BudgetDimension[] = CAPS_OF_SPEND;

/** `wallClock` is EXEMPT: its trip takes the path of F127-FR-027 (CQ-192). */
export const WALL_CLOCK_IS_EXEMPT = true as const;

/** A `wallClock` reading handed to the hard-cap stop (CQ-192). */
export class WallClockIsExemptError extends Error {
  constructor() {
    super(
      `the ceiling ${CEILING_OF_TIME} is exempt from the hard-cap stop (F127-FR-034, CQ-192): ` +
        `it is a ceiling of time and not a cap of spend, and its trip ends as F127-FR-027 says ` +
        `— the stop reason ${WALL_CLOCK_IS_NOT_BLOCKED.stopReason}, exit ` +
        `${WALL_CLOCK_IS_NOT_BLOCKED.exitCode}, retryable true, no blocked reason and no ` +
        `\`blocked\` event. Call \`wallClockStop\` instead.`,
    );
    this.name = "WallClockIsExemptError";
  }
}

/** A reading that is no cap of spend at all (F127-FR-025). */
export class NotACapOfSpendError extends Error {
  constructor(dimension: string) {
    super(
      `the dimension ${JSON.stringify(dimension)} is no cap of spend; the hard-cap stop of ` +
        `F127-FR-034 is for ${DIMENSIONS_THAT_TAKE_THIS_PATH.join(", ")} alone (§Q.3)`,
    );
    this.name = "NotACapOfSpendError";
  }
}

/** True where a trip of the dimension takes the path of F127-FR-034. */
export function takesTheCapPath(dimension: string): boolean {
  return (DIMENSIONS_THAT_TAKE_THIS_PATH as readonly string[]).includes(dimension);
}

/* ------------------------------------------------------------------ *
 * 2. The stop.
 * ------------------------------------------------------------------ */

/** What `capStop` is handed. */
export type CapStopInput = {
  /** The exhausted reading of `./ceilings.ts`. */
  readonly reading: CeilingReading;
  /** The role, where the reading does not name one. */
  readonly role?: string | null | undefined;
  /** A note for `budget.exceeded`, e.g. `ledger-unreadable` (F127-FR-032). */
  readonly note?: string | null | undefined;
};

/** What `capStop` answers. */
export type CapStopOutcome = {
  readonly dimension: BudgetDimension | string;
  readonly key: string;
  readonly limit: number | null;
  readonly used: number | null;
  readonly role: string | null;
  /** True: raising the ceiling and running `resume` continues (F127-FR-024). */
  readonly resumable: boolean;
  /** The event `budget.exceeded`, written first. */
  readonly budgetExceeded: PolicyEvent;
  /** The event `blocked` with the reason `budget-cap`. */
  readonly blocked: PolicyEvent;
  /** The two events, in order (`CAP_STOP_EVENTS`). */
  readonly events: readonly PolicyEvent[];
  /** The whole blocked outcome of F127-FR-017: T9, the need, the terminal. */
  readonly blockedOutcome: BlockedOutcome;
  readonly terminal: BlockedTerminal;
  /** False: the stop is no rejection (F127-FR-034). */
  readonly isARejection: boolean;
  /** False: no reject is spent (F127-FR-034). */
  readonly spendsAReject: boolean;
  /** False: no pass is spent (F127-FR-034). */
  readonly spendsAPass: boolean;
};

/**
 * The hard-cap stop (F127-FR-034).
 *
 * `budget.exceeded` goes out FIRST, so a reader of the stream learns which
 * ceiling tripped and by how much before it learns that the run is blocked;
 * `blocked` with the reason `budget-cap` follows through `blockOnAHuman`, which
 * owns the terminal record values and the transition T9 (F127-FR-017).
 *
 * A `wallClock` reading throws: that trip is F127-FR-027's, not this one's.
 */
export function capStop(
  writer: EventWriter,
  input: CapStopInput,
  options: EmitOptions = {},
): CapStopOutcome {
  const reading = input.reading;
  if (reading.dimension === CEILING_OF_TIME) throw new WallClockIsExemptError();
  if (!takesTheCapPath(reading.dimension)) throw new NotACapOfSpendError(reading.dimension);

  const role = input.role ?? reading.role;
  const payload = budgetExceededPayload(reading);
  const exceeded = budgetExceeded(
    writer,
    {
      dimension: String(payload.dimension),
      limit: reading.limit,
      used: reading.used,
      role: role ?? null,
      resumable: reading.resumable,
      over: reading.over,
      key: reading.key,
      scope: reading.scope,
      ...(input.note === undefined || input.note === null ? {} : { note: input.note }),
    },
    options,
  );
  const blockedOutcome = blockOnAHuman(
    writer,
    {
      reason: BLOCKED_REASON_BUDGET_CAP,
      ...(role === null || role === undefined ? {} : { role }),
      ceilingKey: reading.key,
    },
    options,
  );
  return Object.freeze({
    dimension: reading.dimension,
    key: reading.key,
    limit: reading.limit,
    used: reading.used,
    role: role ?? null,
    resumable: reading.resumable,
    budgetExceeded: exceeded,
    blocked: blockedOutcome.event,
    events: Object.freeze([exceeded, blockedOutcome.event]),
    blockedOutcome,
    terminal: blockedOutcome.terminal,
    isARejection: IS_A_REJECTION,
    spendsAReject: SPENDS_A_REJECT,
    spendsAPass: SPENDS_A_PASS,
  });
}

/* ------------------------------------------------------------------ *
 * 3. The tripped wall clock, which is NOT this stop (CQ-192).
 * ------------------------------------------------------------------ */

/** What `wallClockStop` answers (F127-FR-027, CQ-192). */
export type WallClockStopOutcome = {
  readonly stopReason: string;
  readonly exitCode: number;
  /** True: the stop is one a relaunch classifier table may relaunch. */
  readonly retryable: boolean;
  /** Null: a tripped wall clock carries NO blocked reason. */
  readonly blockedReason: null;
  /** False: NO `blocked` event is emitted (F127-FR-027). */
  readonly emitsBlocked: boolean;
  /** Null: the run does not rest in `blocked-on-human`. */
  readonly restsIn: null;
  /** `budget.exceeded` is still written: the ceiling tripped (F127-FR-024). */
  readonly budgetExceeded: PolicyEvent | null;
  readonly events: readonly PolicyEvent[];
};

/**
 * A tripped `wallClock` (F127-FR-027, CQ-192): the stop reason `wall_budget`,
 * exit 4, `retryable: true`, NO blocked reason and NO `blocked` event.
 *
 * `budget.exceeded` is still written where a reading is handed in, because
 * F127-FR-024 asks for it of EVERY active ceiling that is reached; what
 * F127-FR-027 forbids is the `blocked` event and the rest in
 * `blocked-on-human`.
 */
export function wallClockStop(
  writer?: EventWriter,
  reading?: CeilingReading,
  options: EmitOptions = {},
): WallClockStopOutcome {
  let exceeded: PolicyEvent | null = null;
  if (writer !== undefined && reading !== undefined) {
    exceeded = budgetExceeded(
      writer,
      {
        dimension: String(reading.dimension),
        limit: reading.limit,
        used: reading.used,
        role: reading.role,
        resumable: reading.resumable,
        over: reading.over,
        key: reading.key,
        scope: reading.scope,
      },
      options,
    );
  }
  return Object.freeze({
    stopReason: WALL_CLOCK_IS_NOT_BLOCKED.stopReason,
    exitCode: WALL_CLOCK_IS_NOT_BLOCKED.exitCode,
    retryable: WALL_CLOCK_IS_NOT_BLOCKED.retryable,
    blockedReason: null,
    emitsBlocked: false,
    restsIn: null,
    budgetExceeded: exceeded,
    events: Object.freeze(exceeded === null ? [] : [exceeded]),
  });
}

/* ------------------------------------------------------------------ *
 * 4. No bypass (F127-FR-034, ruling K3).
 * ------------------------------------------------------------------ */

/** The four things F127-FR-034 names that MUST NOT switch a budget off. */
export const BYPASS_ATTEMPTS = ["comment", "flag", "mode", "project-key"] as const;
export type BypassAttempt = (typeof BYPASS_ATTEMPTS)[number];

/** F127-FR-034 — nothing of the four switches a budget off or raises it. */
export const NOTHING_BYPASSES_A_BUDGET = true as const;

/** An attempt to switch a budget off or raise it by one of the four. */
export class BudgetBypassError extends Error {
  readonly attempt: string;
  constructor(attempt: string, detail?: string) {
    super(
      `no ${attempt} switches a budget off or raises it (F127-FR-034): raising a ceiling is a ` +
        `change of user configuration and a \`resume\`` +
        (detail === undefined ? "" : ` — ${detail}`),
    );
    this.name = "BudgetBypassError";
    this.attempt = attempt;
  }
}

/**
 * Refuse an attempt to switch a budget off or raise it (F127-FR-034). Every
 * one of the four — a comment, a flag, a mode, a project key — is refused, and
 * so is anything else: the function never answers, it throws.
 */
export function refuseBypass(attempt: BypassAttempt | string, detail?: string): never {
  throw new BudgetBypassError(attempt, detail);
}

/**
 * The ONLY lawful way a ceiling rises (F127-FR-034, F127-FR-024): the consumer
 * changes their own configuration and runs `resume`, and the run continues
 * where it stopped.
 */
export const RAISING_A_CEILING = Object.freeze({
  isAChangeOfUserConfiguration: true,
  thenResume: true,
  continuesWhereItStopped: true,
  byAComment: false,
  byAFlag: false,
  byAMode: false,
  byAProjectKey: false,
});

/** What `resumeAfterRaising` answers. */
export type ResumeAfterRaising = {
  /** True where the raised ceiling is no longer exhausted. */
  readonly resumes: boolean;
  /** The key that was raised. */
  readonly key: string;
  readonly from: number | null;
  readonly to: number | null;
  /** The used figure the ledger still holds: a `resume` never resets it. */
  readonly used: number | null;
  readonly note: string;
};

/**
 * Raise a ceiling and `resume` (F127-FR-024, F127-FR-034). The ledger is
 * untouched — the spend of the run is one figure (F127-FR-031) — so the run
 * resumes exactly where the cap stopped it, with the same `used`.
 */
export function resumeAfterRaising(
  reading: CeilingReading,
  raisedTo: number | null,
): ResumeAfterRaising {
  const used = reading.used;
  const resumes =
    raisedTo !== null && Number.isFinite(raisedTo) && raisedTo !== 0 && used !== null
      ? used < raisedTo
      : false;
  return Object.freeze({
    resumes,
    key: keyOf(reading.ceiling),
    from: reading.limit,
    to: raisedTo,
    used,
    note: resumes
      ? `the ceiling ${keyOf(reading.ceiling)} was raised from ${String(reading.limit)} to ` +
        `${String(raisedTo)} in user configuration; \`resume\` continues where the run stopped ` +
        `and the spend of ${String(used)} stands (F127-FR-024, F127-FR-031)`
      : `the ceiling ${keyOf(reading.ceiling)} is still reached at ${String(raisedTo)}; the run ` +
        `stops again with the blocked reason ${BLOCKED_REASON_BUDGET_CAP} (F127-FR-034)`,
  });
}

/** The state and the transition a hard-cap stop performs, for a reader. */
export const CAP_STOP_STATE = Object.freeze({
  restsIn: BLOCKED_STATE,
  transition: BLOCKED_TRANSITION,
  terminal: terminalOf(BLOCKED_REASON_BUDGET_CAP),
});
