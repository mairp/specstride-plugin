/**
 * T188 — the CLI protocol, version 1 (annex G, §G.1; F100-FR-170,
 * F100-FR-171, F100-FR-172).
 *
 * This module holds: the protocol integer; the list of commands with their
 * owners as data from `data/cli-protocol.json`; the rule that raises the
 * integer; the three public commands of the Specstride baseline with their
 * codes; the shape of a `--json` record; and the handler of
 * `specstride --protocol` as a plain function that feature 119 mounts.
 *
 * Row 157 of `data/closed-sets.json` ("Verbs of the front door") takes its
 * members from the commands of this module.
 */
import cliProtocol from "../../data/cli-protocol.json" with { type: "json" };

/** The section of annex G that owns the protocol. */
export const ANNEX_SECTION = "annex G, §G.1" as const;

/** The protocol integer of §G.1 (F100-FR-170). */
export const PROTOCOL: number = (cliProtocol as { protocol: number }).protocol;

/** The schema id of `data/cli-protocol.json`. */
export const DATA_SCHEMA_ID: string = (cliProtocol as { schema: string }).schema;

type RawCommand = { Command: string; "What it does": string; Owner: string };

/** One row of the table of commands of §G.1. */
export type CommandRow = {
  /** The `Command` cell as the annex writes it, prose and all. */
  readonly cell: string;
  /** The verbs the cell names, each without its back-ticks. */
  readonly verbs: readonly string[];
  /** What the command does. */
  readonly whatItDoes: string;
  /** The `Owner` cell: the feature that specifies the command. */
  readonly owner: string;
  /** The feature number the `Owner` cell names first. */
  readonly ownerFeature: string;
  /**
   * True for the one row of §G.1 whose cell names no verb in back-ticks
   * because the annex leaves the spelling to the owner: "The launch-contract
   * commands: derive …, validate, promote, render. The spelling of the
   * commands is the owner's".
   */
  readonly spellingIsTheOwners: boolean;
};

