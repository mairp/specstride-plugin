/**
 * T014 — the verification-commands document of a reverse run (F108-FR-022),
 * checked against the shipped copy of `contracts/verification-commands.schema.json`.
 *
 * The document is the state `reverse:<slug>:verification-commands` of annex B
 * §B.5. It holds, for every phase N of the driver, the command `lint-N` and the
 * command `guard-N`: a FIXED argument list run with the source as working
 * directory, whose executable is the product's own entry and whose first
 * argument names the component `reverse` through the component-name table of
 * annex X §X.8 — read from `@specstride/contracts` as data, never spelled here.
 *
 * The lint and guard commands the driver SHOWS are the same argument lists,
 * shell-quoted (F108-FR-022); `shellQuote` is exported for the driver, so that
 * the two can never drift.
 */
import normalization from "@specstride/contracts/data/normalization.json" with { type: "json" };

import { DEFAULT_EXECUTABLE } from "./inventory-call.ts";
import { checkAgainstShippedSchema, violationLines, type SchemaViolation } from "./schema-check.ts";

/* ------------------------------------------------------------------------- *
 * The component name, through the component-name table of annex X §X.8
 * ------------------------------------------------------------------------- */

type ComponentRow = {
  readonly "As-is implementation file": string;
  readonly "Logical component name": string;
};

/** The row of the table that names the reverse components (annex X §X.8). */
export const REVERSE_COMPONENT_ROW = "The reverse module and the reverse-inventory module" as const;

/**
 * The logical component names of that row, read from the data of the
 * normalization contract: `reverse` and `reverse-inventory`.
 */
