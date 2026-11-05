/**
 * T087 — the handshake (annex F, §F.3; F100-FR-160, F100-FR-161).
 *
 * The three outcomes with the exit code of `launch` for each, read from the
 * key `handshake` of `data/exit-codes.json`, and the derivation of
 * `launch-abandoned` from a launch record and a lease, over the exported
 * types of T038 (`LaunchRecord`) and T040 (`Lease`).
 *
 * Row 17 of `data/closed-sets.json` holds the three literals itself; this
 * module imports the registered set and does not register it again.
 */
import exitCodes from "../../data/exit-codes.json" with { type: "json" };
import { handshakeOutcomes } from "../enums/sets-120-125.ts";
import { isAbandoned, type LaunchRecord } from "../records/launch-record.ts";
import type { Lease } from "../records/lease.ts";

/** The section of annex F that owns this table. */
export const ANNEX_SECTION = "annex F, §F.3" as const;

type RawHandshakeRow = {
  Outcome: string;
  Meaning: string;
  "The CLI prints": string;
  "Exit of `launch`": string;
};

const RAW = (exitCodes as { handshake: RawHandshakeRow[] }).handshake;

const bare = (cell: string): string => cell.replace(/`/g, "").trim();

/** The three outcomes of a launch, in the order of the annex. */
export const HANDSHAKE_OUTCOMES = ["started", "attached", "refused"] as const;

/** An outcome of the handshake (annex F, §F.3). */
export type HandshakeOutcome = (typeof HANDSHAKE_OUTCOMES)[number];

/** Row 17 of §X.6, as the table of §X.6 holds it (T253). */
export const handshakeOutcomeSet = handshakeOutcomes;

/** One row of the outcomes table of §F.3. */
export type HandshakeRow = {
  /** The outcome. */
  readonly outcome: HandshakeOutcome;
  /** The cell "Meaning". */
  readonly meaning: string;
  /** The cell "The CLI prints". */
  readonly cliPrints: string;
  /** The cell "Exit of `launch`", verbatim. */
  readonly exitCell: string;
  /** The first number the cell names: the code of the plain case. */
  readonly exitCode: number;
  /** Every number the cell names. */
  readonly exitCodes: readonly number[];
};

/** Every row of the outcomes table, in the order of the annex. */
export const handshakeRows: readonly HandshakeRow[] = Object.freeze(
  RAW.map((row) => {
    const cell = row["Exit of `launch`"];
    // The cell of `refused` cites "the closed set of annex X §X.6 row 212".
    // Strip the citation before reading the codes out of the cell.
    const codesPart = cell
      .replace(/annex [A-Z] §[A-Z]\.\d+ row \d+/g, "")
      .replace(/§[A-Z]\.\d+/g, "");
    const numbers = [...codesPart.matchAll(/\b(\d+)\b/g)].map((m) => Number(m[1]));
    return Object.freeze({
      outcome: bare(row.Outcome) as HandshakeOutcome,
      meaning: row.Meaning,
      cliPrints: row["The CLI prints"],
      exitCell: cell,
      exitCode: numbers[0] ?? 0,
      exitCodes: Object.freeze(numbers),
    });
  }),
);

const ROW = new Map(handshakeRows.map((r) => [r.outcome, r]));

/** The row of an outcome (F100-FR-160). */
export function handshakeRow(outcome: string): HandshakeRow | undefined {
  return ROW.get(outcome as HandshakeOutcome);
}

/** The two refusals of the lock that exit 24, not 4 (annex F, §F.3). */
export const REFUSALS_THAT_EXIT_24 = ["lock-conflict", "lock-unknown"] as const;

/** The refusals of the pipeline, with the code each gives (annex F, §F.3). */
export const PIPELINE_REFUSAL_CODES: Readonly<Record<string, number>> = Object.freeze({
  "invalid-contract": 20,
  "preflight-blocked": 21,
  "stale-sources": 23,
});

/** The supervisor's refusal code, which every other refusal gives. */
export const REFUSAL_CODE = 4 as const;

/** The code of a refusal of role resolution in the foreground `run`. */
export const ROLE_RESOLUTION_REFUSAL_CODE_IN_THE_FOREGROUND = 3 as const;

/** What the caller knows about a refusal when it asks for the code. */
export type RefusalContext = {
  /** The member of the closed set of refusals (row 212 of §X.6). */
  readonly refusal?: string;
  /** True for the foreground `run`, where role resolution refuses with 3. */
  readonly foregroundRun?: boolean;
};

/**
 * F100-FR-160 — the exit code of `launch` for an outcome: 0 for `started`, 4
 * for `attached` (the supervisor's code for the launch decision `attach`),
 * and for `refused` the supervisor's refusal code 4 for every refusal of the
 * closed set, except `lock-conflict` and `lock-unknown`, which give 24; the
 * pipeline code 20, 21 or 23 where the refusal is one of the pipeline's; and
 * 3 for a refusal of role resolution in the foreground `run`.
 */
export function exitOfLaunch(outcome: HandshakeOutcome, context: RefusalContext = {}): number {
  const row = ROW.get(outcome);
  if (row === undefined) {
    throw new Error(`\`${outcome}\` is not an outcome of the handshake of ${ANNEX_SECTION}`);
  }
  if (outcome !== "refused") return row.exitCode;
  const refusal = context.refusal;
  if (refusal !== undefined) {
    if ((REFUSALS_THAT_EXIT_24 as readonly string[]).includes(refusal)) return 24;
    const pipeline = PIPELINE_REFUSAL_CODES[refusal];
    if (pipeline !== undefined) return pipeline;
    if (refusal.startsWith("resolve-") && context.foregroundRun === true) {
      return ROLE_RESOLUTION_REFUSAL_CODE_IN_THE_FOREGROUND;
    }
  }
  return REFUSAL_CODE;
}

