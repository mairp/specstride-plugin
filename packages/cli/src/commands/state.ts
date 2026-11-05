/**
 * T064 — the command surface of `state export`, `state import` and
 * `state adopt` (F122-FR-033 to F122-FR-036).
 *
 * The arguments, the lines and the exit codes are
 * `specs/122-detached-runtime/contracts/cli-state-commands.md`:
 *
 *   specstride state export --feature <slug> --out  <file>      [--json]
 *   specstride state import --feature <slug> --from <file>      [--json]
 *   specstride state adopt  --feature <slug> --from <old path>   [--json]
 *
 * WHY THE WORK IS BEHIND A PORT AND NOT AN IMPORT.
 * The behaviour of the three commands is
 * `packages/runtime/src/state/commands.ts`, which is `@specstride/runtime`
 * (L5). This package is the CLI (L6), and rule LR-1 of annex A §A.2 forbids an
 * L6 package to import an L5 one — *between the CLI and the runtime root there
 * are only files* (F100-FR-003), which `tools/import-boundary` checks over the
 * whole product tree. `launch-handshake.ts` keeps the same boundary by holding
 * the few things it needs itself; the state commands are too much for that, so
 * this module declares the three commands as a PORT, structurally, and the
 * composition root hands the runtime's implementations in. No type and no
 * value of `@specstride/runtime` is named here, which is what keeps the rule.
 *
 * So this module owns exactly the command surface, and all of it:
 *
 *   - the argument grammar and every `usage` refusal (exit 3);
 *   - the ONE line of §G.3, printed through the line printer of feature 100,
 *     so a key the table of `[SPECSTRIDE-STATE]` does not hold cannot be
 *     printed at all (F100-FR-178);
 *   - F122-FR-036: a refusal is one line `[SPECSTRIDE-REFUSE]` and is NEVER
 *     printed under `[SPECSTRIDE-STATE]`;
 *   - the exit code of each ending;
 *   - `--json`, and silence under the `parity` profile.
 */
import process from "node:process";
import { resolve as resolvePath } from "node:path";
import { printLine } from "@specstride/contracts/grammar/line-keys";
import { OUTPUT_MODES } from "@specstride/contracts/grammar/output-modes";
import { PROFILE_NAME } from "@specstride/contracts/profile/parity";

/** The command name, as the consumer types it. */
export const COMMAND = "state" as const;

/** The label of these three commands; no other feature prints it (§G.3). */
export const STATE_LABEL = "SPECSTRIDE-STATE" as const;

/** The label every refusal is printed under (§G.3). */
export const REFUSE_LABEL = "SPECSTRIDE-REFUSE" as const;

/** F122-FR-036 — a refusal is never printed under `[SPECSTRIDE-STATE]`. */
export const A_REFUSAL_IS_PRINTED_UNDER_THE_STATE_LABEL = false as const;

/** The three subcommands, in the order of the contract. */
export const SUBCOMMANDS = ["export", "import", "adopt"] as const;
export type Subcommand = (typeof SUBCOMMANDS)[number];

/** The `action` of a refusal of each subcommand (`cli-state-commands.md`). */
export const REFUSAL_ACTION_OF: Readonly<Record<Subcommand, string>> = Object.freeze({
  export: "state-export",
  import: "state-import",
  adopt: "state-adopt",
});

/** The exit codes of annex G §G.4 these commands use (F122-FR-036). */
export const EXIT_OK = 0 as const;
export const EXIT_NO_STATE_OR_VERIFICATION = 1 as const;
export const EXIT_USAGE = 3 as const;
export const EXIT_ALIVE = 5 as const;

/** The flags of the three commands (`cli-state-commands.md`). */
export const FLAGS = Object.freeze({
  feature: "--feature" as const,
  out: "--out" as const,
  from: "--from" as const,
  json: "--json" as const,
});

