/**
 * T097 — the comparison of the manifest on a relaunch and on a `resume`
 * (F105-FR-021).
 *
 * On a relaunch, and on a `resume`, of a feature that has a STORED manifest,
 * the manifest derived anew is compared with the stored one. A command that
 * was removed or changed is announced at launch and recorded, THE STORED
 * MANIFEST APPLIES, and the fact is contributed to the fact block of every
 * critic call of the run, as the member "a check manifest that a relaunch
 * derived differently" of the further facts.
 *
 * Where `resume` accepts an INTENDED change of a source (feature 100, annex G,
 * F100-FR-173), this feature derives the plan and the manifests again and
 * stores them in place of the old ones — which is the one case in which the
 * stored manifest does NOT apply.
 */
import { STORED_MANIFEST_APPLIES_ON_A_DIFFERENCE } from "@specstride/contracts/ep/verification-source";
import { canonicalRecordText } from "@specstride/kernel/hasher";
import type { CheckManifest, ManifestEntry } from "@specstride/contracts/records/check-manifest";
import { manifestHashOf } from "./derive.ts";

/** The stored manifest applies on a difference (F105-FR-021, §C.9). */
export const STORED_APPLIES = STORED_MANIFEST_APPLIES_ON_A_DIFFERENCE;

/**
 * The member of the further facts of the fact block this comparison
 * contributes (F105-FR-021; feature 100, annex D §D.7).
 */
export const FACT_MEMBER = "a check manifest that a relaunch derived differently" as const;

/** The two occasions on which the comparison is made (F105-FR-021). */
export const OCCASIONS = ["relaunch", "resume"] as const;
export type Occasion = (typeof OCCASIONS)[number];

/** How one entry differs (F105-FR-021). */
export const DIFFERENCE_KINDS = ["removed", "changed", "added"] as const;
export type DifferenceKind = (typeof DIFFERENCE_KINDS)[number];

/** One difference between the stored manifest and the derived one. */
export type ManifestDifference = {
  readonly kind: DifferenceKind;
  readonly commandId: string;
  /** The canonical text of the stored entry, where there is one. */
  readonly stored?: string;
  /** The canonical text of the derived entry, where there is one. */
  readonly derived?: string;
};

/** The result of the comparison (F105-FR-021). */
export type ManifestComparison = {
  readonly phase: number;
  readonly same: boolean;
  readonly differences: readonly ManifestDifference[];
  /** The manifest that APPLIES: the stored one on a difference. */
  readonly applies: CheckManifest;
  /** The line the launch announces, or `undefined` where nothing differs. */
  readonly announcement?: string;
  /** The fact for every critic call of the run, where something differs. */
  readonly fact?: { readonly member: typeof FACT_MEMBER; readonly detail: string };
};

/** The canonical text of one entry, which is what the comparison compares. */
export function textOfEntry(entry: ManifestEntry): string {
  return canonicalRecordText(entry);
}

/** The line a launch announces for a manifest that differs (F105-FR-021). */
export function announcementOf(input: {
  readonly phase: number;
  readonly differences: readonly ManifestDifference[];
}): string {
  const removed = input.differences
    .filter((one) => one.kind === "removed")
    .map((one) => one.commandId);
  const changed = input.differences
    .filter((one) => one.kind === "changed")
    .map((one) => one.commandId);
  const added = input.differences.filter((one) => one.kind === "added").map((one) => one.commandId);
  const parts: string[] = [];
  if (removed.length > 0) parts.push(`removed ${removed.join(", ")}`);
  if (changed.length > 0) parts.push(`changed ${changed.join(", ")}`);
  if (added.length > 0) parts.push(`added ${added.join(", ")}`);
  return (
    `the check manifest of phase ${input.phase} was derived differently ` +
    `(${parts.join("; ")}); the stored manifest applies`
  );
}

