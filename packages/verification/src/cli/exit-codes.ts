/**
 * T135 — THE EXIT CODES OF THE PUBLIC COMMAND `verify` (F105-FR-039).
 *
 * Four codes and no more: 0 on success; 3 on any verification error, with the
 * message after the component name on standard error; 10 when the
 * verification gate failed; 11 when a command staged before failed.
 *
 * NONE OF THE FOUR IS SPELLED HERE AS A FREE NUMBER. Each is read from the
 * table of annex G §G.4 that feature 100 owns (`codesOf("verify")` of
 * `@specstride/contracts/codes/commands`) and cross-checked against this
 * feature's own contract, `../../data/verify-cli.json`, which is the copy
 * `specs/105-verification/contracts/verify-cli.json` T004 made. A change of
 * either table that this feature did not follow fails at load, not in a test.
 *
 * The component name is the same rule as the usage line of the failure
 * summary (`../summary/failure-summary.ts`): the baseline writes its own
 * implementation file name in front of a refusal, and rule N-15 of the
 * normalization contract maps that onto the LOGICAL COMPONENT NAME of annex X
 * §X.8 and compares the text after the name. For the verification-plan module
 * that name is `verification`, and it is READ from the component-name table
 * rather than typed here a second time.
 */
import { codesOf } from "@specstride/contracts/codes/commands";
import normalization from "@specstride/contracts/data/normalization.json" with { type: "json" };
import contract from "../../data/verify-cli.json" with { type: "json" };

/** The command of the table of annex G §G.1 this module belongs to. */
export const COMMAND = "verify" as const;

type ContractShape = {
  readonly command: string;
  readonly exitCodes: Readonly<Record<string, string>>;
  readonly subCommands: readonly {
    readonly name: string;
    readonly required: readonly string[];
    readonly optional: readonly string[];
    readonly prints: string;
    readonly codes: readonly number[];
  }[];
};

/** This feature's own contract of `verify` (`data/verify-cli.json`). */
export const CONTRACT: ContractShape = contract as ContractShape;

/** The contract is the one of this command and not of another. */
export const CONTRACT_IS_OF_THIS_COMMAND: boolean = CONTRACT.command === COMMAND;

/** The four codes of the contract, as numbers, in the order it lists them. */
export const CODES_OF_THE_CONTRACT: readonly number[] = Object.freeze(
  Object.keys(CONTRACT.exitCodes).map((key) => Number(key)),
);

/** The codes the table of annex G §G.4 gives `verify` (F100-FR-182). */
export const CODES_OF_ANNEX_G: readonly number[] = Object.freeze([...codesOf(COMMAND)]);

/**
 * The two tables agree. They are compared as SETS because §G.4 writes its
 * cell as prose and this feature's contract as keys of a record; the members
 * are what both state.
 */
export const THE_TABLES_AGREE: boolean =
  CODES_OF_THE_CONTRACT.length === CODES_OF_ANNEX_G.length &&
  CODES_OF_THE_CONTRACT.every((code) => CODES_OF_ANNEX_G.includes(code));

/**
 * THE MEMBERSHIP GUARD, as a pure function of its inputs. The branch that
 * refuses is unreachable while the two tables agree, which is exactly why it
 * must not be an `if` buried inside `codeOf`: a test drives it with a number
 * the row does not hold, and so the guard is a rule a test holds and not a
 * comment. `codeOf` below calls it and nothing else does the check.
 */
export function assertCodeIsOfTheRow(
  code: number,
  row: readonly number[] = CODES_OF_ANNEX_G,
): number {
  if (!row.includes(code)) {
    throw new Error(`the code ${code} of \`verify\` is not in the table of annex G §G.4`);
  }
  return code;
}

/** One code of `verify`, read from the contract by what it means. */
function codeOf(meaning: string): number {
  const found = Object.entries(CONTRACT.exitCodes).find(([, text]) => text === meaning);
  if (found === undefined) {
    throw new Error(`the contract of \`verify\` names no code for ${meaning}`);
  }
  return assertCodeIsOfTheRow(Number(found[0]));
}

/** 0 — the sub-command succeeded. */
export const SUCCESS: number = codeOf("success");

/** 3 — any verification error, with its message on standard error. */
export const VERIFICATION_ERROR: number = codeOf("any verification error");

/** 10 — the verification gate failed. */
export const GATE_FAILED: number = codeOf("the verification gate failed");

/** 11 — a command staged before failed, for information. */
export const STAGED_COMMAND_FAILED: number = codeOf(
  "a command staged before failed (for information)",
);

/** The four codes, in the order of the contract. */
export const EXIT_CODES = Object.freeze([
  SUCCESS,
  VERIFICATION_ERROR,
  GATE_FAILED,
  STAGED_COMMAND_FAILED,
]);

/** A number that is not one of the four is not a code of this command. */
export function isExitCodeOfVerify(code: number): boolean {
  return EXIT_CODES.includes(code);
}

/* ------------------------------------------------------------------ *
 * The component name in front of a refusal (rule N-15).
 * ------------------------------------------------------------------ */

type ComponentRow = {
  readonly "As-is implementation file": string;
  readonly "Logical component name": string;
};

const COMPONENT_ROWS = (normalization as { readonly componentNames: readonly ComponentRow[] })
  .componentNames;

/** The row of annex X §X.8 that covers the verification-plan module. */
export const COMPONENT_ROW = "The verification-plan module" as const;

/**
 * The logical component name of this feature's module, READ from the
 * component-name table of the normalization contract (annex X §X.8).
 */
export const COMPONENT: string = (() => {
  const row = COMPONENT_ROWS.find((one) => one["As-is implementation file"] === COMPONENT_ROW);
  if (row === undefined) {
    throw new Error(`the component-name table names no row \`${COMPONENT_ROW}\``);
  }
  return row["Logical component name"].replace(/`/g, "").trim();
})();

/** The rule of the normalization contract that maps the one onto the other. */
export const NORMALIZATION_RULE = "N-15" as const;

/**
 * The line a refusal writes on standard error. The baseline writes
 * `verification_plan.py: <message>\n` (`lib/verification_plan.py`:2417); under
 * rule N-15 the prefix is the logical component name and THE TEXT AFTER IT IS
 * COMPARED, so the message is the baseline's byte for byte.
 */
export function errorLine(message: string): string {
  return `${COMPONENT}: ${message}\n`;
}

/** The text of a refusal line AFTER the name of the component (rule N-15). */
export function textAfterTheComponent(line: string): string {
  const at = line.indexOf(": ");
  return at < 0 ? line : line.slice(at + 2);
}
