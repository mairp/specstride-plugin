/**
 * T073 — the re-run of a failed command and the condition `flaky`
 * (F115-FR-020; IR-14).
 *
 * A failed command is run once more on the same fingerprint. When the second
 * result differs, the command is recorded as `flaky` with both observed
 * results, is excluded from the inner set for the phase attempt, and still
 * runs at the verification gate. When the second result agrees, the failure
 * stands as observed once.
 *
 * Purity: imports `@specstride/contracts` only; no `node:fs`, no process.
 */
import type { CheckResult } from "../unit/outcome.ts";

/** One command of the inner set, as `betweenPasses` names it. */
export type FlakyCommand = {
  readonly id: string;
  readonly argv: readonly string[];
};

/** Why the re-run was made or refused. */
export type RerunRefusal =
  | { readonly rerun: false; readonly reason: "not-failed" }
  | { readonly rerun: false; readonly reason: "different-fingerprint" };

/** The outcome of the re-run of one failed command. */
export type RerunOutcome =
  | {
      /** The failure stood on both runs: the single result is the result. */
      readonly kind: "confirmed";
      readonly result: CheckResult;
    }
  | {
      /**
       * F115-FR-020 — the two runs disagree: the command is `flaky`, with
       * both observed results, excluded for the phase attempt, and still at
       * the verification gate.
       */
      readonly kind: "flaky";
      readonly first: CheckResult;
      readonly second: CheckResult;
      readonly excludedForAttempt: true;
      readonly stillAtVerificationGate: true;
    };

/**
 * F115-FR-020 — a failed command runs once more, only on the same tree
 * fingerprint. The re-run is made by the runtime the caller hands over; the
 * layer reads the two results and compares them.
 */
export function rerunFailedCommand(
  first: CheckResult,
  options: {
    readonly treeFingerprint: string;
    readonly rerunFingerprint: string;
    readonly rerun: () => CheckResult;
  },
): RerunOutcome | RerunRefusal {
  if (first.exit === 0) return { rerun: false, reason: "not-failed" };
  if (options.rerunFingerprint !== options.treeFingerprint) {
    return { rerun: false, reason: "different-fingerprint" };
  }
  const second = options.rerun();
  if (second.exit === first.exit) return { kind: "confirmed", result: first };
  return {
    kind: "flaky",
    first,
    second,
    excludedForAttempt: true,
    stillAtVerificationGate: true,
  };
}

/**
 * F115-FR-020 — the results a check states for a flaky command: both
 * observed results, with the condition `flaky` on each.
 */
export function flakyResults(first: CheckResult, second: CheckResult): readonly CheckResult[] {
  return [
    { ...first, conditions: withFlaky(first.conditions) },
    { ...second, conditions: withFlaky(second.conditions) },
  ];
}

function withFlaky(conditions?: readonly string[]): readonly string[] {
  const base = conditions ?? [];
  return base.includes("flaky") ? base : [...base, "flaky"];
}

/**
 * F115-FR-020 — the inner set of the phase attempt after the exclusions:
 * a flaky command leaves the set for the rest of the attempt.
 */
export function innerSetAfterExclusions(
  innerSet: readonly FlakyCommand[],
  excluded: readonly string[],
): readonly FlakyCommand[] {
  return innerSet.filter((command) => !excluded.includes(command.id));
}

/**
 * F115-FR-020 — a command excluded as flaky still runs at the verification
 * gate: the exclusion is of the inner set of the phase attempt only, never
 * of the gate (IR-03).
 */
export function stillAtVerificationGate(commandId: string, excluded: readonly string[]): boolean {
  return excluded.includes(commandId);
}