/** Which flag carries the location of each subcommand. */
export const LOCATION_FLAG_OF: Readonly<Record<Subcommand, "--out" | "--from">> = Object.freeze({
  export: FLAGS.out,
  import: FLAGS.from,
  adopt: FLAGS.from,
});

/** The output modes of §G.2 this command answers in. */
export const OUTPUT_MODES_OF_THIS_COMMAND = OUTPUT_MODES;

/** Under this profile no line is printed (§G.3; row 41 of annex X §X.7). */
export const PROFILE_THAT_PRINTS_NO_LINE = PROFILE_NAME;

/** F100-FR-003 — this module imports nothing of `@specstride/runtime`. */
export const IMPORTS_THE_RUNTIME_PACKAGE = false as const;

/** Who hands the three implementations in (annex A, §A.2; LR-1). */
export const THE_IMPLEMENTATIONS_ARE_WIRED_BY =
  "the composition root of the command surface (feature 119); a test of feature 122 wires `packages/runtime/src/state/commands.ts` directly" as const;

/* ------------------------------------------------------------------ *
 * The port: the three commands, structurally.
 * ------------------------------------------------------------------ */

/**
 * What one of the three commands answers. Declared here structurally, so that
 * the runtime's `StateCommandResult` satisfies it without this module naming
 * it (LR-1).
 */
export type StateOutcome = {
  readonly exit: number;
  readonly line: string;
  readonly refusal?: string | undefined;
  readonly feature: string;
  readonly approvals: number;
  readonly out?: string | undefined;
  readonly from?: string | undefined;
  readonly wroteNothing: boolean;
  readonly json: Readonly<Record<string, unknown>>;
};

/** What every command is given: where the plane is, and where to print. */
export type StateCall = {
  readonly place: Readonly<Record<string, unknown>>;
  readonly slug: string;
  readonly profile?: string | undefined;
  readonly print?: ((line: string) => void) | undefined;
};

/** The three commands of F122-FR-033 to F122-FR-035. */
export type StateCommandPort = {
  export(
    input: StateCall & { readonly out: string; readonly productVersion?: string | undefined },
  ): Promise<StateOutcome>;
  import(input: StateCall & { readonly from: string }): Promise<StateOutcome>;
  adopt(input: StateCall & { readonly from: string }): Promise<StateOutcome>;
};

/* ------------------------------------------------------------------ *
 * The arguments.
 * ------------------------------------------------------------------ */

/** What the reader of the arguments answers. */
export type ParsedArguments =
  | {
      readonly ok: true;
      readonly subcommand: Subcommand;
      readonly feature: string;
      readonly location: string;
      readonly json: boolean;
    }
  | { readonly ok: false; readonly subcommand: Subcommand | null; readonly detail: string };

/**
 * Read the arguments. Everything that is wrong here is `usage`, exit 3
 * (F122-FR-036): an unknown subcommand, a missing `--feature`, a missing
 * location flag, a flag without its value, and a flag the command does not
 * have.
 */
export function parseArguments(argv: readonly string[]): ParsedArguments {
  const [first, ...rest] = argv;
  if (first === undefined || !(SUBCOMMANDS as readonly string[]).includes(first)) {
    return Object.freeze({
      ok: false as const,
      subcommand: null,
      detail: `\`state\` takes one of ${SUBCOMMANDS.join(", ")}`,
    });
  }
  const subcommand = first as Subcommand;
  const locationFlag = LOCATION_FLAG_OF[subcommand];
  let feature = "";
  let location = "";
  let json = false;
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === FLAGS.json) {
      json = true;
      continue;
    }
    if (argument === FLAGS.feature || argument === locationFlag) {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return Object.freeze({
          ok: false as const,
          subcommand,
          detail: `${String(argument)} takes a value`,
        });
      }
      if (argument === FLAGS.feature) feature = value;
      else location = value;
      index += 1;
      continue;
    }
    return Object.freeze({
      ok: false as const,
      subcommand,
      detail: `\`state ${subcommand}\` has no flag ${String(argument)}; its flags are ${FLAGS.feature}, ${locationFlag} and ${FLAGS.json}`,
    });
  }
  if (feature === "") {
    return Object.freeze({ ok: false as const, subcommand, detail: `${FLAGS.feature} is missing` });
  }
  if (location === "") {
    return Object.freeze({ ok: false as const, subcommand, detail: `${locationFlag} is missing` });
  }
  return Object.freeze({ ok: true as const, subcommand, feature, location, json });
}

