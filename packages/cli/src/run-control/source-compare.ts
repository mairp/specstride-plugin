/**
 * T007 — the comparison of the source hashes (F102-FR-015, F102-FR-017;
 * annex X §X.5).
 *
 * At `resume`, and at a `launch` that continues an unfinished run, the CLI
 * compares the hashes of the spec, the plan and the task list with the run
 * snapshot. Every hash comes from the CANONICAL HASHER of the kernel
 * (`@specstride/kernel/hasher`, the one implementation of feature 100's
 * `CanonicalHasher`, F100-FR-207): no feature compares hashes itself
 * (F104-FR-027). The classification of the comparison is the hasher's too —
 * `classifyStaleness`, whose rules are feature 104's (CQ-214).
 *
 * For the task list the hash that IGNORES CHECKBOXES is the one compared
 * (F102-FR-017, research D-5): the runtime ticks tasks after an approval, so
 * a tick — and only a tick — must never refuse a resume. The classifier
 * reports that case as `ticks-only`, and this module counts it as unchanged.
 *
 * A change of the content of any of the three, a file that DISAPPEARED
 * (unreadable; the classifier says `unreadable`) or one that APPEARED where
 * the snapshot holds none, refuses the command with exit 3 and the refusal
 * names EVERY changed file (F102-FR-015). The check runs after the checks of
 * F102-FR-012 and F102-FR-013 (order 4 of refusals.ts) and is not raised
 * under the `parity` profile (F102-FR-018).
 */
import { readFileSync } from "node:fs";
import {
  canonicalHasher,
  classifyStaleness,
  taskListHashIgnoringCheckboxesOfBytes,
} from "@specstride/kernel";
import type { SourceReading, StalenessClassification } from "@specstride/contracts/ep/hasher";
import { PROFILE_NAME, rowOfKey } from "@specstride/contracts/profile/parity";
import { COMPARED_SOURCES, type ComparedSource } from "./refusals.ts";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F102-FR-015", "F102-FR-017"] as const;

/* ------------------------------------------------------------------ *
 * T038 — the switch `staleness.check_points` and the `parity` profile
 * (F102-FR-018; row 15 of annex X §X.7).
 * ------------------------------------------------------------------ */

/** The configuration key of the switch (row 15 of annex X §X.7). */
export const STALENESS_CHECK_POINTS_SWITCH = "staleness.check_points" as const;

/** The default of the switch: the check runs at these three check points. */
export const DEFAULT_CHECK_POINTS: readonly string[] = Object.freeze([
  "launch",
  "resume",
  "pass-start",
]);

/** The check point where the plan is checked under the `parity` profile. */
export const PARITY_CHECK_POINT = "critic-start" as const;

/**
 * The check points in force for a profile, read from the row of the annex
 * (`rowOfKey`, F100-FR-210): under `parity` the value of the row is "critic
 * start only", so NEITHER check point of `resume` nor of a continuing launch
 * is active and the plan is checked when the critic starts, as at the
 * baseline (F102-FR-018).
 */
export function checkPointsOf(profile?: string | undefined): readonly string[] {
  if (profile !== PROFILE_NAME) return DEFAULT_CHECK_POINTS;
  const row = rowOfKey(STALENESS_CHECK_POINTS_SWITCH);
  return row !== undefined && /critic start/i.test(row.parity)
    ? Object.freeze([PARITY_CHECK_POINT])
    : DEFAULT_CHECK_POINTS;
}

/**
 * F102-FR-018 — true when the staleness check runs at the check point, for
 * the profile in force. `resume` and a continuing `launch` ask for their own
 * check points; under `parity` both answers are `false`.
 */
export function checkPointActive(
  point: "launch" | "resume",
  profile?: string | undefined,
): boolean {
  return checkPointsOf(profile).includes(point);
}

/** Every hash of this module comes from the canonical hasher (F100-FR-207). */
export const HASHES_FROM_THE_CANONICAL_HASHER = true as const;

/** The hash compared for the task list ignores checkboxes (F102-FR-017). */
export const TASKS_HASH_IGNORES_CHECKBOXES = true as const;

/** One source hash as the snapshot records it (annex B §B.12). */
export type RecordedSourceHash = {
  /** Logical path of the file, as recorded at launch. */
  readonly path?: string | undefined;
  /** The content hash recorded at launch, or absent where it was unreadable. */
  readonly contentHash?: string | undefined;
  /** For `tasks`: the hash that ignores checkboxes, recorded at launch. */
  readonly hashIgnoringCheckboxes?: string | undefined;
};

/** One source hash as this module computes it NOW. */
export type CurrentSourceHash = {
  /** The content hash now, or `undefined` where the file cannot be read. */
  readonly contentHash?: string | undefined;
  /** For `tasks`: the hash that ignores checkboxes now. */
  readonly hashIgnoringCheckboxes?: string | undefined;
};

