/**
 * T103 — the counters read from the ledger, the reset, and the effect of an
 * invalid ledger (F115-FR-032; IR-26; IR-25).
 *
 * The seven counters of the namespace `micro` (`LEDGER_COUNTERS`, the list
 * of `ledger-micro-115.json`) are read by replaying the records of the
 * ledger: nothing is kept in the memory of a session, so a resume and a
 * relaunch continue the counts that are already there. The reset flag of the
 * run resets them. The ledger is validated before the read (and before the
 * fact block is built, F115-FR-032); when it is invalid the layer is off for
 * the phase attempt and an integrity event of the kind `ledger-invalid`
 * (annex X §X.6, row 65) is raised as an event of the type `integrity.noted`.
 *
 * Purity: imports `@specstride/contracts` and `@specstride/kernel` only; no
 * `node:fs`, no process (F100-FR-012; research.md D-1).
 */
import { validateLedger, type MicroLedger } from "./records.ts";
import { layerOffForIntegrity, type LayerOff } from "../caps/disengage.ts";

/** F115-FR-032 — the counters of the layer that live in the ledger. */
export const LEDGER_COUNTERS = [
  "cyclesUsed",
  "repairsByTask",
  "escalationsByTask",
  "escalationsOfAttempt",
  "unresolvedUnits",
  "uncheckedStreak",
  "closingReturns",
] as const;
export type LedgerCounter = (typeof LEDGER_COUNTERS)[number];

/** The counters of the layer for one phase attempt (IR-26). */
export type LayerCounters = {
  /** Cycles spent in the phase attempt. */
  readonly cyclesUsed: number;
  /** Repairs used, per task id. */
  readonly repairsByTask: Readonly<Record<string, number>>;
  /** Escalations used, per task id. */
  readonly escalationsByTask: Readonly<Record<string, number>>;
  /** Escalations made in the phase attempt, all tasks together. */
  readonly escalationsOfAttempt: number;
  /** Units recorded unresolved in the phase attempt. */
  readonly unresolvedUnits: number;
  /** Consecutive `unchecked` results at the end of the ledger. */
  readonly uncheckedStreak: number;
  /** Closing checks whose result was delivered back. */
  readonly closingReturns: number;
};

/** Fresh counters of a phase attempt (also the effect of the reset flag). */
export function newCounters(): LayerCounters {
  return {
    cyclesUsed: 0,
    repairsByTask: Object.freeze({}),
    escalationsByTask: Object.freeze({}),
    escalationsOfAttempt: 0,
    unresolvedUnits: 0,
    uncheckedStreak: 0,
    closingReturns: 0,
  };
}

function bump(
  counters: Record<string, number>,
  taskIds: readonly unknown[],
): Record<string, number> {
  const next = { ...counters };
  for (const taskId of taskIds) {
    if (typeof taskId !== "string") continue;
    next[taskId] = (next[taskId] ?? 0) + 1;
  }
  return next;
}

function cyclesOf(data: Readonly<Record<string, unknown>>): number {
  return typeof data.cycles === "number" ? data.cycles : 0;
}

/**
 * IR-26 — read the counters back from the ledger by replaying its records.
 * The read is a pure function of the ledger, so a second session reads
 * exactly what the first session counted.
 */
export function readCountersFromLedger(ledger: MicroLedger): LayerCounters {
  let cyclesUsed = 0;
  let repairsByTask: Record<string, number> = {};
  let escalationsByTask: Record<string, number> = {};
  let escalationsOfAttempt = 0;
  let unresolvedUnits = 0;
  let uncheckedStreak = 0;
  let closingReturns = 0;
  for (const record of ledger.records) {
    cyclesUsed += cyclesOf(record.data);
    const taskIds = Array.isArray(record.data.taskIds)
      ? (record.data.taskIds as readonly unknown[])
      : [];
    switch (record.kind) {
      case "unit-repair":
        repairsByTask = bump(repairsByTask, taskIds);
        uncheckedStreak = 0;
        break;
      case "escalation":
        escalationsByTask = bump(escalationsByTask, taskIds);
        escalationsOfAttempt += 1;
        break;
      case "unit-unresolved":
        unresolvedUnits += 1;
        uncheckedStreak = 0;
        break;
      case "closing-check":
        if (record.data.delivered === true) closingReturns += 1;
        break;
      case "check-finished":
        uncheckedStreak = record.data.outcome === "unchecked" ? uncheckedStreak + 1 : 0;
        break;
      case "unit-kept":
        uncheckedStreak = 0;
        break;
      default:
        break;
    }
  }
  return {
    cyclesUsed,
    repairsByTask: Object.freeze(repairsByTask),
    escalationsByTask: Object.freeze(escalationsByTask),
    escalationsOfAttempt,
    unresolvedUnits,
    uncheckedStreak,
    closingReturns,
  };
}

/**
 * F115-FR-032 — the reset flag of the run resets the counters of the layer.
 * Without the flag the counts read from the ledger stand.
 */
export function applyResetFlag(ledger: MicroLedger, reset: boolean): LayerCounters {
  return reset ? newCounters() : readCountersFromLedger(ledger);
}

/** The one `integrity.noted` event the invalid-ledger path raises (row 65). */
export type LedgerInvalidEvent = {
  readonly type: "integrity.noted";
  readonly kind: "ledger-invalid";
  readonly detail: { readonly paths: readonly string[] };
};

/** The verdict of a resume of the counters. */
export type CountersResume =
  | { readonly ok: true; readonly counters: LayerCounters; readonly event?: undefined }
  | {
      readonly ok: false;
      readonly counters: LayerCounters;
      readonly off: LayerOff;
      readonly event: LedgerInvalidEvent;
    };

/**
 * F115-FR-032 — validate the ledger and read the counters. An invalid
 * ledger (truncated, reordered or edited, IR-25) switches the layer off for
 * the phase attempt with the integrity kind `ledger-invalid`, raises the
 * event of the type `integrity.noted`, counts nothing, and the run does not
 * stop: the value carries no exit code, no stop reason and no run state
 * (IR-07).
 */
export function countersAfterResume(ledger: MicroLedger): CountersResume {
  if (!validateLedger(ledger).ok) {
    return {
      ok: false,
      counters: newCounters(),
      off: layerOffForIntegrity("ledger-invalid"),
      event: {
        type: "integrity.noted",
        kind: "ledger-invalid",
        detail: { paths: Object.freeze([]) },
      },
    };
  }
  return { ok: true, counters: readCountersFromLedger(ledger) };
}