/**
 * Compare a manifest derived anew with the stored one (F105-FR-021). The
 * manifest that APPLIES is the stored one whenever anything differs; with
 * `intendedChange` — a `resume` that accepted a change of a source
 * (F100-FR-173) — the DERIVED one applies and replaces the stored one.
 */
export function compareManifest(input: {
  readonly stored: CheckManifest;
  readonly derived: CheckManifest;
  readonly occasion?: Occasion | undefined;
  /** True where `resume` accepted an intended change of a source. */
  readonly intendedChange?: boolean | undefined;
}): ManifestComparison {
  const storedById = new Map(input.stored.entries.map((entry) => [entry.id, entry]));
  const derivedById = new Map(input.derived.entries.map((entry) => [entry.id, entry]));
  const differences: ManifestDifference[] = [];
  for (const entry of input.stored.entries) {
    const now = derivedById.get(entry.id);
    if (now === undefined) {
      differences.push(
        Object.freeze({
          kind: "removed" as const,
          commandId: entry.id,
          stored: textOfEntry(entry),
        }),
      );
      continue;
    }
    const before = textOfEntry(entry);
    const after = textOfEntry(now);
    if (before !== after) {
      differences.push(
        Object.freeze({
          kind: "changed" as const,
          commandId: entry.id,
          stored: before,
          derived: after,
        }),
      );
    }
  }
  for (const entry of input.derived.entries) {
    if (storedById.has(entry.id)) continue;
    differences.push(
      Object.freeze({ kind: "added" as const, commandId: entry.id, derived: textOfEntry(entry) }),
    );
  }
  const same = differences.length === 0;
  const applies = same || input.intendedChange === true ? input.derived : input.stored;
  if (same) {
    return Object.freeze({
      phase: input.stored.phase,
      same: true,
      differences: Object.freeze([]),
      applies,
    });
  }
  const announcement = announcementOf({ phase: input.stored.phase, differences });
  return Object.freeze({
    phase: input.stored.phase,
    same: false,
    differences: Object.freeze(differences),
    applies,
    announcement,
    fact: Object.freeze({ member: FACT_MEMBER, detail: announcement }),
  });
}

/**
 * The manifests `resume` stores in place of the old ones where it accepted an
 * intended change of a source (F105-FR-021, F100-FR-173): the derived ones,
 * each with its own hash recomputed, so a stored manifest is never written
 * with the hash of another record.
 */
export function manifestsAfterAnIntendedChange(
  derived: readonly CheckManifest[],
): readonly CheckManifest[] {
  return Object.freeze(
    derived.map((manifest) => {
      const record: Record<string, unknown> = {
        ...(manifest as unknown as Record<string, unknown>),
      };
      delete record["hash"];
      return Object.freeze({ ...record, hash: manifestHashOf(record) }) as unknown as CheckManifest;
    }),
  );
}

/** The comparison of every phase that has a stored manifest (F105-FR-021). */
export function compareEveryManifest(input: {
  readonly stored: readonly CheckManifest[];
  readonly derived: readonly CheckManifest[];
  readonly occasion?: Occasion | undefined;
  readonly intendedChange?: boolean | undefined;
}): readonly ManifestComparison[] {
  const derivedByPhase = new Map(input.derived.map((manifest) => [manifest.phase, manifest]));
  return Object.freeze(
    input.stored.flatMap((stored) => {
      const derived = derivedByPhase.get(stored.phase);
      if (derived === undefined) return [];
      return [
        compareManifest({
          stored,
          derived,
          ...(input.occasion !== undefined ? { occasion: input.occasion } : {}),
          ...(input.intendedChange !== undefined ? { intendedChange: input.intendedChange } : {}),
        }),
      ];
    }),
  );
}

/** The facts of every comparison that found a difference (F105-FR-021). */
export function factsOf(
  comparisons: readonly ManifestComparison[],
): readonly { readonly member: typeof FACT_MEMBER; readonly detail: string }[] {
  return Object.freeze(comparisons.flatMap((one) => (one.fact === undefined ? [] : [one.fact])));
}
