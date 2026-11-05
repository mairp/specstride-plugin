/**
 * T046 — the four summary lines of the stream (F128-FR-024, CQ-121).
 *
 * F128-FR-024: *A line of a stream that is not a record MUST NOT be shipped.
 * The exporter MUST print nothing on standard output. Under compatibility
 * output and with the telemetry add-on on, the presenter MUST print for the
 * stream facts the four summary lines `  · init model=<model|?> tools=<n>`,
 * the text of the model, `  → tool: <name>` and `  ✓ result: <subtype>
 * cost=$<4 decimals>  turns=<n>  out_tok=<n>  <ms>ms`. In default output none
 * of them MUST be printed.*
 *
 * The module is a FORMATTER: it returns the lines and prints nothing (CQ-121
 * — the presenter of feature 119 calls it in compatibility output; the
 * channel is the caller's). The exporter itself holds no write to standard
 * output anywhere: `STDOUT_IS_NOT_A_CHANNEL_OF_THE_EXPORTER` is the recorded
 * rule its tests prove (a flush against a live or dead collector adds no
 * standard-output line).
 */

/** The rule the tests prove: the exporter prints nothing on standard output. */
export const STDOUT_IS_NOT_A_CHANNEL_OF_THE_EXPORTER = true as const;

/** The first summary line: the init line, `model=?` when the model is unknown. */
export function formatInitLine(model?: string, tools = 0): string {
  return `  · init model=${model ?? "?"} tools=${String(tools)}`;
}

/** The second summary line: the text of the model, alone (`?` when unknown). */
export function formatModelLine(model?: string): string {
  return model ?? "?";
}

/** The third summary line: the tool line. */
export function formatToolLine(name: string): string {
  return `  → tool: ${name}`;
}

/** The fourth summary line: the result line, cost at four decimals. */
export function formatResultLine(
  subtype: string,
  costUsd: number,
  turns: number,
  outTokens: number,
  durationMs: number,
): string {
  return `  ✓ result: ${subtype}  cost=$${costUsd.toFixed(4)}  turns=${String(turns)}  out_tok=${String(outTokens)}  ${String(durationMs)}ms`;
}

/** The stream facts one summary block is formatted from. */
export type StreamFacts = {
  /** The model of the run, when the stream gave one. */
  readonly model?: string;
  /** The number of tools of the run. */
  readonly tools?: number;
  /** The names of the tools called, one tool line each. */
  readonly toolCalls?: readonly string[];
  /** The subtype of the final result record. */
  readonly subtype?: string;
  /** The cost of the run, in dollars. */
  readonly costUsd?: number;
  /** The number of turns. */
  readonly turns?: number;
  /** The output tokens. */
  readonly outTokens?: number;
  /** The duration of the pass, in milliseconds. */
  readonly durationMs?: number;
};

/**
 * The four summary lines of a stream, in order. A tool line is emitted per
 * tool call; a run with no tools carries none, and the other three lines are
 * always the first, second and fourth of the block.
 */
export function summaryLines(facts: StreamFacts): string[] {
  const lines = [
    formatInitLine(facts.model, facts.tools ?? 0),
    formatModelLine(facts.model),
    ...(facts.toolCalls ?? []).map(formatToolLine),
    formatResultLine(
      facts.subtype ?? "complete",
      facts.costUsd ?? 0,
      facts.turns ?? 0,
      facts.outTokens ?? 0,
      facts.durationMs ?? 0,
    ),
  ];
  return lines;
}
