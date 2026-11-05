/**
 * T030 — the handlers of `tail` and `events` (F119-FR-018).
 *
 * `tail` shows the engine log of the selected engine start: in default output
 * one `[SPECSTRIDE-TAIL]` line that names the log by logical name, byte count
 * and line count; under `--verbose` the text itself, redacted and framed as
 * data (F119-FR-032). `events` renders the event stream of the selected
 * engine start: one `[SPECSTRIDE-EVENT]` line per milestone event of the
 * newest events that fit the limit, closed fields only; `--follow` adds
 * following, which keeps to the limit for what it prints before it follows
 * (F119-FR-031). `--json` prints the record of F119-FR-033.
 *
 * Neither handler writes a file (F119-FR-016).
 */

import { readFileSync } from "node:fs";
import { parseInspectArgs } from "../router/inspect-args.ts";
import type { RoutedCall } from "../router/route.ts";
import { byteLimitOf, capOutput, productLine } from "../output/lines.ts";
import { TRUNCATED_LABEL } from "../output/closed-sets.ts";
import { failureLine, eventLine, tailLine, jsonRecord } from "../output/default.ts";
import { outsideTextLines } from "../output/free-text.ts";
import { isCompatibilityMode } from "../output/mode.ts";
import { compatText, renderCompatEvents } from "../output/compat.ts";
import { select, type SelectedFile } from "./select.ts";
import type { FailureReason } from "../output/closed-sets.ts";

/** The text with one trailing newline, as a printed stream ends. */
function ensureNewline(text: string): string {
  return text.endsWith("\n") || text === "" ? text : `${text}\n`;
}

/** What one handler read and printed. */
export type InspectOutcome = {
  readonly exit: number;
  readonly reason?: FailureReason | undefined;
};

/** One milestone event of the stream, as the closed fields hold it. */
export type MilestoneEvent = {
  readonly seq: number;
  readonly type: string;
  readonly phase: number | null;
  readonly attempt: number | null;
};

/** Parse an event-stream line into the closed fields, `null` where not known. */
export function milestoneOf(raw: string, seq: number): MilestoneEvent | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const type = parsed.event ?? parsed.type;
  if (typeof type !== "string") return null;
  const phase = parsed.phase;
  const attempt = parsed.attempt;
  return Object.freeze({
    seq,
    type,
    phase: typeof phase === "number" ? phase : null,
    attempt: typeof attempt === "number" ? attempt : null,
  });
}

/** The milestone events of an event file, in stream order. */
export function milestonesOf(text: string): readonly MilestoneEvent[] {
  const out: MilestoneEvent[] = [];
  const lines = text.split("\n");
  for (let at = 0; at < lines.length; at += 1) {
    const row = lines[at] as string;
    if (row.trim() === "") continue;
    const milestone = milestoneOf(row, out.length + 1);
    if (milestone !== null) out.push(milestone);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The shared emit of the two handlers: the byte cap over the lines, or
 * the `--json` record, and the exit code of the outcome.
 * ------------------------------------------------------------------ */

export function emit(
  call: RoutedCall,
  args: ReturnType<typeof parseInspectArgs>,
  verb: string,
  lines: readonly string[],
  json: Record<string, unknown>,
  failure: FailureReason | undefined,
): number {
  const limit = byteLimitOf({
    failure: failure !== undefined,
    verbose: args.verbose,
    follows: args.follow,
  });
  if (args.json) {
    const record = jsonRecord(verb, json, failure === undefined ? undefined : { reason: failure });
    const capped = capOutput(`${record}\n`, limit);
    call.io.out(capped.text);
  } else {
    const raw = lines.map((line) => `${line}\n`).join("");
    call.io.out(capOutput(raw, limit).text);
  }
  if (failure !== undefined) {
    call.io.err(`${failureLine(verb, failure)}\n`);
    return 1;
  }
  return 0;
}

/* ------------------------------------------------------------------ *
 * `tail`
 * ------------------------------------------------------------------ */

/** The handler of `tail` (F119-FR-018): the engine log of the newest run. */
export function tailHandler(call: RoutedCall): number {
  const args = parseInspectArgs(call.extras);
  const chosen = select(args, call.controlPlane);
  const log: SelectedFile | undefined = chosen.log;
  if (log === undefined) return emit(call, args, "tail", [], {}, "no-log");
  const text = readFileSync(log.path, "utf8");
  // F119-FR-029 — in compatibility output `tail` prints the engine log as
  // the baseline prints it: the log itself, after the redactor.
  if (isCompatibilityMode(call.mode)) {
    call.io.out(compatText(text));
    return 0;
  }
  const bytes = Buffer.byteLength(text, "utf8");
  const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  const line = tailLine({ name: log.logicalName, bytes, lines });
  // F119-FR-032 — the log text itself only under `--verbose`, framed as data.
  const parts =
    args.verbose === true ? [line, ...outsideTextLines("", log.logicalName, text, args)] : [line];
  return emit(
    call,
    args,
    "tail",
    parts,
    { feature: chosen.feature, name: log.logicalName, bytes, lines },
    undefined,
  );
}

/* ------------------------------------------------------------------ *
 * `events`
 * ------------------------------------------------------------------ */

/** The lines of the milestone events that fit, and how many were left out. */
export function fitEvents(
  events: readonly MilestoneEvent[],
  limit: number,
): { lines: readonly string[]; left: number } {
  const lines = events.map((event) =>
    eventLine({
      seq: event.seq,
      type: event.type,
      phase: event.phase ?? undefined,
      attempt: event.attempt ?? undefined,
    }),
  );
  let used = 0;
  let left = 0;
  const kept: string[] = [];
  for (let at = 0; at < lines.length; at += 1) {
    const cost = Buffer.byteLength(`${lines[at]}\n`, "utf8");
    // Reserve room for the truncation line on a finite limit.
    const room = limit === Number.POSITIVE_INFINITY ? Number.MAX_SAFE_INTEGER : limit - 80;
    if (used + cost > room && kept.length > 0) {
      left = events.length - at;
      break;
    }
    kept.push(lines[at] as string);
    used += cost;
  }
  return { lines: kept, left };
}

/** The handler of `events` (F119-FR-018): the event stream, closed fields. */
export function eventsHandler(call: RoutedCall): number {
  const args = parseInspectArgs(call.extras);
  const chosen = select(args, call.controlPlane);
  const file = chosen.events;
  if (file === undefined) return emit(call, args, "events", [], {}, "no-events");
  const raw = readFileSync(file.path, "utf8");
  // F119-FR-029 / F119-FR-018 — in compatibility output `events` renders the
  // stream as the baseline prints it, and `events --json` stays one JSON
  // object per line, as the file holds it.
  if (isCompatibilityMode(call.mode)) {
    call.io.out(
      args.json === true ? compatText(ensureNewline(raw)) : compatText(renderCompatEvents(raw)),
    );
    return 0;
  }
  const events = milestonesOf(raw);
  const limit = byteLimitOf({
    failure: false,
    verbose: args.verbose,
    follows: args.follow,
  });
  const fitted = fitEvents(events, limit);
  const lines =
    fitted.left > 0
      ? [
          ...fitted.lines,
          productLine(TRUNCATED_LABEL, [
            ["left", fitted.left],
            ["more", "--verbose"],
          ]),
        ]
      : fitted.lines;
  const json = {
    feature: chosen.feature,
    events: events.slice(0, events.length - fitted.left).map((event) => ({
      seq: event.seq,
      type: event.type,
      phase: event.phase,
      attempt: event.attempt,
    })),
    left: fitted.left,
  };
  return emit(call, args, "events", lines, json, undefined);
}
