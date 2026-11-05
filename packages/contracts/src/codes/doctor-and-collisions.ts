/**
 * T273 — the codes of the doctor, of the commands without an as-is
 * equivalent, and the table of collisions (annex G, §G.4; F100-FR-185,
 * F100-FR-186).
 *
 * A slice of T093. The codes of the doctor (0, 1, 2, 3; `--strict`; a probe
 * that times out) and of the nine commands that have no as-is equivalent,
 * read from their rows of the key `perCommand` of `data/exit-codes.json`, and
 * the table of collisions of the key `collisions` — one value with its
 * meanings per command — as data.
 */
import exitCodes from "../../data/exit-codes.json" with { type: "json" };
import { commandCodeRow, type CommandCodeRow } from "./commands.ts";

/** The section of annex G that owns these rows. */
export const ANNEX_SECTION = "annex G, §G.4" as const;

/* ------------------------------------------------------------------ *
 * F100-FR-185 — the doctor.
 * ------------------------------------------------------------------ */

/** The row of `doctor` of the key `perCommand` (annex G, §G.4). */
export const doctorRow: CommandCodeRow | undefined = commandCodeRow("doctor");

/** One code of the doctor, with what it means (F100-FR-185). */
export type DoctorCodeRow = { readonly code: number; readonly meaning: string };

/**
 * F100-FR-185 — the doctor exits 0 when no finding has the severity `fail`,
 * 1 when it could not run, 2 when at least one finding has the severity
 * `fail`, and 3 on a usage error.
 */
export const DOCTOR_CODES: readonly DoctorCodeRow[] = Object.freeze([
  Object.freeze({ code: 0, meaning: "no `fail` finding" }),
  Object.freeze({ code: 1, meaning: "the doctor could not run" }),
  Object.freeze({ code: 2, meaning: "at least one `fail` finding" }),
  Object.freeze({ code: 3, meaning: "usage error" }),
]);

/** The four numbers the doctor exits with (F100-FR-185). */
export const DOCTOR_CODE_NUMBERS: readonly number[] = Object.freeze(
  DOCTOR_CODES.map((r) => r.code),
);

/** The severities of a finding of the doctor (annex G, §G.7). */
export const DOCTOR_SEVERITIES = ["pass", "warn", "fail", "skip"] as const;
export type DoctorSeverity = (typeof DOCTOR_SEVERITIES)[number];

/** F100-FR-185 — with `--strict` a warning exits 2. */
export const STRICT_FLAG = "--strict" as const;
export const STRICT_MAKES_A_WARNING_EXIT = 2 as const;

/**
 * F100-FR-185 — a probe that times out inside a check never raises the code
 * above that of a warning: it is a `warn`, never a `fail`.
 */
export const A_PROBE_THAT_TIMES_OUT = Object.freeze({
  severity: "warn" as const,
  raisesTheCodeAboveAWarning: false,
  codeWithoutStrict: 0,
  codeWithStrict: 2,
} as const);

/** What the doctor saw when the caller asks for its code (F100-FR-185). */
export type DoctorOutcome = {
  /** True where at least one finding has the severity `fail`. */
  readonly aFailFinding?: boolean;
  /** True where at least one finding has the severity `warn`. */
  readonly aWarnFinding?: boolean;
  /** True where a probe inside a check timed out. */
  readonly aProbeTimedOut?: boolean;
  /** True where the doctor could not run at all. */
  readonly couldNotRun?: boolean;
  /** True where the invocation was a usage error. */
  readonly usageError?: boolean;
  /** True where `--strict` was given. */
  readonly strict?: boolean;
};

/**
 * F100-FR-185 — the exit code of the doctor. A probe that times out is a
 * warning, so it lifts the code to 2 only under `--strict`, never above.
 */
export function doctorExitCode(outcome: DoctorOutcome): number {
  if (outcome.usageError === true) return 3;
  if (outcome.couldNotRun === true) return 1;
  if (outcome.aFailFinding === true) return 2;
  const warned = outcome.aWarnFinding === true || outcome.aProbeTimedOut === true;
  if (warned && outcome.strict === true) return STRICT_MAKES_A_WARNING_EXIT;
  return 0;
}

