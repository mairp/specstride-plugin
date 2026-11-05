/**
 * T044 — the call point `afterPass` (F115-FR-003, F115-FR-011; annex D §D.1
 * row 2).
 *
 * After a pass ends, the layer looks at the checkpoint of the pass and
 * returns `accept`, `refuse` or `none` — exactly the closed set
 * `AFTER_PASS_RESULTS` of the interface — together with the refusal reason
 * when it refuses. The reading goes through the port `CheckpointClaimReader`
 * of `@specstride/contracts/src/ports/layer-micro.ts` (T003); the file rules
 * live in the edge package, not here.
 *
 * A refused checkpoint changes no counter of the layer, and the pass is
 * accounted as in the classic loop (F115-FR-011): this module returns the
 * result and holds no counter. On a harness that is only declared, at level
 * L1, the pass still ends at the checkpoint and the point behaves the same
 * (F115-FR-003): the point never tests a harness name.
 *
 * Purity: imports `@specstride/contracts` only; no `node:fs`, no process.
 */
import {
  type CheckpointClaimReader,
  type epLoopLayer as epLoopLayerTypes,
} from "@specstride/contracts";

export type AfterPassResult = epLoopLayerTypes.AfterPassResult;

/** What the engine hands the point: the reader of the claim and the pass. */
export type AfterPassInput = {
  /** The port of T003, as the composition root handed it to the layer. */
  readonly claimReader: CheckpointClaimReader;
  /** The unit the pass worked; the checkpoint of that unit is read. */
  readonly unitId: string;
  /** True when the pass was killed; the checkpoint is refused (`pass-killed`). */
  readonly passKilled?: boolean;
  /** True when a yield artifact was written in the same pass (`yield-in-pass`). */
  readonly yieldInPass?: boolean;
  /** The task ids of the phase, from `run:<runId>:task-list` (F115-FR-012). */
  readonly phaseTaskIds: readonly string[];
};

/** What the layer returns at `afterPass`. */
export type AfterPassOutcome = {
  readonly result: AfterPassResult;
  /** The refusal reason, exactly one of the closed set, when refused. */
  readonly refusalReason?: string;
  /** The task ids the validated claim names, when accepted. */
  readonly tasks?: readonly string[];
};

/**
 * F115-FR-011 — read the claim of the pass and accept it or refuse it with
 * exactly one reason of the closed set of refusal reasons. A pass that ended
 * without a checkpoint returns `none`: there is nothing to refuse, and the
 * pass is accounted as in the classic loop.
 */
export async function afterPass(input: AfterPassInput): Promise<AfterPassOutcome> {
  const read = await input.claimReader.readClaim(input.unitId);
  if (!read.ok) {
    if ("absent" in read) return { result: "none" };
    return { result: "refuse", refusalReason: read.refusal.reason };
  }
  if (input.passKilled === true) return { result: "refuse", refusalReason: "pass-killed" };
  if (input.yieldInPass === true) return { result: "refuse", refusalReason: "yield-in-pass" };
  const known = new Set(input.phaseTaskIds);
  if (read.claim.tasks.length === 0) return { result: "refuse", refusalReason: "empty" };
  for (const id of read.claim.tasks) {
    if (!known.has(id)) return { result: "refuse", refusalReason: "foreign-id" };
  }
  return { result: "accept", tasks: [...read.claim.tasks] };
}

/** The type of a prompt block, for the callers of the point. */
export type PromptBlock = epLoopLayerTypes.PromptBlock;
