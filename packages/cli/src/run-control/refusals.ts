/**
 * T003 — the closed set of the refusals of `resume` and their exit codes
 * (F102-FR-012 to F102-FR-016, F102-FR-024; contracts/resume-refusals.md).
 *
 * Before every refusal of the closed set comes the state check of annex G
 * §G.4 of feature 100: `resume` on a workspace without state exits 1
 * (F102-FR-012, CQ-184). That exit is NOT a member of the set — row 51 of
 * annex X §X.6 closes the set without it, and the parity oracle does not map
 * it — so it is exported separately and checked first, before any member of
 * the set can be raised.
 *
 * The order of the members is the order the command checks them
 * (research.md D-2):
 *
 * 1. `nothing-to-resume` — the logical name that is missing, or a finished run;
 * 2. `unsupported-record` — the logical name, the major found, the major supported;
 * 3. `lock-held` and `owner-survivors` — the holder, the surviving process groups;
 * 4. `source-changed` — every changed file: `spec`, `plan`, `tasks`;
 * 5. `settings-invalid` — the key.
 *
 * A refusal is recorded in the launch record (outcome `refused`) and never as
 * run state; readers derive `blocked-on-human` from it (research.md D-4). The
 * refusal `source-changed` has no reference and its own tests, and is not
 * raised under the `parity` profile (F102-FR-018).
 */

/** The exit code of the state check that comes before the closed set. */
export const NO_STATE_EXIT = 1 as const;

/** The message the state check prints: a workspace without state (CQ-184). */
export const NO_STATE_MESSAGE =
  "refused resume: the workspace has no run state; nothing has been launched here yet" as const;

/** The three sources whose hash `resume` compares (row 50 of annex X §X.6). */
export const COMPARED_SOURCES = ["spec", "plan", "tasks"] as const;
export type ComparedSource = (typeof COMPARED_SOURCES)[number];

/** A refusal of `resume` inside the closed set of contracts/resume-refusals.md. */
export type ResumeRefusal =
  | "nothing-to-resume"
  | "unsupported-record"
  | "lock-held"
  | "owner-survivors"
  | "source-changed"
  | "settings-invalid";

/** One member of the closed set, with its exit code and what it names. */
export type ResumeRefusalEntry = {
  readonly refusal: ResumeRefusal;
  readonly exit: 3 | 5;
  /** The position of the check in the fixed order of the command. */
  readonly order: 1 | 2 | 3 | 4 | 5;
  /** What the message names (the column `Named in the message`). */
  readonly names: string;
};

/**
 * The closed set of the refusals of `resume`, in the order the command
 * checks them (contracts/resume-refusals.md). `no-state` (exit 1) is not a
 * member: it comes before every entry here (F102-FR-012, CQ-184).
 */
export const RESUME_REFUSALS: readonly ResumeRefusalEntry[] = Object.freeze([
  Object.freeze({
    refusal: "nothing-to-resume",
    exit: 3,
    order: 1,
    names: "the logical name that is missing, or the finished run",
  }),
  Object.freeze({
    refusal: "unsupported-record",
    exit: 3,
    order: 2,
    names: "the logical name, the major found, the major supported",
  }),
  Object.freeze({
    refusal: "lock-held",
    exit: 5,
    order: 3,
    names: "the holder",
  }),
  Object.freeze({
    refusal: "owner-survivors",
    exit: 5,
    order: 3,
    names: "the surviving process groups",
  }),
  Object.freeze({
    refusal: "source-changed",
    exit: 3,
    order: 4,
    names: "every changed file: spec, plan, tasks",
  }),
  Object.freeze({
    refusal: "settings-invalid",
    exit: 3,
    order: 5,
    names: "the key",
  }),
] satisfies ResumeRefusalEntry[]);

const BY_REFUSAL: ReadonlyMap<string, ResumeRefusalEntry> = new Map(
  RESUME_REFUSALS.map((entry) => [entry.refusal, entry]),
);

/** True when the refusal is a member of the closed set (row 51 of annex X §X.6). */
export function isResumeRefusal(refusal: string): refusal is ResumeRefusal {
  return BY_REFUSAL.has(refusal);
}

/** The exit code of a refusal of the closed set; `undefined` outside it. */
export function resumeRefusalExit(refusal: string): 3 | 5 | undefined {
  return BY_REFUSAL.get(refusal)?.exit;
}

/** The entry of a refusal of the closed set; `undefined` outside it. */
export function resumeRefusalEntry(refusal: string): ResumeRefusalEntry | undefined {
  return BY_REFUSAL.get(refusal);
}

/**
 * F102-FR-024 — `source-changed` has no reference and its own tests; it is
 * recorded in the launch record (outcome `refused`) and never as run state,
 * and readers derive `blocked-on-human`. It is not raised under the `parity`
 * profile (F102-FR-018).
 */
export const SOURCE_CHANGED_REFUSAL = "source-changed" as const;

