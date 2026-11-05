/**
 * The SOURCE CHECK at the start of every pass (F103-FR-021; ruling K3).
 *
 * Before every pass starts, and BEFORE ITS PROMPT IS BUILT, the loop compares
 * the hash of the spec, of the plan and of the task list with the hash pinned
 * in the run snapshot (`run:<runId>:snapshot`). A difference stops the run
 * before the pass: no pass starts, the event `blocked` names the file, and the
 * run rests in `blocked-on-human` with the phase evidence that was already
 * delivered left in place.
 *
 * This is new behaviour, not a port: at the baseline a changed plan was found
 * only when the critic started, which cost up to a whole pass limit of work on
 * a plan nobody was working to any more (F103-SC-005: a changed source costs at
 * most one pass).
 *
 * ## The one comparison, and who makes it
 *
 * This module compares NOTHING itself. The classification of the staleness
 * verdict is the KERNEL's, in `@specstride/kernel`'s hasher
 * (`classifySources` of `packages/kernel/src/hasher/staleness.ts`), which is
 * the one place in the product where a recorded hash meets a hash taken now
 * (F100-FR-207, F104-FR-027, clarification CQ-214). What this module owns is
 * the three sources, the ORDER in which they are reported, the rule that a
 * task list is compared by the hash that IGNORES CHECKBOXES, and the shape of
 * the stop. A feature that compared hashes itself would be a second scheme.
 *
 * ## A tick of a checkbox does not stop the run
 *
 * The task list is the file the proposer itself edits: it ticks a task as it
 * finishes it. Comparing its content hash would stop the run on the proposer's
 * own work. So for the task list the hash compared is the one that ignores
 * checkboxes, and the kernel reports a change of ticks alone as the state
 * `ticks-only`, which is not stale. `A_TICK_STOPS_THE_RUN` is `false` and
 * `TASKS_ARE_COMPARED_BY` names which hash.
 *
 * ## Under the `parity` profile there is NO check
 *
 * F103-FR-021 ends with it: under `parity` the pass loop makes no check at
 * all, and the plan is checked when the critic starts, as at the baseline. The
 * check is row 15 of annex X §X.7 (`staleness.check_points`), whose value
 * under `parity` is "critic start only". `checkSources` therefore returns
 * `{ stopped: false, checked: false }` under the profile — `checked: false`
 * and not "checked and found fresh", because the two are different facts and a
 * test of F103-FR-021 has to tell them apart.
 */
import { classifySources, type ClassifiedSource } from "@specstride/kernel/hasher";

/** The requirement this module carries out. */
export const REQUIREMENT = "F103-FR-021" as const;

/** The ruling that added the check (it is new behaviour, not a port). */
export const RULING = "K3" as const;

/** The success criterion the check serves. */
export const SUCCESS_CRITERION = "F103-SC-005" as const;

/** F103-FR-021 — the three sources whose hash is compared, in the order reported. */
export const SOURCES = ["spec", "plan", "tasks"] as const;
export type SourceName = (typeof SOURCES)[number];

/** F103-FR-021 — the logical name of the record the pinned hashes come from. */
export function snapshotLogicalName(runId: string): string {
  return `run:${runId}:snapshot`;
}

/** F103-FR-021 — the hash compared for a task list ignores checkboxes. */
export const TASKS_ARE_COMPARED_BY = "the hash that ignores checkboxes" as const;

/** F103-FR-021 — a tick of a checkbox does NOT stop the run. */
export const A_TICK_STOPS_THE_RUN = false as const;

/** F103-FR-021 — the pass loop compares no hash itself; the kernel classifies. */
export const THE_CLASSIFICATION_IS_THE_KERNELS = true as const;

/** The module of the kernel that holds the one classification. */
export const CLASSIFIER = "packages/kernel/src/hasher/staleness.ts" as const;

/** F103-FR-021 — the check happens BEFORE the prompt of the pass is built. */
export const CHECKED_BEFORE_THE_PROMPT_IS_BUILT = true as const;

/* ------------------------------------------------------------------ *
 * The switch of the `parity` profile.
 * ------------------------------------------------------------------ */

/** F103-FR-021 — the configuration key of the check points (row 15 of §X.7). */
export const CHECK_POINTS_KEY = "staleness.check_points" as const;

/** The row of annex X §X.7 that holds the key. */
export const CHECK_POINTS_ROW = 15 as const;

/** The default of the key: launch, resume and every pass start. */
export const CHECK_POINTS_DEFAULT = "launch, resume and every pass start" as const;

/** F103-FR-021 — the value under `parity`: the critic's start only. */
export const CHECK_POINTS_UNDER_PARITY = "critic start only" as const;

