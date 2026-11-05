/**
 * T053 — the process registry: open, close, one file per writer, read of the
 * open entries (F122-FR-023, F122-FR-024; annex B §B.10, F100-FR-063).
 *
 * *The process registry MUST hold one entry for every child process that the
 * runtime tree starts, with the fields of feature 100 annex B §B.10, written
 * by the process that started the child, one file per writer. The entry MUST
 * be written before the child can do any work and MUST be closed with
 * `endedAt` and `endCause` when the child ends.*
 *
 * Three sentences, three design decisions, and none of them is a comment:
 *
 *   - **one file per writer** is the layout table's own `<writer>.jsonl`
 *     (`run:<runId>:procs`). A writer appends and never rewrites, so two
 *     writers cannot lose each other's lines, and a line shorter than the
 *     atomic write size of a pipe lands whole under `O_APPEND`. The path is
 *     RESOLVED from the table and never spelled out here.
 *   - **before the child can do any work** cannot be kept by writing the entry
 *     "first" and hoping, because the entry needs the process id, which only
 *     exists once the child has been started. So the child is started behind a
 *     GATE: it blocks on `awaitTheGate()` until the file named by
 *     `GATE_VARIABLE` appears, and only the writer of its entry opens that
 *     gate. `startChildUnderTheRegistry` is the whole ordering in one call,
 *     and `openedBeforeTheChildWorked` is how a test reads it back from the
 *     child's own eyes rather than from this module's word.
 *   - **closed with `endedAt` and `endCause`** is a second line appended for
 *     the same `procId`. The reader folds the lines of a `procId` in order and
 *     the last one wins, so a close never has to find and rewrite a line, and
 *     a crash between the two leaves an OPEN entry — which is exactly what the
 *     search for survivors is for.
 *
 * The record itself belongs to feature 100: every entry goes out through
 * `readProcessRegistry` of `@specstride/contracts`, so an entry this module
 * writes that the owning feature would refuse never reaches the disk.
 */
import { appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  SCHEMA_ID as PROCS_SCHEMA_ID,
  LOGICAL_NAME as PROCS_LOGICAL_NAME,
  classIsAllowed,
  classOfKind,
  readProcessRegistry,
  tryReadProcessRegistry,
  type ProcessClass,
  type ProcessKind,
  type ProcessRegistry,
} from "@specstride/contracts/records/process-registry";
import { resolve, rootPathsOf } from "@specstride/contracts/ids/logical-names";
import { processGroupOf, processPrimitive, sessionOf, systemClock } from "@specstride/kernel";
import type {
  Clock,
  ProcessPrimitive,
  StartProcessInput,
} from "@specstride/contracts/ep/kernel-services";

/** The requirements this module carries. */
export const REGISTRY_REQUIREMENTS = ["F122-FR-023", "F122-FR-024"] as const;

/** The record and the logical name the registry writes (annex B, §B.10). */
export { PROCS_SCHEMA_ID, PROCS_LOGICAL_NAME };

/** The suffix of a writer's file, from the layout table. */
export const WRITER_FILE_SUFFIX = ".jsonl" as const;

/** The directory of the registry of a run, under the control root. */
export const PROCS_DIRECTORY_NAME = "procs" as const;

/** Owner-only, as every file of the control plane. */
export const FILE_MODE = 0o600 as const;
export const DIRECTORY_MODE = 0o700 as const;

/**
 * F122-FR-023 — one file per writer. The two writers of this feature are the
 * runtime root and the engine (the layout table's `writer` cell); a worker
 * pass is recorded by the engine that started it and writes no file of its
 * own, because *the entry is written by the process that started the child*.
 */
export const WRITERS = ["runtime-root", "engine"] as const;
export type Writer = (typeof WRITERS)[number];

/** Where a registry lives: one run of one feature under one control root. */
export type ProcsPlace = {
  readonly controlRoot: string;
  readonly featureSlug: string;
  readonly runId: string;
};

/**
 * The file one writer appends to, resolved from `run:<runId>:procs` of the
 * layout table (annex B, §B.5) and never written out as a literal.
 */
export function registryFileOf(place: ProcsPlace, writer: string): string {
  const roots = rootPathsOf({
    home: "",
    workspaceRealPath: "",
    workspaceId: "",
    controlRoot: place.controlRoot,
    workerRoot: "",
  });
  return resolve(
    PROCS_LOGICAL_NAME,
    { "<slug>": place.featureSlug, "<runId>": place.runId, "<writer>": writer },
    roots,
  );
}

