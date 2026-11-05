/**
 * T102 — the call point `resume` (F115-FR-031; F115-SC-009).
 *
 * At a start of the engine inside a phase attempt the layer acts by the last
 * record of its namespace, by the table of the five resume states of
 * `ledger-micro-115.json`:
 *
 * | Last record | State | On resume |
 * |---|---|---|
 * | (none) | a pass was running | the pass is lost as in the classic loop; no cycle is counted |
 * | `unit-declared` | checkpoint accepted, check not started | run the check on the current tree; a differing fingerprint marks the declaration superseded and binds the result to the current fingerprint |
 * | `check-started` | a check was running | run it again; the interrupted run is recorded as `interrupted` |
 * | `check-finished` | result not delivered | deliver it when the fingerprint matches; run the check again otherwise |
 * | `disengaged` | the layer is off for the phase attempt | it stays off |
 *
 * Purity: imports `@specstride/contracts` and `@specstride/kernel` only; no
 * `node:fs`, no process (F100-FR-012; research.md D-1).
 */
import type { PhaseAttemptView } from "./index.ts";
import { lastRecord, validateLedger, type MicroLedger } from "../ledger/records.ts";
import { layerOffForIntegrity, type LayerOff } from "../caps/disengage.ts";

/** The closed set of the five resume states (F115-FR-031). */
export const RESUME_STATES = [
  "pass-running",
  "checkpoint-accepted",
  "check-running",
  "result-undelivered",
  "disengaged",
] as const;
export type ResumeState = (typeof RESUME_STATES)[number];

/**
 * F115-FR-031 — the state a resume finds, read from the last record of the
 * namespace. A record kind that is not one of the five table keys means a
 * pass was running when the engine stopped, so the pass is lost as in the
 * classic loop.
 */
export function resumeStateOf(ledger: MicroLedger): ResumeState {
  const last = lastRecord(ledger);
  if (last === undefined) return "pass-running";
  switch (last.kind) {
    case "unit-declared":
      return "checkpoint-accepted";
    case "check-started":
      return "check-running";
    case "check-finished":
      return "result-undelivered";
    case "disengaged":
      return "disengaged";
    default:
      return "pass-running";
  }
}

/** What the layer does at the resume, by the table of F115-FR-031. */
export type ResumeAction =
  "pass-lost" | "run-check" | "rerun-check" | "deliver-result" | "stay-off";

/** The outcome of one resume, with the counts the table fixes. */
export type ResumeOutcome = {
  readonly state: ResumeState;
  readonly action: ResumeAction;
  /** Whether the resume counts a cycle (only real work does; a lost pass and an interruption never do). */
  readonly countsCycle: boolean;
  /** An interruption and a lost pass never count as a failure (F115-FR-031). */
  readonly countsFailure: boolean;
  /** State `checkpoint-accepted` with a differing fingerprint: the declaration is `superseded`. */
  readonly declarationSuperseded: boolean;
  /** The fingerprint the check result binds to on the resume. */
  readonly resultBoundTo?: string;
  /** State `check-running`: the interrupted run is recorded as `interrupted`. */
  readonly recordedAs?: "interrupted";
  /** State `disengaged`: the layer stays off for the rest of the phase attempt. */
  readonly layerOff?: boolean;
};

/** The durable seam of the resume: the engine hands the log in, the layer writes nothing itself. */
export type ResumeLog = { events: string[] };

/** The independent read path of the resume log. */
export function readResumeLog(log: ResumeLog): readonly string[] {
  return Object.freeze([...log.events]);
}

/** Record one resume on the log, so a later read sees what happened durably. */
export function recordResume(log: ResumeLog, outcome: ResumeOutcome): void {
  log.events.push(
    outcome.recordedAs !== undefined
      ? `${outcome.recordedAs}:${outcome.state}`
      : `${outcome.action}:${outcome.state}`,
  );
}

/** What a resume needs besides the ledger. */
export type ResumeInput = {
  /** The tree fingerprint at the resume, when the engine has one. */
  readonly currentFingerprint?: string;
  /** The log to write the resume onto (durable seam). */
  readonly log?: ResumeLog;
};

/** The verdict of a resume: the outcome, or the layer off with its event. */
export type ResumeResult =
  | { readonly ok: true; readonly outcome: ResumeOutcome }
  | { readonly ok: false; readonly off: LayerOff; readonly action: "stay-off" };

/**
 * F115-FR-031 — act by the last record of the namespace. An invalid ledger
 * (IR-25) is not resumed at all: the layer goes off for the phase attempt
 * for the integrity event `ledger-invalid` (F115-FR-032) and the run does
 * not stop.
 */
export function resumeFromLedger(ledger: MicroLedger, input: ResumeInput): ResumeResult {
  if (!validateLedger(ledger).ok) {
    return {
      ok: false,
      off: layerOffForIntegrity("ledger-invalid"),
      action: "stay-off",
    };
  }
  const state = resumeStateOf(ledger);
  const last = lastRecord(ledger);
  const log = input.log ?? { events: [] };
  switch (state) {
    case "pass-running": {
      const outcome: ResumeOutcome = {
        state,
        action: "pass-lost",
        countsCycle: false,
        countsFailure: false,
        declarationSuperseded: false,
      };
      recordResume(log, outcome);
      return { ok: true, outcome };
    }
    case "checkpoint-accepted": {
      const declared = last?.data.fingerprint;
      const superseded =
        input.currentFingerprint !== undefined &&
        declared !== undefined &&
        input.currentFingerprint !== declared;
      const outcome: ResumeOutcome = {
        state,
        action: "run-check",
        countsCycle: false,
        countsFailure: false,
        declarationSuperseded: superseded,
        // The result binds to the current fingerprint (superseded) or the
        // declared one (the declaration stands).
        resultBoundTo: superseded
          ? input.currentFingerprint
          : typeof declared === "string"
            ? declared
            : input.currentFingerprint,
      };
      recordResume(log, outcome);
      return { ok: true, outcome };
    }
    case "check-running": {
      const outcome: ResumeOutcome = {
        state,
        action: "rerun-check",
        countsCycle: false,
        countsFailure: false,
        declarationSuperseded: false,
        recordedAs: "interrupted",
      };
      recordResume(log, outcome);
      return { ok: true, outcome };
    }
    case "result-undelivered": {
      const declared = last?.data.fingerprint;
      const matches =
        input.currentFingerprint !== undefined && input.currentFingerprint === declared;
      const outcome: ResumeOutcome = {
        state,
        action: matches ? "deliver-result" : "run-check",
        countsCycle: false,
        countsFailure: false,
        declarationSuperseded: !matches,
        resultBoundTo: input.currentFingerprint,
      };
      recordResume(log, outcome);
      return { ok: true, outcome };
    }
    case "disengaged": {
      const outcome: ResumeOutcome = {
        state,
        action: "stay-off",
        countsCycle: false,
        countsFailure: false,
        declarationSuperseded: false,
        layerOff: true,
      };
      recordResume(log, outcome);
      return { ok: true, outcome };
    }
  }
}

/**
 * The call point `resume` as EP-04 calls it: the point itself returns `none`
 * (the durable effects are the ledger the engine writes and the resume log),
 * while the action of the table has been taken through `resumeFromLedger`.
 */
export function resumeCallPoint(
  invocation: PhaseAttemptView,
  deps: { readonly ledger: MicroLedger; readonly log?: ResumeLog },
): "none" {
  resumeFromLedger(deps.ledger, { log: deps.log });
  return "none";
}
