/**
 * T006 — the lenient readers (F106-FR-004, F106-FR-007): the reader of the
 * event files of past runs, with the attribution of an event that has no run
 * id, and the lenient reader of the decision log.
 *
 * Ported from the baseline (`lib/learn.py` at the pinned commit `9cab15d2`):
 * `find_event_files`, `read_events` and the `_src`-keyed attribution inside
 * `summarize`. A half-written trailing line (a stream still in flight), a
 * blank line, a line that is not JSON and a JSON value that is not an object
 * are skipped, never an error. An event without a run id is attributed to the
 * run id last seen in the same file; an event seen before any run id in a file
 * is dropped (F106-FR-004).
 *
 * Purity: `node:fs` for reading, never for writing.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

/** The file name of an event stream of a run, inside its run directory. */
export const EVENTS_FILE_NAME = "events.jsonl";

/**
 * The event files of the given paths, in order, deduplicated (the baseline's
 * `find_event_files`). A path is an events file itself, a run directory that
 * holds one, or a directory of run directories read in name order.
 */
export function findEventFiles(paths: readonly string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    if (statSync(p).isFile()) {
      out.push(p);
      continue;
    }
    const direct = `${p}/${EVENTS_FILE_NAME}`;
    if (existsSync(direct) && statSync(direct).isFile()) {
      out.push(direct);
      continue;
    }
    for (const name of readdirSorted(p)) {
      const candidate = `${p}/${name}/${EVENTS_FILE_NAME}`;
      if (existsSync(candidate) && statSync(candidate).isFile()) out.push(candidate);
    }
  }
  const seen = new Set<string>();
  return out.filter((f) => (seen.has(f) ? false : (seen.add(f), true)));
}

function readdirSorted(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

/** One event read from a stream file, with the file it was read from. */
export type ReadEvent = Record<string, unknown> & {
  readonly event: string;
  readonly _src: string;
};

/**
 * The lenient reader of one events file (the baseline's `read_events`): one
 * JSON object per line, each carrying an event name; everything else on the
 * way — a blank line, a torn line, a non-object — is skipped. An event
 * without an event name is skipped too (F106-FR-007: event files are read as
 * leniently as the decision log). Undecodable bytes are read as replacement
 * characters, never a failure.
 */
export function readEventsFile(path: string): ReadEvent[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const events: ReadEvent[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof parsed === "object" && parsed !== null && "event" in parsed) {
      const rec = parsed as Record<string, unknown>;
      events.push({ ...rec, event: String(rec["event"]), _src: path } as ReadEvent);
    }
  }
  return events;
}

/** Every event of every file `findEventFiles` orders, in that order. */
export function readEvents(paths: readonly string[]): ReadEvent[] {
  const out: ReadEvent[] = [];
  for (const file of findEventFiles(paths)) out.push(...readEventsFile(file));
  return out;
}

/** The field the as-is event stream carries the run id in. */
export const RUN_ID_FIELD = "run_id" as const;

/**
 * The attribution of the run ids (F106-FR-004): an event that has no run id
 * takes the run id last seen in the same file; an event seen before any run id
 * in its file is dropped. Returns the events that survive, in order, each with
 * its (attributed) run id under `run_id`.
 */
export function attributeRunIds(events: readonly ReadEvent[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const lastBySrc = new Map<string, string>();
  for (const ev of events) {
    const raw = ev[RUN_ID_FIELD];
    const rid = raw === undefined || raw === null || raw === "" ? undefined : String(raw);
    if (rid === undefined) {
      const last = lastBySrc.get(ev._src);
      if (last === undefined) continue; // before any run id in its file: dropped
      out.push({ ...ev, [RUN_ID_FIELD]: last });
      continue;
    }
    lastBySrc.set(ev._src, rid);
    out.push({ ...ev });
  }
  return out;
}

/**
 * The lenient reader of the decision log (F106-FR-007): one JSON object per
 * line; blank lines, lines that are not JSON and values that are not objects
 * are skipped, so a half-written last line never stops a read. Entries of the
 * schema `specstride.learn.applied/1` are read like any other and never match
 * a shape (they carry none — see `entryShape` of `decision-log.ts`).
 */
export function readDecisionEntries(path: string): Record<string, unknown>[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      out.push(parsed as Record<string, unknown>);
    }
  }
  return out;
}
