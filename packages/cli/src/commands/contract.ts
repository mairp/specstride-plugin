/**
 * T008 — the verb wiring of `contract` (F107-FR-039; contracts/commands.md).
 *
 * The wiring is thin, and it holds no rule of the launch contract: it parses
 * the argv of the verb, hands every argument that names state to the
 * state-argument rule (a path OR a logical name, F107-FR-039), dispatches to
 * the owner of the subcommand, prints what the subcommand produces and exits
 * with the code of the exit-code table of annex G §G.4
 * (`src/contract/commands/exit-codes.ts` in `@specstride/pipeline`).
 *
 * `contract derive` is implemented (T021 of the derivation story wires it to
 * the draft builder; the draft command itself lives in `contract-derive.ts`
 * of this package and is dispatched to unchanged). `contract validate` and
 * `contract render` are recognized verbs of this wiring whose owner tasks
 * implement them; until their task lands they refuse with the exit of a
 * usage error (2, annex G §G.4) and say so, they do not misreport success.
 */
import { contractDerive } from "../contract-derive.ts";
import { stateArgumentKind } from "../../../pipeline/src/contract/commands/index.ts";
import {
  DERIVE_EXIT_CODES,
  VALIDATE_EXIT_CODES,
  RENDER_EXIT_CODES,
} from "../../../pipeline/src/contract/commands/exit-codes.ts";

/** The result of one invocation of the verb: the printed lines and the exit. */
export type ContractCommandResult = {
  readonly lines: readonly string[];
  readonly exit: number;
};

/** The subcommands the verb `contract` names, with their exit-code tables. */
export const CONTRACT_VERBS = ["derive", "validate", "render"] as const;
export type ContractVerb = (typeof CONTRACT_VERBS)[number];

/** The table of exit codes of one subcommand. */
export function exitTableOf(
  verb: ContractVerb,
): typeof DERIVE_EXIT_CODES | typeof VALIDATE_EXIT_CODES | typeof RENDER_EXIT_CODES {
  if (verb === "validate") return VALIDATE_EXIT_CODES;
  if (verb === "render") return RENDER_EXIT_CODES;
  return DERIVE_EXIT_CODES;
}

/** The arguments of the verb that name state (F107-FR-039), and their kinds. */
export function stateArgumentsOf(argv: readonly string[]): {
  readonly argument: string;
  readonly kind: "logical-name" | "path" | "neither";
}[] {
  const stateFlags = new Set(["--contract", "--output", "--applied-file", "--feature"]);
  const out: { argument: string; kind: "logical-name" | "path" | "neither" }[] = [];
  for (let at = 0; at < argv.length; at++) {
    const arg = argv[at];
    if (stateFlags.has(arg)) {
      const value = argv[at + 1];
      at += 1;
      if (value !== undefined) out.push({ argument: value, kind: stateArgumentKind(value) });
      continue;
    }
    // A positional argument names state when it is not a flag (contracts/
    // commands.md: `contract validate <contract>`, `--answer <draft> <batch>`).
    if (!arg.startsWith("--")) out.push({ argument: arg, kind: stateArgumentKind(arg) });
  }
  return out;
}

/** The message for a subcommand whose owner task has not landed yet. */
function notYetWired(verb: ContractVerb): ContractCommandResult {
  return {
    lines: [
      `specstride contract ${verb}: the command is not in this build yet; ` +
        `its owner task implements it and this wiring dispatches to it when it lands.`,
    ],
    exit: 2,
  };
}

/**
 * Run the verb `contract` on the arguments that follow its words; the exit
 * code is the result. A logical name is accepted wherever an argument names
 * state (F107-FR-039) and is handed on unchanged; a logical-name-shaped
 * argument the table of §B.5 does not hold is refused with exit 2.
 */
export function contractCommand(argv: readonly string[]): number {
  const verb = argv[0] as ContractVerb | undefined;
  if (verb === undefined || !(CONTRACT_VERBS as readonly string[]).includes(verb)) {
    process.stderr.write(
      `specstride contract: the first argument names a subcommand of the verb ` +
        `(${CONTRACT_VERBS.join(", ")})\n`,
    );
    return 2;
  }
  const rest = argv.slice(1);
  // F107-FR-039 — an argument that names state takes a path or a logical
  // name; a `:`-carrying argument that is no logical name of §B.5 is refused
  // before the subcommand runs.
  for (const { argument, kind } of stateArgumentsOf(rest)) {
    if (kind === "neither") {
      process.stderr.write(
        `specstride contract ${verb}: "${argument}" is neither a path nor a ` +
          `logical name of annex B §B.5 (F107-FR-039)\n`,
      );
      return 2;
    }
  }
  if (verb === "derive") {
    // The draft command of this package runs unchanged; its exit codes are
    // the table of `contract derive` (0; 2 any error).
    const exit = contractDerive(rest);
    return exit;
  }
  return notYetWired(verb).exit;
}
