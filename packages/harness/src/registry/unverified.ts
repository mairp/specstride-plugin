/**
 * T015 — the rules of an unverified harness (F109-FR-013).
 *
 * A harness that is not `tested` MUST be treated as unverified:
 *  - it has NO version pin (no `versionRange`, no `verifiedOn`);
 *  - its capabilities are `declared` or `probed` only — never `adapter` or
 *    `catalogue`, which only a tested harness adapter earns;
 *  - it runs at auth tier 1 or 2 only. Auth tier 3 is not a valid value of a
 *    descriptor or of a registry entry at all, so a descriptor that names it
 *    is refused with the reason — this holds for tested entries too.
 */

/** The only origin a tested entry may carry (F109-FR-014: the loader sets `origin`). */
export const TESTED_ORIGIN = "adapter" as const;

/** The auth tiers an unverified harness may run at. */
export const UNVERIFIED_ALLOWED_TIERS = [1, 2] as const;

/** The provenance values an unverified harness's capabilities may carry. */
export const UNVERIFIED_ALLOWED_PROVENANCE = ["declared", "probed"] as const;

/** Whether the entry is a tested harness adapter: origin `adapter` with the tested range and date. */
export function isTestedHarnessAdapter(entry: {
  readonly origin?: string | null;
  readonly versionRange?: string | null;
  readonly verifiedOn?: string | null;
}): boolean {
  return (
    entry.origin === TESTED_ORIGIN &&
    typeof entry.versionRange === "string" &&
    entry.versionRange.length > 0 &&
    typeof entry.verifiedOn === "string" &&
    entry.verifiedOn.length > 0
  );
}

/** The rules an unverified harness runs under (F109-FR-013). */
export type UnverifiedRules = {
  readonly tested: boolean;
  /** `null` where the harness is unverified: it has no version pin. */
  readonly pin: string | null;
  readonly allowedTiers: readonly number[];
  readonly allowedProvenance: readonly string[];
};

/** Read the rules that apply to one entry. */
export function unverifiedRules(entry: {
  readonly origin?: string | null;
  readonly versionRange?: string | null;
  readonly verifiedOn?: string | null;
  readonly pin?: string | null;
}): UnverifiedRules {
  const tested = isTestedHarnessAdapter(entry);
  return {
    tested,
    pin: tested ? (entry.pin ?? entry.versionRange ?? null) : null,
    allowedTiers: UNVERIFIED_ALLOWED_TIERS,
    allowedProvenance: tested
      ? ["declared", "probed", "adapter", "catalogue"]
      : UNVERIFIED_ALLOWED_PROVENANCE,
  };
}

/** The refusal of a descriptor that names auth tier 3 (F109-FR-013). */
export type AuthTierFinding = {
  readonly reason: string;
  readonly refused: true;
};

/**
 * F109-FR-013 — auth tier 3 is never valid. Returns the refusal finding, or
 * `null` where the tiers are valid (1, 2, both, or an empty list).
 */
export function checkAuthTiers(
  tiers: readonly unknown[] | undefined | null,
): AuthTierFinding | null {
  if (tiers === undefined || tiers === null) {
    return null;
  }
  if (!Array.isArray(tiers)) {
    return { refused: true, reason: "`auth.tiers` is not a list" };
  }
  for (const tier of tiers) {
    if (!Number.isInteger(tier) || (tier as number) < 1 || (tier as number) > 3) {
      return {
        refused: true,
        reason: `auth tier ${JSON.stringify(tier)} is not a whole number in 1 to 3`,
      };
    }
    if (tier === 3) {
      return {
        refused: true,
        reason:
          "auth tier 3 is not a valid value of a descriptor or of a registry entry (F109-FR-013)",
      };
    }
  }
  return null;
}
