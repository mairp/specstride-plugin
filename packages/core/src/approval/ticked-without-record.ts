/**
 * T076 of feature 101 — the refusal of a start for ticked phases without an
 * approval record (F101-FR-032, feature 100 F100-FR-059).
 *
 * The threat is a workspace that was moved, cloned or restored from a copy of
 * the working tree alone: the task list still shows a phase with every task
 * ticked, while the control plane that held the approval records did not come
 * along (T-02, annex B §B.6). Taken at face value the ticks look like work
 * that was approved, so the engine REFUSES THE START and names the three
 * commands that move the control plane properly.
 *
 * | Rule of F101-FR-032 | Here |
 * |---|---|
 * | a phase with EVERY task ticked for which no approval record VERIFIES | `phasesTickedWithoutAVerifiedApproval`, which reads approvals through T074 |
 * | the refusal names `state export`, `state import` and `state adopt` | `STATE_COMMANDS`, in `refusalMessage` |
 * | it exits 3 | `EXIT_CODE` |
 * | it changes no state | `THE_REFUSAL_CHANGES_STATE`; the module writes nothing and the engine returns before the loop |
 * | it is NO halt of the phase gate: no row in the table of halts | `IT_IS_A_HALT_OF_THE_PHASE_GATE`, `theTableOfHaltsNamesIt` |
 * | its terminal record carries NO stop reason (CQ-174) | `STOP_REASON` is `null`, `RETRYABLE` is false |
 * | off under the `parity` profile | row 129 of annex X §X.7, read in `theRefusalIsOn` |
 *
 * The refusal is DERIVED, never stored: the ticks come from the canonical spec
 * model of the one grammar owner (EP-03) and the approvals from the verified
 * reader of T074, so no third place can disagree with either. The module reads
 * no file (F100-FR-012, F100-FR-234).
 */
import { profileRow, type ProfileRow } from "@specstride/contracts/profile/parity";
import { GATE_HALTS } from "@specstride/contracts/engine/gate-halts";
import type { ApprovalFailure } from "@specstride/contracts/enums/gate";
import type { ApprovalIntegrityEvent, VerifiedApprovalReader } from "./verify.ts";

/* ------------------------------------------------------------------ *
 * The switch of row 129.
 * ------------------------------------------------------------------ */

/** Row 129 of annex X §X.7 — "Refusal of a start for ticked phases …". */
export const PARITY_ROW = 129 as const;

/**
 * The row names NO configuration key: the switch "follows the approval
 * record", so the refusal is on wherever approval records are the state and
 * off under the `parity` profile, where the as-is marker is (DV-029, CQ-172).
 */
export const SWITCH_KEY: undefined = undefined;

/** The row itself, as `data/parity-profile.json` holds it. */
export function rowOfTheSwitch(): ProfileRow {
  const row = profileRow(PARITY_ROW);
  if (row === undefined) {
    throw new Error(
      `the \`parity\` profile holds no row ${String(PARITY_ROW)}; F101-FR-032 is switched ` +
        `by that row of annex X §X.7`,
    );
  }
  return row;
}

/** The default of the switch, from the row: `on`. */
export function defaultOfTheSwitch(): string {
  return rowOfTheSwitch().default;
}

/** The value of the switch under the `parity` profile, from the row: `off`. */
export function valueUnderParity(): string {
  return rowOfTheSwitch().parity;
}

/** The name of the profile under which the refusal is off. */
export const PARITY_PROFILE = "parity" as const;

/**
 * Whether the refusal runs. The profile of the run decides it, because the row
 * names no key: under `parity` the row's value is `off`, everywhere else the
 * row's default stands, which is `on`.
 *
 * An unreadable profile name is read as "not `parity`", so a typo never
 * silently takes the refusal away.
 */
export function theRefusalIsOn(profile?: string | undefined): boolean {
  if (profile === PARITY_PROFILE) return valueUnderParity() !== "off";
  return defaultOfTheSwitch() !== "off";
}

/* ------------------------------------------------------------------ *
 * What the refusal is.
 * ------------------------------------------------------------------ */

/** F101-FR-032 — the exit code of the refusal. */
export const EXIT_CODE = 3 as const;

/** CQ-174 — the terminal record of the refusal carries NO stop reason. */
export const STOP_REASON = null;

/** CQ-174 — and is never retryable. */
export const RETRYABLE = false as const;

/** F101-FR-032 — the refusal is no halt of the phase gate. */
export const IT_IS_A_HALT_OF_THE_PHASE_GATE = false as const;

/** F101-FR-032 — and it changes no state. */
export const THE_REFUSAL_CHANGES_STATE = false as const;

/** The name the refusal is known by, for a reader of the result. */
export const REFUSAL = "ticked-phases-without-an-approval-record" as const;

/**
 * F101-FR-032 and F100-FR-059 — the three commands the refusal names, in the
 * order of annex B §B.19.
 */
export const STATE_COMMANDS = Object.freeze(["state export", "state import", "state adopt"]);

/**
 * F101-FR-032 — the table "Halts of the phase gate" names no cause of this
 * refusal. Proved against the table itself rather than asserted: every cause
 * of `packages/contracts/data/gate-halts.json` is compared with the name of
 * the refusal.
 */
