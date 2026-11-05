/**
 * T218 — the types of a staged result and of the reuse policies of EP-05
 * (annex C, §C.8; F100-FR-232).
 *
 * T106 (`src/ep/check-runner.ts`) holds the interface of the check runner: the
 * six operations, the result with each condition in a field of its own, and the
 * reuse policy a manifest entry may declare. This module adds what F100-FR-232
 * states and the interface alone does not carry:
 *
 *  - a command staged before the verification gate may be reused by the gate
 *    only under the reuse policy its declaration names, and only while the tree
 *    is provably the tree of the staged run: the same revision, and a clean
 *    working tree in the record of the staged run and at the gate, as at the
 *    baseline (B-1128);
 *  - the result of a staged command is kept under
 *    `attempt:<N>:<k>:<n>:prestage`;
 *  - with a loop layer engaged in the phase attempt — that is, with a unit of
 *    work declared in it (annex D, F100-FR-118) — the gate reuses nothing;
 *  - the engine hands that fact to the gate as an input of its call: the gate
 *    reads no record of a loop layer.
 *
 * The rules are stated by the owner of the verification gate (F105-FR-033);
 * this module is the shape they are stated in.
 */
import {
  REUSE_POLICIES,
  type CheckResult,
  type ManifestEntry,
  type ReusePolicy,
} from "./check-runner.ts";

/** The section of annex C that owns the rule. */
export const ANNEX_SECTION = "annex C, §C.8" as const;

/** The point whose interface this extends. */
export const POINT = "EP-05" as const;
export const POINT_ID = "specstride.check-runner/1" as const;

/** The requirement this module carries. */
export const REQUIREMENT = "F100-FR-232" as const;

/** The owner of the rules, and the requirement in which they are stated. */
export const RULE_OWNER = "105" as const;
export const RULE_REQUIREMENT = "F105-FR-033" as const;

/** The as-is behaviour the rule reproduces. */
export const BASELINE_ITEM = "B-1128" as const;

/**
 * F100-FR-232 — the three reuse policies a staged command may declare, as the
 * interface of T106 holds them. A command whose declaration names none is
 * reused by nothing.
 */
export { REUSE_POLICIES, type ReusePolicy };

/** Three policies, no fourth (F100-FR-232). */
export const REUSE_POLICY_COUNT = 3 as const;

/** What each policy means, in the words of the requirement. */
export const REUSE_POLICY_SCOPE: Readonly<Record<ReusePolicy, string>> = Object.freeze({
  "per-attempt": "reusable inside the phase attempt that staged it",
  "per-phase": "reusable inside the phase that staged it",
  "per-run": "reusable inside the run that staged it",
});

/** True when the value is one of the three policies. */
export function isReusePolicy(value: string): value is ReusePolicy {
  return (REUSE_POLICIES as readonly string[]).includes(value);
}

/** The logical name under which the result of a staged command is kept. */
export const PRESTAGE_LOGICAL_NAME = "attempt:<N>:<k>:<n>:prestage" as const;

/**
 * The record of a staged run: what was staged, when, and the two facts that
 * make the tree provably the tree of the staged run.
 */
export type StagedRunRecord = {
  /** The revision of the tree at the time of staging. */
  readonly revision: string;
  /** True when the working tree was clean at the time of staging. */
  readonly workingTreeClean: boolean;
  /** The attempt that staged the command, as `e<k>-a<n>`. */
  readonly attempt: string;
  /** The phase that staged it. */
  readonly phase: number;
  /** The run that staged it. */
  readonly runId: string;
};

/** What the verification gate knows of the tree when it considers a reuse. */
export type TreeAtTheGate = {
  readonly revision: string;
  readonly workingTreeClean: boolean;
  readonly attempt: string;
  readonly phase: number;
  readonly runId: string;
};

/**
 * The result of a staged command, kept under `attempt:<N>:<k>:<n>:prestage`. It
 * carries the result of the run of the command, the policy its declaration
 * named, and the record of the staged run that makes the reuse checkable.
 */
export type StagedResult = {
  /** The entry of the check manifest whose command was staged. */
  readonly entry: ManifestEntry;
  /** The reuse policy the declaration names. */
  readonly reuse: ReusePolicy;
  /** The result of the staged run of the command, as the runner returned it. */
  readonly result: CheckResult;
  /** The record of the staged run. */
  readonly staged: StagedRunRecord;
  /** The logical name under which this result is kept. */
  readonly logicalName: typeof PRESTAGE_LOGICAL_NAME;
};

