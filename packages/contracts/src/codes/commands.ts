/**
 * T093 — the table of exit codes per command (annex G, §G.4; F100-FR-182).
 *
 * The 28 rows of the key `perCommand` of `data/exit-codes.json` as data and
 * type, with the general rules: a usage error keeps the as-is code of its
 * command, an uncaught error exits 70, an unknown first argument (verb) exits
 * 1, and an unknown sub-command exits with the code of the row of its
 * command.
 *
 * Row 7 of `data/closed-sets.json` gives no literals of its own: it refers to
 * this table, and registers through T070 from here (`exitCodePerCommandSet`).
 */
import exitCodes from "../../data/exit-codes.json" with { type: "json" };
import { defineByReference, type SetByReference } from "../enums/index.ts";

/** The section of annex G that owns this table. */
export const ANNEX_SECTION = "annex G, §G.4" as const;

type RawRow = { Command: string; Codes: string };

const RAW = (exitCodes as { perCommand: RawRow[] }).perCommand;

/** One row of the table of §G.4. */
export type CommandCodeRow = {
  /** The cell "Command", verbatim. */
  readonly command: string;
  /** The cell "Codes", verbatim. */
  readonly codes: string;
  /** Every number the cell names, in the order it names them. */
  readonly numbers: readonly number[];
  /** The command names the cell holds in back-ticks, where it holds any. */
  readonly commands: readonly string[];
  /** True where the cell names the family `128+N`. */
  readonly signalFamily: boolean;
};

/** Every number a "Codes" cell names, without the citations of an annex. */
function numbersOf(cell: string): readonly number[] {
  const text = cell
    .replace(/annex [A-Z] §[A-Z]\.\d+/g, "")
    .replace(/§[A-Z]\.\d+/g, "")
    .replace(/\(CQ-\d+\)/g, "")
    .replace(/F\d{3}-FR-\d+/g, "")
    .replace(/128\+N/g, "");
  return Object.freeze([...new Set([...text.matchAll(/\b(\d+)\b/g)].map((m) => Number(m[1])))]);
}

/** Every row of the table, in the order of the annex (F100-FR-182). */
export const commandCodeRows: readonly CommandCodeRow[] = Object.freeze(
  RAW.map((row) =>
    Object.freeze({
      command: row.Command,
      codes: row.Codes,
      numbers: numbersOf(row.Codes),
      commands: Object.freeze([...row.Command.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "")),
      signalFamily: /128\+N/.test(row.Codes),
    }),
  ),
);

/** The count of rows the annex holds. */
export const COMMAND_ROW_COUNT: number = commandCodeRows.length;

/**
 * The row of a command. The cell of a row may name several commands
 * (`status`, `tail`, `events`, …); the lookup matches any of them, and falls
 * back to a match on the cell itself.
 */
export function commandCodeRow(command: string): CommandCodeRow | undefined {
  const name = command.replace(/`/g, "").trim();
  return (
    commandCodeRows.find((r) => r.commands.includes(name)) ??
    commandCodeRows.find((r) => r.command.replace(/`/g, "").trim() === name)
  );
}

/** The numbers a command may exit with (F100-FR-182). */
export function codesOf(command: string): readonly number[] {
  return commandCodeRow(command)?.numbers ?? Object.freeze([]);
}

/** Every command name the table names in back-ticks, each once. */
export const COMMANDS_OF_THE_TABLE: readonly string[] = Object.freeze([
  ...new Set(commandCodeRows.flatMap((r) => [...r.commands])),
]);

/** Row 7 of §X.6 — the codes per command, registered through T070 here. */
export const exitCodePerCommandSet: SetByReference<string> = defineByReference(7, [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "10",
  "11",
  "20",
  "21",
  "22",
  "23",
  "24",
  "128+N",
  "70",
  "127",
  "128",
  "130",
] as const);

/* ------------------------------------------------------------------ *
 * F100-FR-182 — the general rules.
 * ------------------------------------------------------------------ */

