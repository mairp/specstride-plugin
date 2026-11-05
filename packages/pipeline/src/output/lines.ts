/**
 * T007 — the line table reader, the colour decision, the hues, the redacted
 * action and the two output modes (F123-FR-002, F123-FR-003, F123-FR-017).
 *
 * Every labelled line of the pipeline entry is data-driven from the line
 * table (`packages/pipeline/data/lines.json`, from `pipeline-lines.json` of
 * §R.2), so that compatibility output and default output cannot drift: the
 * emitter knows one label and one hue, and the mode decides what reaches the
 * stream and what goes to the pipeline log only. Only the label is wrapped in
 * colour; the pipeline log always receives the plain line.
 */
import { colourModesOfThePipelineEntry } from "@specstride/contracts";
import { contentHash } from "@specstride/kernel";
import { loadLines } from "./load-data.ts";

/** The hues of §R.2, with their ANSI codes (only the label is wrapped). */
export const HUES = {
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  cyan: "\u001b[36m",
  magenta: "\u001b[35m",
  dim: "\u001b[2m",
  none: "",
} as const;
export type Hue = keyof typeof HUES;

const RESET = "\u001b[0m";

/** A colour mode of the closed set of row 109 (`auto`, `always`, `never`). */
export type ColourMode = "auto" | "always" | "never";

/** True when the value is a mode of the closed set of row 109; the unknown value is a usage error, exit 2. */
export function isColourMode(value: string): boolean {
  return colourModesOfThePipelineEntry.has(value);
}

/**
 * The colour decision, in the order of F123-FR-002: `--no-color` (off), then
 * `--color always` or `--color never`, then the presence of the variable
 * `NO_COLOR` with any value — the empty value included (B-2563) — then
 * `auto` (on only when standard output is a terminal).
 */
export function decideColour(input: {
  noColor: boolean;
  color?: ColourMode;
  env: Readonly<Record<string, string | undefined>>;
  stdoutIsTerminal: boolean;
}): boolean {
  if (input.noColor) return false;
  if (input.color === "always") return true;
  if (input.color === "never") return false;
  if (Object.prototype.hasOwnProperty.call(input.env, "NO_COLOR")) return false;
  return input.stdoutIsTerminal;
}

/** Parse the value of `--color`; anything outside the closed set is a usage error (exit 2). */
export function parseColourMode(value: string | undefined): ColourMode | undefined {
  if (value === undefined) return undefined;
  if (value === "auto" || value === "always" || value === "never") return value;
  throw new ColourUsageError(value);
}

/** A value of `--color` outside the closed set; the pipeline entry ends with exit 2. */
export class ColourUsageError extends Error {
  constructor(value: string) {
    super(`usage: --color takes auto, always or never, not ${JSON.stringify(value)}`);
    this.name = "ColourUsageError";
  }
}

/** Wrap the label of a labelled line in the hue; the rest of the line stays plain. */
export function wrapLabel(label: string, colourOn: boolean, hue: Hue): string {
  if (!colourOn || hue === "none") return label;
  return `${HUES[hue]}${label}${RESET}`;
}

/**
 * The redacted action of a printed line (F123-FR-003, §R.2): the argument
 * list with every item quoted as in JSON and separated by a space; when the
 * action has environment entries the text is prefixed with
 * `env[<sorted names>] `, and no value is ever printed. Pure.
 */
export function redactAction(action: {
  argv: readonly string[];
  env?: readonly { name: string; target?: string; value?: string }[];
}): string {
  const entries = action.env ?? [];
  const prefix =
    entries.length === 0
      ? ""
      : `env[${entries
          .map((entry) => entry.target ?? entry.name)
          .sort()
          .join(",")}] `;
  return `${prefix}${action.argv.map((item) => JSON.stringify(item)).join(" ")}`;
}

/** Where a line goes: the two streams and the pipeline log. */
export type LineSink = {
  stdout(text: string): void;
  stderr(text: string): void;
  /** The pipeline log always receives the plain line. */
  log(text: string): void;
};

/** The two output modes of feature 100, annex G §G.2 (F123-FR-017). */
export type OutputMode = "compatibility" | "default";

/** The labels default output prints; every other labelled line goes to the log only. */
const DEFAULT_OUTPUT_PRINTS: readonly string[] = [
  "[DIGEST]",
  "[WARN]",
  "[BLOCKED]",
  "[INVALID]",
  "[STALE]",
  "[ERROR]",
  "[FAIL]",
];

/** The line table rows, read once. */
let cachedLines: ReturnType<typeof loadLines> | undefined;

/** The rows of §R.2 (from `lines.json`). */
export function pipelineLineTable() {
  cachedLines ??= loadLines();
  return cachedLines.pipelineLines;
}

/** The label of a row: the text of the line up to the first space, without the backticks. */
export function labelOfRow(row: { line: string }): string {
  return row.line.replace(/[`]/g, "").split(" ")[0];
}

/** True when default output prints the label; the progress lines stay log-only. */
export function defaultOutputPrints(label: string): boolean {
  if (
    label.startsWith("[SKIP]") ||
    label.startsWith("[PLAN]") ||
    label.startsWith("[CHECK]") ||
    label.startsWith("[PREFLIGHT]") ||
    label.startsWith("[DRY-RUN]")
  ) {
    return true; // the dry-run plan lines
  }
  return DEFAULT_OUTPUT_PRINTS.includes(label);
}

/**
 * Emit one labelled line (F123-FR-002, F123-FR-017): the label wrapped in the
 * hue of the row when colour is on, on the row's stream, and the plain line
 * always appended to the pipeline log. In default output a progress line
 * reaches neither stream, only the log.
 */
export function emitLine(input: {
  label: string;
  text: string;
  hue: Hue;
  stream: "stdout" | "stderr";
  mode: OutputMode;
  colourOn: boolean;
  sink: LineSink;
}): void {
  // The hue of the row of the line table wins over the caller's default.
  const row = pipelineLineTable().find((candidate) => labelOfRow(candidate) === input.label);
  const hue: Hue = row && row.hue in HUES ? (row.hue as Hue) : input.hue;
  const wrapped = wrapLabel(input.label, input.colourOn, hue);
  const line = `${wrapped} ${input.text}`;
  input.sink.log(line);
  if (input.mode === "default" && !defaultOutputPrints(input.label)) return;
  if (input.stream === "stderr") input.sink.stderr(line);
  else input.sink.stdout(line);
}

/**
 * The digest line of §R.2, exactly one per run end: the fields joined in the
 * order the table holds them, with the literal `None` where a value is absent.
 */
export function digestLine(input: {
  state: string;
  exit: number;
  lastStage: string | null;
  childExit: number | null;
  evidence: string | null;
  /** A pipeline run that reached a stage digests `child-exit=None` when no child exit exists (§R.2). */
  withChildExit?: boolean;
}): string {
  const lastStage = input.lastStage ?? "none";
  const child =
    input.childExit === null
      ? input.withChildExit === true
        ? " child-exit=None"
        : ""
      : ` child-exit=${input.childExit}`;
  const evidence = input.evidence ?? "none";
  return `[DIGEST] state=${input.state} exit=${input.exit} last-stage=${lastStage}${child} evidence=${evidence}`;
}

/** The evidence name of a pipeline run: `<pipeline>-<hash of the launch>` (§R.2 `evidence=<pipeline run>`). */
export function evidenceName(pipelineId: string, launchKey: string): string {
  return `${pipelineId}-${contentHash(launchKey).slice(0, 12)}`;
}