/**
 * The command a `usage` refusal of the surface names as the way out (§G.3,
 * key `next`). Every other refusal's `next` comes from the implementation,
 * which is the one that knows which refusal it is.
 */
export function nextForAUsageRefusal(subcommand: Subcommand): string {
  return `specstride state ${subcommand} --help`;
}

/* ------------------------------------------------------------------ *
 * The run.
 * ------------------------------------------------------------------ */

/** What `runStateCommand` answers. */
export type StateCommandRun = {
  readonly exit: number;
  /** The one line, or `""` under the `parity` profile. */
  readonly line: string;
  readonly outcome: StateOutcome | null;
};

/** What the command needs from its environment. */
export type StateCommandEnvironment = {
  /** Where the control plane and the working tree are; the port reads it. */
  readonly place: Readonly<Record<string, unknown>>;
  /** The three implementations (LR-1: handed in, never imported). */
  readonly commands: StateCommandPort;
  readonly productVersion?: string | undefined;
  readonly profile?: string | undefined;
  readonly print?: ((line: string) => void) | undefined;
};

/**
 * Run one of the three commands. One line goes out and one exit code comes
 * back; a refusal is one line `[SPECSTRIDE-REFUSE]` and nothing else
 * (F122-FR-036).
 */
export async function runStateCommand(
  argv: readonly string[],
  environment: StateCommandEnvironment,
): Promise<StateCommandRun> {
  const quiet = environment.profile === PROFILE_THAT_PRINTS_NO_LINE;
  const print =
    environment.print ?? ((line: string): void => void process.stdout.write(line + "\n"));
  const parsed = parseArguments(argv);
  if (!parsed.ok) {
    // F122-FR-036 — one line `[SPECSTRIDE-REFUSE]`, with the three keys of
    // §G.3, and never the label of a command that succeeded.
    const action = parsed.subcommand ?? "export";
    const line = printLine(REFUSE_LABEL, {
      action: REFUSAL_ACTION_OF[action],
      reason: "usage",
      next: nextForAUsageRefusal(action),
    });
    if (!quiet) print(line);
    return Object.freeze({ exit: EXIT_USAGE, line: quiet ? "" : line, outcome: null });
  }
  // A location is made absolute HERE, so that the refusal of a location inside
  // the working tree is taken over the path the command would really write and
  // not over the text the consumer typed. For `adopt` the location is the OLD
  // PATH of the working tree, and the workspace identity is derived from its
  // text, so two spellings of one path must give one identity (F122-FR-019).
  const location = resolvePath(parsed.location);
  const shared = {
    place: environment.place,
    slug: parsed.feature,
    ...(environment.profile === undefined ? {} : { profile: environment.profile }),
    print,
  };
  let outcome: StateOutcome;
  switch (parsed.subcommand) {
    case "export":
      outcome = await environment.commands.export({
        ...shared,
        out: location,
        ...(environment.productVersion === undefined
          ? {}
          : { productVersion: environment.productVersion }),
      });
      break;
    case "import":
      outcome = await environment.commands.import({ ...shared, from: location });
      break;
    default:
      outcome = await environment.commands.adopt({ ...shared, from: location });
      break;
  }
  if (parsed.json && !quiet) print(JSON.stringify(outcome.json));
  return Object.freeze({ exit: outcome.exit, line: outcome.line, outcome });
}

/** The exit code of a run that succeeded, for a caller that pins it. */
export const EXIT_ON_SUCCESS = EXIT_OK;
