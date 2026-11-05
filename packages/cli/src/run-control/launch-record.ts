/**
 * T042 — the launch records behind the transitions T1, T2, T3 and T17
 * (F102-FR-037; annex E §E.2).
 *
 * The operations that a consumer can ask of the run-state machine are
 * `resume` and `stop`. The CLI writes only the transitions into and out of
 * `created` (F100-FR-142, `TRANSITIONS_OF_THE_CLI`):
 *
 *   T1 — `resume` or `launch` passes the checks: the launch record with
 *        outcome `started` (the launch record IS what T1 writes);
 *   T2 — a launch starts a NEW run: the launch record of the new run id;
 *   T3 — a source hash differs: the launch record with outcome `refused`,
 *        the refusal `source-changed` and the file named;
 *   T17 — `resume` from `blocked-on-human`, `stopped`, `failed` or `dead`:
 *         a NEW launch record for the run continued.
 *
 * `stop` writes a request and NO state. A host writes no transition. T13 and
 * T14 belong to the engine at boundaries and to the runtime root. This
 * module is the only place the CLI builds a launch record for a transition:
 * it refuses any transition outside the four, so no caller can drift into a
 * transition the CLI does not own, and the CLI writes no run state and no
 * other record of a transition (F102-FR-037).
 */
import { randomUUID } from "node:crypto";

import { atomicWriteJson } from "@specstride/kernel";
import type { LaunchRecord } from "@specstride/contracts/records/launch-record";
import {
  mayWrite,
  TRANSITIONS_OF_THE_CLI,
  type TransitionId,
} from "@specstride/contracts/state/run-state";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F102-FR-037"] as const;

/** The transitions the launch records of this module stand behind. */
export const LAUNCH_RECORD_TRANSITIONS = TRANSITIONS_OF_THE_CLI;

/** F102-FR-037 — the CLI writes no run state. */
export const THE_CLI_WRITES_NO_RUN_STATE = true as const;

/** F102-FR-037 — the CLI writes no transition outside T1, T2, T3 and T17. */
export const THE_CLI_WRITES_NO_OTHER_TRANSITION = true as const;

/** F102-FR-037 — `stop` writes a request and no state. */
export const STOP_WRITES_A_REQUEST_AND_NO_STATE = true as const;

/** F102-FR-037 — a host writes no transition. */
export const A_HOST_WRITES_NO_TRANSITION = true as const;

/** The error for a launch record asked for a transition the CLI does not own. */
export class TransitionNotOfTheCliError extends Error {
  constructor(transition: string) {
    super(
      `the CLI writes only ${TRANSITIONS_OF_THE_CLI.join(", ")}; ` +
        `a launch record was asked for ${transition} (F102-FR-037)`,
    );
    this.name = "TransitionNotOfTheCliError";
  }
}

/**
 * Guard: the transition must be one of T1, T2, T3, T17, and the table of
 * annex E §E.2 must give the CLI the write (`mayWrite`, F100-FR-142).
 */
export function assertTransitionOfTheCli(transition: TransitionId | string): void {
  if (!(LAUNCH_RECORD_TRANSITIONS as readonly string[]).includes(transition)) {
    throw new TransitionNotOfTheCliError(transition);
  }
  if (!mayWrite(transition, "cli")) {
    throw new TransitionNotOfTheCliError(transition);
  }
}

/** The common input of the four builders. */
export type LaunchRecordInput = {
  readonly launchId: string;
  readonly runId: string;
  readonly workspaceId: string;
  readonly now: string;
  readonly featureSlug: string | undefined;
  readonly resetCounts: boolean;
  readonly acceptSourceChange: boolean;
  /** `launch` or `resume`, as the command was typed. */
  readonly command: "launch" | "run" | "resume";
};

/** The launch record the four builders produce, with the transition named. */
export type LaunchRecordOfTransition = {
  readonly transition: TransitionId;
  readonly record: LaunchRecord;
};

/** The record body the four transitions share (F102-FR-011, CQ-072). */
function recordOf(input: LaunchRecordInput, outcome: "started" | "refused"): LaunchRecord {
  return {
    schema: "specstride.launch/1",
    launchId: input.launchId,
    runId: input.runId,
    workspaceId: input.workspaceId,
    requestKind: "engine",
    request: {
      command: input.command,
      ...(input.featureSlug !== undefined ? { feature: input.featureSlug } : {}),
    },
    mode: "run",
    // The closed set of the launch record: `first` for a launch that starts
    // a run, `resume` for a resume (annex B §B.7).
    reason: input.command === "resume" ? "resume" : "first",
    host: "cli",
    commentHash: null,
    detachStrategy: "foreground",
    launchNonce: randomUUID(),
    engineExecutable: {},
    createdAt: input.now,
    productVersion: "0.0.0",
    protocol: 1,
    outcome,
    resetCounts: input.resetCounts,
    acceptSourceChange: input.acceptSourceChange,
  };
}

/**
 * T1 — `resume` or `launch` passes the checks: the launch record with
 * outcome `started` (F102-FR-037).
 */
export function launchRecordForT1(input: LaunchRecordInput): LaunchRecordOfTransition {
  assertTransitionOfTheCli("T1");
  return Object.freeze({ transition: "T1" as const, record: recordOf(input, "started") });
}

/**
 * T2 — a launch starts a NEW run (`--new-run`, or nothing to continue): the
 * launch record of the new run id (F102-FR-034, F102-FR-037). The records of
 * the old run stay.
 */
export function launchRecordForT2(input: LaunchRecordInput): LaunchRecordOfTransition {
  assertTransitionOfTheCli("T2");
  return Object.freeze({ transition: "T2" as const, record: recordOf(input, "started") });
}

/**
 * T3 — a source hash differs: the launch record with outcome `refused`, the
 * refusal `source-changed` and the changed file named (F102-FR-015,
 * F102-FR-037).
 */
export function launchRecordForT3(
  input: LaunchRecordInput,
  namedFiles: string,
): LaunchRecordOfTransition {
  assertTransitionOfTheCli("T3");
  return Object.freeze({
    transition: "T3" as const,
    record: {
      ...recordOf(input, "refused"),
      refusal: "source-changed",
      refusalFile: namedFiles,
    },
  });
}

/**
 * T17 — `resume` from `blocked-on-human`, `stopped`, `failed` or `dead`: a
 * NEW launch record for the run continued (F102-FR-023, F102-FR-037).
 */
export function launchRecordForT17(
  input: LaunchRecordInput,
  fromState: string,
): LaunchRecordOfTransition {
  assertTransitionOfTheCli("T17");
  if (!["blocked-on-human", "stopped", "failed", "dead"].includes(fromState)) {
    throw new TransitionNotOfTheCliError(`T17 from ${fromState}`);
  }
  return Object.freeze({ transition: "T17" as const, record: recordOf(input, "started") });
}

/**
 * The write behind every transition: the kernel atomic write of the launch
 * record, refused for any transition outside the four (F102-FR-037).
 */
export function writeLaunchRecordForTransition(
  path: string,
  built: LaunchRecordOfTransition,
): void {
  assertTransitionOfTheCli(built.transition);
  atomicWriteJson(path, built.record);
}
