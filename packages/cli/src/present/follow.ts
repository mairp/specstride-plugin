/**
 * The reader of one events file (T003): the presenter's source stream
 * (F145-FR-022). It reads one file of JSON lines, skips the lines that are
 * not valid JSON silently (F145-FR-006, F145-FR-011), and, with `--follow`,
 * waits for a missing file (0.3 s poll), tails an existing one (0.4 s poll)
 * and reopens the followed file from the top with the synthetic `_reopen`
 * event when its identity changes (a link retargeted or a file replaced,
 * F145-FR-011). The reader never writes and never signals a run
 * (F145-FR-001): it ends when the caller's signal ends it.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";

/** One event record of the as-is vocabulary: a JSON object with an `event`. */
export interface PresentEvent {
  readonly event: string;
  readonly [field: string]: unknown;
}

/** The synthetic event emitted when the followed file is reopened (F145-FR-011). */
export const REOPEN_EVENT: PresentEvent = { event: "_reopen" };

/** Options of the reader. The defaults are the spec's (F145-FR-011). */
export interface FollowOptions {
  /** Tail the file after the first full read. Default true. */
  readonly follow?: boolean;
  /** The poll of the tail loop, in milliseconds. Default 400. */
  readonly pollMs?: number;
  /** The poll for a missing file, in milliseconds. Default 300. */
  readonly waitPollMs?: number;
  /** Ends the reader when aborted. */
  readonly signal?: AbortSignal;
}

/** The parsed state of one read of the file. */
export interface ReadResult {
  readonly events: PresentEvent[];
  /** The count of lines that were not valid JSON and were skipped silently. */
  readonly skipped: number;
}

/**
 * Parses one line of the file: an event object, or null for a line that is
 * not valid JSON — skipped silently by every caller (F145-FR-006).
 */
export function parseEventsLine(line: string): PresentEvent | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const event = record.event;
    if (typeof event !== "string" || event === "") return null;
    return record as PresentEvent;
  } catch {
    return null;
  }
}

/** The identity of the followed file: its device, inode and resolved path. */
interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly realpath: string;
}

function identityOf(path: string): FileIdentity | null {
  try {
    const stats = statSync(path);
    return { dev: stats.dev, ino: stats.ino, realpath: realpathSync(path) };
  } catch {
    return null;
  }
}

function sameIdentity(a: FileIdentity, b: FileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.realpath === b.realpath;
}

/**
 * Reads the whole file once: every valid event in order, with the lines that
 * are not valid JSON skipped silently (F145-FR-006). A missing file reads as
 * an empty result and never raises (F145-FR-011, the no-follow form).
 */
export function readEventsFile(path: string): ReadResult {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { events: [], skipped: 0 };
  }
  return splitEvents(text);
}

function splitEvents(text: string): ReadResult {
  const events: PresentEvent[] = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    const parsed = parseEventsLine(line);
    if (parsed === null) {
      if (line.trim() !== "") skipped += 1;
      continue;
    }
    events.push(parsed);
  }
  return { events, skipped };
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * The reader of one events file (F145-FR-006, F145-FR-011, F145-FR-022).
 *
 * Without `follow` it yields the events of the file as it stands and ends;
 * a missing file ends it silently. With `follow` it first waits, polling
 * every `waitPollMs` (0.3 s), until the file exists; then it yields the file
 * from the top and polls every `pollMs` (0.4 s) for appended lines. When the
 * identity of the followed file changes — the events link retargeted to the
 * file of a new engine start, or the file replaced — it emits the synthetic
 * `_reopen` event and reads the new file from the top.
 *
 * The reader ends when `signal` aborts, so a run never waits for it
 * (F145-FR-001, Principle V).
 */
export async function* followEventsFile(
  path: string,
  options: FollowOptions = {},
): AsyncGenerator<PresentEvent, void, void> {
  const follow = options.follow ?? true;
  const pollMs = options.pollMs ?? 400;
  const waitPollMs = options.waitPollMs ?? 300;
  const signal = options.signal;

  if (!existsSync(path)) {
    if (!follow) return;
    while (!existsSync(path)) {
      if (signal?.aborted) return;
      await sleep(waitPollMs, signal);
    }
  }

  let identity = identityOf(path);
  let offset = 0;
  let carry = "";

  for (;;) {
    if (signal?.aborted) return;
    const current = identityOf(path);
    if (identity !== null && current !== null && !sameIdentity(identity, current)) {
      // The link was retargeted or the file replaced: reopen from the top
      // and announce the new run (F145-FR-011).
      yield REOPEN_EVENT;
      identity = current;
      offset = 0;
      carry = "";
    } else if (identity === null && current !== null) {
      identity = current;
      offset = 0;
      carry = "";
    }
    if (current !== null) {
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        text = carry;
      }
      if (text.length >= offset) {
        const chunk = text.slice(offset);
        const newline = chunk.lastIndexOf("\n");
        if (newline !== -1) {
          const complete = carry + chunk.slice(0, newline + 1);
          carry = "";
          offset += newline + 1;
          for (const line of complete.split("\n")) {
            const parsed = parseEventsLine(line);
            if (parsed !== null) yield parsed;
          }
        } else {
          carry += chunk;
          offset += chunk.length;
        }
      } else {
        // The file shrank under us (truncated in place): start over.
        offset = 0;
        carry = "";
      }
    }
    if (!follow) return;
    await sleep(pollMs, signal);
  }
}
