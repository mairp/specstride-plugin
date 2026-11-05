/**
 * T038 — the one continuation module that `launch`, `run` and `resume` call
 * (F102-FR-034), and the `parity` wiring of its source check (F102-FR-018).
 *
 * A launch continues the unfinished run of the same feature, with its
 * `runId`, its snapshot and its counts; a new run starts only when no
 * unfinished run of the feature exists or when the consumer passes
 * `--new-run` (F102-FR-034). The records of the old run stay. The check of
 * F102-FR-015 at a CONTINUING launch is one of the two check points of the
 * switch `staleness.check_points` (`launch`): under the `parity` profile the
 * value of the row is "critic start only", so NEITHER check point — the
 * continuing launch here, `resume` in `source-compare.ts` — is active and
 * the plan is checked when the critic starts, as at the baseline
 * (F102-FR-018).
 *
 * The line: a continuing launch says so in one line, `[SPECSTRIDE-CONTINUE]`
 * with the keys `run` and `counts` (`carried` or `reset`); under the
 * `parity` profile the line MUST NOT be printed (F102-FR-034). A new run
 * prints no such line.
 */
import { randomUUID } from "node:crypto";

import { PROFILE_NAME } from "@specstride/contracts/profile/parity";
import { rankOfKeyOnResume } from "./snapshot-writer.ts";
import { checkPointActive } from "./source-compare.ts";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F102-FR-015", "F102-FR-018", "F102-FR-034"] as const;

/**
 * F102-FR-034 — the one module that `launch`, `run` and `resume` call. The
 * commands `launch` and `run` belong to feature 100 (annex G §G.1, rows
 * `launch` and `run`; CQ-076): the call sites of this module are named here
 * so that the wiring of those two commands is feature 100's to land on this
 * module, and none of the three commands can drift from the others.
 */
export const CALL_SITES = Object.freeze({
  launch:
    "feature 100 (annex G §G.1, row `launch`; the check of F102-FR-015 at a continuing launch)",
  run: "feature 100 (annex G §G.1, row `run`; CQ-076 — `run` follows the same rule as `launch`)",
  resume: "this feature (packages/cli/src/commands/resume.ts)",
});

/**
 * CQ-075, annex X §X.2 — a launch that continues a run takes the snapshot
 * into account AS `resume` does: every key keeps the rank it has at `resume`
 * (`rankOfKeyOnResume`), the pin of the launch contract above every flag and
 * both classes, `pinned` below flags and above the environment, `tunable`
 * below the environment and above project configuration.
 */
export const snapshotRankAtContinuingLaunch = rankOfKeyOnResume;

/** The prefix of the continuation line (annex G §G.1). */
export const CONTINUE_LINE_PREFIX = "[SPECSTRIDE-CONTINUE]" as const;

/** What the module decided for one launch. */
export type ContinuationDecision = {
  /** True when the launch starts a NEW run (`--new-run`, or nothing to continue). */
  readonly newRun: boolean;
  /** The run continued, when the launch continues one. */
  readonly runId: string | null;
  /** True when the launch must run the source check of F102-FR-015. */
  readonly sourceCheckRequired: boolean;
  /** The continuation line, or `null` for a new run or under `parity`. */
  readonly line: string | null;
};

/** The unfinished run the selection found, or `null`. */
export type ContinuationSelection = {
  readonly runId: string;
  /** The state of the run record: a finished run is never continued. */
  readonly state: string;
} | null;

/**
 * F102-FR-034 — decide the continuation for one launch of `launch`, `run` or
 * `resume`. `newRunFlag` is `--new-run`; `resetCounts` is `--reset-counts`.
 * The source check of F102-FR-015 is asked of
 * `checkPointActive("launch", profile)`: under `parity` it is not active
 * (F102-FR-018), and the line is not printed either (F102-FR-034).
 */
