/**
 * T035 — the retention sweep of the invocation artifacts (F126-FR-037;
 * origins C-166 B-2200, B-2201, B-2202; F126-SC-007) and the retained stream
 * (F126-FR-038).
 *
 * The sweep visits every directory under the invocations of the run that
 * holds a record (`metadata.json`). An invocation without a `result.json` is
 * active and is skipped with `{"skipped": "active"}`. The raw files (the
 * stream, the prompt, the response and any transcript the harness adapter
 * copied into the control plane) are removed first, the record second, and
 * the result is never removed. The age in whole days comes from `finalized_at`
 * of the result, else from `createdAt` of the record; a missing or unreadable
 * stamp means age 0. The days come from `observability` retention `rawDays`
 * (default 7) and `observability` retention `metadataDays` (default 30), the
 * same under `parity`. Each sweep is recorded with the number of files
 * removed.
 *
 * A retained stream contains no secret: it is written from redacted text
 * where content capture is on, and the raw stream file is 0600 within the
 * control plane (F126-FR-038).
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  fchmodSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { RetentionSweepOutcome } from "@specstride/contracts/engine/finalization";
import type { RedactorPort } from "../stream/tap.ts";

/** The raw files of one invocation, in the order they are removed. */
export const RAW_FILES: readonly string[] = Object.freeze([
  "provider.jsonl", // the stream (`pass:<passId>:stream`)
  "prompt.txt", // the prompt (`pass:<passId>:prompt`)
  "response.txt", // the response (`pass:<passId>:response`)
  "transcript.jsonl", // any transcript the harness adapter copied
] as const);

/** The record files of one invocation, removed after the raw files. */
export const RECORD_FILES: readonly string[] = Object.freeze([
  "metadata.json", // the invocation record
  "producer.json", // the producer status
  "provider-terminal.json", // the provider terminal
] as const);

/** The result record: written once, never removed by a sweep. */
export const RESULT_FILE = "result.json" as const;

/** The file that marks the directory of one invocation as visited. */
export const RECORD_MARKER = "metadata.json" as const;

/** The retention days of the `observability` retention keys (F126-FR-037). */
export type RetentionDays = {
  readonly rawDays: number;
  readonly metadataDays: number;
};

/** The defaults: 7 and 30, the same under `parity`. */
export const DEFAULT_RETENTION_DAYS: RetentionDays = {
  rawDays: 7,
  metadataDays: 30,
};

/** What one visited invocation got. */
export type RetentionVisit =
  | { readonly dir: string; readonly skipped: "active" }
  | {
      readonly dir: string;
      readonly ageDays: number;
      /** The files removed, in the order they were removed. */
      readonly removed: readonly string[];
    };

/** What one sweep did, recorded with the number of files removed. */
export type RetentionSweep = RetentionSweepOutcome & {
  /** How many files were removed in total. */
  readonly filesRemoved: number;
  /** Every visited invocation, in the order of the walk. */
  readonly visits: readonly RetentionVisit[];
  /** The ISO stamp of the sweep, as its record carries. */
  readonly sweptAt: string;
};

/** The options of a sweep; the file operations are injectable for the tests. */
export type SweepOptions = {
  readonly days?: Partial<RetentionDays> | undefined;
  /** The clock, in milliseconds; defaults to the wall clock. */
  readonly now?: (() => number) | undefined;
  /** Remove one file; defaults to an unlink of the real file system. */
  readonly removeFile?: ((path: string) => void) | undefined;
  /** Read one file as text; defaults to the real file system. */
  readonly readFile?: ((path: string) => string) | undefined;
};

/** The age of one invocation in whole days (B-2200). */
export function ageInWholeDays(
  dir: string,
  nowMs: number,
  io: { readFile: (path: string) => string },
): number {
  const stamps = [join(dir, RESULT_FILE), join(dir, RECORD_MARKER)];
  for (const path of stamps) {
    if (!existsSync(path)) continue;
    try {
      const record = JSON.parse(io.readFile(path)) as {
        finalized_at?: unknown;
        created_at?: unknown;
        createdAt?: unknown;
      };
      const stamp =
        typeof record.finalized_at === "string"
          ? record.finalized_at
          : typeof record.created_at === "string"
            ? record.created_at
            : typeof record.createdAt === "string"
              ? record.createdAt
              : null;
      if (stamp === null) continue;
      const ms = Date.parse(stamp);
      // A missing or unparsable stamp means age 0 (B-2200): a stamp that is
      // there but cannot be read is age 0, never a fall-through.
      if (!Number.isFinite(ms)) return 0;
      return Math.floor((nowMs - ms) / 86400000);
    } catch {
      continue; // an unreadable stamp means age 0
    }
  }
  return 0;
}

