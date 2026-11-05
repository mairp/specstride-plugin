/**
 * T051 of feature 118 — a yield written beside a checkpoint refuses the
 * checkpoint (F118-FR-043; own test CT-118-9).
 *
 * A yield says "nothing to do until"; a checkpoint says "unit done". The two
 * cannot stand in the same pass: the engine acts on the yield, leaves the
 * unit of work undeclared, and records the refusal. No layer can accept a
 * checkpoint that was written beside a yield — the decision is total: the
 * caller hands both artifacts in and gets the refusal, or nothing.
 */

/** What the pass wrote, as the engine reads the two artifacts after it exited. */
export interface PassArtifacts {
  readonly hasCheckpoint: boolean;
  readonly hasYield: boolean;
}

/** The decision of the engine after a pass has exited. */
export type CheckpointBesideYieldDecision =
  | { readonly kind: "accept-checkpoint" }
  | { readonly kind: "act-on-yield" }
  | { readonly kind: "refuse-checkpoint"; readonly record: CheckpointRefusalRecord };

/** The durable record of the refusal (the engine writes it once). */
export interface CheckpointRefusalRecord {
  readonly refused: "checkpoint";
  readonly reason: "a yield was written in the same pass";
}

/** Decide what the engine acts on when a pass wrote one or both artifacts. */
export function decideCheckpointBesideYield(
  artifacts: PassArtifacts,
): CheckpointBesideYieldDecision {
  if (artifacts.hasYield && artifacts.hasCheckpoint) {
    return {
      kind: "refuse-checkpoint",
      record: { refused: "checkpoint", reason: "a yield was written in the same pass" },
    };
  }
  return { kind: artifacts.hasYield ? "act-on-yield" : "accept-checkpoint" };
}

/** The layer hook of EP-04: a checkpoint beside a yield can never be accepted. */
export function checkpointAcceptedBesideYield(artifacts: PassArtifacts): boolean {
  return !(artifacts.hasCheckpoint && artifacts.hasYield);
}
