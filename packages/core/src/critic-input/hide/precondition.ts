// Feature 117 (T077) — the precondition of a critic-class call of the form
// `read-only-tools` (F117-FR-041).
//
// No call of the second form starts while a pass of the proposer is alive,
// or while a detached job that the pass launched writes into the working
// tree. The LIVENESS of both goes through the process primitive of the
// kernel (`startTimeOf`, `findByRunToken` of `@specstride/kernel/proc`) —
// this module starts no process and imports no process module.
//
// Before the call the runtime verifies that the worker root of the run is
// empty (through the `FileMovingPort`) and sweeps it ONCE where it is not,
// by the operation `sweep` of the tree-store service (feature 100 annex D
// §D.2, F100-FR-121). The sweep itself is HANDED IN BY THE COMPOSITION ROOT
// — this module removes no tree itself and imports no file-system module;
// it only decides, and the decision is never delayed beyond one sweep.
import type { FileMovingPort } from "../ports.ts";
import { TREE_CHANGED_OUTSIDE_PASS } from "./hide.ts";

/** The liveness view this module needs, as the process primitive of the kernel gives it. */
export type LivenessView = {
  /** The start time of a process, or `null` where it is gone. */
  startTimeOf(pid: number): number | null;
  /** The pids that carry a run token — the detached jobs of the pass. */
  findByRunToken(runToken: string): readonly number[];
};

/**
 * The operation `sweep` of the tree-store service (annex D §D.2), handed in
 * by the composition root. This module calls it at most ONCE per decision
 * and removes no tree itself.
 */
export type WorkerRootSweep = {
  /** Sweep the worker root named; returns what was removed. */
  sweep(workerRoot: string): { readonly removed: readonly string[] };
};

/** What the check of one call is given. */
export type PreconditionInput = {
  /** The process primitive of the kernel, or a view of it (liveness only). */
  readonly process: LivenessView;
  /** The file-moving port: the emptiness test of the worker root. */
  readonly mover: FileMovingPort;
  /** The `sweep` operation of the tree-store service, from the composition root. */
  readonly sweep: WorkerRootSweep | undefined;
  /** The pids of the pass of the proposer, when one is recorded for this run. */
  readonly passPids?: readonly number[] | undefined;
  /** The run token whose detached jobs the pass launched. */
  readonly runToken?: string | undefined;
  /** The worker root of the run, absolute. */
  readonly workerRoot: string;
};

/** The decision for one call. */
export type PreconditionOutcome =
  /** A pass is alive or a writing job of the pass is alive: the call does not start. */
  | { readonly outcome: "refused"; readonly reasons: readonly string[] }
  /** The worker root was empty: the call starts. */
  | { readonly outcome: "clear" }
  /** The worker root was swept once and is empty now: the call starts. */
  | { readonly outcome: "swept" }
  /** Still not empty after ONE sweep: a tool-less critic is called with the kind. */
  | {
      readonly outcome: "tree-changed-outside-pass";
      readonly kind: typeof TREE_CHANGED_OUTSIDE_PASS;
      readonly remaining: readonly string[];
    };

/**
 * The precondition of one critic-class call of the form `read-only-tools`
 * (F117-FR-041): no live pass, no writing job of the pass, an empty worker
 * root after at most one sweep. The call is NEVER delayed beyond one sweep.
 */
export function checkCallPrecondition(input: PreconditionInput): PreconditionOutcome {
  const reasons: string[] = [];
  for (const pid of input.passPids ?? []) {
    if (input.process.startTimeOf(pid) !== null) {
      reasons.push(`pass-alive:${pid}`);
    }
  }
  if (input.runToken !== undefined) {
    for (const pid of input.process.findByRunToken(input.runToken)) {
      // A detached job of the pass writes into the working tree while it is
      // alive; liveness through the same primitive.
      if (input.process.startTimeOf(pid) !== null) {
        reasons.push(`writing-job:${pid}`);
      }
    }
  }
  if (reasons.length > 0) {
    return { outcome: "refused", reasons };
  }

  if (input.mover.listWorkerRoot().length === 0) {
    return { outcome: "clear" };
  }
  // Exactly ONE sweep (F117-FR-041): no loop, no second attempt, no delay.
  if (input.sweep !== undefined) {
    input.sweep.sweep(input.workerRoot);
  }
  const remaining = input.mover.listWorkerRoot();
  if (remaining.length === 0) {
    return { outcome: "swept" };
  }
  return {
    outcome: "tree-changed-outside-pass",
    kind: TREE_CHANGED_OUTSIDE_PASS,
    remaining,
  };
}
