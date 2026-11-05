// Feature 117 (T041) — the fingerprint bracket around the grounding pass
// (F117-FR-019, row 31 of annex X §X.7).
//
// The protected set and the tree are fingerprinted IMMEDIATELY BEFORE and
// IMMEDIATELY AFTER the grounding pass. A difference becomes a fact for the
// critic through the fact block and NEVER halts the run. The snapshot is
// built on the working tree; no copy of the tree is made (research D-3).
//
// This module hashes nothing and reads no file (the pattern of
// `integrity/protected-set.ts`): the fingerprints come from the fingerprint
// service of the content owner through the callable this module is handed at
// the call (feature 100 annex C §C.8 — the engine hands in the fingerprints,
// F100-FR-012, F100-FR-234).

import { theFingerprintsAreOn } from "../../integrity/protected-set.ts";

/** The switch of row 31, read from the parity profile of feature 100. */
export const SWITCH_KEY = "integrity.gate_fingerprint" as const;
export const PARITY_ROW = 31 as const;

/** One difference the bracket found: a path whose fingerprint changed. */
export interface FingerprintDifference {
  /** The path, relative to the workspace root, as the fact block shows it. */
  readonly path: string;
  /** The fingerprint before the grounding pass. */
  readonly before: string;
  /** The fingerprint after the grounding pass. */
  readonly after: string;
}

/** The result of one bracket. */
export interface FingerprintBracket {
  /** True when the switch of row 31 is on and both fingerprints were taken. */
  readonly taken: boolean;
  /** The fingerprint before the pass, when taken. */
  readonly before?: string;
  /** The fingerprint after the pass, when taken. */
  readonly after?: string;
  /** The paths whose fingerprint differs, empty when none or not taken. */
  readonly differences: readonly FingerprintDifference[];
}

/** A difference as the fact block of the critic receives it (no fingerprint values, D §D.7). */
export interface GroundingChangedFact {
  readonly kind: "grounding-changed-during-pass";
  readonly paths: readonly string[];
}

/** The fingerprint service of the content owner, handed in by the engine (annex C §C.8). */
export type FingerprintService = () => string;

/**
 * Run one grounding pass inside the bracket (F117-FR-019). With the switch
 * of row 31 OFF nothing is fingerprinted and the pass runs exactly as
 * before; with it on, a difference between the fingerprints before and
 * after becomes a fact for the critic and NEVER halts the run.
 */
export function runInsideFingerprintBracket<R>(
  config: Readonly<Record<string, unknown>> | undefined,
  fingerprint: FingerprintService,
  pass: () => R,
): { result: R; bracket: FingerprintBracket; facts: readonly GroundingChangedFact[] } {
  if (!theFingerprintsAreOn(config ?? {})) {
    // The switch is off: nothing is fingerprinted, no output changes.
    return { result: pass(), bracket: { taken: false, differences: [] }, facts: [] };
  }
  const before = fingerprint();
  const result = pass();
  const after = fingerprint();
  if (before === after) {
    return { result, bracket: { taken: true, before, after, differences: [] }, facts: [] };
  }
  // The service answers for the tree as a whole; a difference is reported
  // with the paths the service names, so the caller hands in the paths
  // beside the fingerprint when it can (see `bracketOfFingerprints`).
  const differences: FingerprintDifference[] = [{ path: "<tree>", before, after }];
  const facts: GroundingChangedFact[] = [
    { kind: "grounding-changed-during-pass", paths: ["<tree>"] },
  ];
  return { result, bracket: { taken: true, before, after, differences }, facts };
}

/**
 * The bracket over two per-path fingerprint maps: the differences are the
 * paths whose fingerprint changed, with the before and after values.
 */
export function bracketOfFingerprints(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): FingerprintBracket {
  const differences: FingerprintDifference[] = [];
  for (const path of Object.keys(before)) {
    if (before[path] !== after[path]) {
      differences.push({ path, before: before[path]!, after: after[path] ?? "" });
    }
  }
  for (const path of Object.keys(after)) {
    if (!(path in before)) differences.push({ path, before: "", after: after[path]! });
  }
  return {
    taken: true,
    differences,
  };
}

/** The fact rows the engine hands to the fact block for one bracket (D §D.7). */
export function factsOfBracket(bracket: FingerprintBracket): readonly GroundingChangedFact[] {
  if (!bracket.taken || bracket.differences.length === 0) return [];
  return [{ kind: "grounding-changed-during-pass", paths: bracket.differences.map((d) => d.path) }];
}
