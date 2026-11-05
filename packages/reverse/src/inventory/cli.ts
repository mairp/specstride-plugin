/**
 * T028 of feature 140 — the VERB `inventory` and its exit codes
 * (F140-FR-001, F140-FR-015).
 *
 *     specstride reverse inventory <SRC> --out <inventory.json>
 *                                 [--md PATH] [--exclude PATH]...
 *
 * It builds the inventory standalone — no model, no network, no engine — and
 * prints the ABSOLUTE PATH of the file it wrote, so that a caller that was
 * handed a relative `--out` still learns where the document is.
 *
 * The exit codes are the three of annex G §G.4, which this verb shares with
 * `lint`, `plan` and `guard` (F140-FR-001):
 *
 * | Code | When |
 * |---|---|
 * | 0 | the inventory was built and written |
 * | 2 | a usage error — a missing `--out`, an unknown flag, no source |
 * | 3 | invalid input: `reverse-inventory: <message>` on standard error |
 *
 * Exit 3 covers every refusal the inventory can make: a source that is not a
 * directory (`source is not a directory: <src>`), a limit that is not a
 * positive integer (`<NAME> must be a positive integer (got '<v>')`), a
 * failing git listing (`git ls-files failed in <src>: <stderr>`), and a
 * document that does not satisfy `contracts/inventory.schema.json`.
 *
 * One deliberate departure from the baseline at `9cab15d`: there, the summary
 * budget was read AFTER the inventory had already been written and outside the
 * guarded region, so a bad `SPECSTRIDE_CONTEXT_BUDGET` left the document on
 * disk and ended in an uncaught traceback. F140-FR-016 requires exit 3 for
 * that value, so every limit — the budget included, when `--md` asks for a
 * summary — is read BEFORE anything is written. A refused run writes nothing.
 */
import { resolve } from "node:path";

import type { Inventory } from "./document.ts";
import { buildInventory, serializeInventory, validateInventory } from "./document.ts";
import { InventoryError, contextBudgetOf, limitsOf } from "./limits.ts";
import { renderSummary, writeAtomic } from "./summary.ts";

/** Exit 0: the inventory was built and written (F140-FR-001). */
export const EXIT_OK = 0 as const;

/** Exit 2: a usage error (F140-FR-001). */
export const EXIT_USAGE = 2 as const;

/** Exit 3: invalid input (F140-FR-001). */
export const EXIT_INVALID = 3 as const;

/** The prefix of an invalid-input message on standard error (F140-FR-001). */
export const MESSAGE_PREFIX = "reverse-inventory" as const;

/** The usage line the verb prints on a usage error. */
export const INVENTORY_USAGE =
  "usage: specstride reverse inventory <src> --out PATH [--md PATH] [--exclude PATH]";

/** A usage error of the verb: exit 2, and the usage line (F140-FR-001). */
export class InventoryUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryUsageError";
  }
}

/** The arguments of `reverse inventory` (F140-FR-015). */
export interface InventoryArguments {
  /** The source tree. */
  readonly src: string;
  /** Where the inventory document is written. */
  readonly out: string;
  /** Where the summary is written, or null where none was asked for. */
  readonly md: string | null;
  /** The source-relative paths never walked, in the order they were given. */
  readonly exclude: readonly string[];
}

const VALUED_FLAGS = Object.freeze(["--out", "--md", "--exclude"] as const);

/**
 * Parse the arguments of `reverse inventory` (F140-FR-015). `--exclude` is
 * repeatable; `--out` is required; a flag with no value, an unknown flag, a
 * second positional argument and a missing source are usage errors.
 */
export function parseInventoryArguments(argv: readonly string[]): InventoryArguments {
  let src: string | null = null;
  let out: string | null = null;
  let md: string | null = null;
  const exclude: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    if ((VALUED_FLAGS as readonly string[]).includes(argument)) {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new InventoryUsageError(`argument ${argument}: expected one argument`);
      }
      index += 1;
      if (argument === "--out") out = value;
      else if (argument === "--md") md = value;
      else exclude.push(value);
      continue;
    }
    if (argument.startsWith("-")) {
      throw new InventoryUsageError(`unrecognized arguments: ${argument}`);
    }
    if (src !== null) throw new InventoryUsageError(`unrecognized arguments: ${argument}`);
    src = argument;
  }
  if (src === null) throw new InventoryUsageError("the following arguments are required: src");
  if (out === null) {
    throw new InventoryUsageError("the following arguments are required: --out");
  }
  return Object.freeze({ src, out, md, exclude: Object.freeze(exclude) });
}

/** What the verb produced: its exit code, its two streams and the document. */
export interface InventoryVerbResult {
  readonly exit: number;
  readonly stdout: string;
  readonly stderr: string;
  /** The inventory, where it was built; null where the verb refused. */
  readonly inventory: Inventory | null;
  /** The absolute path of the document, where one was written. */
  readonly out: string | null;
  /** The absolute path of the summary, where one was written. */
  readonly md: string | null;
}

/** What `runInventory` may be handed instead of the process's own state. */
export interface InventoryOptions {
  /** The environment the limits are read from; `process.env` by default. */
  readonly environ?: Readonly<Record<string, string | undefined>> | undefined;
  /** The directory a relative path is resolved against; `cwd` by default. */
  readonly cwd?: string | undefined;
}

/**
 * The whole verb `reverse inventory` (F140-FR-001, F140-FR-015). It returns
 * the exit code rather than ending the process, so that an internal caller
 * gets the same code as the `exit_code` of a result record.
 */
export function runInventory(
  argv: readonly string[],
  options: InventoryOptions = {},
): InventoryVerbResult {
  const environ = options.environ ?? process.env;
  const base = options.cwd ?? process.cwd();
  let parsed: InventoryArguments;
  try {
    parsed = parseInventoryArguments(argv);
  } catch (error) {
    if (error instanceof InventoryUsageError) {
      return Object.freeze({
        exit: EXIT_USAGE,
        stdout: "",
        stderr: `${INVENTORY_USAGE}\nspecstride reverse inventory: error: ${error.message}\n`,
        inventory: null,
        out: null,
        md: null,
      });
    }
    throw error;
  }
  const refusal = (message: string): InventoryVerbResult =>
    Object.freeze({
      exit: EXIT_INVALID,
      stdout: "",
      stderr: `${MESSAGE_PREFIX}: ${message}\n`,
      inventory: null,
      out: null,
      md: null,
    });
  let inventory: Inventory;
  let budget: number;
  try {
    // Every limit is read BEFORE anything is written, so that a refused run
    // leaves no document behind (see the module comment).
    limitsOf(environ);
    budget = parsed.md === null ? 0 : contextBudgetOf(environ);
    inventory = buildInventory({ src: parsed.src, excludes: parsed.exclude, environ });
    // The document is validated against `contracts/inventory.schema.json` (the
    // byte-for-byte copy in `data/`) BEFORE it is written, so the verb can
    // never leave a document behind that fails its own schema (T024).
    validateInventory(inventory);
  } catch (error) {
    if (error instanceof InventoryError) return refusal(error.message);
    throw error;
  }
  const out = resolve(base, parsed.out);
  writeAtomic(out, serializeInventory(inventory));
  let md: string | null = null;
  if (parsed.md !== null) {
    md = resolve(base, parsed.md);
    writeAtomic(md, renderSummary(inventory, out, budget).text);
  }
  return Object.freeze({
    exit: EXIT_OK,
    stdout: `${out}\n`,
    stderr: "",
    inventory,
    out,
    md,
  });
}
