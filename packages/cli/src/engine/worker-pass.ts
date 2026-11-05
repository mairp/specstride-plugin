/**
 * The dsh path of the engine for a WORKER pass: the `startPass` door of
 * `specstride.harness/1` (annex C §C.1), as the composition root hands it to
 * the group executor of feature 143 (F142-FR-020, F143-FR-010).
 *
 * The pass loop keeps its own single-pass door — `services.runPass`, the
 * `claude` or `dsh` executable of the main line — and nothing of it changes
 * while `loop.parallel.units` is off (F142-SC-001). This module is the other
 * door: one worker of a group, started through the dsh adapter's
 * `dshStartPass` in a process group of its own, with its tree as the write
 * root, a fresh session under the worker id, and the three-variable worker
 * environment of F143-FR-009 (the opaque token, the run token and the
 * temporary directory — no index and no count). The two outputs of the pass
 * land under the run's control root, beside the run's own files, where the
 * engine reads them at the barrier; never inside the worker tree, whose
 * bytes are the audit's to compare (F143-SC-001).
 */
import { mkdirSync } from "node:fs";
import { dshStartPass } from "../../../adapter-dsh/src/start-pass/index.ts";
import type {
  DshPassHandle,
  DshStartPassResult,
} from "../../../adapter-dsh/src/start-pass/index.ts";
import {
  RUN_TOKEN_VARIABLE,
  TEMPORARY_DIRECTORY_VARIABLE,
  WORKER_TOKEN_VARIABLE,
} from "../../../core/src/parallel/group-executor.ts";
import type { ContainmentLevel } from "@specstride/contracts/ep/harness";

export { RUN_TOKEN_VARIABLE, TEMPORARY_DIRECTORY_VARIABLE, WORKER_TOKEN_VARIABLE };

/** What the engine hands over for one worker pass. */
export type WorkerPassInput = {
  /** The worker id: the minted session id of the pass. */
  readonly workerId: string;
  /** The tree of the worker: the working directory and the write root. */
  readonly tree: string;
  /** The opaque token of the worker (F143-FR-009). */
  readonly workerToken: string;
  /** The run token of the group (F143-FR-009). */
  readonly runToken: string;
  /** The temporary directory of the worker, beside its tree (F143-FR-009). */
  readonly temporaryDirectory: string;
  /** The model reference of the proposer, `provider/model`. */
  readonly model: string;
  /** The base model tier, resolved at launch (F143-FR-011). */
  readonly modelTierOrEffort: string;
  /** The containment level the worker runs at. */
  readonly containment: ContainmentLevel;
  /** The prompt reference of the worker pass. */
  readonly promptReference: string;
  /** The time limit of the worker pass, in milliseconds. */
  readonly timeLimitMs: number;
  /** Under the run's control root: where the two outputs of the pass go. */
  readonly outputRoot: string;
  /** The environment of the consumer (the as-is aliases are read from it). */
  readonly env?: Readonly<Record<string, string | undefined>>;
};

/**
 * The worker environment of F143-FR-009: the opaque token, the run token and
 * the temporary directory — three variables, and no index and no count.
 */
export function workerEnvironmentOf(input: {
  readonly workerToken: string;
  readonly runToken: string;
  readonly temporaryDirectory: string;
}): Readonly<Record<string, string>> {
  return Object.freeze({
    [WORKER_TOKEN_VARIABLE]: input.workerToken,
    [RUN_TOKEN_VARIABLE]: input.runToken,
    [TEMPORARY_DIRECTORY_VARIABLE]: input.temporaryDirectory,
  });
}

/** The names of the worker environment, as the port's allow-list states them. */
export function workerEnvironmentAllowList(): readonly string[] {
  return [WORKER_TOKEN_VARIABLE, RUN_TOKEN_VARIABLE, TEMPORARY_DIRECTORY_VARIABLE];
}

/**
 * Starts ONE worker of a group on the dsh path (annex C §C.1, `startPass`):
 * its tree as the working directory and the write root, a fresh session under
 * the worker id, the three-variable worker environment allow-listed, and the
 * two outputs under the run's control root.
 */
export async function startDshWorkerPass(input: WorkerPassInput): Promise<DshStartPassResult> {
  mkdirSync(input.outputRoot, { recursive: true });
  return dshStartPass({
    promptReference: input.promptReference,
    workingDirectory: input.tree,
    writeRoot: input.tree,
    session: { kind: "fresh", sessionId: input.workerId },
    model: input.model,
    modelTierOrEffort: input.modelTierOrEffort,
    containment: input.containment,
    environmentAllowList: workerEnvironmentAllowList(),
    environment: workerEnvironmentOf(input),
    timeLimitMs: input.timeLimitMs,
    transport: "subprocess",
    env: input.env,
    outputDirectory: input.outputRoot,
  });
}

/** The type of the handle the engine holds for one worker, re-exported for its callers. */
export type { DshPassHandle };
