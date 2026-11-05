/**
 * T047 — the exemptions and the cycle count (F115-FR-027).
 *
 * A pass that ends at a valid checkpoint MUST leave the short-pass counter
 * and the consecutive breakers as they were: the directives
 * `exemptShortPass` and the breaker exemption follow from the valid
 * checkpoint alone. A pass with a valid checkpoint and a tree fingerprint
 * that differs from that of the checkpoint before MUST be given back
 * (directive `giveIterationBack`), so that it does not raise the pass
 * count, and MUST spend one cycle. The exact argument lists of the inner
 * check set MUST be exempt from the process-level repeat counter
 * (`exemptRepeatCounter`). The passes of a phase attempt are bounded by the
 * pass limit plus the cycle cap plus the yield cap.
 *
 * Inner events change none of: the reject count, the number of the phase
 * attempt, the MALFORMED streak, the input of the oscillation halt, the
 * signature of the diagnostician, the verdict pins, the learning
 * observations, the yield index and the consecutive breakers (IR-06); every
 * function here returns only the directives and the counters of the layer's
 * own namespace — it never touches an outer counter.
 *
 * Purity: imports `@specstride/contracts` only; no `node:fs`, no process.
 */
import { type epLoopLayer as epLoopLayerTypes } from "@specstride/contracts";

type Directive = epLoopLayerTypes.Directive;

/** The three exemptions of F115-FR-027, by their directive names. */
export const EXEMPTIONS = [
  "giveIterationBack",
  "exemptShortPass",
  "exemptRepeatCounter",
] as const satisfies readonly Directive[];
export type Exemption = (typeof EXEMPTIONS)[number];

/** The facts of one ended pass the assessment needs. */
export type PassAccount = {
  /** True when the pass ended at a checkpoint that validated (F115-FR-011). */
  readonly validCheckpoint: boolean;
  /** The tree fingerprint of this pass. */
  readonly treeFingerprint: string;
  /** The tree fingerprint of the checkpoint before; `undefined` for the first. */
  readonly previousCheckpointFingerprint?: string;
};

/** The directives the layer returns for one ended pass. */
export type PassAssessment = {
  readonly directives: readonly Directive[];
  /** Cycles the pass spends: one for a valid checkpoint, else none. */
  readonly cyclesSpent: number;
  /** True when the pass is given back and raises no pass count. */
  readonly givenBack: boolean;
};

/**
 * F115-FR-027 — assess one ended pass. A valid checkpoint leaves the
 * short-pass counter and the consecutive breakers as they were
 * (`exemptShortPass`), and a changed tree against the checkpoint before is
 * given back (`giveIterationBack`) and spends exactly one cycle. A pass
 * without a valid checkpoint is accounted as in the classic loop: no
 * exemption, no cycle of the layer.
 */
export function assessPass(pass: PassAccount): PassAssessment {
  if (!pass.validCheckpoint) {
    return { directives: [], cyclesSpent: 0, givenBack: false };
  }
  const changedTree =
    pass.previousCheckpointFingerprint !== undefined &&
    pass.previousCheckpointFingerprint !== pass.treeFingerprint;
  const directives: Directive[] = ["exemptShortPass"];
  let givenBack = false;
  if (changedTree) {
    directives.push("giveIterationBack");
    givenBack = true;
  }
  return { directives, cyclesSpent: 1, givenBack };
}

/** The argument lists of the inner check set, in manifest order. */
export type InnerSetArgv = readonly (readonly string[])[];

/**
 * F115-FR-027 — the exact argument lists of the inner check set are exempt
 * from the process-level repeat counter. The exemption holds exactly when
 * the lists are the ones of the check manifest, so it is computed from them
 * and returned as the directive; the caller never exempts a list of its own.
 */
export function exemptRepeatCounter(argvLists: InnerSetArgv): {
  readonly directive: Extract<Directive, "exemptRepeatCounter">;
  /** The exact lists the exemption covers, in manifest order. */
  readonly argvLists: InnerSetArgv;
} {
  return { directive: "exemptRepeatCounter", argvLists: [...argvLists] };
}

/**
 * F115-FR-027 — the bound on the passes of one phase attempt: the pass
 * limit plus the cycle cap plus the yield cap.
 */
export function boundOnPasses(caps: {
  readonly passLimit: number;
  readonly cycleCap: number;
  readonly yieldCap: number;
}): number {
  return caps.passLimit + caps.cycleCap + caps.yieldCap;
}

/**
 * F115-FR-022 — the cycle cap of a phase attempt: the number of tasks of
 * the phase plus 6, and at least 12.
 */
export function cycleCapFor(taskCount: number): number {
  return Math.max(taskCount + 6, 12);
}

/** The running cycle count of one phase attempt, in the namespace `micro`. */
export type CycleCounter = { readonly cyclesSpent: number };

/** Spend the cycles of one pass on the counter of the phase attempt. */
export function spendCycles(counter: CycleCounter, cycles: number): CycleCounter {
  return { cyclesSpent: counter.cyclesSpent + cycles };
}
