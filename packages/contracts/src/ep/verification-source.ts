/**
 * T109 — the interface types of EP-07, the verification-plan source, from
 * `contracts/extension-points/EP-07.verification-source.json` and annex C,
 * §C.9 (F100-FR-101 to F100-FR-103).
 *
 * `specstride.verification-source/1`. A source finds the verification
 * commands a project declares, with where each was declared, and invents
 * none.
 */
export const POINT_ID = "specstride.verification-source/1" as const;
export const EP = "EP-07" as const;
export const ANNEX_SECTION = "annex C, §C.9" as const;

/** F100-FR-101 — the three operations of the point. */
export const OPERATIONS = ["discover", "obligations", "conflicts"] as const;
export type VerificationSourceOperation = (typeof OPERATIONS)[number];

/** F100-FR-102 — the closed set of verification modes, and the default. */
export const VERIFICATION_MODES = ["required", "plan", "off"] as const;
export type VerificationMode = (typeof VERIFICATION_MODES)[number];
export const VERIFICATION_MODE_DEFAULT: VerificationMode = "required";

/** Unknown-value rule of §C.9: an unknown mode is a configuration error, exit 3. */
export const UNKNOWN_MODE_EXIT_CODE = 3 as const;

/** Where a declaration was made (§C.9, Outputs). */
export type Provenance = { readonly file: string; readonly line: number };

/** One declared command, as `discover` reports it. */
export type DeclaredCommand = {
  readonly id: string;
  readonly argv: readonly string[];
  readonly provenance: Provenance;
  readonly phase: number;
  readonly timeLimitMs: number;
  readonly tasks?: readonly string[];
  readonly steps?: readonly { readonly argv: readonly string[]; readonly required: boolean }[];
  readonly reads?: readonly string[];
  readonly writes?: readonly string[];
  readonly exclusiveResource?: string;
};

/**
 * Under the recommended answer of CQ-190 a source that reads repository text
 * reports no declared reads and no declared writes: a declaration without the
 * provenance of user configuration, the environment or a flag counts as
 * undeclared, and by ruling P11 the commands it concerns run serial.
 */
export const PROVENANCES_THAT_COUNT_AS_DECLARED = [
  "user-configuration",
  "environment",
  "flag",
] as const;

/** One verification obligation, one per task line (§C.9, Outputs). */
export type VerificationObligation = {
  readonly obligationId: string;
  readonly taskId: string;
  readonly level: string;
  readonly kind: string;
  readonly oracle: string;
};

/** A blocker: a command that cannot be a fixed argument list, or two declarations that disagree. */
export type Blocker = {
  readonly reason: "not-a-fixed-argument-list" | "declarations-disagree";
  readonly message: string;
  readonly provenance: readonly Provenance[];
};

/** A finding of a source; an unknown field of a declaration is ignored with one. */
export type SourceFinding = { readonly message: string; readonly provenance?: Provenance };

/** F100-FR-101 — the verification-plan source. */
export type VerificationSource = {
  discover(workspace: string, model: unknown): Promise<readonly DeclaredCommand[]>;
  obligations(model: unknown): Promise<readonly VerificationObligation[]>;
  conflicts(resultsOfEverySource: readonly (readonly DeclaredCommand[])[]): readonly Blocker[];
};

/** "Guarantees of an implementation" of §C.9: a source reads and never writes. */
export const A_SOURCE_WRITES = false as const;

/** "Failure of an implementation" of §C.9, as data. */
export const FAILURE_PATHS: Readonly<Record<VerificationSourceOperation, string>> = Object.freeze({
  discover:
    "the source contributes nothing and is reported as a finding; under the mode `required` a phase left without commands refuses the launch",
  obligations: "the source contributes nothing and is reported as a finding",
  conflicts: "the source contributes nothing and is reported as a finding",
});

/** F100-FR-101 — the plan is frozen at launch and bound to the hashes of its sources. */
export const PLAN_IS_FROZEN_AT_LAUNCH = true as const;

/**
 * F100-FR-103 — a manifest derived on a relaunch is compared with the stored
 * one; a difference becomes a fact for the critic and the stored manifest
 * applies.
 */
export const STORED_MANIFEST_APPLIES_ON_A_DIFFERENCE = true as const;