/** The directory the writers' files live in. */
export function registryDirectoryOf(place: ProcsPlace): string {
  return dirname(registryFileOf(place, WRITERS[0]));
}

/** Every writer's file that exists for a run. */
export function registryFilesOf(place: ProcsPlace): readonly string[] {
  const directory = registryDirectoryOf(place);
  let names: readonly string[];
  try {
    names = readdirSync(directory);
  } catch {
    return Object.freeze([]);
  }
  return Object.freeze(
    [...names]
      .filter((name) => name.endsWith(WRITER_FILE_SUFFIX))
      .sort()
      .map((name) => join(directory, name)),
  );
}

/* ------------------------------------------------------------------ *
 * Open an entry.
 * ------------------------------------------------------------------ */

/** What a writer knows about the child it has just started. */
export type OpenEntryInput = {
  readonly procId: string;
  readonly kind: ProcessKind;
  /** Omitted: derived from the kind by `classOfKind` of feature 100. */
  readonly class?: ProcessClass;
  readonly pid: number;
  readonly processGroup: number;
  readonly processSession: number;
  /** The start time the platform reports, in milliseconds since the epoch. */
  readonly startTimeMs: number;
  /** F122-FR-024 — only the HASH of the run token ever reaches a record. */
  readonly runTokenHash: string;
  readonly engineStartId: string;
  readonly attemptId?: string;
  readonly passId?: string;
  readonly jobId?: string;
  /** F122-FR-023 — the worker id of a worker pass of parallel units. */
  readonly workerId?: string;
  readonly startedAt?: string;
};

/** A hexadecimal hash, which is all of a run token a record may hold. */
const HASH_SHAPE = /^[0-9a-f]{32,128}$/;

/**
 * F122-FR-024 — the field `runTokenHash` holds a HASH and never a token. The
 * check is here and not only in a review: a caller that passed the secret by
 * mistake would otherwise write it to disk, which the requirement forbids
 * outright. A 32-byte token is 64 hexadecimal characters and so is its
 * SHA-256, so length alone cannot tell them apart — which is why
 * `assertIsAHash` is paired with `MintedToken`, whose `toString` already
 * yields the hash.
 */
export function assertIsAHash(value: string, field = "runTokenHash"): void {
  if (typeof value !== "string" || !HASH_SHAPE.test(value)) {
    throw new Error(
      `the field \`${field}\` of a process registry entry takes a hexadecimal hash and not a ` +
        `token (F122-FR-024: a token appears in a record only as its hash)`,
    );
  }
}

/**
 * F122-FR-023 — write the entry of a child. The entry is validated against
 * `specstride.procs/1` before the line is appended, so an entry the owning
 * feature would refuse never reaches the disk.
 */
export function openEntry(
  place: ProcsPlace,
  writer: string,
  input: OpenEntryInput,
  clock: Clock = systemClock,
): ProcessRegistry {
  assertIsAHash(input.runTokenHash);
  const cls = input.class ?? classOfKind(input.kind);
  if (!classIsAllowed(input.kind, cls)) {
    throw new Error(
      `a process of kind \`${input.kind}\` is never of class \`${cls}\` (F100-FR-063)`,
    );
  }
  const entry: ProcessRegistry = {
    schema: PROCS_SCHEMA_ID,
    procId: input.procId,
    class: cls,
    kind: input.kind,
    pid: input.pid,
    processGroup: input.processGroup,
    processSession: input.processSession,
    // The start time is text in §B.10; it carries the milliseconds the
    // platform reported, which is what the identity check compares.
    startTime: String(input.startTimeMs),
    runTokenHash: input.runTokenHash,
    runId: place.runId,
    engineStartId: input.engineStartId,
    ...(input.attemptId === undefined ? {} : { attemptId: input.attemptId }),
    ...(input.passId === undefined ? {} : { passId: input.passId }),
    ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
    ...(input.workerId === undefined ? {} : { workerId: input.workerId }),
    startedAt: input.startedAt ?? clock.nowIso(),
  };
  appendLine(place, writer, readProcessRegistry(entry));
  return Object.freeze(entry);
}

/* ------------------------------------------------------------------ *
 * Close an entry.
 * ------------------------------------------------------------------ */

/**
 * The end causes this feature writes. `identity-mismatch` is F122-FR-025's,
 * `gone` is F122-FR-028's; the rest are the ordinary ends of a child.
 */
export const END_CAUSES = [
  "exited",
  "signalled",
  "ended-by-the-root",
  "identity-mismatch",
  "gone",
  "adopted",
] as const;
export type RegistryEndCause = (typeof END_CAUSES)[number];

