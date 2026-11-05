/**
 * T037 — `resume --accept-source-change`, the CLI side (F102-FR-019).
 *
 * With the flag the consumer accepts an intended change of the spec, the
 * plan or the task list. The CLI then:
 *
 * 1. computes the changed files against the run snapshot (the comparison of
 *    `source-compare.ts`, through the canonical hasher);
 * 2. derives the verification plan and the check manifest AGAIN through
 *    EP-07, the verification-plan source `specstride.verification-source/1`
 *    (annex C §C.9) — the plan is frozen at launch and bound to the hashes
 *    of its sources, so an accepted change unfreezes exactly the derivation,
 *    never the counts and never the phase evidence already delivered;
 * 3. writes `acceptedChanges` — the old hash, the new hash, the file and the
 *    time of the acceptance for every changed file — and the new source
 *    hashes into the run snapshot, BEFORE the engine starts, as the writer
 *    of `snapshot-writer.ts` writes the snapshot at launch (F102-FR-019,
 *    F102-FR-025).
 *
 * With the flag and NO changed source the command behaves as a plain
 * `resume` and records NO accepted change (F102-FR-019).
 *
 * The counts live in the ledger, not in the snapshot: rewriting the snapshot
 * touches no ledger record, so the counts and the phase evidence of phases
 * already delivered stay (F102-FR-019; the reader of the counts is
 * `packages/core/src/run-control/counts.ts`).
 */
import { POINT_ID } from "@specstride/contracts/ep/verification-source";
import type { VerificationSource } from "@specstride/contracts/ep/verification-source";
import { COMPARED_SOURCES, type ComparedSource } from "./refusals.ts";
import {
  compareSourceHashes,
  currentSourceHashes,
  type CurrentSourceHash,
  type RecordedSourceHash,
} from "./source-compare.ts";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F102-FR-019"] as const;

/** The extension point the plan and the manifest are derived through again. */
export const EP = "EP-07" as const;

/** The id of that extension point (annex C §C.9). */
export const VERIFICATION_SOURCE_POINT_ID = POINT_ID;

/**
 * F102-FR-019 — with the flag and no changed source: a plain `resume`, and
 * no accepted change is recorded.
 */
export const NOTHING_CHANGED_BEHAVIOUR = "a plain resume; no accepted change is recorded" as const;

/** F102-FR-019 — the flag, as the consumer types it. */
export const FLAG = "--accept-source-change" as const;

/** One accepted change, as `acceptedChanges` of the snapshot holds it. */
export type AcceptedChange = {
  /** Which of the three sources was accepted (`spec`, `plan` or `tasks`). */
  readonly file: ComparedSource;
  /** The logical name of the source, as `blocked` writes it — never a path. */
  readonly changedRef: string;
  /** The hash recorded at launch (empty where the file was unreadable then). */
  readonly oldHash: string;
  /** The hash of the content now. */
  readonly newHash: string;
  /** The time of the acceptance, ISO 8601 UTC — the caller's clock. */
  readonly acceptedAt: string;
};

/** The logical name of one source of a feature, as `blocked` writes it. */
export function changedRefOf(featureId: string, file: ComparedSource): string {
  return `feature:${featureId}:${file}`;
}

/**
 * The accepted changes for the files the comparison found changed
 * (F102-FR-019): one entry with the old hash, the new hash, the file and the
 * time for each. A file the classifier counted as `ticks-only` is not here —
 * it refuses nothing and nothing is accepted for it.
 */
export function acceptedChangesOf(input: {
  readonly featureId: string;
  readonly acceptedAt: string;
  readonly recorded: Readonly<Record<string, RecordedSourceHash | undefined>>;
  readonly current: Readonly<Record<ComparedSource, CurrentSourceHash>>;
}): readonly AcceptedChange[] {
  const comparison = compareSourceHashes(input.recorded, input.current);
  return comparison.changed.map((file) => {
    const recorded = input.recorded[file];
    const current = input.current[file];
    return Object.freeze({
      file,
      changedRef: changedRefOf(input.featureId, file),
      oldHash: recorded?.contentHash ?? "",
      newHash: current?.contentHash ?? "",
      acceptedAt: input.acceptedAt,
    });
  });
}

/**
 * Compare the recorded hashes with the files as they stand NOW at the given
 * paths, and return the accepted changes for what changed. The one call the
 * `resume` path makes before the engine starts.
 */
export function acceptedChangesFromPaths(input: {
  readonly featureId: string;
  readonly acceptedAt: string;
  readonly recorded: Readonly<Record<string, RecordedSourceHash | undefined>>;
  readonly sourcePaths: { readonly spec: string; readonly plan: string; readonly tasks: string };
}): {
  readonly changed: readonly ComparedSource[];
  readonly acceptedChanges: readonly AcceptedChange[];
} {
  const current = currentSourceHashes(input.sourcePaths);
  const acceptedChanges = acceptedChangesOf({
    featureId: input.featureId,
    acceptedAt: input.acceptedAt,
    recorded: input.recorded,
    current,
  });
  return Object.freeze({
    changed: acceptedChanges.map((change) => change.file),
    acceptedChanges,
  });
}

/**
 * F102-FR-019 — derive the verification plan and the check manifest AGAIN
 * through EP-07. The plan is the `discover` answer of the source with its
 * obligations (`obligations`) and its conflicts resolved; the manifest is the
 * command list the plan freezes. A source invents nothing: the commands are
 * the ones the project declares (annex C §C.9).
 */
export async function deriveVerificationArtifactsAgain(input: {
  readonly workspace: string;
  readonly source: VerificationSource;
  readonly model: unknown;
  /** The results of every source of the registry, for the conflict check. */
  readonly resultsOfEverySource?: readonly (readonly import("@specstride/contracts/ep/verification-source").DeclaredCommand[])[];
}): Promise<{
  readonly verificationPlan: readonly import("@specstride/contracts/ep/verification-source").DeclaredCommand[];
  readonly checkManifest: readonly import("@specstride/contracts/ep/verification-source").DeclaredCommand[];
}> {
  const verificationPlan = await input.source.discover(input.workspace, input.model);
  await input.source.obligations(input.model);
  input.source.conflicts(input.resultsOfEverySource ?? [verificationPlan]);
  return Object.freeze({
    // The check manifest is the plan's command list, derived again — the
    // same commands the frozen manifest of the launch held, re-derived from
    // the declarations as they stand after the accepted change.
    verificationPlan,
    checkManifest: verificationPlan,
  });
}

/**
 * F102-FR-019 — the new source hashes the snapshot is rewritten with: for
 * every compared source the hash as it stands now (for `tasks` both the
 * content hash and the hash that ignores checkboxes).
 */
export function newSourceHashesOf(
  current: Readonly<Record<ComparedSource, CurrentSourceHash>>,
): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const source of COMPARED_SOURCES) {
    out[source] = current[source] ?? {};
  }
  return Object.freeze(out);
}
