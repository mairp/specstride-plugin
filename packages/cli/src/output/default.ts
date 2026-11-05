/**
 * T033 — the default-output lines of the inspection verbs (F119-FR-030,
 * F119-FR-031, F119-FR-033).
 *
 * In default output an inspection verb prints ONE product line for a success
 * and, for a failure, the failing item with its fix — the closed reason and
 * the one fixed fix text of `closed-sets.ts` — and nothing more. Every path a
 * line carries is RELATIVE to the root of the repository (`displayPath`); an
 * absolute path in default output is a failure of the build (F119-FR-031).
 * The `--json` record (`jsonRecord`) carries the same facts with keys in the
 * stable order of F119-FR-033: `schema`, `cmd`, `ok`, `feature`, then the
 * fields of the verb, then `reason` and `fix` when `ok` is false.
 */

import { LINE_LABELS, fixTextOf, schemaIdOf, type FailureReason } from "./closed-sets.ts";
import { productLine, errorLine, type Pair } from "./lines.ts";
import { basename, relative } from "node:path";

/**
 * A path as default output prints it (F119-FR-030): relative to the root of
 * the repository. A path outside it keeps only its base name — a value that
 * names the item without carrying an absolute path out of the machine.
 */
export function displayPath(path: string): string {
  const rel = relative(process.cwd(), path);
  if (rel === "") return ".";
  return rel.startsWith("..") ? basename(path) : rel;
}

/** `1-3, 5` — the phase numbers of one state, as ranges (F119-FR-030). */
export function rangesOf(numbers: readonly number[]): string {
  const sorted = [...numbers].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = 0;
  for (let at = 1; at <= sorted.length; at += 1) {
    const endOfRun =
      at === sorted.length || (sorted[at] as number) !== (sorted[at - 1] as number) + 1;
    if (endOfRun) {
      const first = sorted[start] as number;
      const last = sorted[at - 1] as number;
      parts.push(first === last ? `${first}` : `${first}-${last}`);
      start = at;
    }
  }
  return parts.join(", ");
}

/** `[SPECSTRIDE-TAIL] name=... bytes=... lines=...` (F119-FR-030). */
export function tailLine(line: { name: string; bytes: number; lines: number }): string {
  return productLine(LINE_LABELS.tail, [
    ["name", line.name],
    ["bytes", line.bytes],
    ["lines", line.lines],
  ]);
}

/** One `[SPECSTRIDE-EVENT] seq=... type=... phase=... attempt=...` line. */
export function eventLine(event: {
  seq: number;
  type: string;
  phase?: number | undefined;
  attempt?: number | undefined;
}): string {
  const pairs: Pair[] = [
    ["seq", event.seq],
    ["type", event.type],
  ];
  if (event.phase !== undefined) pairs.push(["phase", event.phase]);
  if (event.attempt !== undefined) pairs.push(["attempt", event.attempt]);
  return productLine(LINE_LABELS.events, pairs);
}

/** One `[SPECSTRIDE-VERDICT] name=... bytes=... result=...` line. */
export function verdictLine(line: { name: string; bytes: number; result: string }): string {
  return productLine(LINE_LABELS.verdicts, [
    ["name", line.name],
    ["bytes", line.bytes],
    ["result", line.result],
  ]);
}

/** `[SPECSTRIDE-FEEDBACK] phase=... name=... bytes=... lines=...`. */
export function feedbackLine(line: {
  phase: number;
  name: string;
  bytes: number;
  lines: number;
}): string {
  return productLine(LINE_LABELS.feedback, [
    ["phase", line.phase],
    ["name", line.name],
    ["bytes", line.bytes],
    ["lines", line.lines],
  ]);
}

/** `[SPECSTRIDE-PHASES] spec=... phases=... approved=... current=... ...`. */
export function phasesLine(line: {
  spec: string;
  phases: number;
  approved: number;
  current: number | "done";
  states: Readonly<Record<string, readonly number[]>>;
}): string {
  const pairs: Pair[] = [
    ["spec", line.spec],
    ["phases", line.phases],
    ["approved", line.approved],
    ["current", line.current],
  ];
  for (const [state, numbers] of Object.entries(line.states)) {
    if (numbers.length > 0) pairs.push([state, rangesOf(numbers)]);
  }
  return productLine(LINE_LABELS.phases, pairs);
}

/** The failure line of one verb and one closed reason (F119-FR-030). */
export function failureLine(cmd: string, reason: FailureReason): string {
  return errorLine(cmd, reason);
}

/**
 * The `--json` record of one inspection call (F119-FR-033): keys in the
 * stable order `schema`, `cmd`, `ok`, `feature`, the fields of the verb, then
 * `reason` and `fix` when the call failed. The text returns as a line with
 * the trailing newline the caller adds.
 */
export function jsonRecord(
  verb: string,
  fields: Readonly<Record<string, unknown>>,
  failure?: { readonly reason: FailureReason; readonly feature?: string | undefined } | undefined,
): string {
  const record: Record<string, unknown> = {
    schema: schemaIdOf(verb),
    cmd: verb,
    ok: failure === undefined,
  };
  if (failure?.feature !== undefined) record.feature = failure.feature;
  else if (fields.feature !== undefined) record.feature = fields.feature;
  for (const [key, value] of Object.entries(fields)) {
    if (key === "feature") continue;
    record[key] = value;
  }
  if (failure !== undefined) {
    record.reason = failure.reason;
    record.fix = fixTextOf(failure.reason);
  }
  return JSON.stringify(record);
}
