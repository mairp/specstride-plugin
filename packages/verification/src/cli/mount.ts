/**
 * T136 — MOUNT THE SUB-COMMAND MODULE OF `verify` IN THE CLI THROUGH THE
 * COMMAND TABLE OF FEATURE 100 (annex G §G.1).
 *
 * The CLI of feature 100 (layer L6) is what a host calls; `@specstride/cli`
 * does not import this package and must not — the `mayImport` of
 * `@specstride/verification` is `@specstride/contracts` and
 * `@specstride/kernel`, and a package of layer L1 cannot reach up to L6.
 * The mount is therefore a VALUE this package EXPORTS and the composition
 * root installs: one `MountedCommand` whose `command` is the row of §G.1 that
 * names this feature as its owner, whose `codes` are the row of §G.4, whose
 * `subCommands` are the seven of F105-FR-039, and whose `handler` is
 * `runVerify`.
 *
 * NOTHING OF THE MOUNT IS TYPED HERE TWICE. The row, the owner and the codes
 * are READ from `@specstride/contracts/data/cli-protocol.json` and from the
 * table of annex G §G.4; `mountIsConsistent` is the predicate that says the
 * three agree, and `mountVerify` REFUSES to build a mount for which they do
 * not. So a change of §G.1 that moved this command, renamed it or gave it
 * another owner fails at the mount and not in a test of a later feature.
 */
import cliProtocol from "@specstride/contracts/data/cli-protocol.json" with { type: "json" };
import { COMMANDS_OF_THE_TABLE, commandCodeRow } from "@specstride/contracts/codes/commands";
import type { CommandCodeRow } from "@specstride/contracts/codes/commands";
import { CODES_OF_ANNEX_G, COMMAND, EXIT_CODES } from "./exit-codes.ts";
import { SUB_COMMANDS, SUB_COMMAND_COUNT } from "./arguments.ts";
import { runVerify } from "./verify.ts";
import type { VerifyPorts, VerifyResult } from "./verify.ts";

/** One row of the command table of annex G §G.1. */
export type ProtocolCommandRow = {
  readonly Command: string;
  readonly "What it does": string;
  readonly Owner: string;
};

/** The section of annex G that holds the command table. */
export const ANNEX_SECTION = "annex G, §G.1" as const;

/** The protocol integer the table belongs to (F100-FR-170). */
export const PROTOCOL: number = (cliProtocol as { readonly protocol: number }).protocol;

/** Every row of the command table of §G.1, as feature 100 holds it. */
export const PROTOCOL_COMMANDS: readonly ProtocolCommandRow[] = Object.freeze([
  ...(cliProtocol as { readonly commands: readonly ProtocolCommandRow[] }).commands,
]);

/** The feature that owns `verify` in the table of §G.1. */
export const OWNER = "105" as const;