export function decideContinuation(input: {
  readonly selection: ContinuationSelection;
  readonly newRunFlag?: boolean | undefined;
  readonly resetCounts?: boolean | undefined;
  readonly profile?: string | undefined;
}): ContinuationDecision {
  const canContinue =
    input.newRunFlag !== true && input.selection !== null && input.selection.state !== "finished";
  if (!canContinue) {
    return Object.freeze({
      newRun: true,
      runId: null,
      sourceCheckRequired: false,
      line: null,
    });
  }
  const runId = input.selection!.runId;
  const profileIsParity = input.profile === PROFILE_NAME;
  return Object.freeze({
    newRun: false,
    runId,
    sourceCheckRequired: checkPointActive("launch", input.profile),
    line: profileIsParity
      ? null
      : `${CONTINUE_LINE_PREFIX} run=${runId} counts=${input.resetCounts === true ? "reset" : "carried"}`,
  });
}

/**
 * F102-FR-021 — a run that ended blocked on `source-changed`, whichever
 * process found it, is left ONLY by `resume --accept-source-change`, by a
 * `resume` after the change was reverted, or by a `launch` with `--new-run`.
 * True when the launch of a run resting in `blocked-on-human` may go on.
 */
export function blockedRunMayBeContinued(input: {
  readonly state: string;
  readonly acceptSourceChange?: boolean | undefined;
  readonly newRunFlag?: boolean | undefined;
}): boolean {
  if (input.state !== "blocked-on-human") return true;
  return input.acceptSourceChange === true || input.newRunFlag === true;
}

/* ------------------------------------------------------------------ *
 * T052 — the selection of the unfinished run, and `--new-run`.
 * ------------------------------------------------------------------ */

/** The states a launch may continue; a finished run is never continued. */
export const UNFINISHED_STATES = [
  "created",
  "starting",
  "running",
  "paused-quota",
  "relaunching",
  "stopping",
  "blocked-on-human",
  "stopped",
  "failed",
  "dead",
] as const;

/** One run of the workspace, as the reader of the run records gives it. */
export type RunCandidate = {
  readonly runId: string;
  readonly feature: string;
  readonly state: string;
  /** When the run was launched; the latest of the feature wins the selection. */
  readonly launchedAt?: string | undefined;
};

/**
 * F102-FR-034 — select THE unfinished run of the feature: the latest launch
 * of the feature whose run is not `finished`. `featureSlug` absent selects
 * the latest unfinished run of any feature. Nothing unfinished → `null`,
 * and the launch starts a new run.
 */
export function selectUnfinishedRun(
  candidates: readonly RunCandidate[],
  featureSlug?: string | undefined,
): ContinuationSelection {
  const ofFeature = candidates.filter(
    (c) =>
      (featureSlug === undefined || c.feature === featureSlug) &&
      c.state !== "finished" &&
      (UNFINISHED_STATES as readonly string[]).includes(c.state),
  );
  if (ofFeature.length === 0) return null;
  const latest = [...ofFeature].sort((a, b) =>
    String(a.launchedAt ?? "").localeCompare(String(b.launchedAt ?? "")),
  )[ofFeature.length - 1]!;
  return Object.freeze({ runId: latest.runId, state: latest.state });
}

/**
 * F102-FR-034 — `--new-run`: a new run gets a new `runId`, a snapshot and
 * counts of its own, and the records of the old run MUST stay. The id is
 * generated by the injected maker (the caller's clock and entropy); this
 * module writes no record — it returns the decision.
 */
export const OLD_RECORDS_OF_A_NEW_RUN_STAY = true as const;

export function newRunIdOf(make: () => string = randomUUID): string {
  return make();
}

/**
 * F102-FR-015 — the hash check at a CONTINUING launch compares the three
 * sources against the snapshot of the run continued, exactly as `resume`
 * does (the same canonical hasher, the task list without its checkboxes).
 * A difference refuses the launch (F102-FR-015); under the `parity` profile
 * the check point is not active at all (F102-FR-018).
 */
export const THE_HASH_CHECK_AT_A_CONTINUING_LAUNCH = "F102-FR-015 as at resume" as const;
