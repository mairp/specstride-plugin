/**
 * T135 — THE SEVEN SUB-COMMANDS OF `verify` AND THEIR ARGUMENTS
 * (F105-FR-039; `research.md` D-14 keeps the names of the baseline, because
 * operators' scripts use them).
 *
 * The table is READ from this feature's own contract,
 * `../../data/verify-cli.json` — the copy T004 made of
 * `specs/105-verification/contracts/verify-cli.json` — so the names, the
 * required flags, the optional flags and the codes of a sub-command cannot
 * drift from the specification. What this module adds is the KINDS of the
 * flags (a value, a switch, a whole number) and the two refusals the
 * requirement names in words:
 *
 *   * `--phase` of `run` takes a whole number or the literal `release`, and
 *     anything else exits 3 with `--phase must be an integer or release`
 *     (B-1054);
 *   * `create` needs its working directory and its specification to exist and
 *     its two output places to be absolute and inside the working directory
 *     (B-1046 to B-1050, B-1053).
 *
 * A USAGE ERROR KEEPS THE AS-IS CODE OF ITS COMMAND (F100-FR-182): the
 * baseline's argument parser exits 2, and the table of feature 100 maps that
 * onto 3 for `verify` (`usageErrorCodeOf`). An unknown sub-command exits with
 * the code of the row of `verify` as well (`unknownSubcommandCodeOf`). Both
 * numbers are read from feature 100 and never spelled here.
 */
import { isAbsolute } from "node:path";
import { unknownSubcommandCodeOf, usageErrorCodeOf } from "@specstride/contracts/codes/commands";
import { VerificationError } from "../plan/record.ts";
import { COMMAND, CONTRACT, VERIFICATION_ERROR } from "./exit-codes.ts";

/** The seven sub-commands, in the order of the contract and the baseline. */
export const SUB_COMMANDS: readonly string[] = Object.freeze(
  CONTRACT.subCommands.map((one) => one.name),
);

/** The count the requirement names: seven. */
export const SUB_COMMAND_COUNT = 7 as const;

/** The contract holds exactly the seven. */
export const THE_CONTRACT_HOLDS_SEVEN: boolean = SUB_COMMANDS.length === SUB_COMMAND_COUNT;

/** The names of the baseline, which `research.md` D-14 keeps. */
export const NAMES_OF_THE_BASELINE: readonly string[] = Object.freeze([
  "create",
  "validate",
  "slice",
  "scaffold",
  "run",
  "prestage",
  "prestage-report",
]);

/** The contract's names are the baseline's, in its order. */
export const NAMES_ARE_THE_BASELINE_S: boolean =
  JSON.stringify(SUB_COMMANDS) === JSON.stringify(NAMES_OF_THE_BASELINE);

/** What a flag carries. */
export const FLAG_KINDS = ["value", "switch", "whole-number"] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];

/**
 * The kind of every flag of the seven sub-commands. `--required` is the one
 * switch (`action="store_true"` at the baseline); `--phase` of `slice`,
 * `prestage` and `prestage-report` and `--attempt` everywhere are whole
 * numbers (`type=int`); `--phase` of `run` is a VALUE, because the baseline
 * declares it without a type and reads the literal `release` itself.
 */
export const FLAG_KIND_OF: Readonly<Record<string, FlagKind>> = Object.freeze({
  "--required": "switch",
  "--attempt": "whole-number",
});

/** One sub-command of `verify`, as this module reads the contract. */
export type SubCommand = {
  readonly name: string;
  readonly required: readonly string[];
  readonly optional: readonly string[];
  readonly flags: readonly string[];
  readonly codes: readonly number[];
  readonly prints: string;
};

/** The kind of one flag of one sub-command. */
export function flagKindOf(subCommand: string, flag: string): FlagKind {
  if (flag === "--phase") return subCommand === "run" ? "value" : "whole-number";
  return FLAG_KIND_OF[flag] ?? "value";
}

/** Every sub-command of the contract, with its flags. */
export const subCommands: readonly SubCommand[] = Object.freeze(
  CONTRACT.subCommands.map((one) =>
    Object.freeze({
      name: one.name,
      required: Object.freeze([...one.required]),
      optional: Object.freeze([...one.optional]),
      flags: Object.freeze([...one.required, ...one.optional]),
      codes: Object.freeze([...one.codes]),
      prints: one.prints,
    }),
  ),
);

/** One sub-command by name, or `undefined` where the name is unknown. */
export function subCommandOf(name: string): SubCommand | undefined {
  return subCommands.find((one) => one.name === name);
}

/* ------------------------------------------------------------------ *
 * Usage errors.
 * ------------------------------------------------------------------ */

