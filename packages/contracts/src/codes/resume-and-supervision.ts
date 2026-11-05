/**
 * T272 — the refusals of `resume` and the seven supervision outcomes
 * (annex G, §G.4; F100-FR-183, F100-FR-184).
 *
 * A slice of T093. The refusals of `resume` — the lock held 5, nothing to
 * resume 3, a changed hash of the spec, the plan or the task list 3 with the
 * file named, and the task-list hash that ignores checkbox changes — and the
 * seven supervision outcomes with their codes, read from the rows of `resume`
 * and `supervise` of the key `perCommand` of `data/exit-codes.json`, as data.
 *
 * Row 16 of `data/closed-sets.json` gives no literals of its own: it refers
 * to this table, and registers through T070 from here
 * (`supervisionOutcomeSet`).
 */
import { defineByReference, type SetByReference } from "../enums/index.ts";
import { commandCodeRow, type CommandCodeRow } from "./commands.ts";

/** The section of annex G that owns these rows. */
export const ANNEX_SECTION = "annex G, §G.4" as const;

/* ------------------------------------------------------------------ *
 * F100-FR-183 — the refusals of `resume`.
 * ------------------------------------------------------------------ */

/** The row of `resume` of the key `perCommand` (annex G, §G.4). */
export const resumeRow: CommandCodeRow | undefined = commandCodeRow("resume");

/** One refusal of `resume`, with its code (F100-FR-183). */
export type ResumeRefusal = {
  /** The refusal, as row 51 of `data/closed-sets.json` names it. */
  readonly refusal: string;
  /** The exit code of the command. */
  readonly code: number;
  /** What the refusal is. */
  readonly meaning: string;
  /** True where the refusal names the file that changed. */
  readonly namesTheFile: boolean;
};

/**
 * F100-FR-183 and the row of `resume` of §G.4, in the order of the annex:
 * 1 without state, which is the first check, as at the baseline (CQ-184);
 * then 5 when the lock is held; 5 when the owner of the lock is dead and a
 * process group of it survives; 3 when there is nothing to resume, which
 * includes a run that is `finished`; 3 when a source hash changed since
 * launch; 3 for a record of an unsupported major or settings that do not
 * validate.
 */
export const RESUME_REFUSALS: readonly ResumeRefusal[] = Object.freeze([
  Object.freeze({
    refusal: "no-state",
    code: 1,
    meaning: "without state, which is the first check, as at the baseline (CQ-184)",
    namesTheFile: false,
  }),
  Object.freeze({
    refusal: "lock-held",
    code: 5,
    meaning: "the lock is held",
    namesTheFile: false,
  }),
  Object.freeze({
    refusal: "owner-dead-group-survives",
    code: 5,
    meaning: "the owner of the lock is dead and a process group of it survives",
    namesTheFile: false,
  }),
  Object.freeze({
    refusal: "nothing-to-resume",
    code: 3,
    meaning: "there is nothing to resume, which includes a run that is `finished`",
    namesTheFile: false,
  }),
  Object.freeze({
    refusal: "source-changed",
    code: 3,
    meaning: "a source hash changed since launch; the file that changed is named",
    namesTheFile: true,
  }),
  Object.freeze({
    refusal: "unsupported-major-or-invalid-settings",
    code: 3,
    meaning: "a record of an unsupported major, or settings that do not validate",
    namesTheFile: false,
  }),
]);

const REFUSAL = new Map(RESUME_REFUSALS.map((r) => [r.refusal, r]));

/** The code of a refusal of `resume` (F100-FR-183). */
export function resumeRefusalCode(refusal: string): number | undefined {
  return REFUSAL.get(refusal)?.code;
}

/** F100-FR-183 — `resume` refuses with 5 when the lock is held. */
export const RESUME_LOCK_HELD_CODE = 5 as const;

/** F100-FR-183 — `resume` refuses with 3 when there is nothing to resume. */
export const RESUME_NOTHING_TO_RESUME_CODE = 3 as const;

/** F100-FR-183 — `resume` refuses with 3 on a changed source hash. */
export const RESUME_SOURCE_CHANGED_CODE = 3 as const;

/** The three sources whose hash `resume` compares (row 50 of §X.6). */
export const SOURCES_COMPARED = ["spec", "plan", "tasks"] as const;

/** A source whose hash `resume` compares. */
export type ComparedSource = (typeof SOURCES_COMPARED)[number];

/**
 * F100-FR-183 — for the task list the hash that ignores checkboxes is
 * compared, so that a tick never refuses a resume. The other two sources are
 * compared by their plain hash.
 */
export const HASH_COMPARED_PER_SOURCE: Readonly<Record<ComparedSource, string>> = Object.freeze({
  spec: "the hash of the file",
  plan: "the hash of the file",
  tasks: "the hash that ignores checkbox changes",
});

/** F100-FR-183 — true where the source is hashed ignoring checkboxes. */
export const TASK_LIST_HASH_IGNORES_CHECKBOXES = true as const;

/** F100-FR-183 — true where a change of that source refuses the resume. */
export function ignoresCheckboxChanges(source: string): boolean {
  return source === "tasks";
}