export const REVERSE_COMPONENT_NAMES: readonly string[] = Object.freeze(
  (
    (normalization as { componentNames: readonly ComponentRow[] }).componentNames.find(
      (row) => row["As-is implementation file"] === REVERSE_COMPONENT_ROW,
    )?.["Logical component name"] ?? ""
  )
    .split(",")
    .map((name) => name.replace(/`/g, "").trim())
    .filter((name) => name !== ""),
);

/** The component-name table does not hold the row this module needs. */
export class ComponentNameNotInTheTableError extends Error {
  constructor(row: string) {
    super(
      `the component-name table of annex X §X.8 holds no row "${row}", so the first ` +
        `argument of a verification command of a reverse run cannot be named (F108-FR-022)`,
    );
    this.name = "ComponentNameNotInTheTableError";
  }
}

if (!REVERSE_COMPONENT_NAMES.includes("reverse")) {
  throw new ComponentNameNotInTheTableError(REVERSE_COMPONENT_ROW);
}

/** The first argument of every verification command of a reverse run. */
export const COMPONENT = "reverse" as const;

/* ------------------------------------------------------------------------- *
 * The fields of the document (F108-FR-022)
 * ------------------------------------------------------------------------- */

/** The schema file of the document, shipped in `data/` by T002. */
export const SCHEMA_FILE = "verification-commands.schema.json" as const;

/** `schema_version` of the document (F108-FR-022). */
export const SCHEMA_VERSION = "1.0.0" as const;

/** `discovery` of the document: a reverse run discovers no command. */
export const DISCOVERY = "none" as const;

/** The time limit of a `lint-N` command, in seconds (F108-FR-022). */
export const LINT_TIMEOUT_SEC = 120 as const;

/** The time limit of a `guard-N` command, in seconds (F108-FR-022). */
export const GUARD_TIMEOUT_SEC = 300 as const;

/** The lint levels that get a phase timeout at all (F108-FR-022). */
export const PHASE_TIMEOUT_LEVELS = Object.freeze([0, 1] as const);

/** The phase timeout those levels get, in seconds (F108-FR-022). */
export const PHASE_TIMEOUT_SEC = 3600 as const;

/** The verbs of the two commands. */
export const LINT_VERB = "lint" as const;
export const GUARD_VERB = "guard" as const;

/** The flags the two commands carry (F140-FR-002; F108-FR-027). */
export const UPTO_FLAG = "--upto" as const;
export const BASELINE_FLAG = "--baseline" as const;
export const SRC_FLAG = "--src" as const;
export const CLAIMS_FLAG = "--claims" as const;
export const OUT_FLAG = "--out" as const;

/**
 * The phase shape a command is built for. It is the minimum the commands need,
 * so that this module never depends on the driver: the driver passes its own
 * phases in.
 */
export type CommandsPhase = {
  /** The phase number, which is the number of the phase gate (F108-FR-018). */
  readonly n: number;
  /** The lint level of the phase, 0 to 5. */
  readonly lintLevel: number;
  /**
   * The resolved location of `reverse:<slug>:claims:<unit-key>` for a unit
   * phase, and `undefined` for every other phase (F108-FR-019, F108-FR-022).
   */
  readonly claims?: string | undefined;
};

/** The resolved locations the commands carry (research.md, D-2). */
export type CommandLocations = {
  /** The real path of the source, which is the working directory of a command. */
  readonly src: string;
  /** The resolved location of `reverse:<slug>:output`. */
  readonly out: string;
  /** The resolved location of `reverse:<slug>:inventory`, the baseline. */
  readonly baseline: string;
  /** The product's own entry; `specstride` unless the caller pins another. */
  readonly executable?: string | undefined;
};

/** One command of the document (F108-FR-022). */
export type VerificationCommand = {
  readonly id: string;
  readonly phase: number;
  readonly executable: string;
  readonly cwd: string;
  readonly args: readonly string[];
  readonly timeoutSec: number;
};

/** The whole document (F108-FR-022). */
export type VerificationCommandsDocument = {
  readonly schema_version: typeof SCHEMA_VERSION;
  readonly discovery: typeof DISCOVERY;
  readonly commands: readonly VerificationCommand[];
  readonly phaseTimeouts: Readonly<Record<string, number>>;
};

/** The id of the lint command of a phase. */
export function lintId(n: number): string {
  return `${LINT_VERB}-${n}`;
}

/** The id of the guard command of a phase. */
export function guardId(n: number): string {
  return `${GUARD_VERB}-${n}`;
}

/**
 * F108-FR-022 — the argument list of the lint of a phase: the lint of the
 * output directory with the source, the baseline inventory and `--upto
 * <level>`, and for a unit phase also `--claims` with the location of
 * `reverse:<slug>:claims:<unit-key>`.
 */
export function lintArgs(phase: CommandsPhase, locations: CommandLocations): readonly string[] {
  const args = [
    COMPONENT,
    LINT_VERB,
    locations.out,
    SRC_FLAG,
    locations.src,
    BASELINE_FLAG,
    locations.baseline,
    UPTO_FLAG,
    String(phase.lintLevel),
  ];
  if (phase.claims !== undefined) args.push(CLAIMS_FLAG, phase.claims);
  return Object.freeze(args);
}

/**
 * F108-FR-022 — the argument list of the guard of a phase: the guard over the
 * source with the baseline inventory and the output directory.
 */
export function guardArgs(_phase: CommandsPhase, locations: CommandLocations): readonly string[] {
  return Object.freeze([
    COMPONENT,
    GUARD_VERB,
    locations.src,
    BASELINE_FLAG,
    locations.baseline,
    OUT_FLAG,
    locations.out,
  ]);
}

/** The lint command of a phase. */
export function lintCommand(
  phase: CommandsPhase,
  locations: CommandLocations,
): VerificationCommand {
  return Object.freeze({
    id: lintId(phase.n),
    phase: phase.n,
    executable: locations.executable ?? DEFAULT_EXECUTABLE,
    cwd: locations.src,
    args: lintArgs(phase, locations),
    timeoutSec: LINT_TIMEOUT_SEC,
  });
}

/** The guard command of a phase. */
export function guardCommand(
  phase: CommandsPhase,
  locations: CommandLocations,
): VerificationCommand {
  return Object.freeze({
    id: guardId(phase.n),
    phase: phase.n,
    executable: locations.executable ?? DEFAULT_EXECUTABLE,
    cwd: locations.src,
    args: guardArgs(phase, locations),
    timeoutSec: GUARD_TIMEOUT_SEC,
  });
}

/**
 * F108-FR-022 — `phaseTimeouts` gives 3600 seconds to every phase with lint
 * level 0 or 1, and NO entry to the others.
 */
export function phaseTimeoutsOf(
  phases: readonly CommandsPhase[],
): Readonly<Record<string, number>> {
  const timeouts: Record<string, number> = {};
  for (const phase of phases) {
    if ((PHASE_TIMEOUT_LEVELS as readonly number[]).includes(phase.lintLevel)) {
      timeouts[String(phase.n)] = PHASE_TIMEOUT_SEC;
    }
  }
  return Object.freeze(timeouts);
}

/** A document this module built that the shipped schema refuses. */
export class VerificationCommandsNotValidError extends Error {
  readonly violations: readonly SchemaViolation[];
  constructor(violations: readonly SchemaViolation[]) {
    super(
      `the verification-commands document of the reverse run does not satisfy ` +
        `data/${SCHEMA_FILE}: ${violationLines(violations)}`,
    );
    this.name = "VerificationCommandsNotValidError";
    this.violations = Object.freeze([...violations]);
  }
}

/**
 * F108-FR-022 — the whole document: the four top-level fields, one `lint-N` and
 * one `guard-N` per driver phase in phase order, and the phase timeouts. It is
 * checked against the shipped schema before it is returned, so that a document
 * that would not validate is never written.
 */
export function buildVerificationCommands(
  phases: readonly CommandsPhase[],
  locations: CommandLocations,
): VerificationCommandsDocument {
  const commands: VerificationCommand[] = [];
  for (const phase of phases) {
    commands.push(lintCommand(phase, locations));
    commands.push(guardCommand(phase, locations));
  }
  const document: VerificationCommandsDocument = Object.freeze({
    schema_version: SCHEMA_VERSION,
    discovery: DISCOVERY,
    commands: Object.freeze(commands),
    phaseTimeouts: phaseTimeoutsOf(phases),
  });
  const violations = checkAgainstShippedSchema(document, SCHEMA_FILE);
  if (violations.length > 0) throw new VerificationCommandsNotValidError(violations);
  return document;
}

/* ------------------------------------------------------------------------- *
 * The serialized form, and the shell-quoted form the driver shows
 * ------------------------------------------------------------------------- */

/**
 * F108-FR-014 — the document as JSON with ONE space of indentation, sorted
 * keys and a final line end.
 */
export function serializeVerificationCommands(document: VerificationCommandsDocument): string {
  return JSON.stringify(document, sortedKeys, 1) + "\n";
}

/** A replacer that puts every object's keys in code-point order. */
export function sortedKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) out[key] = record[key];
  return out;
}

/** A word that needs no quoting in a shell code block. */
export const SAFE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** One word, quoted for a shell the way the as-is dry run quotes it. */
export function shellQuote(word: string): string {
  if (word === "") return "''";
  if (SAFE_WORD.test(word)) return word;
  return `'${word.split("'").join(`'"'"'`)}'`;
}

/** An argument list, shell-quoted and joined by one space. */
export function shellJoin(words: readonly string[]): string {
  return words.map(shellQuote).join(" ");
}

/**
 * F108-FR-022 — the lint command of a phase as the driver SHOWS it: the same
 * argument list, shell-quoted, with the product's own entry in front.
 */
export function shownLintCommand(phase: CommandsPhase, locations: CommandLocations): string {
  const command = lintCommand(phase, locations);
  return shellJoin([command.executable, ...command.args]);
}

/** F108-FR-022 — the guard command of a phase as the driver shows it. */
export function shownGuardCommand(phase: CommandsPhase, locations: CommandLocations): string {
  const command = guardCommand(phase, locations);
  return shellJoin([command.executable, ...command.args]);
}
