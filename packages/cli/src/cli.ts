/**
 * The command line of the product (CLI protocol 1). Owners: features 119 and 145
 * and the owner of each command.
 *
 * `@specstride/cli` is still the skeleton of the campaign scaffolding: the commands
 * of CLI protocol 1 — `run`, `events`, `launch`, `doctor` and the rest — are the
 * deliverables of the features that own them and are not here. What IS here is the
 * list of commands this package can actually run, and the dispatch to each. The
 * same list stands in the manifest under `specstride.commands`, so that a caller can
 * read what exists without running anything, and `COMMANDS` below is checked against
 * it by the test of this package.
 */
import { contractDerive } from "./contract-derive.ts";
import { contractCommand } from "./commands/contract.ts";
import { learn } from "./learn.ts";

/** One command of the command line: the words that name it, and what runs it. */
export type Command = {
  /** The words of the command, as a caller types them. */
  readonly name: string;
  /** The feature that owns the command. */
  readonly owner: string;
  /** Run it with the arguments that follow its words; the exit code is the result. */
  readonly run: (argv: readonly string[]) => number;
};

/** Every command this package can run today. */
export const COMMANDS: readonly Command[] = Object.freeze([
  // T008 of feature 107 — the verb `contract`; `contract derive` stays the
  // longer, earlier match, and the verb dispatches `validate` and `render`.
  Object.freeze({ name: "contract derive", owner: "107", run: contractDerive }),
  Object.freeze({ name: "contract", owner: "107", run: contractCommand }),
  Object.freeze({ name: "learn", owner: "106", run: learn }),
]);

/** The command one argument list names, with the arguments that follow it. */
export function commandOf(
  argv: readonly string[],
): { readonly command: Command; readonly rest: readonly string[] } | undefined {
  // The longest name first, so `contract derive` is found before a future `contract`.
  for (const command of [...COMMANDS].sort((a, b) => b.name.length - a.name.length)) {
    const words = command.name.split(" ");
    if (words.every((word, at) => argv[at] === word)) {
      return { command, rest: argv.slice(words.length) };
    }
  }
  return undefined;
}

/** The message a caller gets for a command this package does not have. */
export function unknownCommand(argv: readonly string[]): string {
  const asked = argv.length === 0 ? "no command" : argv.join(" ");
  return (
    `specstride: ${asked} is not a command of this build. The commands it has are: ` +
    `${COMMANDS.map((c) => c.name).join(", ")}. The rest of CLI protocol 1 belongs to the ` +
    `features that own each command and is not in this package yet.\n`
  );
}

/** Run the command line on one argument list and give the exit code. */
export function main(argv: readonly string[]): number {
  const found = commandOf(argv);
  if (found === undefined) {
    process.stderr.write(unknownCommand(argv));
    return 2;
  }
  return found.command.run(found.rest);
}

/**
 * T018 — the front door as the executable runs it (F119-FR-011): the whole
 * argument list goes to the router of `src/router/route.ts`, which reads the
 * first argument, hands the call to the command that owns it, and ends with
 * the code of that command — 70 on an error nothing catches.
 */
export async function mainAsync(argv: readonly string[]): Promise<number> {
  const { route } = await import("./router/route.ts");
  return route(argv);
}
