/**
 * T008 — the exit-code table of the three launch-contract commands and of
 * `launch`, from annex G §G.4 (the generated table of feature 100,
 * `@specstride/contracts` `data/exit-codes.json`, rows "Launch-contract
 * commands" and "`launch`"), this spec and
 * `specs/107-launch-contract/contracts/commands.md`.
 *
 * The as-is codes are 0, 2, 20 and 23: they are the codes the baseline of
 * mixture-of-loops exits with, and the oracle compares them. The codes 4, 21
 * and 24 of `launch` are the product's: 4 is the code of a refusal of
 * `launch` (annex G §G.4, row "`launch`"), 21 and 24 are the pipeline's own
 * refusals that a refusal of `launch` may carry (F123-FR-024). The table is
 * data: the commands read it, the tests compare it against the generated
 * annex table, and no command writes its own exit code outside it.
 */

/** One row of the exit-code table of one command. */
export type ExitCodeRow = {
  /** The exit code. */
  readonly code: number;
  /** When the command exits with it. */
  readonly meaning: string;
  /** True when the baseline of mixture-of-loops already exits with it. */
  readonly asIs: boolean;
};

/** One command's exit-code table. */
export type ExitCodeTable = {
  readonly command: string;
  /** The row of annex G §G.4 (the generated table) the table is read from. */
  readonly annexRow: string;
  readonly codes: readonly ExitCodeRow[];
};

/** The exit-code table of `contract derive` (commands.md; §G.4: 0; 2 any error). */
export const DERIVE_EXIT_CODES: ExitCodeTable = Object.freeze({
  command: "contract derive",
  annexRow: "Launch-contract commands: Derive: 0; 2 any error",
  codes: Object.freeze([
    Object.freeze({ code: 0, meaning: "the draft was written", asIs: true }),
    Object.freeze({
      code: 2,
      meaning: "any error: an unreadable source, a refused answer included",
      asIs: true,
    }),
  ]),
});

/** The exit-code table of `contract validate` (commands.md; §G.4). */
export const VALIDATE_EXIT_CODES: ExitCodeTable = Object.freeze({
  command: "contract validate",
  annexRow:
    "Launch-contract commands: Validate: 0 valid; 2 promotion together with allowing a draft; 20 invalid; 23 stale sources or changed learning decisions",
  codes: Object.freeze([
    Object.freeze({ code: 0, meaning: "valid", asIs: true }),
    Object.freeze({ code: 2, meaning: "`--promote` together with `--allow-draft`", asIs: true }),
    Object.freeze({ code: 20, meaning: "invalid", asIs: true }),
    Object.freeze({
      code: 23,
      meaning: "stale sources, or changed learning decisions",
      asIs: true,
    }),
  ]),
});

/** The exit-code table of `contract render` (commands.md; §G.4). */
export const RENDER_EXIT_CODES: ExitCodeTable = Object.freeze({
  command: "contract render",
  annexRow: "Launch-contract commands: Render: 0; 2 usage; 20 cannot render; 23 stale",
  codes: Object.freeze([
    Object.freeze({ code: 0, meaning: "rendered", asIs: true }),
    Object.freeze({ code: 2, meaning: "usage", asIs: true }),
    Object.freeze({ code: 20, meaning: "cannot render, an edited launcher included", asIs: true }),
    Object.freeze({ code: 23, meaning: "stale", asIs: true }),
  ]),
});

/** The exit-code table of `launch` (commands.md; §G.4, row "`launch`"). */
export const LAUNCH_EXIT_CODES: ExitCodeTable = Object.freeze({
  command: "launch",
  annexRow:
    "`launch`: 0 started; 4 attached or refused; 20, 21, 23, 24 where the refusal is one of the pipeline's",
  codes: Object.freeze([
    Object.freeze({ code: 0, meaning: "started; in the mode `dry-run`, reported", asIs: false }),
    Object.freeze({
      code: 4,
      meaning: "attached, or refused (the refusals of this feature included)",
      asIs: false,
    }),
    Object.freeze({
      code: 20,
      meaning: "the pipeline's `invalid-contract`; in `dry-run`, no promoted launch contract",
      asIs: true,
    }),
    Object.freeze({ code: 21, meaning: "the pipeline's `preflight-blocked`", asIs: false }),
    Object.freeze({
      code: 23,
      meaning: "the pipeline's `stale-sources`; in `dry-run`, stale sources",
      asIs: true,
    }),
    Object.freeze({ code: 24, meaning: "the pipeline's `lock-conflict`", asIs: false }),
  ]),
});

/** The exit-code tables of the three commands of this feature, with `launch`. */
export const EXIT_CODE_TABLES: readonly ExitCodeTable[] = Object.freeze([
  DERIVE_EXIT_CODES,
  VALIDATE_EXIT_CODES,
  RENDER_EXIT_CODES,
  LAUNCH_EXIT_CODES,
]);

/** The codes the baseline already exits with, across the three commands. */
export const AS_IS_CODES: readonly number[] = Object.freeze([0, 2, 20, 23]);

/** The exit of one command for one outcome, read from the table. */
export function exitOf(table: ExitCodeTable, code: number): number {
  const row = table.codes.find((one) => one.code === code);
  if (row === undefined) {
    throw new Error(
      `the exit-code table of "${table.command}" holds no code ${code} (annex G §G.4)`,
    );
  }
  return row.code;
}
