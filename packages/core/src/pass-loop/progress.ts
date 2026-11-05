/**
 * T017 of feature 103 — the PROGRESS MEASUREMENT of one pass (F103-FR-016).
 *
 * A pass counts as having made progress when ANY file under the progress roots
 * has a modification time LATER than one second before the pass started. The
 * comparison is strictly greater, which is why the start stamp is taken one
 * second earlier: a file written in the same second as the start of the pass
 * must count, and a strictly-greater comparison against the exact start stamp
 * would lose it on a file system whose stamps have one-second resolution.
 * `STAMP_SLACK_MS` is that second, and `thresholdOf` is where it is applied.
 *
 * ## What is not measured
 *
 * The measurement IGNORES, as F103-FR-016 lists them:
 *
 * | Ignored | Why |
 * |---|---|
 * | the project's repository directory | the run's own version control is not the proposer's work |
 * | the workspace part (the state, the notebook and the outbox) | a write by the proposer to its own bookkeeping is not progress |
 * | `node_modules` | an install is not the proposer's work |
 * | `.venv` | the same |
 *
 * The CONTROL PLANE lies outside the working tree and is therefore not
 * measured at all; no rule is needed for it, and
 * `THE_CONTROL_PLANE_IS_INSIDE_THE_WORKING_TREE` records that.
 *
 * A file written by a BACKGROUND JOB under the working directory DOES count: a
 * detached job is the proposer's work, and nothing here asks who wrote a file.
 *
 * The LEGACY name of the state directory is not carried (F103-FR-016): the
 * ignored workspace head is `.specstride` and the baseline's older name is not
 * in `IGNORED_DIRECTORY_NAMES`.
 *
 * ## The event this module does not emit
 *
 * The measurement emits NO event of its own beyond the `iter_no_progress` of
 * F103-FR-017, which `./accounting.ts` emits. In particular it does not emit
 * `progress.swept`: that event is the SWEEP OF A STRAY NOTEBOOK at the start
 * of a phase, which belongs to feature 100 (F100-FR-057, F100-FR-058), and no
 * part of the pass loop writes it. `EMITS_PROGRESS_SWEPT` is `false` and
 * `PROGRESS_SWEPT_IS_OWNED_BY` names the owner, so that a reader who looks for
 * the event here finds the answer instead of writing one.
 */

/** The requirement this module carries out. */
export const REQUIREMENT = "F103-FR-016" as const;

/**
 * F103-FR-016 — the pass loop does NOT emit `progress.swept`. That event is
 * the sweep of a stray notebook at the start of a phase (F100-FR-057,
 * F100-FR-058) and belongs to feature 100.
 */
export const EMITS_PROGRESS_SWEPT = false as const;

/** The event `progress.swept` and the feature that owns it (F100-FR-058). */
export const PROGRESS_SWEPT_IS_OWNED_BY = Object.freeze({
  event: "progress.swept",
  feature: "100",
  requirements: ["F100-FR-057", "F100-FR-058"],
  whatItIs: "the sweep of a stray notebook at the start of a phase",
});

/** The only event a pass without progress leads to; `./accounting.ts` emits it. */
export const THE_ONE_EVENT = "iter_no_progress" as const;

/**
 * F103-FR-016 — the start stamp is taken ONE SECOND EARLIER, because the
 * comparison of modification times is strictly greater.
 */
export const STAMP_SLACK_MS = 1_000 as const;

/** F103-FR-016 — the comparison is strictly greater. */
export const COMPARISON_IS_STRICTLY_GREATER = true as const;

/**
 * The directory names the measurement ignores wherever they appear under a
 * progress root (F103-FR-016). The workspace head `.specstride` covers the
 * state, the notebook and the outbox in one name.
 */
export const IGNORED_DIRECTORY_NAMES: readonly string[] = Object.freeze([
  ".git",
  ".specstride",
  "node_modules",
  ".venv",
]);

/** F103-FR-016 — the legacy name of the state directory is not carried. */
export const LEGACY_STATE_DIRECTORY_NAME_IS_CARRIED = false as const;

/** F103-FR-016 — the control plane lies outside the working tree. */
export const THE_CONTROL_PLANE_IS_INSIDE_THE_WORKING_TREE = false as const;

