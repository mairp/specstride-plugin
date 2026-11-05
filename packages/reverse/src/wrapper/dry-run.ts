/**
 * T025 — the DRY RUN of `reverse` (F108-FR-005): the plan lines and the engine
 * command.
 *
 * `reverse --dry-run` runs the plan, which writes its files exactly as
 * F108-FR-014 says, prints what WOULD be launched, launches nothing, and exits
 * 0. The withholding of the launch is the whole point (the constitution,
 * principle XV: invocation is consent, the dry run withholds it), so this
 * module holds no runner, no `spawn`, no submitter and no seam that could
 * start anything: every function here returns STRINGS.
 *
 * The lines are compatibility output, so their order and their spelling are
 * behaviour under parity and are reproduced from F108-FR-005 literally: the
 * heading; the ten labelled lines `source`, `inventory`, `languages`,
 * `frameworks`, `constitution`, `output dir`, `tasks mode`, `inventory`,
 * `driver`, `commands`; `phases:` with one line per phase; and last the
 * orchestrator label with the shell-quoted engine command prefixed
 * `SPECSTRIDE_GIT_COMMITS=off`.
 *
 * The argument list of the engine start is F108-FR-007's and is built by the
 * wrapper (`engineArgv`); the dry run RENDERS it and never rebuilds it, so the
 * command the consumer reads here cannot drift from the one a real launch
 * would use. The dependency runs one way only — the wrapper imports the dry
 * run, the dry run imports no wrapper — so nothing in this module can reach a
 * launch even by accident.
 */
import { shellJoin } from "../plan/commands.ts";
import type { PlanResult } from "../plan/plan.ts";

/* ------------------------------------------------------------------------- *
 * The commit switch as the dry run SHOWS it (F108-FR-005, annex X §X.8)
 * ------------------------------------------------------------------------- */

/**
 * The as-is variable the commit switch is an alias of (annex X §X.8). The dry
 * run shows it, because the dry run is compatibility output (F108-FR-005);
 * the wrapper imports it from here for the environment of a foreground start,
 * so the printed prefix and the real environment can never disagree.
 */
export const COMMIT_SWITCH_VARIABLE = "SPECSTRIDE_GIT_COMMITS" as const;

/** The value the commit switch carries in both spellings (F108-FR-008). */
export const COMMIT_SWITCH_OFF = "off" as const;

/** F108-FR-005 — the prefix the dry run puts in front of the engine command. */
export const COMMIT_SWITCH_PREFIX: string = `${COMMIT_SWITCH_VARIABLE}=${COMMIT_SWITCH_OFF}`;

/* ------------------------------------------------------------------------- *
 * The lines (F108-FR-005)
 * ------------------------------------------------------------------------- */

/** F108-FR-005 — the first line of the dry run. */
export const DRY_RUN_HEADING =
  "specstride reverse — dry run (no LLM call, nothing launched)" as const;

/** F108-FR-005 — the labels of the dry run, in the order the requirement lists. */
export const DRY_RUN_LABELS = Object.freeze([
  "source",
  "inventory",
  "languages",
  "frameworks",
  "constitution",
  "output dir",
  "tasks mode",
  "inventory",
  "driver",
  "commands",
] as const);

/** F108-FR-005 — the heading of the phase list. */
export const DRY_RUN_PHASES_HEADING = "phases:" as const;

/** F108-FR-005 — the last label of the dry run. */
export const DRY_RUN_ORCHESTRATOR_LABEL = "  orchestrator (not executed):" as const;

/** The indentation of the engine command under the orchestrator label. */
export const ENGINE_COMMAND_INDENT = "    " as const;

/** F108-FR-005 — the dry run exits 0, whatever the plan found. */
export const DRY_RUN_EXIT_CODE = 0 as const;

/** The placeholder a labelled line carries where the inventory found nothing. */
export const EMPTY_VALUE = "-" as const;

/** One labelled line of the dry run. */
export function labelled(label: string, value: string): string {
  return `${label}: ${value}`;
}