/** F100-FR-182 — an uncaught error of any command exits 70. */
export const UNCAUGHT_ERROR_CODE = 70 as const;

/** F100-FR-182 — an unknown first argument (verb) exits 1. */
export const UNKNOWN_VERB_CODE = 1 as const;

/** §G.4 — a front-door command given a flag without its value exits 127. */
export const FLAG_WITHOUT_ITS_VALUE_CODE = 127 as const;

/** §G.4 — `--protocol` exits 0. */
export const PROTOCOL_CODE = 0 as const;

/** §G.4 — the shim of a host package refuses a protocol mismatch with 4. */
export const PROTOCOL_MISMATCH = Object.freeze({
  code: 4,
  line: "[SPECSTRIDE-REFUSE] action=protocol reason=protocol-mismatch",
  namesTheDoctor: true,
} as const);

/**
 * F100-FR-182 — the usage-error code of a command, which keeps the as-is code
 * of that command. The commands that came from modules with an argument
 * parser use 2; the front door uses 1 for wrong usage of `feedback`, 3 for
 * `host event` and `wait`, and `run` uses 3 for an unknown argument.
 */
export const USAGE_ERROR_CODES: Readonly<Record<string, number>> = Object.freeze({
  run: 3,
  resume: 3,
  learn: 2,
  spec: 2,
  reverse: 2,
  supervise: 2,
  doctor: 3,
  wait: 3,
  "host event": 3,
  verify: 3,
  "harness verify": 3,
  "state export": 3,
  "state import": 3,
  "state adopt": 3,
  "config show": 3,
  "config schema": 3,
  "tripwire clear": 3,
  "pipeline run": 2,
});

/** F100-FR-182 — a usage error keeps the as-is code of its command. */
export function usageErrorCodeOf(command: string): number | undefined {
  return USAGE_ERROR_CODES[command.replace(/`/g, "").trim()];
}

/**
 * F100-FR-182 — an unknown sub-verb of a command exits with the code of the
 * row of that command: the usage-error code of the row, where it has one.
 * CQ-201 reads "unknown subcommand" as an unknown first argument only, so an
 * unknown verb at the front door is `UNKNOWN_VERB_CODE`.
 */
export function unknownSubcommandCodeOf(command: string): number {
  return usageErrorCodeOf(command) ?? UNKNOWN_VERB_CODE;
}

/** The kinds of ending the general rules of §G.4 cover. */
export const GENERAL_RULES = Object.freeze({
  uncaughtError: UNCAUGHT_ERROR_CODE,
  unknownVerb: UNKNOWN_VERB_CODE,
  flagWithoutItsValue: FLAG_WITHOUT_ITS_VALUE_CODE,
  protocol: PROTOCOL_CODE,
  protocolMismatch: PROTOCOL_MISMATCH.code,
} as const);

/** How a command ended, when the caller asks for its code (F100-FR-182). */
export type CommandEnding =
  | { readonly kind: "uncaught-error" }
  | { readonly kind: "unknown-verb" }
  | { readonly kind: "unknown-subcommand"; readonly command: string }
  | { readonly kind: "usage-error"; readonly command: string }
  | { readonly kind: "flag-without-its-value" }
  | { readonly kind: "protocol-mismatch" };

/** F100-FR-182 — the code of a command for one of the general rules. */
export function codeOfEnding(ending: CommandEnding): number {
  switch (ending.kind) {
    case "uncaught-error":
      return UNCAUGHT_ERROR_CODE;
    case "unknown-verb":
      return UNKNOWN_VERB_CODE;
    case "unknown-subcommand":
      return unknownSubcommandCodeOf(ending.command);
    case "usage-error":
      return usageErrorCodeOf(ending.command) ?? UNKNOWN_VERB_CODE;
    case "flag-without-its-value":
      return FLAG_WITHOUT_ITS_VALUE_CODE;
    case "protocol-mismatch":
      return PROTOCOL_MISMATCH.code;
  }
}