/**
 * F100-FR-232 — with a loop layer engaged in the phase attempt the gate reuses
 * nothing. The engine hands this fact to the gate as an input of its call; the
 * gate reads no record of a loop layer.
 */
export const GATE_READS_A_RECORD_OF_A_LOOP_LAYER = false as const;
export const THE_ENGINE_HANDS_THE_FACT_AS_AN_INPUT = true as const;

/** The requirement of annex D that says what "engaged" means. */
export const LOOP_LAYER_ENGAGED_MEANS = "a unit of work declared in the phase attempt" as const;
export const LOOP_LAYER_REQUIREMENT = "F100-FR-118" as const;

/** The input of the call of the verification gate that carries the fact. */
export type GateInput = {
  /**
   * True when a loop layer is engaged in the phase attempt, that is, when a
   * unit of work is declared in it (annex D, F100-FR-118). The engine states
   * it; the gate does not work it out.
   */
  readonly loopLayerEngaged: boolean;
};

/** Why a staged result may not be reused (F100-FR-232). */
export const REFUSALS_OF_A_REUSE = [
  "no-reuse-policy",
  "policy-out-of-scope",
  "revision-differs",
  "working-tree-dirty-when-staged",
  "working-tree-dirty-at-the-gate",
  "loop-layer-engaged",
] as const;
export type ReuseRefusal = (typeof REFUSALS_OF_A_REUSE)[number];

/** What the gate decides about one staged result. */
export type ReuseDecision =
  | { readonly reused: true; readonly policy: ReusePolicy }
  | { readonly reused: false; readonly refusal: ReuseRefusal; readonly reason: string };

/** True when the policy admits a reuse from the staged run at this point. */
export function policyAdmits(
  policy: ReusePolicy,
  staged: StagedRunRecord,
  gate: TreeAtTheGate,
): boolean {
  if (staged.runId !== gate.runId) return false;
  if (policy === "per-run") return true;
  if (staged.phase !== gate.phase) return false;
  if (policy === "per-phase") return true;
  return staged.attempt === gate.attempt;
}

/**
 * F100-FR-232 — whether the verification gate may reuse a staged result.
 *
 * The gate reuses nothing when a loop layer is engaged, whatever the policy.
 * Otherwise the policy must admit the reuse at this point, the revision must be
 * the same, and the working tree must have been clean in the record of the
 * staged run and must be clean at the gate.
 */
export function mayReuse(
  staged: StagedResult,
  gate: TreeAtTheGate,
  input: GateInput,
): ReuseDecision {
  const refuse = (refusal: ReuseRefusal, reason: string): ReuseDecision =>
    Object.freeze({ reused: false as const, refusal, reason });
  if (input.loopLayerEngaged) {
    return refuse(
      "loop-layer-engaged",
      `a loop layer is engaged in the phase attempt (${LOOP_LAYER_ENGAGED_MEANS}, ` +
        `annex D, ${LOOP_LAYER_REQUIREMENT}), so the verification gate reuses nothing`,
    );
  }
  if (!isReusePolicy(staged.reuse)) {
    return refuse(
      "no-reuse-policy",
      `the declaration of the staged command names no reuse policy of ` +
        `${REUSE_POLICIES.join(", ")}`,
    );
  }
  if (!policyAdmits(staged.reuse, staged.staged, gate)) {
    return refuse(
      "policy-out-of-scope",
      `the policy \`${staged.reuse}\` is ${REUSE_POLICY_SCOPE[staged.reuse]}, and the ` +
        `verification gate is outside that scope`,
    );
  }
  if (staged.staged.revision !== gate.revision) {
    return refuse(
      "revision-differs",
      `the tree is at ${gate.revision} and the staged run was at ${staged.staged.revision}; ` +
        `the tree must be provably the tree of the staged run (${BASELINE_ITEM})`,
    );
  }
  if (!staged.staged.workingTreeClean) {
    return refuse(
      "working-tree-dirty-when-staged",
      `the record of the staged run does not say the working tree was clean (${BASELINE_ITEM})`,
    );
  }
  if (!gate.workingTreeClean) {
    return refuse(
      "working-tree-dirty-at-the-gate",
      `the working tree is not clean at the verification gate (${BASELINE_ITEM})`,
    );
  }
  return Object.freeze({ reused: true as const, policy: staged.reuse });
}

/**
 * The two facts that make the tree provably the tree of the staged run
 * (F100-FR-232): the same revision, and a clean working tree in the record of
 * the staged run and at the verification gate.
 */
export const PROOF_THAT_THE_TREE_IS_THE_STAGED_TREE = [
  "the same revision",
  "a clean working tree in the record of the staged run",
  "a clean working tree at the verification gate",
] as const;