/**
 * The code of a usage error of `verify`, read from feature 100's table
 * (F100-FR-182, `USAGE_ERROR_CODES`). It is the same 3 the requirement names
 * for a verification error, which is why `verify` has four codes and not five.
 */
export const USAGE_ERROR_CODE: number = usageErrorCodeOf(COMMAND) ?? VERIFICATION_ERROR;

/** The code of an unknown sub-command, read from feature 100 (F100-FR-182). */
export const UNKNOWN_SUB_COMMAND_CODE: number = unknownSubcommandCodeOf(COMMAND);

/** The usage code of this command is the code of a verification error. */
export const THE_USAGE_CODE_IS_THE_ERROR_CODE: boolean = USAGE_ERROR_CODE === VERIFICATION_ERROR;

/**
 * A refusal of the ARGUMENT LIST itself. `VerificationError.code` is the
 * literal 3 of row 52 of annex X §X.6, which is right for every refusal of
 * this command's own work; a usage error carries the code of its own rule of
 * §G.4 instead, so `usageCode` is a second field rather than an override of a
 * narrower type.
 */
export class VerifyUsageError extends VerificationError {
  /** The code of this usage error, from feature 100's table (F100-FR-182). */
  readonly usageCode: number;
  constructor(message: string, usageCode: number = USAGE_ERROR_CODE) {
    super(message);
    this.name = "VerifyUsageError";
    this.usageCode = usageCode;
  }
}

/** The message of an unknown sub-command. */
export function unknownSubCommandMessage(name: string): string {
  return (
    `unknown sub-command of ${COMMAND}: ${name} ` + `(it is one of ${SUB_COMMANDS.join(", ")})`
  );
}

/** The message of a sub-command that was not given. */
export const NO_SUB_COMMAND_MESSAGE = `${COMMAND} needs a sub-command: ${SUB_COMMANDS.join(", ")}`;

/** The message of a required flag that was not given. */
export function missingFlagMessage(subCommand: string, flag: string): string {
  return `${COMMAND} ${subCommand}: the argument ${flag} is required`;
}

/** The message of a flag that the sub-command does not take. */
export function unknownFlagMessage(subCommand: string, flag: string): string {
  return `${COMMAND} ${subCommand}: unrecognized argument ${flag}`;
}

/** The message of a flag whose value is missing. */
export function flagWithoutItsValueMessage(subCommand: string, flag: string): string {
  return `${COMMAND} ${subCommand}: the argument ${flag} expects one value`;
}

/** The message of a whole-number flag whose value is not one. */
export function notAWholeNumberMessage(subCommand: string, flag: string, value: string): string {
  return `${COMMAND} ${subCommand}: the argument ${flag} must be a whole number (got: ${value})`;
}

/* ------------------------------------------------------------------ *
 * The phase of `run` (B-1054).
 * ------------------------------------------------------------------ */

/** The literal `--phase` of `run` takes beside a whole number. */
export const RELEASE = "release" as const;

/**
 * The as-is message of a `--phase` that is neither (B-1054,
 * `lib/verification_plan.py`:2404). It is written AFTER the component name.
 */
export const PHASE_MESSAGE = "--phase must be an integer or release" as const;

/** A whole number as the baseline's `int()` reads one, or `undefined`. */
export function wholeNumberOf(value: string): number | undefined {
  const text = value.trim();
  if (!/^[+-]?[0-9]+$/.test(text)) return undefined;
  return Number(text);
}

/**
 * The phase of `run`: a whole number or the literal `release`. ANYTHING ELSE
 * IS A VERIFICATION ERROR with the as-is message, which the command ends with
 * the code 3 (B-1054).
 */
export function phaseOfRun(value: string): number | typeof RELEASE {
  if (value === RELEASE) return RELEASE;
  const number = wholeNumberOf(value);
  if (number === undefined) throw new VerificationError(PHASE_MESSAGE);
  return number;
}

/* ------------------------------------------------------------------ *
 * Parsing.
 * ------------------------------------------------------------------ */

/** The argument list of one call, after parsing. */
export type ParsedArguments = {
  readonly subCommand: SubCommand;
  /** The value of each flag that was given; a switch carries the text `true`. */
  readonly values: Readonly<Record<string, string>>;
};

/** The value of a flag, or `undefined` where it was not given. */
export function flagValueOf(parsed: ParsedArguments, flag: string): string | undefined {
  return parsed.values[flag];
}

/** True where a switch was given. */
export function flagSwitchOf(parsed: ParsedArguments, flag: string): boolean {
  return parsed.values[flag] === "true";
}