export function theTableOfHaltsNamesIt(): boolean {
  return GATE_HALTS.some((halt) => halt.cause === REFUSAL);
}

/* ------------------------------------------------------------------ *
 * The phases the refusal is about.
 * ------------------------------------------------------------------ */

/** One phase of the specification, as this module reads it (EP-03, §C.7). */
export type PhaseWithTasks = {
  readonly number: number;
  readonly tasks: readonly { readonly ticked: boolean }[];
};

/**
 * Whether a phase "shows every task ticked". A phase with NO TASK AT ALL does
 * not: there is nothing that shows work, so an empty phase can never refuse a
 * start on its own.
 */
export function everyTaskIsTicked(phase: PhaseWithTasks): boolean {
  return phase.tasks.length > 0 && phase.tasks.every((task) => task.ticked);
}

/** One phase the refusal is about, with what its approval read reported. */
export type TickedPhaseWithoutARecord = {
  readonly phase: number;
  readonly taskCount: number;
  /** What the verification found: a member of row 255 of annex X §X.6. */
  readonly failed: ApprovalFailure;
  readonly integrityEvent: ApprovalIntegrityEvent;
};

/**
 * F101-FR-032 — the phases that show every task ticked and for which NO
 * approval record verifies. Every approval is read through the verification of
 * T074 (`./verify.ts`), so a forged record, a wrongly signed one and a bare
 * marker all count as "no approval record that verifies" here too, and each
 * read raises its integrity event.
 */
export function phasesTickedWithoutAVerifiedApproval(
  phases: readonly PhaseWithTasks[],
  readApproval: VerifiedApprovalReader,
): readonly TickedPhaseWithoutARecord[] {
  const found: TickedPhaseWithoutARecord[] = [];
  for (const phase of phases) {
    if (!everyTaskIsTicked(phase)) continue;
    const read = readApproval(phase.number);
    if (read.approved) continue;
    found.push(
      Object.freeze({
        phase: phase.number,
        taskCount: phase.tasks.length,
        failed: read.failed,
        integrityEvent: read.integrityEvent,
      }),
    );
  }
  return Object.freeze(found);
}

/**
 * The text of the refusal. It names the phases, the three commands and the
 * requirement, and it holds no key material and no path of the control plane.
 */
export function refusalMessage(phases: readonly number[]): string {
  const which =
    phases.length === 1
      ? `phase ${String(phases[0])}`
      : `phases ${phases.map((p) => String(p)).join(", ")}`;
  return (
    `the specification shows every task of ${which} ticked, and no approval record of ` +
    `${phases.length === 1 ? "that phase" : "those phases"} verifies. The run is refused so ` +
    `that ticks alone cannot pass for approved work. Move the control plane with ` +
    `\`${STATE_COMMANDS[0]}\` and \`${STATE_COMMANDS[1]}\`, or take over the control plane of ` +
    `this working tree with \`${STATE_COMMANDS[2]}\` (F101-FR-032, F100-FR-059).`
  );
}

/** What a refused start reports back. The engine returns it instead of a run. */
export type RefusedStart = {
  readonly ended: "refused";
  readonly refusal: typeof REFUSAL;
  readonly exitCode: typeof EXIT_CODE;
  /** CQ-174 — no member of §E.3 applies, so the field is empty. */
  readonly stopReason: null;
  readonly retryable: typeof RETRYABLE;
  readonly message: string;
  /** The three commands, named by the refusal itself (F100-FR-059). */
  readonly commands: readonly string[];
  /** The phases the refusal is about, with what their approval read found. */
  readonly phases: readonly TickedPhaseWithoutARecord[];
  /** The integrity events the reads raised, in the order of the phases. */
  readonly integrityEvents: readonly ApprovalIntegrityEvent[];
  /** F101-FR-032 — nothing was written. */
  readonly stateChanged: false;
};

/** What the engine hands in before it starts a run. */
export type RefusalInputs = {
  readonly phases: readonly PhaseWithTasks[];
  readonly readApproval: VerifiedApprovalReader;
  /** The profile of the run; `parity` switches the refusal off (row 129). */
  readonly profile?: string | undefined;
};

/**
 * F101-FR-032 — refuse the start, or `undefined` where there is nothing to
 * refuse. `undefined` is also what the `parity` profile gives, whatever the
 * specification shows, and in that case NO approval is read at all, so the
 * profile cannot be told apart from a clean workspace by its integrity events
 * either.
 */
export function refuseToStart(inputs: RefusalInputs): RefusedStart | undefined {
  if (!theRefusalIsOn(inputs.profile)) return undefined;
  const found = phasesTickedWithoutAVerifiedApproval(inputs.phases, inputs.readApproval);
  if (found.length === 0) return undefined;
  return Object.freeze({
    ended: "refused" as const,
    refusal: REFUSAL,
    exitCode: EXIT_CODE,
    stopReason: STOP_REASON,
    retryable: RETRYABLE,
    message: refusalMessage(found.map((f) => f.phase)),
    commands: STATE_COMMANDS,
    phases: found,
    integrityEvents: Object.freeze(found.map((f) => f.integrityEvent)),
    stateChanged: false as const,
  });
}

/** True when a result of the engine is this refusal. */
export function startWasRefused(end: { readonly ended: string }): end is RefusedStart {
  return end.ended === "refused";
}