/** F122-FR-023 — close an entry with `endedAt` and `endCause`. */
export function closeEntry(
  place: ProcsPlace,
  writer: string,
  entry: ProcessRegistry,
  endCause: RegistryEndCause | string,
  clock: Clock = systemClock,
  endedAt?: string,
): ProcessRegistry {
  const closed: ProcessRegistry = {
    ...entry,
    endedAt: endedAt ?? clock.nowIso(),
    endCause: String(endCause),
  };
  appendLine(place, writer, readProcessRegistry(closed));
  return Object.freeze(closed);
}

/** Close by `procId`, reading the open entry first. `null` where none is open. */
export function closeEntryById(
  place: ProcsPlace,
  writer: string,
  procId: string,
  endCause: RegistryEndCause | string,
  clock: Clock = systemClock,
): ProcessRegistry | null {
  const open = readOpenEntries(place).find((one) => one.procId === procId);
  if (open === undefined) return null;
  return closeEntry(place, writer, open, endCause, clock);
}

/* ------------------------------------------------------------------ *
 * Read.
 * ------------------------------------------------------------------ */

/**
 * Every entry of the run, folded by `procId`: the lines of one `procId` are
 * read in order and the last one wins, so a close replaces its open.
 *
 * A line that is not a valid entry is SKIPPED and never throws: the registry
 * is read while it is being written, and a reader that died on a half line
 * would take the search for survivors down with it.
 */
export function readEntries(place: ProcsPlace): readonly ProcessRegistry[] {
  const byId = new Map<string, ProcessRegistry>();
  const order: string[] = [];
  for (const file of registryFilesOf(place)) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      const read = tryReadProcessRegistry(value);
      if (!read.ok) continue;
      const entry = read.record;
      if (!byId.has(entry.procId)) order.push(entry.procId);
      byId.set(entry.procId, entry);
    }
  }
  return Object.freeze(order.map((id) => byId.get(id) as ProcessRegistry));
}

/** True where an entry was closed (annex B, §B.10: `endedAt` is set). */
export function entryIsOpen(entry: ProcessRegistry): boolean {
  return entry.endedAt === undefined || entry.endedAt === null || entry.endedAt === "";
}

/** F122-FR-023 — the open entries of the run. */
export function readOpenEntries(place: ProcsPlace): readonly ProcessRegistry[] {
  return Object.freeze(readEntries(place).filter(entryIsOpen));
}

/** The open entries of one class. */
export function readOpenEntriesOfClass(
  place: ProcsPlace,
  cls: ProcessClass,
): readonly ProcessRegistry[] {
  return Object.freeze(readOpenEntries(place).filter((one) => one.class === cls));
}

/** The open entries of class `owned` of one engine start (F122-FR-026). */
export function readOpenOwnedEntriesOfEngineStart(
  place: ProcsPlace,
  engineStartId: string,
): readonly ProcessRegistry[] {
  return Object.freeze(
    readOpenEntriesOfClass(place, "owned").filter((one) => one.engineStartId === engineStartId),
  );
}

/** The start time an entry recorded, in milliseconds, or `null`. */
export function startTimeMsOf(entry: ProcessRegistry): number | null {
  const value = Number(entry.startTime);
  return Number.isFinite(value) ? value : null;
}

/* ------------------------------------------------------------------ *
 * The gate: the entry is written before the child can do any work.
 * ------------------------------------------------------------------ */

/**
 * F122-FR-023 — the variable a child is told the gate file under. The child
 * does nothing until the file is there, and only the writer of its registry
 * entry makes it.
 */
export const GATE_VARIABLE = "SPECSTRIDE_PROC_GATE" as const;

/** How long a child waits for its gate before it gives up and ends. */
export const GATE_TIMEOUT_MS = 30_000 as const;

/** What the gate file holds: the `procId` of the entry that was written. */
export type GateContent = { readonly procId: string };

/**
 * Called by a CHILD, before it does any work. It blocks until the gate file
 * its starter named appears, and answers with the `procId` of the entry that
 * was written for it. A child started with no gate named is not under the
 * registry and gets `null` at once.
 */
