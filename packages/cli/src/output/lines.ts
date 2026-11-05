/**
 * T004 — the product-line writer of default output (F119-FR-030, F119-FR-031;
 * the line grammar of annex G §G.3).
 *
 * A product line carries a label that starts with `SPECSTRIDE-` and pairs
 * `key=value` separated by one space, where a TEXT value is quoted as in
 * JSON. The writer does exactly that and nothing more: it invents no field,
 * it prints no free text from outside the runtime (that is the frame writer's
 * job, T005), and it cuts the call's output at the byte cap with the
 * `[SPECSTRIDE-TRUNCATED]` line (F119-FR-031).
 */

import {
  ERROR_LABEL,
  TRUNCATED_LABEL,
  fixTextOf,
  type FailureReason,
  type LineLabel,
} from "./closed-sets.ts";

/** The byte limits of one call of an inspection verb (F119-FR-031). */
export const SUCCESS_BYTE_LIMIT = 1_120 as const;
export const FAILURE_BYTE_LIMIT = 2_240 as const;

/** One ordered pair of a product line. */
export type Pair = readonly [key: string, value: string | number | boolean];

/** Quote a value the way the line grammar quotes a text value: as in JSON. */
export function quoteValue(value: string | number | boolean): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return String(value);
}

export type LineTag = LineLabel | typeof ERROR_LABEL | typeof TRUNCATED_LABEL;

/** Render one product line: the label, then the pairs `key=value`. */
export function productLine(label: LineTag, pairs: readonly Pair[]): string {
  const body = pairs.map(([key, value]) => `${key}=${quoteValue(value)}`).join(" ");
  return body === "" ? label : `${label} ${body}`;
}

/** The failure line `[SPECSTRIDE-ERROR] cmd=... reason=... fix="..."`. */
export function errorLine(cmd: string, reason: FailureReason): string {
  return productLine(ERROR_LABEL, [
    ["cmd", cmd],
    ["reason", reason],
    ["fix", fixTextOf(reason)],
  ]);
}

/** What the byte cap did to one call's output (F119-FR-031). */
export type CappedOutput = {
  /** The output to print: the lines, then the truncation line when cut. */
  readonly text: string;
  /** True when the cap cut the output. */
  readonly truncated: boolean;
  /** How many bytes were left out; 0 when nothing was cut. */
  readonly left: number;
};

/**
 * The limit of one call (F119-FR-031): 1,120 bytes on a success, 2,240 on a
 * failure; `--verbose` lifts the cap on a success. A following form (`tail`,
 * `events --follow`, `watch`) keeps to the limit for what it prints before it
 * starts to follow, which the caller states with `follows`.
 */
export function byteLimitOf(options: {
  failure: boolean;
  verbose?: boolean;
  follows?: boolean;
}): number {
  if (options.follows || (options.verbose === true && !options.failure)) {
    return Number.POSITIVE_INFINITY;
  }
  return options.failure ? FAILURE_BYTE_LIMIT : SUCCESS_BYTE_LIMIT;
}

/**
 * Cut one call's output to the byte limit and end it with
 * `[SPECSTRIDE-TRUNCATED] left=<n> more=--verbose` when anything was cut.
 * `left` counts the bytes of the original output that the line replaced.
 */
export function capOutput(text: string, limit: number): CappedOutput {
  if (limit === Number.POSITIVE_INFINITY || Buffer.byteLength(text) <= limit) {
    return { text, truncated: false, left: 0 };
  }
  const truncation = (left: number): string =>
    productLine(TRUNCATED_LABEL, [
      ["left", left],
      ["more", "--verbose"],
    ]);
  // Grow back until the kept text plus the truncation line fits the limit.
  let end = text.length;
  for (;;) {
    const kept = text.slice(0, end);
    const withBreak = kept.endsWith("\n") ? kept : `${kept}\n`;
    const left = Buffer.byteLength(text) - Buffer.byteLength(withBreak);
    const line = truncation(left);
    const result = `${withBreak}${line}\n`;
    if (Buffer.byteLength(result) <= limit) {
      return { text: result, truncated: true, left };
    }
    // Walk back to the previous line break, or one character, whichever is next.
    const breakAt = kept.lastIndexOf("\n");
    end = breakAt > 0 ? breakAt : end - 1;
  }
}

/**
 * The writer of one call of an inspection verb in default output: it holds
 * the lines, applies the byte cap over stdout and stderr together and hands
 * back what to print (F119-FR-030, F119-FR-031).
 */
export type LineWriter = {
  /** Add one product line to the call's output. */
  line(text: string): void;
  /** Add the failure line of one reason. */
  error(cmd: string, reason: FailureReason): void;
  /** Finish the call: the capped output, and whether it was cut. */
  finish(): CappedOutput;
};

/** Open the writer of one call with the limits of that call (F119-FR-031). */
export function openLineWriter(options: {
  failure: boolean;
  verbose?: boolean;
  follows?: boolean;
}): LineWriter {
  const limit = byteLimitOf(options);
  const lines: string[] = [];
  return {
    line(text: string): void {
      lines.push(text);
    },
    error(cmd: string, reason: FailureReason): void {
      lines.push(errorLine(cmd, reason));
    },
    finish(): CappedOutput {
      const raw = lines.map((line) => `${line}\n`).join("");
      return capOutput(raw, limit);
    },
  };
}
