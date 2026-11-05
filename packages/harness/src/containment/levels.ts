/**
 * T073 — containment levels and ceilings (F109-FR-026).
 *
 * Containment is a capability with the four levels C0, C1, C2, C3 of feature
 * 100, annex C §C.15. Every harness adapter and every descriptor declares its
 * ceiling with provenance; a ceiling that no run has shown is `unverified`.
 * The seam runs a pass at the strongest level that is available: C2 where the
 * harness offers it, else C1. C0 needs an opt-in in user configuration only —
 * never from the environment, from a flag or from project configuration
 * (ruling 34; CQ-183). A proposer whose ceiling is C0 is refused at launch
 * without it, with a message that names the key. C3 is detected and never
 * created. The level is announced and recorded for every run, and at C0 and
 * C1 the record says `protection=detect`.
 */

/** The four containment levels (annex X §X.6 row 26). */
export const CONTAINMENT_LEVELS = ["C0", "C1", "C2", "C3"] as const;
export type ContainmentLevel = (typeof CONTAINMENT_LEVELS)[number];

/** Where a ceiling or a level came from. */
export const CONTAINMENT_PROVENANCE = ["declared", "detected", "unverified"] as const;
export type ContainmentProvenance = (typeof CONTAINMENT_PROVENANCE)[number];

/**
 * The key of row 25 of the `parity` profile that holds the opt-in to C0.
 * Only the user configuration may set it to `C0` (CQ-183, W-110-05).
 */
export const CONTAINMENT_OPT_IN_KEY = "sandbox.level";

/** Where an opt-in value may come from. Only `user` is accepted (F109-FR-026). */
export const OPT_IN_SOURCES = ["user", "environment", "flag", "project"] as const;
export type OptInSource = (typeof OPT_IN_SOURCES)[number];

/** The ceiling an adapter or a descriptor declares, with its provenance. */
export type ContainmentCeiling = {
  readonly level: ContainmentLevel;
  readonly provenance: ContainmentProvenance;
};

/** The containment record of one run, announced and recorded (F109-FR-026). */
export type ContainmentRecord = {
  readonly level: ContainmentLevel;
  readonly provenance: ContainmentProvenance;
  /** `detect` at C0 and C1; null where the level protects by itself. */
  readonly protection: "detect" | null;
};

/** A ceiling with its provenance; `unverified` until a run has shown it. */
export function containmentCeiling(
  level: ContainmentLevel,
  provenance: ContainmentProvenance = "unverified",
): ContainmentCeiling {
  return { level, provenance };
}

/** The strongest level that is available: C2 where offered, else C1. */
export function defaultLevel(offersC2: boolean): ContainmentLevel {
  return offersC2 ? "C2" : "C1";
}

/** True at the levels that protect by detection only. */
export function protectionOf(level: ContainmentLevel): "detect" | null {
  return level === "C0" || level === "C1" ? "detect" : null;
}

/** The value of the opt-in key, as one source carries it. */
export type OptInValue = { readonly value: string; readonly source: OptInSource };

/**
 * F109-FR-026 — is C0 opted in? Only the user configuration can opt in:
 * the same value from the environment, from a flag or from project
 * configuration gives NO opt-in.
 */
export function c0OptedIn(values: readonly OptInValue[]): boolean {
  for (const one of values) {
    if (one.source !== "user") continue;
    if (one.value === "C0") return true;
  }
  return false;
}

/** The refusal of a C0 proposer at launch: the message names the key. */
export class ContainmentRefusedError extends Error {
  public readonly key = CONTAINMENT_OPT_IN_KEY;

  constructor(harnessId: string) {
    super(
      `containment: the ceiling of '${harnessId}' is C0; set ${CONTAINMENT_OPT_IN_KEY}=C0 in the user configuration to opt in`,
    );
    this.name = "ContainmentRefusedError";
  }
}

/**
 * F109-FR-026 — the level of one run of `entry`.
 *
 * - A ceiling of C3 is detected and never created: the run records C3 as
 *   detected.
 * - A ceiling of C0 needs the opt-in in user configuration only; without it
 *   the launch of a proposer is refused with a message that names the key.
 * - Otherwise the seam runs at the strongest available level: C2 where the
 *   harness offers it, else C1, at the ceiling's provenance (`unverified`
 *   until a run has shown it).
 */
export function resolveRunLevel(input: {
  readonly id: string;
  readonly ceiling: ContainmentCeiling;
  readonly offersC2: boolean;
  readonly role: "proposer" | "critic";
  /** Every value of the opt-in key the run saw, with where it came from. */
  readonly optInValues?: readonly OptInValue[];
}): ContainmentRecord {
  const { ceiling } = input;
  if (ceiling.level === "C3") {
    // C3 is supplied by the consumer and detected, never created.
    return { level: "C3", provenance: "detected", protection: null };
  }
  if (ceiling.level === "C0") {
    if (input.role === "proposer" && !c0OptedIn(input.optInValues ?? [])) {
      throw new ContainmentRefusedError(input.id);
    }
    return { level: "C0", provenance: ceiling.provenance, protection: protectionOf("C0") };
  }
  const level = ceiling.level === "C1" ? "C1" : defaultLevel(input.offersC2);
  const capped = level === "C0" ? "C1" : level; // never below the ceiling's own floor
  return { level: capped, provenance: ceiling.provenance, protection: protectionOf(capped) };
}