export async function awaitTheGate(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  timeoutMs: number = GATE_TIMEOUT_MS,
): Promise<string | null> {
  const path = environment[GATE_VARIABLE];
  if (typeof path !== "string" || path === "") return null;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const text = readFileSync(path, "utf8");
      const parsed = JSON.parse(text) as Partial<GateContent>;
      if (typeof parsed.procId === "string" && parsed.procId !== "") return parsed.procId;
    } catch {
      /* not there yet, or half written: look again */
    }
    if (Date.now() > deadline) {
      throw new Error(
        `the process registry gate \`${path}\` did not open inside ${timeoutMs} ms, so this ` +
          `child has no entry and must do no work (F122-FR-023)`,
      );
    }
    await new Promise((done) => setTimeout(done, 5));
  }
}

/** Open the gate of a child: the LAST thing the writer does. */
export function openTheGate(gateFile: string, procId: string): void {
  mkdirSync(dirname(gateFile), { recursive: true, mode: DIRECTORY_MODE });
  const temporary = `${gateFile}.${process.pid}.tmp`;
  // A temporary name and a rename, so a child never reads a half-written gate.
  rmSync(temporary, { force: true });
  appendFileSync(temporary, `${JSON.stringify({ procId } satisfies GateContent)}\n`, {
    encoding: "utf8",
    mode: FILE_MODE,
  });
  renameSync(temporary, gateFile);
}

/* ------------------------------------------------------------------ *
 * The one call that keeps the ordering.
 * ------------------------------------------------------------------ */

/** What `startChildUnderTheRegistry` reports. */
export type StartedUnderTheRegistry = {
  readonly entry: ProcessRegistry;
  readonly pid: number;
  readonly pgid: number;
  readonly sid: number;
  readonly gateFile: string;
};

/** What a writer gives to start a child under the registry. */
export type StartUnderTheRegistryInput = {
  readonly place: ProcsPlace;
  readonly writer: string;
  /** Everything of the entry but the three identities the platform gives. */
  readonly entry: Omit<OpenEntryInput, "pid" | "processGroup" | "processSession" | "startTimeMs">;
  /** The command, its working directory and its environment (T075). */
  readonly start: Omit<StartProcessInput, "env"> & {
    readonly env: Readonly<Record<string, string>>;
  };
  /** Where the gate file goes; beside the registry of the run by default. */
  readonly gateFile?: string;
  readonly primitive?: ProcessPrimitive;
  readonly clock?: Clock;
};

/**
 * F122-FR-023 — start a child and have its entry on disk BEFORE the child can
 * do any work.
 *
 * The order is the whole point and it is kept here once, so that no caller has
 * to keep it again:
 *
 *   1. the gate file is named and is NOT there;
 *   2. the child is started through the process primitive of the kernel, in a
 *      group and a session of its own, with the gate named in its
 *      environment. It blocks on `awaitTheGate` and does nothing;
 *   3. the platform is asked for the group, the session and the start time of
 *      the child — observed, never assumed;
 *   4. the entry is appended to the writer's file;
 *   5. and only then is the gate opened.
 *
 * A failure anywhere before step 5 leaves a child that will give up and end,
 * and no entry — which is the safe way round: an entry with no process is a
 * process the runtime would hunt for, and a process with no entry that never
 * ran did nothing.
 */
export async function startChildUnderTheRegistry(
  input: StartUnderTheRegistryInput,
): Promise<StartedUnderTheRegistry> {
  const primitive = input.primitive ?? processPrimitive;
  const clock = input.clock ?? systemClock;
  const gateFile =
    input.gateFile ??
    join(registryDirectoryOf(input.place), "gates", `${input.entry.procId}.gate.json`);
  mkdirSync(dirname(gateFile), { recursive: true, mode: DIRECTORY_MODE });
  rmSync(gateFile, { force: true });

  const started = await primitive.start({
    ...input.start,
    env: { ...input.start.env, [GATE_VARIABLE]: gateFile },
  });

  const pgid = processGroupOf(started.pid) ?? started.pgid;
  const sid = sessionOf(started.pid) ?? started.pid;
  const startTimeMs = primitive.startTimeOf(started.pid) ?? started.startedAtMs;

  const entry = openEntry(
    input.place,
    input.writer,
    {
      ...input.entry,
      pid: started.pid,
      processGroup: pgid,
      processSession: sid,
      startTimeMs,
    },
    clock,
  );

  openTheGate(gateFile, entry.procId);
  return Object.freeze({ entry, pid: started.pid, pgid, sid, gateFile });
}

/** The one line of a writer's file, appended whole. */
function appendLine(place: ProcsPlace, writer: string, entry: ProcessRegistry): void {
  const file = registryFileOf(place, writer);
  mkdirSync(dirname(file), { recursive: true, mode: DIRECTORY_MODE });
  appendFileSync(file, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: FILE_MODE });
}
