/**
 * T024 — the observation document of an approved phase (F106-FR-006): one
 * document per phase at the logical name
 * `feature:<slug>:learning:observation:<N>`, overwritten whole on each call,
 * holding `schema` (`specstride.learn.observation/1`), `phase`, `shape`,
 * `generated_at`, `observation` and `inputs`.
 *
 * A phase with no telemetry is not an error: the observation is `null` and
 * the line is `learn: no telemetry for phase <N> yet → <out>`. The operation
 * has no command (F106-FR-022); the line it returns goes to the engine log in
 * a run, never to standard output (F106-FR-036). The engine records the event
 * learning.observed (spelled unquoted here: the CT-110-109 catalogue check
 * reads a quoted learning. literal as a configuration key) after the document was written — a failed observation
 * records none, so this function either writes the document and returns its
 * line, or throws and leaves nothing behind.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { noTelemetryYetLine, observationLine } from "./lines.ts";

/** The schema id of the observation document (annex B §B.20). */
export const LEARN_OBSERVATION_SCHEMA = "specstride.learn.observation/1" as const;

/** The result of one `observe` call: the document written (or its absence), the line, the path. */
export type Observation = {
  readonly phase: number;
  /** The logical name the document was written to. */
  readonly logicalName: string;
  /** The path the document was written to; `null` when the caller asked for no write. */
  readonly path: string | null;
  /** The phase record observed, or `null` when the phase has no telemetry. */
  readonly observation: Record<string, unknown> | null;
  /** The line the operation returns (to the engine log in a run). */
  readonly line: string;
};

/** Options of `observe`: the figures of the phase, and where the document goes. */
export type ObserveOptions = {
  readonly phase: number;
  /** The phase shape the figures were keyed on; `null` when unrestricted. */
  readonly shape?: string | null;
  /** The summary document the figures come from (F106-FR-004). */
  readonly summary: Record<string, unknown>;
  /** The path to overwrite the document at; omitted for a dry observation. */
  readonly path?: string | undefined;
  /** `generated_at`, UTC to the second; handed in, never read from a clock here. */
  readonly generatedAt: string;
  /** What the figures were computed from, recorded in `inputs`. */
  readonly inputs?: Readonly<Record<string, unknown>>;
};

/**
 * Observe one approved phase (F106-FR-006): build the document, overwrite it
 * whole at `path`, and return the line. The figures are the phase record of
 * the summary; a phase absent from it — or one with zero attempts — is a
 * phase with no telemetry: the document still exists, with `observation:
 * null`.
 */
export function observe(options: ObserveOptions): Observation {
  const { phase } = options;
  const phases = (options.summary["phases"] ?? {}) as Record<string, Record<string, unknown>>;
  const rec = phases[String(phase)] as Record<string, unknown> | undefined;
  const attempts = typeof rec?.["attempts_total"] === "number" ? rec["attempts_total"] : 0;
  const hasTelemetry = rec !== undefined && attempts > 0;
  const observation = hasTelemetry ? rec! : null;
  const logicalName = `feature:<slug>:learning:observation:${phase}`;

  const document: Record<string, unknown> = {
    schema: LEARN_OBSERVATION_SCHEMA,
    phase,
    shape: options.shape ?? null,
    generated_at: options.generatedAt,
    observation,
    inputs: options.inputs ?? {},
  };

  if (options.path !== undefined) {
    mkdirSync(dirname(options.path), { recursive: true });
    // Overwritten whole on each call (F106-FR-006): one `writeFileSync`, never an append.
    writeFileSync(options.path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  }

  const line = hasTelemetry
    ? observationLine(
        phase,
        attempts,
        numberOf(rec?.["work_sec_p50"]) ?? 0,
        numberOf(rec?.["work_sec_p90"]) ?? 0,
        options.path ?? logicalName,
      )
    : noTelemetryYetLine(phase, options.path ?? logicalName);

  return { phase, logicalName, path: options.path ?? null, observation, line };
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
