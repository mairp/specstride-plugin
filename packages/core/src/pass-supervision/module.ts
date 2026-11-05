/**
 * T004 of feature 118 — the module group `pass-supervision` of
 * `@specstride/core` (`specs/118-pass-supervision-and-jobs/plan.md`,
 * "Project Structure").
 *
 * Supervision of one pass of the proposer and of the detached jobs a pass
 * leaves behind: the watchdogs, the hard cap, the stop ladder and the kill
 * note, the yield artifact with its seven predicates, the long job, the
 * failure ledger of the baseline and the first-failure predicate.
 *
 * The folders `plan.md` assigns to this directory are listed in `FILES`
 * below; the phases after Setup write their files (T022 onward). Every
 * system access goes through the ports of `ports.ts` (T005); no file of this
 * module imports `node:fs` or `node:child_process` (F100-FR-012, CQ-185).
 *
 * Boundary: `@specstride/contracts` and `@specstride/kernel` only.
 */

/** The directory this module group occupies, relative to the repository root. */
export const DIRECTORY = "packages/core/src/pass-supervision" as const;

/** The feature that owns the module group. */
export const OWNER = "118" as const;

/** The folders `plan.md` assigns to the directory, in the order it lists them. */
export const FOLDERS = [
  "watchdogs/",
  "stop-ladder/",
  "kill-note/",
  "yield/schema/",
  "yield/predicates/",
  "yield/wait/",
  "yield/resume-block/",
  "jobs/",
  "failure-ledger/",
  "failfast/",
] as const;

/** The tasks of tasks.md that fill each folder after Setup. */
export const FOLDER_TASKS: Readonly<{ readonly [K in (typeof FOLDERS)[number]]: string }> =
  Object.freeze({
    "watchdogs/": "T022 to T027, T026, T030, T031 (US1)",
    "stop-ladder/": "T028 (US1)",
    "kill-note/": "T029 (US1)",
    "yield/schema/": "T043 (US2)",
    "yield/predicates/": "T044 (US2)",
    "yield/wait/": "T046 (US2)",
    "yield/resume-block/": "T048 (US2)",
    "jobs/": "T045, T052 (US2)",
    "failure-ledger/": "T053 (US2)",
    "failfast/": "T063 onward (US3)",
  });

/**
 * The files of this directory the Setup phase wrote itself, each with the
 * task that added it and why. They are kept apart from `FOLDERS` so that the
 * list above stays a faithful reading of the plan.
 */
export const FILES_ADDED_AFTER_THE_PLAN: Readonly<Record<string, string>> = Object.freeze({
  "ports.ts":
    "T005 (Setup) — the ports the plan's Structure Decision names: clock, process " +
    "list, file reader, file writer, signal sender, process launcher, event writer, " +
    "registry access, ingress (F118-FR-002, F118-FR-031, F118-FR-044).",
});