/** The verbs a `Command` cell names: every back-ticked word of the cell. */
function verbsOf(cell: string): readonly string[] {
  const out: string[] = [];
  for (const match of cell.matchAll(/`([^`]+)`/g)) {
    const verb = match[1].trim();
    if (verb !== "") out.push(verb);
  }
  return Object.freeze(out);
}

/** Load the table of commands of §G.1 (F100-FR-170). */
export function loadCommands(): readonly CommandRow[] {
  return Object.freeze(
    (cliProtocol as { commands: RawCommand[] }).commands.map((row) => {
      const owner = row.Owner;
      const first = /\d+/.exec(owner);
      const verbs = verbsOf(row.Command);
      return Object.freeze({
        cell: row.Command,
        verbs,
        whatItDoes: row["What it does"],
        owner,
        ownerFeature: first === null ? "" : first[0],
        spellingIsTheOwners: verbs.length === 0,
      });
    }),
  );
}

/** The rows of the table of commands, in the order of the annex. */
export const commandRows: readonly CommandRow[] = loadCommands();

/** Every verb of protocol 1, in the order of the table (row 157 of §X.6). */
export const COMMANDS: readonly string[] = Object.freeze(
  commandRows.flatMap((row) => [...row.verbs]),
);

/**
 * The acts of the one row of §G.1 whose spelling the owner decides
 * (F100-FR-170: a change that RENAMES a command raises the integer, so the
 * spelling is pinned by the owner's specification and not here).
 */
export const ACTS_WHOSE_SPELLING_THE_OWNER_DECIDES = [
  "derive",
  "validate",
  "promote",
  "render",
] as const;

/** The owner of the row whose spelling it decides (§G.1). */
export const OWNER_OF_THAT_ROW = "107" as const;

/** The rows of §G.1 whose cell names its verbs in back-ticks. */
export const ROWS_WITH_VERBS: readonly CommandRow[] = Object.freeze(
  commandRows.filter((row) => !row.spellingIsTheOwners),
);

/** The rows of §G.1 whose spelling the owner decides; §G.1 names exactly one. */
export const ROWS_WHOSE_SPELLING_THE_OWNER_DECIDES: readonly CommandRow[] = Object.freeze(
  commandRows.filter((row) => row.spellingIsTheOwners),
);

/** The row that names a verb, or `undefined` for a verb the table does not hold. */
export function commandRow(verb: string): CommandRow | undefined {
  return commandRows.find((row) => row.verbs.includes(verb));
}

/** The owner of a command, as the `Owner` cell writes it. */
export function ownerOf(verb: string): string | undefined {
  return commandRow(verb)?.owner;
}

/** True where the verb is a command of protocol 1. */
export function isCommand(verb: string): boolean {
  return COMMANDS.includes(verb);
}

/**
 * F100-FR-170 — the change kinds that MUST raise the protocol integer: the
 * removal or the rename of a command, a flag, a line or a field of `--json`
 * output.
 */
export const RAISES_THE_INTEGER = [
  "a command removed",
  "a command renamed",
  "a flag removed",
  "a flag renamed",
  "a line removed",
  "a line renamed",
  "a field of `--json` output removed",
  "a field of `--json` output renamed",
] as const;
export type BreakingChange = (typeof RAISES_THE_INTEGER)[number];

/** One change of the surface, as the rule reads it. */
export type SurfaceChange = {
  readonly subject: "command" | "flag" | "line" | "json-field";
  readonly kind: "added" | "removed" | "renamed";
};

/**
 * F100-FR-170 — the protocol integer after a change: a removal or a rename of
 * a command, a flag, a line or a field of `--json` output raises it; anything
 * added leaves it as it is.
 */
export function protocolAfter(
  changes: readonly SurfaceChange[],
  current: number = PROTOCOL,
): number {
  const breaking = changes.some((c) => c.kind === "removed" || c.kind === "renamed");
  return breaking ? current + 1 : current;
}

/** True where a change of the surface raises the integer (F100-FR-170). */
export function raisesTheInteger(change: SurfaceChange): boolean {
  return change.kind === "removed" || change.kind === "renamed";
}

/* ------------------------------------------------------------------ *
 * F100-FR-170 — what a host package does with the integer.
 * ------------------------------------------------------------------ */

/** The exit code and the line of a protocol mismatch in a host shim (§G.4). */
export const MISMATCH_EXIT_CODE = 4 as const;
export const MISMATCH_LINE =
  "[SPECSTRIDE-REFUSE] action=protocol reason=protocol-mismatch" as const;

/** The command a host package names in the refusal (F100-FR-170). */
export const MISMATCH_NAMES_THE_COMMAND = "doctor" as const;

/**
 * F100-FR-170 — a host package compares the integer with the range it
 * supports and refuses a mismatch with ONE line that names the doctor.
 */
export function compareProtocol(
  integer: number,
  supported: { readonly from: number; readonly to: number },
): { readonly ok: true } | { readonly ok: false; readonly exitCode: 4; readonly line: string } {
  if (integer >= supported.from && integer <= supported.to) return Object.freeze({ ok: true });
  return Object.freeze({
    ok: false,
    exitCode: MISMATCH_EXIT_CODE,
    line:
      `${MISMATCH_LINE} detail="protocol ${integer} is outside ${supported.from}..` +
      `${supported.to}; run \`specstride ${MISMATCH_NAMES_THE_COMMAND}\`"`,
  });
}

/* ------------------------------------------------------------------ *
 * F100-FR-171 — the three public commands of the baseline.
 * ------------------------------------------------------------------ */

/**
 * F100-FR-171 — of the module entry points of the Specstride baseline exactly
 * three are public commands, with the exit codes of the baseline.
 */
export const PUBLIC_BASELINE_COMMANDS = ["spec", "verify", "learn"] as const;
export type PublicBaselineCommand = (typeof PUBLIC_BASELINE_COMMANDS)[number];

/** The codes of §G.4 of each of the three, keyed by the command. */
export const PUBLIC_BASELINE_CODES: Readonly<Record<PublicBaselineCommand, readonly number[]>> =
  Object.freeze({
    spec: Object.freeze([0, 1, 2, 3]),
    verify: Object.freeze([0, 3, 10, 11]),
    learn: Object.freeze([0, 1, 2, 3, 4]),
  });

/** F100-FR-171 — the pass loop and the critic are no commands. */
export const NOT_COMMANDS = ["the pass loop", "the critic"] as const;
export const THEIR_CODES_ARE = "fields of result records (annex E §E.4)" as const;

/* ------------------------------------------------------------------ *
 * F100-FR-172 — the shape of `--json` output.
 * ------------------------------------------------------------------ */