/**
 * One sweep of one run (F126-FR-037). The root is the control-plane root;
 * the walk is `<root>/debug/invocations/<runId>/**`, every directory that
 * holds a `metadata.json`.
 */
export function sweepRetentionUnder(
  root: string,
  runId: string,
  options: SweepOptions = {},
): RetentionSweep {
  const days: RetentionDays = { ...DEFAULT_RETENTION_DAYS, ...(options.days ?? {}) };
  const nowMs = (options.now ?? Date.now)();
  const io = {
    readFile: options.readFile ?? ((path: string) => readFileSync(path, "utf8")),
  };
  const remove = options.removeFile ?? ((path: string) => rmSync(path));
  const base = join(resolve(root), "debug", "invocations", runId);
  const visits: RetentionVisit[] = [];
  let filesRemoved = 0;
  let kept = 0;
  for (const dir of invocationDirs(base)) {
    if (!existsSync(join(dir, RECORD_MARKER))) continue;
    if (!existsSync(join(dir, RESULT_FILE))) {
      // An invocation without a result is active (B-2201).
      visits.push({ dir, skipped: "active" });
      kept++;
      continue;
    }
    const ageDays = ageInWholeDays(dir, nowMs, io);
    const removed: string[] = [];
    if (ageDays >= days.rawDays) {
      // The raw files first (B-2202).
      for (const name of RAW_FILES) {
        const path = join(dir, name);
        if (existsSync(path)) {
          remove(path);
          removed.push(name);
        }
      }
    }
    if (ageDays >= days.metadataDays) {
      // The record second; the result is never removed.
      for (const name of RECORD_FILES) {
        const path = join(dir, name);
        if (existsSync(path)) {
          remove(path);
          removed.push(name);
        }
      }
    }
    filesRemoved += removed.length;
    if (removed.length === 0) {
      kept++;
      visits.push({ dir, ageDays, removed });
      continue;
    }
    visits.push({ dir, ageDays, removed });
  }
  return {
    swept: visits.length,
    kept,
    filesRemoved,
    visits,
    sweptAt: new Date(nowMs).toISOString(),
  };
}

/** Every directory under `base`, depth first, stable by name. */
function invocationDirs(base: string): readonly string[] {
  const out: string[] = [];
  if (!existsSync(base)) return out;
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries.sort()) {
      const path = join(dir, entry);
      let isDir = false;
      try {
        isDir = statSync(path).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;
      if (existsSync(join(path, RECORD_MARKER))) {
        out.push(path);
        continue;
      }
      walk(path);
    }
  };
  walk(base);
  return out;
}

/**
 * The plain function of the engine interface (F100-FR-237): the sweep of one
 * run against a control-plane root.
 */
export function sweepRetentionFor(
  root: string,
  options: SweepOptions = {},
): (runId: string) => RetentionSweepOutcome {
  return (runId: string): RetentionSweepOutcome => {
    const sweep = sweepRetentionUnder(root, runId, options);
    return { swept: sweep.swept, kept: sweep.kept };
  };
}

/**
 * Write the raw stream of a pass as a retained stream (F126-FR-038): the
 * lines are written from redacted text where content capture is on — each
 * line goes through the redactor handed in — and the file is created with the
 * mode 0600 within the control plane. The return names the redacted state and
 * the byte size, as the stream reference of the invocation record carries.
 */
export function writeRetainedStream(
  destination: string,
  lines: readonly string[],
  options: {
    readonly redactor?: RedactorPort | null | undefined;
    /** Content capture off keeps the reference and writes nothing. */
    readonly contentCapture?: boolean | undefined;
    readonly sizeCap?: number | undefined;
  } = {},
): { readonly path: string; readonly bytes: number; readonly redacted: boolean } {
  const cap = options.sizeCap ?? 1048576;
  const redactor = options.redactor ?? null;
  const captureOn = options.contentCapture !== false;
  let body = "";
  let redacted = false;
  if (captureOn) {
    for (const line of lines) {
      const text = line.length > cap ? line.slice(0, cap) : line;
      if (redactor === null) {
        body += text + "\n";
        continue;
      }
      const ingress = redactor.redact(text, cap);
      redacted =
        redacted || ingress.replacements > 0 || ingress.dropped === true || ingress.text !== text;
      body += ingress.text + "\n";
    }
  }
  const dir = dirname(destination);
  mkdirSync(resolve(dir), { recursive: true });
  const fd = openSync(destination, "wx", 0o600);
  try {
    fchmodSync(fd, 0o600); // the raw stream file is 0600 (F126-FR-038)
    writeFileSync(fd, body, "utf8");
  } finally {
    closeSync(fd);
  }
  return { path: destination, bytes: Buffer.byteLength(body, "utf8"), redacted };
}

/** Read the mode of a file, for the proof that a retained stream is 0600. */
export function fileMode(path: string): number {
  return statSync(path).mode & 0o777;
}