/** The refusal `resume` gives for a changed source, with the file named. */
export type ResumeSourceChanged = {
  readonly refusal: "source-changed";
  readonly code: 3;
  /** The file the command names. */
  readonly file: string;
  /** The source of §G.4 the file is. */
  readonly source: ComparedSource;
};

/**
 * F100-FR-183 — the refusal for one changed source. A tick of the task list
 * changes no hash that is compared, so it returns `undefined`.
 */
export function resumeSourceChanged(input: {
  readonly source: ComparedSource;
  readonly file: string;
  /** True where the only change is a checkbox of the task list. */
  readonly onlyCheckboxesChanged?: boolean;
}): ResumeSourceChanged | undefined {
  if (input.onlyCheckboxesChanged === true && ignoresCheckboxChanges(input.source)) {
    return undefined;
  }
  return Object.freeze({
    refusal: "source-changed" as const,
    code: 3 as const,
    file: input.file,
    source: input.source,
  });
}

/* ------------------------------------------------------------------ *
 * F100-FR-184 — the seven supervision outcomes.
 * ------------------------------------------------------------------ */

/** The row of `supervise` of the key `perCommand` (annex G, §G.4). */
export const superviseRow: CommandCodeRow | undefined = commandCodeRow("supervise");

/** The seven outcomes of supervision, in the order of F100-FR-184. */
export const SUPERVISION_OUTCOMES = [
  "completed",
  "stopped",
  "unknown-terminal",
  "refused",
  "supervision-expired",
  "failed",
  "lock-conflict",
] as const;

/** An outcome of supervision (annex G, §G.4; F100-FR-184). */
export type SupervisionOutcome = (typeof SUPERVISION_OUTCOMES)[number];

/** Row 16 of §X.6 — supervision outcomes, registered through T070 here. */
export const supervisionOutcomeSet: SetByReference<SupervisionOutcome> = defineByReference(
  16,
  SUPERVISION_OUTCOMES,
);

/** One outcome of supervision, with its code (F100-FR-184). */
export type SupervisionOutcomeRow = {
  /** The outcome. */
  readonly outcome: SupervisionOutcome;
  /** The exit code of `supervise`. */
  readonly code: number;
  /** What the outcome is, as the row of §G.4 words it. */
  readonly meaning: string;
  /** The double use of the baseline the annex keeps on that number. */
  readonly alsoMeans?: string;
};

/**
 * F100-FR-184 — the seven outcomes with their codes: completed, a reading
 * taken or a relaunch started 0; stopped 2, which is also the usage error;
 * unknown-terminal 3; refused 4, which is also the launch decision `attach`;
 * supervision-expired 5; failed 22; lock-conflict 24.
 */
export const SUPERVISION_OUTCOME_ROWS: readonly SupervisionOutcomeRow[] = Object.freeze([
  Object.freeze({
    outcome: "completed" as const,
    code: 0,
    meaning: "completed, a reading taken, a relaunch started",
  }),
  Object.freeze({
    outcome: "stopped" as const,
    code: 2,
    meaning: "stopped",
    alsoMeans: "a usage error",
  }),
  Object.freeze({ outcome: "unknown-terminal" as const, code: 3, meaning: "unknown-terminal" }),
  Object.freeze({
    outcome: "refused" as const,
    code: 4,
    meaning: "refused",
    alsoMeans: "the launch decision `attach`",
  }),
  Object.freeze({
    outcome: "supervision-expired" as const,
    code: 5,
    meaning: "supervision expired",
  }),
  Object.freeze({ outcome: "failed" as const, code: 22, meaning: "failed" }),
  Object.freeze({ outcome: "lock-conflict" as const, code: 24, meaning: "lock conflict" }),
]);

const OUTCOME = new Map(SUPERVISION_OUTCOME_ROWS.map((r) => [r.outcome, r]));

/** The exit code of an outcome of supervision (F100-FR-184). */
export function supervisionExitCode(outcome: string): number | undefined {
  return OUTCOME.get(outcome as SupervisionOutcome)?.code;
}

/** The row of an outcome of supervision (F100-FR-184). */
export function supervisionOutcomeRow(outcome: string): SupervisionOutcomeRow | undefined {
  return OUTCOME.get(outcome as SupervisionOutcome);
}

/**
 * §G.4 — a status the exit map does not know gives 1 (row 16 of §X.6: the
 * unknown value of the set is "Exit 1").
 */
export const SUPERVISION_UNKNOWN_STATUS_CODE = 1 as const;

/** §G.4 — `supervise` interrupted exits 130 and leaves the run alone. */
export const SUPERVISION_INTERRUPTED = Object.freeze({
  code: 130,
  leavesTheRunAlone: true,
} as const);

/**
 * F100-FR-184 — the double uses of the baseline the annex keeps: 2 is also
 * the usage error of `supervise`, and 4 is also the launch decision `attach`.
 */
export const SUPERVISION_DOUBLE_USES = Object.freeze({
  2: "also the usage error",
  4: "also the launch decision `attach`",
} as Readonly<Record<number, string>>);

/**
 * F100-FR-184 — the code for a status of supervision: the outcome's code, and
 * 1 for a status the exit map does not know.
 */
export function codeOfSupervisionStatus(status: string): number {
  return supervisionExitCode(status) ?? SUPERVISION_UNKNOWN_STATUS_CODE;
}
