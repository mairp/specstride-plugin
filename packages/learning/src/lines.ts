/**
 * T025 — the message texts of the command `learn` (F106-FR-026): the lines
 * the baseline prints, byte for byte under compatibility output, and with no
 * new line under the `parity` profile (the caller decides the profile; every
 * builder here returns the text WITHOUT the trailing line feed).
 *
 * Ported from the baseline (`lib/learn.py` at the pinned commit `9cab15d2`):
 * the usage and refusal texts of the front door, the notice about decisions
 * that predate phase shapes, the applied line, the reverted line, the
 * evaluation line, the digest line of `summarize --out`, and the two lines of
 * `observe` (which has no command; its line goes to the engine log in a run,
 * F106-FR-036). A message that names state names it by logical name in the
 * default output (F106-FR-026); the paths handed in here are the caller's
 * choice of profile.
 *
 * Purity: string builders only; no clock, no environment, no file system.
 */

/** The prefix every learning message that is not a usage error carries. */
export const LEARN_MESSAGE_PREFIX = "learn:" as const;

/** The command word the usage errors name. */
export const LEARN_COMMAND = "specstride learn" as const;

/** `advise` with no telemetry at all (F106-FR-025, exit 1). */
export function noTelemetryAnyPhaseLine(): string {
  return `${LEARN_MESSAGE_PREFIX} no telemetry for any phase`;
}

/** `advise` of one phase with no telemetry, when that phase was asked for. */
export function noTelemetryPhaseLine(phase: number): string {
  return `${LEARN_MESSAGE_PREFIX} no telemetry for phase ${phase}`;
}

/** The line `observe` returns for a phase that has telemetry (F106-FR-006). */
export function observationLine(
  phase: number,
  attempts: number,
  workP50: number,
  workP90: number,
  out: string,
): string {
  return (
    `${LEARN_MESSAGE_PREFIX} phase ${phase} observation — ${attempts} attempt(s), ` +
    `work p50=${workP50}s p90=${workP90}s → ${out}`
  );
}

/** The line `observe` returns for a phase with no telemetry (F106-FR-006). */
export function noTelemetryYetLine(phase: number, out: string): string {
  return `${LEARN_MESSAGE_PREFIX} no telemetry for phase ${phase} yet → ${out}`;
}

/** A mode that is not one of the six (F106-FR-022, exit 1). */
export function unknownOptionLine(mode: string): string {
  return (
    `${LEARN_COMMAND}: unknown option '${mode}' ` +
    "(expected --show|--apply|--revert <run-id>|--off|--summarize|--evaluate)"
  );
}

/** `--revert` without a run id (F106-FR-022, exit 1, standard error). */
export function revertUsageLine(): string {
  return `usage: ${LEARN_COMMAND} --revert <run-id>`;
}

/** No event file was found under any of the paths handed in (F106-FR-025, exit 2). */
export function noEventsFoundLine(paths: readonly string[]): string {
  return `${LEARN_MESSAGE_PREFIX} no events.jsonl found under: ${paths.join(", ")}`;
}

/** `advise` was given neither events nor a summary (F106-FR-025, exit 2). */
export function eventsOrSummaryRequiredLine(): string {
  return `${LEARN_MESSAGE_PREFIX} one of --events or --summary is required`;
}

/** The spec could not be read; learning continues with no shape restriction (F106-FR-024). */
export function cannotReadShapesLine(specs: string, error: string): string {
  return `${LEARN_MESSAGE_PREFIX} cannot read phase shapes from ${specs}: ${error}`;
}

/** `--apply` was given no `--phase` (a missing input, exit 2). */
export function applyRequiresPhaseLine(): string {
  return `${LEARN_MESSAGE_PREFIX} --apply requires --phase <N>`;
}

/** A run id outside the `learn-` + twelve-hexadecimal form (exit 2). */
export function runIdFormLine(): string {
  return `${LEARN_MESSAGE_PREFIX} --run-id must be 'learn-' followed by 12 hexadecimal characters`;
}

/** No workspace or feature was resolved, so no decision log can be found (exit 2). */
export function cannotFindDecisionLogLine(): string {
  return `${LEARN_MESSAGE_PREFIX} cannot find the decision log (no workspace or feature resolved)`;
}

/** The report when the decision log holds no decision at all. */
export function noActiveDecisionsLine(): string {
  return `${LEARN_MESSAGE_PREFIX} no active decisions`;
}

/** The line an `apply` prints (F106-FR-026). */
export function appliedLine(input: {
  readonly knob: string;
  readonly phase: number;
  readonly previous: number;
  readonly value: number;
  readonly samples: number;
  readonly runId: string;
  readonly appliedFile: string;
}): string {
  return (
    `${LEARN_MESSAGE_PREFIX} applied ${input.knob}[${input.phase}] ` +
    `${input.previous}s -> ${input.value}s ` +
    `(samples=${input.samples}, run_id=${input.runId}) → ${input.appliedFile}`
  );
}