/** F103-FR-021 — under `parity` the pass loop makes NO check at a pass start. */
export function checksAtAPassStart(checkPoints: string = CHECK_POINTS_DEFAULT): boolean {
  return checkPoints !== CHECK_POINTS_UNDER_PARITY;
}

/* ------------------------------------------------------------------ *
 * The stop.
 * ------------------------------------------------------------------ */

/** F103-FR-021 — the blocked reason of a changed source (annex E §E.2). */
export const BLOCKED_REASON = "source-changed" as const;

/** F103-FR-021 — the result the pass loop reports (annex E §E.4, row 3). */
export const RESULT = 3 as const;

/** F103-FR-021 — the stop reason the engine writes, and its exit. */
export const STOP = Object.freeze({
  stopReason: "critic_config",
  engineExit: 3,
  state: "blocked-on-human",
  lockReleased: true,
  deliveredEvidenceIsKept: true,
});

/** F103-FR-021 — phase evidence that was delivered is KEPT. */
export const DELIVERED_EVIDENCE_IS_KEPT = true as const;

/** The hashes of one source: the one pinned in the snapshot and the one now. */
export type SourceHashes = {
  /** The repository path of the source, which the event names. */
  readonly path: string;
  /** The content hash pinned in the run snapshot. */
  readonly recordedHash: string;
  /** The content hash now, or `undefined` where the source cannot be read. */
  readonly hashNow?: string | undefined;
  /** For the task list: the pinned hash that ignores checkboxes. */
  readonly recordedHashIgnoringCheckboxes?: string | undefined;
  /** For the task list: the hash now that ignores checkboxes. */
  readonly hashNowIgnoringCheckboxes?: string | undefined;
};

/** What the check is asked: the three sources, and whether it checks at all. */
export type SourceCheckQuestion = {
  /** The hashes of each of the three sources. */
  readonly sources: Readonly<Partial<Record<SourceName, SourceHashes>>>;
  /** The value of `staleness.check_points`; under `parity` there is no check. */
  readonly checkPoints?: string;
};

/** What the check answers. */
export type SourceCheckDecision = {
  /** False where no check was made (under `parity`), true otherwise. */
  readonly checked: boolean;
  /** True when the run stops before the pass. */
  readonly stopped: boolean;
  /** The classification of each source, in the order of `SOURCES`. */
  readonly classified: readonly ClassifiedSource[];
  /** The result the pass loop reports: 3 on a stop. */
  readonly exit_code?: typeof RESULT;
  /** The field `blocked` of the result, with the file that changed. */
  readonly blocked?: {
    readonly reason: typeof BLOCKED_REASON;
    readonly file: SourceName;
  };
  /** The event `blocked`, which names the file that changed. */
  readonly event?: {
    readonly event: "blocked";
    readonly reason: typeof BLOCKED_REASON;
    readonly changedSource: SourceName;
    readonly changedRef: string;
  };
};

const FRESH: readonly ClassifiedSource[] = Object.freeze([]);

/**
 * F103-FR-021 — the check at the start of one pass.
 *
 * Under the `parity` profile it makes no check and reports
 * `checked: false`. Otherwise it hands the three sources to the kernel's
 * classification, in the order of `SOURCES`, with the task list carrying its
 * hash that ignores checkboxes, and stops the run on the FIRST source the
 * kernel reports as `changed` or `unreadable`. A source the kernel reports as
 * `ticks-only` is not stale, so a tick of a checkbox starts the pass.
 */
export function checkSources(question: SourceCheckQuestion): SourceCheckDecision {
  if (!checksAtAPassStart(question.checkPoints)) {
    return Object.freeze({ checked: false, stopped: false, classified: FRESH });
  }
  const names: SourceName[] = [];
  const readings = [];
  for (const name of SOURCES) {
    const hashes = question.sources[name];
    if (hashes === undefined) continue;
    names.push(name);
    readings.push({
      logicalName: name,
      repositoryPath: hashes.path,
      recordedHash: hashes.recordedHash,
      recordedHashIgnoringCheckboxes: hashes.recordedHashIgnoringCheckboxes,
      hashNow: hashes.hashNow,
      hashNowIgnoringCheckboxes: hashes.hashNowIgnoringCheckboxes,
    });
  }
  const classified = classifySources(readings);
  const at = classified.findIndex((s) => s.state === "changed" || s.state === "unreadable");
  if (at < 0) {
    return Object.freeze({ checked: true, stopped: false, classified });
  }
  const file = names[at] as SourceName;
  const path = (question.sources[file] as SourceHashes).path;
  return Object.freeze({
    checked: true,
    stopped: true,
    classified,
    exit_code: RESULT,
    blocked: Object.freeze({ reason: BLOCKED_REASON, file }),
    event: Object.freeze({
      event: "blocked" as const,
      reason: BLOCKED_REASON,
      changedSource: file,
      changedRef: path,
    }),
  });
}