/** F100-FR-172 — every command that prints facts offers `--json`. */
export const JSON_FLAG = "--json" as const;
export const VERBOSE_FLAG = "--verbose" as const;

/** F100-FR-172 — `--json` and `--verbose` are opt-in. */
export const OPT_IN_FLAGS = [JSON_FLAG, VERBOSE_FLAG] as const;

/** The shape of a `--json` record: one record with a `schema` field (§G.1). */
export type JsonRecord = {
  /** The schema id of the record; every `--json` record carries one. */
  readonly schema: string;
  readonly [key: string]: unknown;
};

/** The one command whose compatibility output prints one record per line (§G.1). */
export const ONE_RECORD_PER_LINE_IN_COMPATIBILITY_OUTPUT = "events" as const;

/** What a `--json` record never holds (F100-FR-172). */
export const NEVER_IN_JSON_OUTPUT = [
  "escape sequences for colour",
  "a secret value",
  "an account identifier",
  "a token",
] as const;

/** Why a `--json` record was refused. */
export type JsonRefusal = "not-a-record" | "no-schema-field" | "keys-out-of-order";

/**
 * F100-FR-172 — the check of a `--json` record: one record with a `schema`
 * field, in a stable order of keys. The stable order is the order the writer
 * declares; where it declares none, the keys are compared sorted.
 */
export function checkJsonRecord(
  value: unknown,
  keyOrder?: readonly string[],
):
  | { readonly ok: true; readonly record: JsonRecord }
  | { readonly ok: false; readonly reason: JsonRefusal; readonly message: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return Object.freeze({
      ok: false as const,
      reason: "not-a-record" as const,
      message: "the output of `--json` must be one record (F100-FR-172)",
    });
  }
  const record = value as Record<string, unknown>;
  if (typeof record.schema !== "string" || record.schema === "") {
    return Object.freeze({
      ok: false as const,
      reason: "no-schema-field" as const,
      message: "the record of `--json` must carry a field `schema` (F100-FR-172)",
    });
  }
  const keys = Object.keys(record);
  const expected = keyOrder === undefined ? [...keys].sort() : [...keyOrder];
  const seen = keys.filter((k) => expected.includes(k));
  const wanted = expected.filter((k) => keys.includes(k));
  if (seen.join("\u0000") !== wanted.join("\u0000")) {
    return Object.freeze({
      ok: false as const,
      reason: "keys-out-of-order" as const,
      message:
        `the keys of a record of \`--json\` must be in a stable order; found ` +
        `${seen.join(", ")} (F100-FR-172)`,
    });
  }
  return Object.freeze({ ok: true as const, record: record as JsonRecord });
}

/* ------------------------------------------------------------------ *
 * The handler of `specstride --protocol`, which feature 119 mounts.
 * ------------------------------------------------------------------ */

/** The flag that prints the protocol integer (§G.1). */
export const PROTOCOL_FLAG = "--protocol" as const;

/** The exit code of `--protocol` (§G.4). */
export const PROTOCOL_EXIT_CODE = 0 as const;

/** What the handler of `--protocol` returns: the lines and the exit code. */
export type CommandOutcome = {
  /** The lines of standard output, without their line ends. */
  readonly stdout: readonly string[];
  /** The lines of standard error, without their line ends. */
  readonly stderr: readonly string[];
  /** The exit code. */
  readonly exitCode: number;
};

/**
 * The handler of `specstride --protocol` (F100-FR-170): it prints the integer,
 * and NOTHING else in that call, on standard output, and exits 0. Feature 119
 * mounts this function as the handler of the flag.
 */
export function protocolHandler(): CommandOutcome {
  return Object.freeze({
    stdout: Object.freeze([String(PROTOCOL)]),
    stderr: Object.freeze([]),
    exitCode: PROTOCOL_EXIT_CODE,
  });
}

/** F100-FR-170 — `--protocol` prints the integer and nothing else. */
export const PROTOCOL_PRINTS_NOTHING_ELSE = true as const;

/** The exit code of an unknown first argument (verb) (§G.4, F100-FR-182). */
export const UNKNOWN_VERB_EXIT_CODE = 1 as const;

/** Row 157 of annex X §X.6, whose members are the verbs of the front door. */
export const CLOSED_SET_ROW = 157 as const;