/* ------------------------------------------------------------------ *
 * F100-FR-186 — the commands without an as-is equivalent.
 * ------------------------------------------------------------------ */

/**
 * F100-FR-186 — the nine commands that have no as-is equivalent, in the
 * order the requirement names them.
 */
export const COMMANDS_WITHOUT_AN_AS_IS_EQUIVALENT = [
  "launch",
  "wait",
  "state export",
  "state import",
  "state adopt",
  "harness verify",
  "config show",
  "config schema",
  "tripwire clear",
] as const;

/** A command with no as-is equivalent (F100-FR-186). */
export type CommandWithoutAnAsIsEquivalent = (typeof COMMANDS_WITHOUT_AN_AS_IS_EQUIVALENT)[number];

/** The row of §G.4 of every command that has no as-is equivalent. */
export const ROWS_WITHOUT_AN_AS_IS_EQUIVALENT: readonly {
  readonly command: CommandWithoutAnAsIsEquivalent;
  readonly row: CommandCodeRow;
}[] = Object.freeze(
  COMMANDS_WITHOUT_AN_AS_IS_EQUIVALENT.map((command) => {
    const row = commandCodeRow(command);
    if (row === undefined) {
      throw new Error(`the key \`perCommand\` of data/exit-codes.json holds no row \`${command}\``);
    }
    return Object.freeze({ command, row });
  }),
);

/** The codes of a command that has no as-is equivalent (F100-FR-186). */
export function codesWithoutAnAsIsEquivalent(command: string): readonly number[] | undefined {
  return ROWS_WITHOUT_AN_AS_IS_EQUIVALENT.find((r) => r.command === command)?.row.numbers;
}

/** True where the command has no as-is equivalent (F100-FR-186). */
export function hasNoAsIsEquivalent(command: string): command is CommandWithoutAnAsIsEquivalent {
  return (COMMANDS_WITHOUT_AN_AS_IS_EQUIVALENT as readonly string[]).includes(command);
}

/* ------------------------------------------------------------------ *
 * F100-FR-186 — the table of collisions.
 * ------------------------------------------------------------------ */

type RawCollision = { Value: string; Meanings: string };

const RAW_COLLISIONS = (exitCodes as { collisions: RawCollision[] }).collisions;

/** One row of the collisions table of §G.4. */
export type CollisionRow = {
  /** The cell "Value", verbatim: a number, or "22, 24". */
  readonly cell: string;
  /** The numbers the cell names. */
  readonly values: readonly number[];
  /** The cell "Meanings", verbatim. */
  readonly meaningsCell: string;
  /** The meanings the cell separates with a middle dot. */
  readonly meanings: readonly string[];
};

/** Every row of the collisions table, in the order of the annex. */
export const collisionRows: readonly CollisionRow[] = Object.freeze(
  RAW_COLLISIONS.map((row) =>
    Object.freeze({
      cell: row.Value,
      values: Object.freeze([...row.Value.matchAll(/\d+/g)].map((m) => Number(m[0]))),
      meaningsCell: row.Meanings,
      meanings: Object.freeze(
        row.Meanings.split("·")
          .map((part) => part.trim())
          .filter((part) => part !== ""),
      ),
    }),
  ),
);

/** The rows of the collisions table a value appears in (F100-FR-186). */
export function collisionsOf(value: number): readonly CollisionRow[] {
  return collisionRows.filter((r) => r.values.includes(value));
}

/** The meanings one value carries across the processes (F100-FR-186). */
export function meaningsOf(value: number): readonly string[] {
  return Object.freeze(collisionsOf(value).flatMap((r) => [...r.meanings]));
}

/** Every value the collisions table names, each once. */
export const COLLIDING_VALUES: readonly number[] = Object.freeze([
  ...new Set(collisionRows.flatMap((r) => [...r.values])),
]);
