/**
 * T067 — the proof of the second form (`read-only-tools`) of a critic-class
 * call (F109-FR-039; feature 100, F100-FR-089 and annex C §C.4).
 *
 * The call is refused unless its call record shows the read-only sandbox mode,
 * the network off, and the confirmation of the harness adapter that the
 * withheld paths of feature 100, annex C §C.4 cannot be read. The
 * confirmation is given BEFORE the call. Without it a configured critic is
 * refused with `critic_not_toolless`; an automatically picked one is passed
 * over for the next candidate, announced and recorded. Every act of such a
 * critic to write or to reach the network is refused and recorded as refused.
 */
import {
  CRITIC_NOT_TOOLLESS,
  type FixedForm,
  type FormRefusal,
  SECOND_FORM,
  refusal,
} from "./forms.ts";

/** The sandbox mode the second form runs in. */
export const READ_ONLY_SANDBOX_MODE = "read-only" as const;

/** The sandbox modes a call record may show; only one proves the second form. */
export const SANDBOX_MODES = ["read-only", "none", "unrestricted"] as const;
export type SandboxMode = (typeof SANDBOX_MODES)[number];

/** How the critic came to be the critic of the run (F100-FR-230). */
export const CRITIC_PROVENANCES = ["configured", "automatically-picked"] as const;
export type CriticProvenance = (typeof CRITIC_PROVENANCES)[number];

/** The confirmation the harness adapter gives before the call (§C.4). */
export type WithheldPathsConfirmation = {
  /** True where the adapter confirms the read denial before the call. */
  readonly confirmed: boolean;
  /** The locations the sandbox denies for reading (the five of §C.4). */
  readonly deniedLocations: readonly string[];
};

/** The five withheld locations of feature 100, annex C §C.4. */
export const WITHHELD_LOCATIONS = [
  "workspace-part",
  "control-plane",
  "event-stream",
  "worker-root",
  "tree-store",
] as const;

/** True when the confirmation covers every withheld location of §C.4. */
export function confirmationIsComplete(
  confirmation: WithheldPathsConfirmation | null | undefined,
): boolean {
  if (!confirmation?.confirmed) return false;
  const held = new Set(confirmation.deniedLocations);
  return (WITHHELD_LOCATIONS as readonly string[]).every((location) => held.has(location));
}

/** What the seam knows about one critic-class call of the second form. */
export type SecondFormCall = {
  /** The form fixed before the call; it must still be the second form. */
  readonly fixed: FixedForm;
  /** The sandbox mode the call record shows. */
  readonly sandboxMode: SandboxMode;
  /** Whether the network was off for the call. */
  readonly networkOff: boolean;
  /** The confirmation the adapter gave before the call. */
  readonly confirmation: WithheldPathsConfirmation | null;
  /** How the critic came to be the critic of the run. */
  readonly provenance: CriticProvenance;
};

/** The proof result of one critic-class call of the second form. */
export type SecondFormProof =
  | {
      readonly accepted: true;
      readonly proofKind: "read-only-sandbox";
      readonly sandboxMode: typeof READ_ONLY_SANDBOX_MODE;
      readonly networkOff: true;
      readonly confirmationRecorded: true;
    }
  | {
      /** The automatically picked critic is passed over, not refused. */
      readonly accepted: false;
      readonly outcome: "passed-over";
      readonly announced: true;
      readonly recorded: true;
      readonly takes: "the next candidate of the critic order";
      readonly reason: string;
    }
  | (FormRefusal & {
      /** A configured critic without the proof is refused. */
      readonly failure: typeof CRITIC_NOT_TOOLLESS;
      /** The reply of a refused call is not read. */
      readonly replyRead: false;
    });

/**
 * Proves the second form of one critic-class call (F109-FR-039). A configured
 * critic is refused with the typed failure; an automatically picked one is
 * passed over for the next candidate, announced and recorded.
 */
export function proveSecondForm(call: SecondFormCall): SecondFormProof {
  if (call.fixed.form !== SECOND_FORM) {
    return refused(`the form fixed before the call is "${call.fixed.form}", not the second form`);
  }
  const problems: string[] = [];
  if (call.sandboxMode !== READ_ONLY_SANDBOX_MODE) {
    problems.push(`the sandbox mode of the call record is "${call.sandboxMode}", not "read-only"`);
  }
  if (!call.networkOff) {
    problems.push("the network was not off for the call");
  }
  if (!confirmationIsComplete(call.confirmation)) {
    problems.push(
      "the harness adapter did not confirm, before the call, that every withheld path of annex C §C.4 cannot be read",
    );
  }
  if (problems.length === 0) {
    return {
      accepted: true,
      proofKind: "read-only-sandbox",
      sandboxMode: READ_ONLY_SANDBOX_MODE,
      networkOff: true,
      confirmationRecorded: true,
    };
  }
  if (call.provenance === "automatically-picked") {
    return {
      accepted: false,
      outcome: "passed-over",
      announced: true,
      recorded: true,
      takes: "the next candidate of the critic order",
      reason: problems.join("; "),
    };
  }
  return refused(problems.join("; "));
}

function refused(reason: string): SecondFormProof {
  return {
    ...refusal(reason),
    failure: CRITIC_NOT_TOOLLESS,
    replyRead: false,
  };
}

/* ------------------------------------------------------------------ *
 * Acts of the critic: a write or a reach for the network is refused.
 * ------------------------------------------------------------------ */

/** One act of a critic of the second form, and whether it was refused. */
export type CriticAct = {
  /** What the critic tried to do. */
  readonly act: "write" | "network";
  /** The path it tried to write, or the host it tried to reach. */
  readonly target: string;
  /** Every such act is refused (F109-FR-039). */
  readonly refused: true;
};

/**
 * Judges one act of a critic of the second form: a write and a reach for the
 * network are refused, always, and the refusal is returned as the record to
 * keep (F109-FR-039).
 */
export function refuseAct(act: Exclude<CriticAct["act"], never>, target: string): CriticAct {
  return { act, target, refused: true };
}

/** The journal of the refused acts of one critic-class call. */
export class ActJournal {
  readonly #acts: CriticAct[] = [];

  /** Records one refused act and returns the record. */
  record(act: CriticAct): CriticAct {
    this.#acts.push(act);
    return act;
  }

  /** The acts recorded so far; every one of them refused. */
  get acts(): readonly CriticAct[] {
    return [...this.#acts];
  }

  /** True when every recorded act is a refusal. */
  get allRefused(): boolean {
    return this.#acts.every((act) => act.refused);
  }
}
