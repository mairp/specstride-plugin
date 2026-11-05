/**
 * T046 of feature 101 — the approval commit (F101-FR-035), with the SCAN
 * BEFORE THE COMMIT (F100-FR-206).
 *
 * The commit is made in the PROJECT's repository and only when all three hold
 * (B-0276):
 *
 *  1. commits are set to the as-is value that enables them (`auto`, B-0050);
 *  2. the working directory lies inside a work tree of a repository;
 *  3. the tree has changes.
 *
 * It stages EVERY change of the working tree and commits with the as-is
 * message, which holds the phase number and the title of the phase, or the
 * word for the phase with its number where no title exists (B-0278). It never
 * creates a repository and never pushes.
 *
 * A commit that FAILS is ignored WITHOUT a log line and WITHOUT an event
 * (B-0278). A commit that WORKED emits the as-is event with the phase (B-0088,
 * written only then) and writes the as-is line (B-0205).
 *
 * The engine starts no process itself, so the two calls of the version-control
 * tool are FIXED-ARGV calls through the check-runner port (EP-05, annex C
 * §C.8; F100-FR-012, F100-FR-234).
 */
import type { PreCommitScan, PreCommitScanResult } from "@specstride/contracts/ep/redactor";
import { gitCheckpoint } from "../gate/lines.ts";

/** B-0050 — the as-is value of the switch that ENABLES the approval commit. */
export const AS_IS_VALUE_THAT_ENABLES_COMMITS = "auto" as const;

/** B-0050 — any other value disables them. */
export function commitsAreEnabled(configured: string | undefined): boolean {
  return configured === AS_IS_VALUE_THAT_ENABLES_COMMITS;
}

/** F101-FR-035 — the three conditions, in the order B-0276 checks them. */
export const CONDITIONS_OF_THE_APPROVAL_COMMIT = Object.freeze([
  "commits are set to the as-is value that enables them",
  "the working directory lies inside a work tree of a repository",
  "the tree has changes",
]);

/** F101-FR-035 — the feature never creates a repository. */
export const CREATES_A_REPOSITORY = false as const;

/** F101-FR-035 — and never pushes. */
export const PUSHES = false as const;

/** F101-FR-035 — no other commit, revert, reset or clean is made by this feature. */
export const OTHER_OPERATIONS_OF_THE_VERSION_CONTROL_TOOL: readonly string[] = Object.freeze([]);

/** B-0278 — a commit that fails is ignored with no log line and no event. */
export const A_FAILED_COMMIT_IS_LOGGED = false as const;
export const A_FAILED_COMMIT_RAISES_AN_EVENT = false as const;

/** B-0088 — the event is written ONLY when the commit worked. */
export const THE_EVENT_IS_WRITTEN_ONLY_WHEN_THE_COMMIT_WORKED = true as const;

/** The two fixed-argv calls of the version-control tool (B-0278). */
export const STAGE_ARGV = Object.freeze(["git", "add", "-A"]);
export function commitArgv(message: string): readonly string[] {
  return Object.freeze(["git", "commit", "-q", "-m", message]);
}

/**
 * B-0278 — the as-is message of the approval commit:
 * `specstride: phase <N> approved — <title>`, or `phase <N>` in place of the
 * title where the phase has none.
 */
export function approvalCommitMessage(phase: number, title: string | undefined): string {
  const subject = title === undefined || title.trim() === "" ? `phase ${phase}` : title;
  return `specstride: phase ${phase} approved — ${subject}`;
}

/** Why the commit did not happen, where it did not. */
export const REASONS_NOT_TO_COMMIT = [
  "switched-off",
  "not-a-work-tree",
  "no-changes",
  "scan-blocked",
  "commit-failed",
] as const;
export type ReasonNotToCommit = (typeof REASONS_NOT_TO_COMMIT)[number];

/** What the step reports back. */
export type CommitOutcome =
  | {
      readonly committed: false;
      readonly reason: ReasonNotToCommit;
      /** The scan result where the scan blocked the commit. */
      readonly scan?: PreCommitScanResult;
      readonly line?: undefined;
      readonly event?: undefined;
    }
  | {
      readonly committed: true;
      readonly message: string;
      readonly scan: PreCommitScanResult;
      /** The as-is line (B-0205). */
      readonly line: string;
      /** The as-is event with the phase (B-0088). */
      readonly event: { readonly phase: number };
    };

/** What the step needs from outside. */
export type CommitInputs = {
  readonly phase: number;
  readonly title: string | undefined;
  /** The configured value of `loop.gitCommits` / `SPECSTRIDE_GIT_COMMITS`. */
  readonly commits: string | undefined;
  /** Whether the working directory lies inside a work tree of a repository. */
  readonly insideAWorkTree: boolean;
  /** The changed paths of the working tree; empty means the tree has no change. */
  readonly changedPaths: readonly string[];
  /** The paths of the commit that the RUNTIME wrote: what the scan reads. */
  readonly pathsTheRuntimeWrote: readonly string[];
};

/** The ports the step calls. */
export type CommitDependencies = {
  /** F100-FR-206 — the scan before the commit; feature 111 implements it. */
  readonly scan: PreCommitScan;
  /**
   * One fixed-argv call of the version-control tool through the check-runner
   * port. It returns the exit code; it never throws for a failed commit,
   * because a failed commit is ignored.
   */
  readonly run: (argv: readonly string[]) => number;
};

/**
 * F101-FR-035 — make the approval commit. The scan runs BEFORE the commit and
 * a hit BLOCKS it (F100-FR-206, `A_HIT_BLOCKS_THE_COMMIT`); the block is not a
 * failed commit, so it is reported rather than swallowed.
 */
export function approvalCommit(inputs: CommitInputs, deps: CommitDependencies): CommitOutcome {
  if (!commitsAreEnabled(inputs.commits)) {
    return Object.freeze({ committed: false as const, reason: "switched-off" as const });
  }
  if (!inputs.insideAWorkTree) {
    return Object.freeze({ committed: false as const, reason: "not-a-work-tree" as const });
  }
  if (inputs.changedPaths.length === 0) {
    return Object.freeze({ committed: false as const, reason: "no-changes" as const });
  }

  // F100-FR-206 — the files of the commit that the RUNTIME wrote are scanned
  // for registered secrets and for the patterns; a hit blocks the commit.
  const scan = deps.scan.scan(inputs.pathsTheRuntimeWrote);
  if (scan.blocked) {
    return Object.freeze({ committed: false as const, reason: "scan-blocked" as const, scan });
  }

  // B-0278 — stage every change, then commit with the as-is message.
  const staged = deps.run(STAGE_ARGV);
  const message = approvalCommitMessage(inputs.phase, inputs.title);
  const committed = staged === 0 ? deps.run(commitArgv(message)) : staged;
  if (committed !== 0) {
    // Ignored: no log line, no event.
    return Object.freeze({ committed: false as const, reason: "commit-failed" as const, scan });
  }
  return Object.freeze({
    committed: true as const,
    message,
    scan,
    line: gitCheckpoint(inputs.phase),
    event: Object.freeze({ phase: inputs.phase }),
  });
}
