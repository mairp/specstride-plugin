/**
 * T029 — the verification record of the PAID tasks of User Story 5
 * (F113-FR-040), on the owner's ruling of 2026-09-30: the paid part of a task
 * (a live call or a capture that costs money) is never run and never faked in
 * this lane. The hermetic part on Linux is the runner of each task, in
 * `evals/behaviour-smoke.ts` and `evals/with-and-without-report.ts` of this
 * package; a person starts them, never a job and never a schedule of the
 * build.
 *
 * The record is held against the runners on disk: a runner that is missing, or
 * a record that claims `verified` for a task whose paid part was never run,
 * fails at load (`assertRecordMatchesTheRunners`).
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The one prose reason, the owner's ruling of 2026-09-30. */
export const PAID_TASK_REASON =
  "paid-probe: a live call or a capture that costs money is never run and never faked in " +
  "this lane (owner's ruling of 2026-09-30)";

/** One paid task and the state of its verification. */
export type PaidTaskRecord = {
  /** The task of `specs/113-host-claude-code/tasks.md`. */
  readonly task: string;
  /** The paid task, as F113-FR-038 or F113-FR-040 names it. */
  readonly name: string;
  /** The runner a person starts, from the package root. */
  readonly runner: string;
  /** `unverified` until the owner runs the paid part by hand. */
  readonly status: "unverified";
  /** Why it is unverified. */
  readonly reason: string;
  /** Who starts it: always a person; never a job, never a schedule. */
  readonly startedBy: "a person";
  /** Neither is a check of a change, and neither is a release check. */
  readonly kind: "paid task; not a check of a change and not a release check";
};

/** The verification record of the paid tasks of F113-FR-040. */
export const PAID_TASK_RECORDS: readonly PaidTaskRecord[] = Object.freeze([
  Object.freeze({
    task: "T029",
    name: "behaviour smoke with a stub CLI",
    runner: "evals/behaviour-smoke.ts",
    status: "unverified",
    reason: PAID_TASK_REASON,
    startedBy: "a person",
    kind: "paid task; not a check of a change and not a release check",
  }),
  Object.freeze({
    task: "T029",
    name: "with-and-without report",
    runner: "evals/with-and-without-report.ts",
    status: "unverified",
    reason: PAID_TASK_REASON,
    startedBy: "a person",
    kind: "paid task; not a check of a change and not a release check",
  }),
  // T037 (phase 9) - the trigger suite on the built package: three runs per
  // skill, threshold 0.8, no ablation, the model from the configuration of the
  // run, logged with date, model ids, calls, cost and the hash of the skill
  // texts (F113-FR-038, F113-FR-039). Through the release check of T035 it is
  // a precondition of a release, and of NO test.
  Object.freeze({
    task: "T037",
    name: "trigger suite on the built package",
    runner: "evals/trigger-suite.ts",
    status: "unverified",
    reason: PAID_TASK_REASON,
    startedBy: "a person",
    kind: "paid task; not a check of a change and not a release check",
  }),
]);

/** True where the paid part of every recorded task is still unrun. */
export function paidPartsAreUnrun(): boolean {
  return PAID_TASK_RECORDS.every((record) => record.status === "unverified");
}

function assertRecordMatchesTheRunners(): void {
  for (const record of PAID_TASK_RECORDS) {
    if (!existsSync(join(PACKAGE, record.runner))) {
      throw new Error(
        `the verification record names the runner \`${record.runner}\`, which is not on disk`,
      );
    }
    if (record.status !== "unverified") {
      throw new Error(
        `the paid part of \`${record.name}\` was never run in this lane; the record may not ` +
          `claim ${record.status} (${PAID_TASK_REASON})`,
      );
    }
  }
}

assertRecordMatchesTheRunners();
