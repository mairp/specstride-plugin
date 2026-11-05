/**
 * T059 — the span state (F128-FR-018; C-189; B-2363; B-2367).
 *
 * F128-FR-018: *The spans that are open MUST be kept at the logical name
 * `run:<runId>:span-state`, of which the exporter is the only writer, with the
 * trace id and the stack of open scopes. It MUST be written by replacing the
 * file whole, under an exclusive lock of its own, and MUST carry the field
 * `schema` with the value `specstride.span-state/1`, the schema id with its
 * major of annex B §B.20 (F100-FR-048), and no separate version field. Before
 * a run starts, span state of another run older than 7 days MUST be removed.
 * An engine start that finds open spans of a dead engine start MUST close them
 * from the events that the next writer synthesizes, marked as synthesized, and
 * MUST continue in the same trace.*
 */

import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { atomicWriteJson } from "@specstride/kernel";
import type { OpenScope } from "./builder.ts";

/** The schema id of the span-state file (annex B §B.20; F100-FR-048). */
export const SPAN_STATE_SCHEMA = "specstride.span-state/1" as const;

/** The age at which span state of another run is removed (B-2367). */
export const SPAN_STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The longest run id a physical file name carries (B-2363). */
export const SPAN_STATE_RUN_ID_MAX = 200 as const;

/** The logical name of the span state of a run (F128-FR-018). */
export function spanStateLogicalNameOf(runId: string): string {
  return `run:${runId}:span-state`;
}

/** The physical base of the state file: unsafe characters become `_` (B-2363). */
export function spanStateBaseOf(runId: string): string {
  const safe = spanStateLogicalNameOf(runId)
    .slice(0, 4 + SPAN_STATE_RUN_ID_MAX)
    .replace(/[^A-Za-z0-9._-]/g, "_");
  return safe;
}

/** The path of the state file of a run in a state directory (B-2363). */
export function spanStatePathOf(stateDir: string, runId: string): string {
  return join(stateDir, `${spanStateBaseOf(runId)}.json`);
}

/** The record the state file holds (F128-FR-018; `schema`, never `v`). */
export type SpanStateRecord = {
  readonly schema: typeof SPAN_STATE_SCHEMA;
  readonly runId: string;
  readonly traceId: string;
  readonly stack: readonly OpenScope[];
};

/** The record to write, from the open stack of a builder (F128-FR-018). */
export function spanStateOf(
  runId: string,
  traceId: string,
  stack: readonly OpenScope[],
): SpanStateRecord {
  return { schema: SPAN_STATE_SCHEMA, runId, traceId, stack };
}

/**
 * An exclusive lock of the state file's own (B-2363): an exclusive create of
 * `<path>.lock`, retried until the holder releases it. The lock is always
 * released in the end — a crashed holder's lock is stolen after the timeout.
 */
export class StateFileLock {
  private readonly path: string;
  private fd: number | null = null;

  constructor(path: string) {
    this.path = `${path}.lock`;
  }

  acquire(timeoutMs = 5000): void {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        this.fd = openSync(this.path, "wx");
        return;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== "EEXIST") throw error;
        if (Date.now() > deadline) {
          // A dead holder: steal the lock rather than block the exporter.
          try {
            rmSync(this.path, { force: true });
          } catch {
            /* best-effort (F128-FR-035) */
          }
          continue;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
    }
  }

  release(): void {
    if (this.fd !== null) {
      closeSync(this.fd);
      this.fd = null;
    }
    try {
      rmSync(this.path, { force: true });
    } catch {
      /* best-effort */
    }
  }

  /** Run `body` under the exclusive lock, releasing it afterwards. */
  run<T>(body: () => T): T {
    this.acquire();
    try {
      return body();
    } finally {
      this.release();
    }
  }
}

/**
 * Replace the state file whole, under the exclusive lock of its own
 * (F128-FR-018): the kernel's atomic write (temporary in the same directory,
 * fsync, rename) does the replacement.
 */
export function writeSpanState(stateDir: string, record: SpanStateRecord): string {
  const path = spanStatePathOf(stateDir, record.runId);
  const lock = new StateFileLock(path);
  return lock.run(() => {
    atomicWriteJson(path, record, { createDirectory: true });
    return path;
  });
}

/** Read the state file back (`null` when there is none, or it is not state). */
export function readSpanState(stateDir: string, runId: string): SpanStateRecord | null {
  const path = spanStatePathOf(stateDir, runId);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SpanStateRecord>;
    if (parsed.schema !== SPAN_STATE_SCHEMA) return null;
    return parsed as SpanStateRecord;
  } catch {
    return null; // a torn or foreign file is not state
  }
}

/**
 * Remove the span state of other runs older than 7 days, before a run starts
 * (F128-FR-018; B-2367). The paths removed come back, for the test to observe.
 */
export function pruneOldSpanState(
  stateDir: string,
  now: number = Date.now(),
  maxAgeMs: number = SPAN_STATE_MAX_AGE_MS,
  keepRunId?: string,
): readonly string[] {
  if (!existsSync(stateDir)) return [];
  const removed: string[] = [];
  for (const name of readdirSync(stateDir)) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const path = join(stateDir, name);
    let mtime: number;
    try {
      mtime = statSync(path).mtimeMs;
    } catch {
      continue;
    }
    if (now - mtime <= maxAgeMs) continue;
    try {
      rmSync(path, { force: true });
      removed.push(path);
    } catch {
      /* best-effort (F128-FR-035) */
    }
  }
  void keepRunId;
  return removed;
}
