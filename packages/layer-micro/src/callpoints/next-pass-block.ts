/**
 * T071 — the failure block of a repair, with the marker token of the run and
 * the repair note (F115-FR-018; annex D §D.1 row 4, the call point
 * `nextPassBlock`).
 *
 * For a repair the proposer gets the output of the check on the current tree
 * and never an earlier one: a block is built only from the results whose tree
 * fingerprint equals the fingerprint of the tree now. Every block carries a
 * marker token that is random per run, so that a block from an earlier check
 * cannot be replayed as this one. For a taint the block names the protected
 * path that changed. The second repair runs in a fresh session with a note
 * built by the runtime (the runtime note, not prose of the proposer; the
 * note of a checkpoint never reaches a critic-class call — T-23).
 *
 * The block is a prompt contribution: it decides nothing and approves
 * nothing (IR-01).
 *
 * Purity: imports `@specstride/contracts` only; no `node:fs`, no process.
 */

/**
 * The randomness source of the marker token. Injectable so the
 * characterization tests can pin a token; the runtime gives
 * `crypto`-backed randomness.
 */
export type RandomSource = () => number;

/**
 * F115-FR-018 — the marker token of a run: random per run, carried by every
 * failure block of the run. Two calls give two tokens.
 */
export function markerToken(runId: string, random: RandomSource = Math.random): string {
  const word = Math.floor(random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0");
  return `loop-marker-${runId}-${word}`;
}

/** One observed output of one command of the check, on one tree. */
export type CheckOutput = {
  /** The id of the command in the check manifest. */
  readonly id: string;
  /** The exit status the runtime observed. */
  readonly exit: number;
  /** The output the runtime captured for the command. */
  readonly output: string;
  /** The tree fingerprint the command ran on. */
  readonly treeFingerprint: string;
  /** The protected path that changed, when the runner carried a taint. */
  readonly changedProtectedPath?: string;
};

/** The input of the failure block. */
export type FailureBlockInput = {
  /** The run the marker token belongs to. */
  readonly runId: string;
  /** The outputs the runtime observed, in manifest order. */
  readonly outputs: readonly CheckOutput[];
  /** The tree fingerprint of the tree now (the current tree). */
  readonly treeFingerprint: string;
  /** The ordinal of this repair: 1 for the first, 2 for the second. */
  readonly repairIndex: number;
  /** The randomness for the marker token (injected; default `Math.random`). */
  readonly random?: RandomSource;
};

/** The failure block the next pass gets. */
export type FailureBlock = {
  /** The block text, with the marker token in it. */
  readonly text: string;
  /** The marker token the block carries. */
  readonly marker: string;
  /** True: every line of the block is from the current tree. */
  readonly currentTree: true;
  /** The ordinal of the repair the block belongs to. */
  readonly repairIndex: number;
  /**
   * True only for the second repair (F115-FR-018): it runs in a fresh
   * session with a note built by the runtime.
   */
  readonly freshSession?: boolean;
  /** The note the runtime built, for the second repair. */
  readonly runtimeNote?: string;
};

/**
 * F115-FR-018 — build the failure block of a repair from the outputs on the
 * current tree only. An output of an earlier tree never enters the block.
 */
export function failureBlock(input: FailureBlockInput): FailureBlock {
  const marker = markerToken(input.runId, input.random ?? Math.random);
  const current = input.outputs.filter(
    (output) => output.treeFingerprint === input.treeFingerprint,
  );
  const lines: string[] = [
    `[LOOP] repair ${input.repairIndex} of the unit; check output on the current tree (${input.treeFingerprint}); marker ${marker}`,
  ];
  for (const output of current) {
    lines.push(`- ${output.id}: exit ${output.exit}`);
    if (output.changedProtectedPath !== undefined) {
      // F115-FR-018 — for a taint the block names the protected path that
      // changed.
      lines.push(`  protected path changed: ${output.changedProtectedPath}`);
    }
    for (const line of output.output.split("\n")) lines.push(`  | ${line}`);
  }
  const freshSession = input.repairIndex >= 2;
  return {
    text: lines.join("\n"),
    marker,
    currentTree: true,
    repairIndex: input.repairIndex,
    ...(freshSession ? { freshSession: true } : {}),
    ...(freshSession
      ? {
          runtimeNote:
            "Built by the runtime for the second repair: the same unit failed twice; " +
            `marker ${marker}. Work from a fresh session on the current tree.`,
        }
      : {}),
  };
}

/** The input of the call point `nextPassBlock`. */
export type NextPassBlockInput = {
  readonly runId: string;
  /** The last check ended with the outcome `repair` when this is set. */
  readonly lastOutcome: "repair" | "unresolved" | "kept" | "unchecked" | "none";
  /** The outputs the runtime observed on the last check, in manifest order. */
  readonly outputs: readonly CheckOutput[];
  /** The tree fingerprint of the tree now. */
  readonly treeFingerprint: string;
  /** The ordinal of the repair the next pass is: 0 when none. */
  readonly repairIndex: number;
  readonly random?: RandomSource;
};

/** What the call point `nextPassBlock` returns (annex D §D.1 row 4). */
export type NextPassBlockResult = {
  readonly directive: "contribute" | "none";
  readonly block?: FailureBlock;
};

/**
 * T071 — the call point `nextPassBlock`: for a repair, the failure block of
 * the next pass; for anything else, `none`.
 */
export function nextPassBlock(input: NextPassBlockInput): NextPassBlockResult {
  if (input.lastOutcome !== "repair" || input.repairIndex < 1) {
    return { directive: "none" };
  }
  return {
    directive: "contribute",
    block: failureBlock({
      runId: input.runId,
      outputs: input.outputs,
      treeFingerprint: input.treeFingerprint,
      repairIndex: input.repairIndex,
      ...(input.random === undefined ? {} : { random: input.random }),
    }),
  };
}