/** The whole number of a flag, or `undefined` where it was not given. */
export function flagWholeNumberOf(parsed: ParsedArguments, flag: string): number | undefined {
  const text = parsed.values[flag];
  if (text === undefined) return undefined;
  const number = wholeNumberOf(text);
  if (number === undefined) {
    throw new VerifyUsageError(notAWholeNumberMessage(parsed.subCommand.name, flag, text));
  }
  return number;
}

/**
 * Parse the argument list of `verify`. The first argument is the
 * sub-command; the rest are its flags, in either of the two forms the
 * baseline's parser accepts, `--flag value` and `--flag=value`.
 *
 * A flag that the sub-command does not take, a required flag that is absent,
 * a value that is missing and a whole number that is not one are USAGE ERRORS
 * and carry the code of the row of `verify` (F100-FR-182).
 */
export function parseVerifyArguments(argv: readonly string[]): ParsedArguments {
  const first = argv[0];
  if (first === undefined) throw new VerifyUsageError(NO_SUB_COMMAND_MESSAGE);
  const subCommand = subCommandOf(first);
  if (subCommand === undefined) {
    throw new VerifyUsageError(unknownSubCommandMessage(first), UNKNOWN_SUB_COMMAND_CODE);
  }
  const values: Record<string, string> = {};
  let index = 1;
  while (index < argv.length) {
    const argument = argv[index] as string;
    const at = argument.indexOf("=");
    const flag = at > 2 ? argument.slice(0, at) : argument;
    if (!subCommand.flags.includes(flag)) {
      throw new VerifyUsageError(unknownFlagMessage(subCommand.name, argument));
    }
    const kind = flagKindOf(subCommand.name, flag);
    if (kind === "switch") {
      if (at > 2) throw new VerifyUsageError(unknownFlagMessage(subCommand.name, argument));
      values[flag] = "true";
      index += 1;
      continue;
    }
    if (at > 2) {
      values[flag] = argument.slice(at + 1);
      index += 1;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new VerifyUsageError(flagWithoutItsValueMessage(subCommand.name, flag));
    }
    values[flag] = value;
    index += 2;
  }
  for (const flag of subCommand.required) {
    if (values[flag] === undefined) {
      throw new VerifyUsageError(missingFlagMessage(subCommand.name, flag));
    }
  }
  const parsed = Object.freeze({ subCommand, values: Object.freeze({ ...values }) });
  // Every whole-number flag is read once here, so a value that is not one is
  // a usage error of the ARGUMENT LIST and not of a later step.
  for (const flag of subCommand.flags) {
    if (flagKindOf(subCommand.name, flag) === "whole-number") flagWholeNumberOf(parsed, flag);
  }
  return parsed;
}

/* ------------------------------------------------------------------ *
 * The arguments of `create` (B-1046 to B-1050, B-1053).
 * ------------------------------------------------------------------ */

/** The as-is message of a specification place that is not absolute. */
export function specsNotAbsoluteMessage(path: string): string {
  return `specification path must be absolute: ${path}`;
}

/** The as-is message of a specification that is not there. */
export function specsNotFoundMessage(path: string): string {
  return `specification not found: ${path}`;
}

/** The as-is message of a specification that does not validate. */
export function invalidSpecificationMessage(errors: readonly string[]): string {
  return `invalid specification: ${errors.join("; ")}`;
}

/** The as-is message of a commands document whose place is not absolute. */
export function commandsNotAbsoluteMessage(path: string): string {
  return `verification commands path must be absolute: ${path}`;
}

/** The as-is message of a commands document that is not there. */
export function commandsNotFoundMessage(path: string): string {
  return `verification commands not found: ${path}`;
}

/**
 * The checks of `--specs` that belong to the ARGUMENT LIST: absolute, and a
 * file that is there (B-1047). What the format is, and whether the document
 * validates in it, belongs to the grammar owner EP-03 and arrives as a port.
 */
export function requireSpecificationFile(input: {
  readonly path: string;
  readonly isFile: (path: string) => boolean;
  readonly realPath: (path: string) => string;
}): string {
  if (!isAbsolute(input.path)) {
    throw new VerificationError(specsNotAbsoluteMessage(input.path));
  }
  const real = input.realPath(input.path);
  if (!input.isFile(real)) throw new VerificationError(specsNotFoundMessage(real));
  return real;
}

/** The checks of `--verification-commands`: absolute, and a file (B-1053). */
export function requireCommandsDocument(input: {
  readonly path: string;
  readonly isFile: (path: string) => boolean;
}): string {
  if (!isAbsolute(input.path)) {
    throw new VerificationError(commandsNotAbsoluteMessage(input.path));
  }
  if (!input.isFile(input.path)) {
    throw new VerificationError(commandsNotFoundMessage(input.path));
  }
  return input.path;
}