/**
 * The three ways out of `source-changed` (contracts/resume-refusals.md):
 * revert the change, `resume --accept-source-change`, or `launch --new-run`.
 */
export const WAYS_OUT_OF_SOURCE_CHANGED = [
  "revert the change",
  "resume --accept-source-change",
  "launch --new-run",
] as const;

/* ------------------------------------------------------------------ *
 * T033 — the compatibility messages and the default refusal lines
 * (F102-FR-012, F102-FR-013, F102-FR-021).
 * ------------------------------------------------------------------ */

import oldSide from "../../../../packages/contracts/data/layout-old-side.json" with { type: "json" };

/**
 * The legacy launcher name, read from the one file that may carry it
 * (F100-FR026, `layout-old-side.json`): the entry of the as-is paths of the
 * SS annex items that stands at the root of a workspace as a shell script.
 */
export const LEGACY_LAUNCHER_NAME: string = (() => {
  const items = (oldSide as { items: { asIsPaths?: string[] }[] }).items ?? [];
  for (const item of items) {
    for (const path of item.asIsPaths ?? []) {
      // The launcher of the baseline stands at the root of a workspace as a
      // shell script: a bare `<name>.sh`, no directory component.
      if (/^[a-z0-9][a-z0-9-]*\.sh$/u.test(path)) return path;
    }
  }
  return "the launcher";
})();

/**
 * F102-FR-012 — the as-is messages of `nothing-to-resume`, byte for byte,
 * in compatibility output (B-1494, B-1495):
 *
 *   `specstride resume: no last-run config for feature '<slug>' (<path>).`
 *   `specstride resume: no <conf> — launch the run once via <legacy launcher> first.`
 *
 * The legacy launcher name is read from the ONE file that may carry it,
 * `packages/contracts/data/layout-old-side.json` (F100-FR-026): the product
 * source names no legacy command, while the compatibility output reproduces
 * the as-is line with the name the annex recorded.
 */
export function nothingToResumeFeatureLine(slug: string, path: string): string {
  return `specstride resume: no last-run config for feature '${slug}' (${path}).`;
}

export function nothingToResumeNoConfLine(confPath: string): string {
  return `specstride resume: no ${confPath} — launch the run once via ${LEGACY_LAUNCHER_NAME} first.`;
}

/**
 * F102-FR-013 — the as-is message of `lock-held`, byte for byte, in
 * compatibility output (B-1496).
 */
export function lockHeldLine(workdir: string): string {
  return `specstride resume: a run is already ACTIVE on ${workdir} (lock held) — nothing to resume.`;
}

/**
 * F102-FR-014 — the refusal `owner-survivors` names the surviving process
 * groups. The baseline has no such line, so this is a DEFAULT-output line:
 * the failing item (every survivor) and its fix.
 */
export function ownerSurvivorsLine(survivors: readonly string[]): string {
  return `refused resume (owner-survivors): the owner is dead but these process groups are alive: ${survivors.join(", ")}; end them, or reclaim with a proof the owner is gone`;
}

/** The fix the DEFAULT output offers for each refusal (D-9: the item and its fix). */
export const FIX_OF_REFUSAL: Readonly<Record<ResumeRefusal, string>> = Object.freeze({
  "nothing-to-resume": "launch the run once first, or name a feature that has a run",
  "unsupported-record":
    "upgrade the reader, or start a new run with launch --new-run; an older major is never read",
  "lock-held": "wait for the run to end, or stop it with specstride stop",
  "owner-survivors": "end the surviving process groups, then resume again",
  "source-changed": "revert the change, or resume --accept-source-change, or launch --new-run",
  "settings-invalid": "correct the key, or start a new run with launch --new-run",
});

/**
 * F102-FR-021 — a refusal in DEFAULT output names the failing item and its
 * fix; `source-changed` offers the three ways out by name.
 */
export function defaultRefusalLine(refusal: ResumeRefusal, detail: string): string {
  return `refused resume (${refusal}): ${detail}; ${FIX_OF_REFUSAL[refusal]}`;
}

/** `unsupported-record` names the logical name, the major found, the major supported. */
export function unsupportedRecordLine(
  logicalName: string,
  majorFound: string,
  majorSupported: string,
): string {
  return defaultRefusalLine(
    "unsupported-record",
    `the record "${logicalName}" has the schema major ${majorFound}, the reader supports ${majorSupported}`,
  );
}

/** `settings-invalid` names the key that failed the replay validation. */
export function settingsInvalidLine(key: string): string {
  return defaultRefusalLine(
    "settings-invalid",
    `the replayed value of the key "${key}" failed validation`,
  );
}

/**
 * F102-FR-012 — the success line of `resume`: the run continues, as the same
 * run, at the first phase without a valid approval record (F102-FR-011,
 * F102-FR-022).
 */
export function resumingLine(runId: string, phase: number, launchId: string): string {
  return `resume: run ${runId} continues at phase ${phase} (launch ${launchId})`;
}