/* ------------------------------------------------------------------ *
 * F100-FR-160 — the four steps of the handshake.
 * ------------------------------------------------------------------ */

/** One step of the handshake of §F.3. */
export type HandshakeStep = {
  readonly step: number;
  readonly actor: "CLI" | "Runtime root";
  readonly act: string;
};

/** The four steps of §F.3, in order (F100-FR-160). */
export const HANDSHAKE_STEPS: readonly HandshakeStep[] = Object.freeze([
  Object.freeze({
    step: 1,
    actor: "CLI" as const,
    act:
      "Resolves the run request, runs the launch checks (the launch-blocking subset of the " +
      "doctor's checks), writes the launch record with a fresh launch nonce",
  }),
  Object.freeze({ step: 2, actor: "CLI" as const, act: "Calls the detach strategy" }),
  Object.freeze({
    step: 3,
    actor: "Runtime root" as const,
    act: "Takes the workspace lock; writes the lease with the launch nonce; emits `run.launched`",
  }),
  Object.freeze({
    step: 4,
    actor: "CLI" as const,
    act:
      "Waits for a lease with its nonce, for a bounded time and no longer; records the outcome " +
      "in the launch record; prints one line; exits",
  }),
]);

/**
 * F100-FR-160 — readiness is confirmed by the lease that carries the launch
 * nonce, whatever the detach strategy.
 */
export const READINESS_IS_CONFIRMED_BY = "the lease that carries the launch nonce" as const;

/** True when the lease confirms readiness for this launch (F100-FR-160). */
export function leaseConfirmsLaunch(record: LaunchRecord, lease: Lease | undefined): boolean {
  if (lease === undefined) return false;
  return String(lease.launchNonce) === String(record.launchNonce);
}

/**
 * F100-FR-160 — the outcome of a handshake, from the launch record and the
 * lease the CLI found within the bounded wait.
 */
export function outcomeOf(input: {
  readonly record: LaunchRecord;
  readonly lease?: Lease | undefined;
  readonly refusal?: string | undefined;
}): HandshakeOutcome {
  if (input.refusal !== undefined) return "refused";
  if (input.lease === undefined) return "refused";
  return leaseConfirmsLaunch(input.record, input.lease) ? "started" : "attached";
}

/* ------------------------------------------------------------------ *
 * F100-FR-160 — `launch-abandoned`.
 * ------------------------------------------------------------------ */

/** The derived condition of an unanswered launch (row 2 of §X.6). */
export const LAUNCH_ABANDONED = "launch-abandoned" as const;

/**
 * F100-FR-160 — an unanswered launch is closed as `launch-abandoned` by the
 * next launch. It is derived and never written: a launch record older than
 * the handshake limit that has no `outcome` and no lease with its nonce
 * (annex B §B.7; T038 `isAbandoned`).
 */
export function deriveLaunchAbandoned(input: {
  readonly record: LaunchRecord;
  readonly lease?: Lease | undefined;
  readonly now: Date;
  readonly handshakeLimitSeconds: number;
}): typeof LAUNCH_ABANDONED | undefined {
  const leaseWithNonceExists = leaseConfirmsLaunch(input.record, input.lease);
  return isAbandoned(input.record, input.now, input.handshakeLimitSeconds, leaseWithNonceExists)
    ? LAUNCH_ABANDONED
    : undefined;
}

/** F100-FR-160 — the next launch closes an abandoned one. */
export const CLOSED_BY = "the next launch" as const;

/* ------------------------------------------------------------------ *
 * F100-FR-161 — re-attachment is reading only.
 * ------------------------------------------------------------------ */

/** F100-FR-161 — re-attachment writes nothing. */
export const REATTACHMENT_IS_READING_ONLY = true as const;

/** The two ways a new host session learns of a run (F100-FR-161). */
export const HOW_A_NEW_SESSION_LEARNS = [
  "`status`",
  "a host hook shim that prints a precomputed status line",
] as const;

/** The value of `validUntil` for a run that rests and has no lease. */
export const VALID_UNTIL_NONE = "none" as const;

/** What the shim prints for a status line whose `validUntil` has passed. */
export const EXPIRED_STATUS_LINE = {
  says: "the state is unknown",
  namesTheCommand: "status",
} as const;

/** F100-FR-161 — how a shim reads the `validUntil` of a status line. */
export function statusLineIsValid(validUntil: string, now: Date): boolean {
  if (validUntil === VALID_UNTIL_NONE) return true;
  const at = Date.parse(validUntil);
  if (Number.isNaN(at)) return false;
  return at > now.getTime();
}
