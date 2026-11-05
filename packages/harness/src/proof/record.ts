/**
 * T069 — the record of the proof of a critic-class call (F109-FR-040) and the
 * containment levels of the roles of a run (F109-SC-003's ledger side).
 *
 * For every critic-class call the seam writes into the invocation record of
 * the call: the form, the kind of proof (`initial-record`,
 * `pinned-configuration`, `read-only-sandbox`), the result of the proof, and
 * for the second form the sandbox mode, the state of the network and the
 * confirmation. For every run the seam records the containment level of each
 * role.
 */
import type { CompletionForm } from "./forms.ts";
import type { FirstFormProof } from "./first-form.ts";
import type { SecondFormProof } from "./second-form.ts";

/** The kinds of proof of row 128 of annex X §X.6. */
export const PROOF_KINDS = ["initial-record", "pinned-configuration", "read-only-sandbox"] as const;
export type ProofKind = (typeof PROOF_KINDS)[number];

/** The results a proof can have, as the invocation record carries them. */
export const PROOF_RESULTS = ["passed", "refused", "passed-over"] as const;
export type ProofResult = (typeof PROOF_RESULTS)[number];

/** The invocation record of the proof of one critic-class call (F109-FR-040). */
export type ProofRecord = {
  /** The form the call ran in, fixed before the call. */
  readonly form: CompletionForm;
  /** The kind of proof. */
  readonly proofKind: ProofKind;
  /** The result of the proof. */
  readonly result: ProofResult;
  /** True for the weaker proof by pinned configuration. */
  readonly weakerProof?: true;
  /** Second form only: the sandbox mode of the call. */
  readonly sandboxMode?: string;
  /** Second form only: the state of the network. */
  readonly networkOff?: boolean;
  /** Second form only: whether the adapter confirmed the read denial. */
  readonly confirmation?: boolean;
  /** Where the proof was refused or the critic passed over: the reason. */
  readonly reason?: string;
};

/** The proof record of an accepted call of the first form. */
export function recordOfFirstForm(proof: FirstFormProof): ProofRecord {
  if (proof.accepted) {
    return {
      form: "tool-less",
      proofKind: proof.proofKind,
      result: "passed",
      ...(proof.weakerProof ? { weakerProof: true as const } : {}),
    };
  }
  return {
    form: "tool-less",
    proofKind: "initial-record",
    result: "refused",
    reason: proof.reason,
  };
}

/** The proof record of an accepted or passed-over call of the second form. */
export function recordOfSecondForm(
  proof: SecondFormProof,
  call: {
    readonly sandboxMode: string;
    readonly networkOff: boolean;
    readonly confirmation: boolean;
  },
): ProofRecord {
  if (proof.accepted) {
    return {
      form: "read-only-tools",
      proofKind: "read-only-sandbox",
      result: "passed",
      sandboxMode: proof.sandboxMode,
      networkOff: proof.networkOff,
      confirmation: true,
    };
  }
  if ("outcome" in proof) {
    return {
      form: "read-only-tools",
      proofKind: "read-only-sandbox",
      result: "passed-over",
      sandboxMode: call.sandboxMode,
      networkOff: call.networkOff,
      confirmation: call.confirmation,
      reason: proof.reason,
    };
  }
  return {
    form: "read-only-tools",
    proofKind: "read-only-sandbox",
    result: "refused",
    sandboxMode: call.sandboxMode,
    networkOff: call.networkOff,
    confirmation: call.confirmation,
    reason: proof.reason,
  };
}

/* ------------------------------------------------------------------ *
 * The containment level of each role per run (F109-FR-040).
 * ------------------------------------------------------------------ */

/** The containment levels (annex X §X.6 row 26). */
export const CONTAINMENT_LEVELS = ["C0", "C1", "C2", "C3"] as const;
export type ContainmentLevel = (typeof CONTAINMENT_LEVELS)[number];

/** The roles whose containment level a run records. */
export const RUN_ROLES = ["proposer", "critic"] as const;
export type RunRole = (typeof RUN_ROLES)[number];

/** The containment level of each role of one run. */
export type RunContainment = Readonly<Record<RunRole, ContainmentLevel>>;

/** True when the value is a containment level of row 26. */
export function isContainmentLevel(value: unknown): value is ContainmentLevel {
  return typeof value === "string" && (CONTAINMENT_LEVELS as readonly string[]).includes(value);
}

/**
 * Records the containment level of each role of one run (F109-FR-040). A
 * value outside row 26 is read as C0, the unknown-value rule of the row.
 */
export function containmentLevelsForRun(levels: {
  readonly proposer: ContainmentLevel | string;
  readonly critic: ContainmentLevel | string;
}): RunContainment {
  const read = (value: ContainmentLevel | string): ContainmentLevel =>
    isContainmentLevel(value) ? value : "C0";
  return Object.freeze({ proposer: read(levels.proposer), critic: read(levels.critic) });
}
