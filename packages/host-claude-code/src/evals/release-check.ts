/**
 * T035 — the release check of the trigger suite, F113-FR-038 (implemented
 * together with T028, which first exercised it).
 *
 * The suite is a release check and NO check of a change: a release MUST NOT be
 * made unless the log holds a run on the skill texts of that release, matched
 * by their hash, in which every skill reached the threshold 0.8 over three
 * runs without ablation. The release check READS the log and calls NO model.
 *
 * The threshold of 0.8 and the three runs are the requirement's own numbers;
 * no ablation exists anywhere in this feature.
 */
import type { PaidRunRecord, SkillResult } from "./log.ts";
import { isPaidRunRecord } from "./log.ts";

/** The threshold of F113-FR-038. */
export const RELEASE_THRESHOLD = 0.8 as const;

/** The number of runs the requirement pins. */
export const REQUIRED_RUNS = 3 as const;

/** The verdict of the release check. */
export type ReleaseVerdict = {
  readonly passed: boolean;
  readonly reason: string;
};

/** True where a recorded run was made WITH an ablation, which never passes. */
export function runUsedAblation(record: PaidRunRecord): boolean {
  // No ablation exists in this feature; a record that carries `ablation: true`
  // records one, and the check fails it. Anything else is without ablation.
  return (record as { ablation?: unknown }).ablation === true;
}

function skillScores(results: readonly SkillResult[]): readonly { skill: string; low: boolean }[] {
  return results
    .filter((result) => result.scored)
    .map((result) => ({
      skill: result.skill,
      low:
        result.scores.length < REQUIRED_RUNS ||
        result.scores.some((score) => score < RELEASE_THRESHOLD),
    }));
}

/**
 * The release check. `skillTextsHash` is the hash of the skill texts of the
 * release that asks; it is matched against `skillTextsHash` of each recorded
 * run. Reads records only — it makes no call of any kind.
 */
export function releaseCheck(
  log: readonly unknown[],
  options: { readonly skillTextsHash: string },
): ReleaseVerdict {
  const records = log.filter(isPaidRunRecord).filter(
    // The trigger suite is the task the release check reads (F113-FR-038).
    (record) => record.task === "trigger-suite",
  );
  const matching = records.filter((record) => record.skillTextsHash === options.skillTextsHash);
  if (records.length === 0) {
    return {
      passed: false,
      reason: "the log holds no run of the trigger suite: no release (F113-FR-038)",
    };
  }
  if (matching.length === 0) {
    return {
      passed: false,
      reason:
        "the log holds no run on the skill texts of this release: no hash in the log matches " +
        `${options.skillTextsHash} (F113-FR-038)`,
    };
  }
  for (const record of matching) {
    if (runUsedAblation(record)) {
      return { passed: false, reason: `the run of ${record.date} used an ablation (F113-FR-038)` };
    }
    const low = skillScores(record.resultPerSkill).filter((entry) => entry.low);
    if (low.length > 0) {
      return {
        passed: false,
        reason:
          `the run of ${record.date} does not reach the threshold ${RELEASE_THRESHOLD} over ` +
          `${REQUIRED_RUNS} runs for: ${low.map((entry) => entry.skill).join(", ")} (F113-FR-038)`,
      };
    }
  }
  return {
    passed: true,
    reason:
      `the log holds ${matching.length} run(s) on this release's skill texts, every skill at ` +
      `the threshold ${RELEASE_THRESHOLD} over ${REQUIRED_RUNS} runs, without ablation`,
  };
}

/** True where the release check would call a model: never. */
export function releaseCheckCallsAModel(): boolean {
  return false;
}