/** The line a `revert` prints (F106-FR-026). */
export function revertedLine(input: {
  readonly runId: string;
  readonly knob: string;
  readonly phase: number;
  readonly value: number;
}): string {
  return (
    `${LEARN_MESSAGE_PREFIX} reverted ${input.runId} — ` +
    `${input.knob}[${input.phase}] back to ${input.value}s`
  );
}

/** A kill count dictionary in the form the digest line writes (`hard_cap=2, other=1`). */
export function killsText(kills: Readonly<Record<string, number>>): string {
  return Object.entries(kills)
    .map(([reason, n]) => `${reason}=${n}`)
    .join(",");
}

/** The digest line of `summarize --out` (F106-FR-026). */
export function digestLine(input: {
  readonly runs: number;
  readonly attempts: number;
  readonly passes: number;
  readonly cost: number;
  readonly kills: Readonly<Record<string, number>>;
  readonly out: string;
}): string {
  return (
    `${LEARN_MESSAGE_PREFIX} ${input.runs} run(s), ${input.attempts} attempt(s), ` +
    `${input.passes} pass(es), $${input.cost}, kills=${killsText(input.kills)} → ${input.out}`
  );
}

/** The `need` figure of the cost and wall sections of an evaluation line (F106-FR-026). */
export const EVALUATION_NEED_TEXT = "6/6" as const;

/**
 * One primary of an evaluation line: the `need` form below the arm floor, the
 * effect-and-MDE form at or above it (the baseline's `_fmt_primary`).
 */
export function fmtPrimary(name: string, arm: Record<string, unknown>): string {
  const nA = arm["n_a"] ?? 0;
  const nB = arm["n_b"] ?? 0;
  const r = arm["r"];
  if (r === null || r === undefined) {
    return `${name} n=${nA}/${nB} (need ${EVALUATION_NEED_TEXT})`;
  }
  const mde = arm["mde"] ?? 0;
  const rNum = Number(r);
  const sign = rNum < 0 ? "-" : "+";
  return `${name} r=${sign}${Math.abs(rNum).toFixed(2)} (MDE ±${Number(mde).toFixed(2)}, n=${nA}/${nB})`;
}

/**
 * The evaluation line of a recorded evaluation (F106-FR-026), derived from the
 * members the `evaluate` entry stored — the report of the last evaluations
 * that `learn --show` prints reads these lines out of the log (F106-FR-023).
 * `guardrails ok (<k> unknown below their minimum n)` counts the guardrail
 * records whose state is `unknown`; a `BREACH` state prints the breach form
 * instead.
 */
export function evaluationLine(entry: Record<string, unknown>): string {
  const knob = String(entry["knob"] ?? "?");
  const phase = entry["phase"] ?? "?";
  const previous = entry["previous"];
  const value = entry["value"];
  const runId = String(entry["evaluates_run_id"] ?? entry["run_id"] ?? "?");
  const label = String(entry["label"] ?? "?");
  const cost = (entry["cost"] ?? {}) as Record<string, unknown>;
  const wall = (entry["wall"] ?? {}) as Record<string, unknown>;
  const reset = entry["reset"];
  const resetText = reset === "shape" || reset === "backend" ? ` (baseline reset: ${reset})` : "";
  const guardrails = (entry["guardrails"] ?? {}) as Record<string, Record<string, unknown>>;
  const breached = Object.entries(guardrails)
    .filter(([, g]) => g["state"] === "breach")
    .map(([name]) => name);
  const unknown = Object.values(guardrails).filter((g) => g["state"] === "unknown").length;
  const guardrailText = breached.length
    ? `guardrails: BREACH ${breached.join(",")}`
    : `guardrails ok (${unknown} unknown below their minimum n)`;
  return (
    `${LEARN_MESSAGE_PREFIX} phase ${phase} ${knob} ${previous}s→${value}s [${runId}]:` +
    `${resetText} ${label}` +
    ` — ${fmtPrimary("cost", cost)}` +
    `; ${fmtPrimary("wall", wall)}` +
    `; ${guardrailText}`
  );
}

/** The `--evaluate --report` line for a decision with no recorded evaluation yet. */
export function notEvaluatedLine(input: {
  readonly phase: number;
  readonly knob: string;
  readonly previous: number;
  readonly value: number;
  readonly runId: string;
}): string {
  return (
    `${LEARN_MESSAGE_PREFIX} phase ${input.phase} ${input.knob} ` +
    `${input.previous}s→${input.value}s [${input.runId}]: not evaluated yet`
  );
}