/** F103-FR-016 — a file a background job wrote under the working directory counts. */
export const A_BACKGROUND_JOB_COUNTS = true as const;

/** F103-FR-016 — a write by the proposer to its notebook, state or outbox counts. */
export const A_WRITE_TO_THE_WORKSPACE_COUNTS = false as const;

const IGNORED = new Set<string>(IGNORED_DIRECTORY_NAMES);

/** True when a directory of this name is ignored wherever it appears. */
export function isIgnoredDirectoryName(name: string): boolean {
  return IGNORED.has(name);
}

/**
 * F103-FR-016 — the threshold a modification time must exceed: one second
 * before the pass started.
 */
export function thresholdOf(passStartedAtMs: number): number {
  return passStartedAtMs - STAMP_SLACK_MS;
}

/** One entry of a progress root, as the walk reads it. */
export type ProgressEntry = {
  /** The path, as the walk built it. */
  readonly path: string;
  /** The base name, against which `IGNORED_DIRECTORY_NAMES` is tested. */
  readonly name: string;
  readonly isDirectory: boolean;
  /** The modification time in milliseconds since the epoch. */
  readonly modifiedAtMs: number;
};

/**
 * The file system the measurement reads, as a port.
 *
 * `@specstride/core` may not import `node:fs` or `node:fs/promises`
 * (F100-FR-012, F100-FR-234; the rule of `tools/import-boundary`), so the two
 * operations the walk needs are named here with the `node:fs` call each stands
 * for, and the COMPOSITION ROOT implements them — the same shape
 * `../approval/gate-tree.ts` uses. A test hands a tree it built in memory, or
 * a thin implementation over the real one.
 */
export const IO_OPERATIONS = Object.freeze({
  list: "readdirSync",
  statEach: "statSync(...).isDirectory() and statSync(...).mtimeMs",
});

/** This module imports no file-system module of Node (F100-FR-012). */
export const IMPORTS_NODE_FS = false as const;

/** The port itself. */
export type ProgressIo = {
  /** The entries of a directory, or an empty list where it cannot be read. */
  entriesOf(directory: string): readonly ProgressEntry[];
};

/** What the measurement is asked. */
export type ProgressQuestion = {
  /** The progress roots; the working directory is the usual single root. */
  readonly roots: readonly string[];
  /** When the pass started, in milliseconds since the epoch. */
  readonly passStartedAtMs: number;
};

/** What the measurement answers. */
export type ProgressMeasurement = {
  /** F103-FR-016 — true when any file under a root is newer than the threshold. */
  readonly madeProgress: boolean;
  /** The threshold the comparison used; one second before the start. */
  readonly thresholdMs: number;
  /** The first file that proved progress, for a line and for a test. */
  readonly firstNewerFile?: string;
  /** How many files the walk looked at; the measurement stops at the first hit. */
  readonly filesExamined: number;
};

/**
 * F103-FR-016 — the measurement. It stops at the FIRST file that proves
 * progress: the answer is a truth value, so there is nothing to gain from
 * walking the rest of the tree, and a phase whose first pass touched a file
 * costs one `readdir`.
 *
 * It asks nothing about WHO wrote a file. A write by a background job under
 * the working directory therefore counts, which is what F103-FR-016 requires;
 * a write by the proposer to its notebook, to the state or to the outbox does
 * not count, because all three live under the ignored workspace head.
 */
export function measureProgress(question: ProgressQuestion, io: ProgressIo): ProgressMeasurement {
  const thresholdMs = thresholdOf(question.passStartedAtMs);
  let filesExamined = 0;
  const pending: string[] = [...question.roots];
  while (pending.length > 0) {
    const directory = pending.pop() as string;
    for (const entry of io.entriesOf(directory)) {
      if (entry.isDirectory) {
        if (!isIgnoredDirectoryName(entry.name)) pending.push(entry.path);
        continue;
      }
      filesExamined += 1;
      if (entry.modifiedAtMs > thresholdMs) {
        return Object.freeze({
          madeProgress: true,
          thresholdMs,
          firstNewerFile: entry.path,
          filesExamined,
        });
      }
    }
  }
  return Object.freeze({ madeProgress: false, thresholdMs, filesExamined });
}
