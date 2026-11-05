/**
 * The finding and the blocker of a plan source (F105-FR-015), on the types of
 * EP-07 (feature 100, annex C §C.9).
 *
 * A finding is what a source reports about something it IGNORED; a blocker is
 * what it reports about something it REFUSED to guess. The two are different
 * in effect: a finding leaves the plan whole, a blocker keeps a command out of
 * it and is recorded among the `ambiguities`.
 */
import type {
  Blocker as ContractBlocker,
  Provenance,
  SourceFinding as ContractFinding,
} from "@specstride/contracts/ep/verification-source";

/**
 * A finding of a source: the message of §C.9 with its provenance, and the two
 * fields this feature adds for the reader of a finding about a field — which
 * field it was, of which command, and whether it made the command undeclared
 * (F105-FR-016, CQ-190).
 */
export type SourceFinding = ContractFinding & {
  readonly field?: string;
  readonly commandId?: string;
  /** True where the field made the command undeclared, which means serial. */
  readonly undeclares?: boolean;
};

/** A blocker of a source, as §C.9 shapes it (F105-FR-015). */
export type Blocker = ContractBlocker;

/** The two reasons a blocker may carry (§C.9). */
export const BLOCKER_REASONS = ["not-a-fixed-argument-list", "declarations-disagree"] as const;
export type BlockerReason = (typeof BLOCKER_REASONS)[number];

/** Where a declaration was made: file and line (F105-FR-015). */
export type { Provenance };

/** A blocker for a command that cannot be written as a fixed argument list. */
export function notAFixedArgumentList(input: {
  readonly message: string;
  readonly provenance: readonly Provenance[];
}): Blocker {
  return Object.freeze({
    reason: "not-a-fixed-argument-list" as const,
    message: input.message,
    provenance: Object.freeze([...input.provenance]),
  });
}

/** A blocker for two declarations that disagree (F105-FR-015). */
export function declarationsDisagree(input: {
  readonly message: string;
  readonly provenance: readonly Provenance[];
}): Blocker {
  return Object.freeze({
    reason: "declarations-disagree" as const,
    message: input.message,
    provenance: Object.freeze([...input.provenance]),
  });
}

/** How a blocker reads among the `ambiguities` of the plan (F105-FR-015). */
export function ambiguityOf(blocker: Blocker): string {
  const where = blocker.provenance.map((one) => `${one.file}:${one.line}`).join(", ");
  return where === "" ? blocker.message : `${blocker.message} (${where})`;
}

/** How a finding of a FAILED source reads (F105-FR-015, §C.9). */
export function failedSourceFinding(input: {
  readonly sourceId: string;
  readonly reason: string;
}): SourceFinding {
  return Object.freeze({
    message: `the plan source \`${input.sourceId}\` failed and contributes nothing: ${input.reason}`,
  });
}
