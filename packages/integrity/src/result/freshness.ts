// T036 (F116-FR-008; IR-16, IR-40) — the binding of a result to its tree and
// the derivation of `current` and `superseded`.
export type Freshness = "current" | "superseded";

/** Bind a result to the tree fingerprints it ran between. */
export function bindResultToTree<R extends object>(
  result: R,
  treeBefore: string,
  treeAfter: string,
): R & { treeBefore: string; treeAfter: string; freshness: Freshness } {
  return {
    ...result,
    treeBefore,
    treeAfter,
    freshness: freshnessOf(treeAfter, treeAfter),
  };
}

/** `current` only when the fingerprint equals the tree at the phase gate. */
export function freshnessOf(resultTree: string, phaseGateTree: string): Freshness {
  return resultTree === phaseGateTree ? "current" : "superseded";
}

/**
 * Derive `freshness` for a series of results of the phase: a result on an
 * older tree than the phase gate reads `superseded`. The exit result and the
 * conditions stay in their own fields.
 */
export function markFreshness<R extends { unitId: string; ordinal: number; treeAfter: string }>(
  results: R[],
  phaseGateTree: string,
): (R & { freshness: Freshness })[] {
  return results
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((r) => ({ ...r, freshness: freshnessOf(r.treeAfter, phaseGateTree) }));
}