/** F108-FR-005 — the `inventory` counts line: files, skipped, bytes, oversize, units. */
export function inventoryCountsOf(
  summary: {
    readonly files: number;
    readonly skipped: number;
    readonly text_bytes: number;
    readonly units: number;
  },
  oversize: boolean,
): string {
  return (
    `${summary.files} files, ${summary.skipped} skipped, ${summary.text_bytes} bytes, ` +
    `oversize ${oversize ? "true" : "false"}, ${summary.units} units`
  );
}

/** F108-FR-005 — one line of the phase list. */
export function phaseLine(phase: {
  readonly n: number;
  readonly title: string;
  readonly lint_level: number;
}): string {
  return `${phase.n}. ${phase.title}  (lint --upto ${phase.lint_level})`;
}

/**
 * F108-FR-005 — THE ENGINE COMMAND of the dry run: the shell-quoted engine
 * start, prefixed `SPECSTRIDE_GIT_COMMITS=off`, under the orchestrator label.
 *
 * `shellJoin` is the quoting of the verification-commands document (T014), so
 * a command printed here can be pasted into a shell and is the same text the
 * driver shows for its own commands.
 */
export function engineCommandLine(executable: string, argv: readonly string[]): string {
  return `${ENGINE_COMMAND_INDENT}${COMMIT_SWITCH_PREFIX} ${shellJoin([executable, ...argv])}`;
}

/** What the dry run prints about: the plan that was made and the start withheld. */
export type DryRunInput = {
  /** The plan, already made and already written (F108-FR-005, F108-FR-014). */
  readonly result: PlanResult;
  /** The executable the engine start would use. */
  readonly executable: string;
  /** The engine argument list of F108-FR-007, as the wrapper built it. */
  readonly argv: readonly string[];
};

/**
 * F108-FR-005 — the lines of the dry run, in the order of the requirement:
 * the heading, the ten labelled lines, `phases:` with one line per phase, and
 * last the orchestrator label with the engine command.
 */
export function dryRunLines(input: DryRunInput): readonly string[] {
  const output = input.result.output;
  const summary = output.summary;
  const lines: string[] = [DRY_RUN_HEADING];
  lines.push(labelled("source", output.src));
  lines.push(labelled("inventory", inventoryCountsOf(summary, output.oversize)));
  lines.push(
    labelled("languages", Object.keys(summary.languages).sort().join(", ") || EMPTY_VALUE),
  );
  lines.push(labelled("frameworks", [...summary.frameworks].join(", ") || EMPTY_VALUE));
  lines.push(labelled("constitution", summary.constitution));
  lines.push(labelled("output dir", output.out));
  lines.push(labelled("tasks mode", output.tasks_mode));
  lines.push(labelled("inventory", output.inventory));
  lines.push(labelled("driver", output.driver));
  lines.push(labelled("commands", output.verification_commands));
  lines.push(DRY_RUN_PHASES_HEADING);
  for (const phase of output.phases) lines.push(phaseLine(phase));
  lines.push(DRY_RUN_ORCHESTRATOR_LABEL);
  lines.push(engineCommandLine(input.executable, input.argv));
  return Object.freeze(lines);
}

/** What the dry run settles: the lines, the exit code, and that nothing ran. */
export type DryRunOutcome = {
  readonly stdout: readonly string[];
  readonly exitCode: 0;
  /** Always `false`: the dry run launches NOTHING (F108-FR-005). */
  readonly launched: false;
};

/**
 * F108-FR-005 — the whole dry run: the plan lines and the engine command, exit
 * 0, and nothing launched. The third field is a constant, not a report of what
 * happened, because this module cannot start anything: it is the structural
 * statement that the withheld launch is withheld here and not by the caller's
 * discipline.
 */
export function dryRunOutcome(input: DryRunInput): DryRunOutcome {
  return Object.freeze({
    stdout: dryRunLines(input),
    exitCode: DRY_RUN_EXIT_CODE,
    launched: false as const,
  });
}