/** Hash ONE source file with the canonical hasher. */
export function hashSourceContent(source: ComparedSource, bytes: Uint8Array): CurrentSourceHash {
  if (source === "tasks") {
    return {
      contentHash: canonicalHasher.contentHash(bytes),
      hashIgnoringCheckboxes: taskListHashOfBytes(bytes),
    };
  }
  return { contentHash: canonicalHasher.contentHash(bytes) };
}

/** The task-list hash that ignores checkboxes, over bytes (F104-FR-022). */
function taskListHashOfBytes(bytes: Uint8Array): string | undefined {
  return taskListHashIgnoringCheckboxesOfBytes(bytes);
}

/** Read ONE source file and hash it; an unreadable or missing file has NO hash. */
export function hashSourceFile(source: ComparedSource, path: string): CurrentSourceHash {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(path);
  } catch {
    return {};
  }
  return hashSourceContent(source, bytes);
}

/** Hash all three compared sources from their paths. */
export function currentSourceHashes(paths: {
  readonly spec: string;
  readonly plan: string;
  readonly tasks: string;
}): Readonly<Record<ComparedSource, CurrentSourceHash>> {
  return Object.freeze({
    spec: hashSourceFile("spec", paths.spec),
    plan: hashSourceFile("plan", paths.plan),
    tasks: hashSourceFile("tasks", paths.tasks),
  });
}

/** One reading of one source, in the shape the classifier takes. */
function readingOf(
  source: ComparedSource,
  recorded: RecordedSourceHash | undefined,
  current: CurrentSourceHash,
): SourceReading {
  return {
    logicalName: source,
    repositoryPath: recorded?.path ?? source,
    recordedHash: recorded?.contentHash ?? "",
    ...(source === "tasks" && recorded?.hashIgnoringCheckboxes !== undefined
      ? { recordedHashIgnoringCheckboxes: recorded.hashIgnoringCheckboxes }
      : {}),
    hashNow: current.contentHash,
    ...(source === "tasks" && current.hashIgnoringCheckboxes !== undefined
      ? { hashNowIgnoringCheckboxes: current.hashIgnoringCheckboxes }
      : {}),
  };
}

/** What the comparison reports to the caller of `resume` / a continuing launch. */
export type SourceCompareResult = {
  /** The state of each of the three sources, as the classifier gave it. */
  readonly states: Readonly<Record<string, string>>;
  /** The verdict of the classifier over all three: `fresh` or `stale`. */
  readonly verdict: "fresh" | "stale";
  /**
   * EVERY source the refusal must name (F102-FR-015): a changed file, and a
   * file that disappeared (unreadable) or appeared where the snapshot held
   * none. A `ticks-only` task list is NOT here (F102-FR-017).
   */
  readonly changed: readonly ComparedSource[];
  /** Sources whose only difference is a tick of a checkbox. */
  readonly ticksOnly: readonly ComparedSource[];
  /** The line the refusal prints, naming every changed file. */
  readonly message: string;
};

/**
 * Compare the recorded hashes of the snapshot with the hashes now, through
 * the classifier of the canonical hasher (F102-FR-015, F102-FR-017).
 *
 * A source the snapshot recorded with NO hash (it was unreadable at launch)
 * and that now HAS one counts as changed too: the file appeared. The
 * comparison itself is pure — the caller reads the files with
 * `currentSourceHashes` and hands the hashes over.
 */
export function compareSourceHashes(
  recorded: Readonly<Record<string, RecordedSourceHash | undefined>>,
  current: Readonly<Record<ComparedSource, CurrentSourceHash>>,
): SourceCompareResult {
  const readings: SourceReading[] = COMPARED_SOURCES.map((source) =>
    readingOf(source, recorded[source], current[source] ?? {}),
  );
  const classification: StalenessClassification = classifyStaleness(readings);
  const changed: ComparedSource[] = [];
  const ticksOnly: ComparedSource[] = [];
  for (const source of COMPARED_SOURCES) {
    const state = classification.sources[source];
    if (state === "ticks-only") {
      ticksOnly.push(source);
      continue;
    }
    if (state === "changed" || state === "unreadable") changed.push(source);
  }
  const names = changed.length > 0 ? changed.join(", ") : "";
  return Object.freeze({
    states: classification.sources,
    verdict: classification.verdict,
    changed,
    ticksOnly,
    message:
      changed.length > 0
        ? `refused resume: the source changed (${names}); ` +
          `revert the change, or resume --accept-source-change, or launch --new-run`
        : "",
  });
}

/** True when the comparison refuses the command (F102-FR-015). */
export function isRefused(result: SourceCompareResult): boolean {
  return result.changed.length > 0;
}
