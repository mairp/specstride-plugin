/**
 * T038 — the text of the start-up line and the fallback line (F128-FR-029).
 *
 * F128-FR-029: *With telemetry off, the start-up record of a run MUST say
 * `  telemetry: off (loki export not configured)`. With it on, the line MUST
 * carry the receiver state of F128-FR-028. When the probe cannot run, the
 * status line and the start-up line MUST fall back to
 * `<sink>: export configured (<url>)`. The lines MUST be printed in
 * compatibility output; in default output the rule of annex G §G.3 for terse
 * lines holds and no line is added under the `parity` profile.*
 *
 * CQ-122: the as-is line text; the label family of the line is the printer's,
 * not the exporter's. So this module RETURNS the line — it prints nothing —
 * and the feature that owns the start-up record prints it (CQ-122). The
 * exporter prints nothing at all (F128-FR-024): standard output is not a
 * channel of the exporter.
 */
import { STATE_PHRASES, type ReceiverState } from "./state.ts";

/** The start-up line with telemetry off: two leading spaces, the as-is text. */
export const STARTUP_LINE_OFF = "  telemetry: off (loki export not configured)" as const;

/** What the caller of `startupLine` hands in. */
export type StartupLineInput = {
  /** The sink `telemetry.enabled` resolved to. */
  readonly enabled: boolean;
  /** The receiver state, when the probe ran (F128-FR-028). */
  readonly state?: ReceiverState;
  /** The address, when the probe ran against one. */
  readonly url?: string;
  /** The address the probe could not run against (the fallback names it). */
  readonly fallbackUrl?: string;
  /** Which sink the fallback names; the default is `loki`. */
  readonly sink?: string;
};

/**
 * The start-up line: off, the receiver state when on, or the fallback
 * `<sink>: export configured (<url>)` when the probe cannot run.
 */
export function startupLine(input: StartupLineInput): string {
  if (!input.enabled) return STARTUP_LINE_OFF;
  if (input.state === undefined) {
    return fallbackStatusLine(input.sink ?? "loki", input.fallbackUrl ?? input.url ?? "");
  }
  const phrase = STATE_PHRASES[input.state];
  return input.url === undefined
    ? `${input.sink ?? "loki"}: ${phrase}`
    : `${input.sink ?? "loki"}: ${phrase} (${input.url})`;
}

/** The fallback status line: `<sink>: export configured (<url>)`. */
export function fallbackStatusLine(sink: string, url: string): string {
  return `${sink}: export configured (${url})`;
}

/** The line the caller hands its printer; the printer prints it (CQ-122). */
export type Printer = (line: string) => void;

/**
 * Give the line to the printer of the feature that owns the start-up record
 * (CQ-122) and return it. The exporter never calls this: it prints nothing.
 */
export function printStartupLine(print: Printer, input: StartupLineInput): string {
  const line = startupLine(input);
  print(line);
  return line;
}

/** The exporter prints nothing: standard output is not a channel of the exporter. */
export const THE_EXPORTER_PRINTS_NOTHING = true as const;