/** The row of §G.1 that names `verify`, or `undefined` where none does. */
export const PROTOCOL_ROW: ProtocolCommandRow | undefined = PROTOCOL_COMMANDS.find(
  (row) => row.Command.replace(/`/g, "").trim() === COMMAND,
);

/** The row of §G.4 that gives `verify` its codes (F100-FR-182). */
export const CODE_ROW: CommandCodeRow | undefined = commandCodeRow(COMMAND);

/** The table of §G.1 names this command. */
export const THE_COMMAND_IS_IN_THE_TABLE: boolean = PROTOCOL_ROW !== undefined;

/** The table of §G.1 names THIS FEATURE as its owner. */
export const THIS_FEATURE_OWNS_IT: boolean = PROTOCOL_ROW?.Owner.trim() === OWNER;

/** The table of §G.4 names this command too. */
export const THE_COMMAND_HAS_A_CODE_ROW: boolean =
  CODE_ROW !== undefined && COMMANDS_OF_THE_TABLE.includes(COMMAND);

/**
 * Whether a list of codes IS the row of §G.4, as sets (F100-FR-182). It is a
 * function of its two inputs on purpose: with the real tables it is always
 * true, so only a test that hands it a wrong list can hold the rule.
 */
export function codesAreTheRowS(
  codes: readonly number[],
  row: readonly number[] = CODES_OF_ANNEX_G,
): boolean {
  return codes.length === row.length && codes.every((code) => row.includes(code));
}

/** The codes of the mount are the codes of §G.4, as sets (F100-FR-182). */
export const THE_CODES_ARE_THE_ROW_S: boolean = codesAreTheRowS(EXIT_CODES);

/** The mount holds the seven sub-commands of F105-FR-039. */
export const SEVEN_SUB_COMMANDS: boolean = SUB_COMMANDS.length === SUB_COMMAND_COUNT;

/** Every condition a mount of this command must satisfy, each by name. */
export const MOUNT_CONDITIONS = Object.freeze({
  theCommandIsInTheTable: THE_COMMAND_IS_IN_THE_TABLE,
  thisFeatureOwnsIt: THIS_FEATURE_OWNS_IT,
  theCommandHasACodeRow: THE_COMMAND_HAS_A_CODE_ROW,
  theCodesAreTheRowS: THE_CODES_ARE_THE_ROW_S,
  sevenSubCommands: SEVEN_SUB_COMMANDS,
});

/** The shape of the conditions: one boolean per name. */
export type MountConditions = Readonly<Record<string, boolean>>;

/** True where every condition of a set holds. */
export function mountIsConsistent(conditions: MountConditions = MOUNT_CONDITIONS): boolean {
  return Object.values(conditions).every((one) => one);
}

/** The conditions that do NOT hold, by name; empty where they all do. */
export function brokenConditions(
  conditions: MountConditions = MOUNT_CONDITIONS,
): readonly string[] {
  return Object.freeze(
    Object.entries(conditions)
      .filter(([, holds]) => !holds)
      .map(([name]) => name),
  );
}

/** The refusal a mount gives when the tables and this module disagree. */
export class MountRefusedError extends Error {
  readonly broken: readonly string[];
  constructor(broken: readonly string[]) {
    super(
      `\`${COMMAND}\` cannot be mounted: the command table of ${ANNEX_SECTION} and this ` +
        `module disagree (${broken.join(", ")})`,
    );
    this.name = "MountRefusedError";
    this.broken = Object.freeze([...broken]);
  }
}

/**
 * What the CLI of feature 100 installs for one command. It is the narrowest
 * shape that carries the row of §G.1, the codes of §G.4 and one handler; the
 * CLI reads it and never reads a file of this package.
 */
export type MountedCommand = {
  /** The name of the command as §G.1 spells it. */
  readonly command: string;
  /** The feature that owns it in §G.1. */
  readonly owner: string;
  /** The cell "What it does" of §G.1, verbatim. */
  readonly whatItDoes: string;
  /** The protocol integer the mount belongs to (F100-FR-170). */
  readonly protocol: number;
  /** The names of the sub-commands, in the order of the contract. */
  readonly subCommands: readonly string[];
  /** The codes of its row of §G.4. */
  readonly codes: readonly number[];
  /** The one call. */
  readonly handler: (input: {
    readonly argv: readonly string[];
    readonly ports?: VerifyPorts | undefined;
  }) => Promise<VerifyResult>;
};

/**
 * THE GUARD OF THE MOUNT, as a function of the conditions it is given. With
 * the real tables every condition holds and the refusal is unreachable, which
 * is why it takes its conditions as an argument: a test hands it a broken set
 * and so the refusal is a rule a test holds.
 */
export function assertMountable(conditions: MountConditions = MOUNT_CONDITIONS): void {
  if (!mountIsConsistent(conditions)) throw new MountRefusedError(brokenConditions(conditions));
}

/**
 * THE MOUNT (T136). It REFUSES when the command table of §G.1, the code table
 * of §G.4 and this feature's own contract of `verify` do not agree, so a
 * removed row, a renamed command, a changed owner or a lost sub-command is a
 * failure at the mount rather than a command that quietly does nothing.
 */
export function mountVerify(): MountedCommand {
  assertMountable();
  const row = PROTOCOL_ROW as ProtocolCommandRow;
  return Object.freeze({
    command: COMMAND,
    owner: row.Owner.trim(),
    whatItDoes: row["What it does"],
    protocol: PROTOCOL,
    subCommands: Object.freeze([...SUB_COMMANDS]),
    codes: Object.freeze([...CODES_OF_ANNEX_G]),
    handler: runVerify,
  });
}

/**
 * The mount as the composition root takes it: a record whose one key is the
 * name of the command, so a root can spread several features' mounts into one
 * command table without knowing any of them by name.
 */
export function verifyCommandTable(): Readonly<Record<string, MountedCommand>> {
  const mounted = mountVerify();
  return Object.freeze({ [mounted.command]: mounted });
}
