/**
 * T008 — the stub process: a process that holds a given environment and sleeps.
 *
 * Every test of this feature that needs a live child uses this and never a
 * model, a harness or a real engine (quickstart, "Prerequisites": every
 * scenario uses stub processes). The stub is what the lock probe probes, what
 * the identity check checks, what `findByRunToken` searches for and what the
 * crash tests kill.
 *
 * The file has two roles.
 *
 *   1. **The child itself.** Run directly — `node stub-process.ts --ready <file>`
 *      — it records the environment it holds into the ready file with an atomic
 *      write (temporary file, then rename, so a reader never sees half a
 *      record) and then sleeps. It writes nothing on standard output, reads
 *      nothing on standard input, and ends only when it is killed or when its
 *      time to live runs out. The time to live is a cap with a default
 *      (`DEFAULT_TTL_MS`) so that a test which fails before its `kill` cannot
 *      leave a process behind for ever.
 *   2. **The helper the test calls.** `spawnStubProcess` starts the child with
 *      the environment the caller gives, waits until the ready record is on
 *      disk, and returns the record together with the child handle. The
 *      environment is then observable twice over: in the record the child
 *      wrote, and in the process environment of a live process of this user —
 *      which is what the platform readers of T010 are meant to read.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

/** This file; the path the helper hands to `node` as the child's entry. */
export const STUB_PROCESS_ENTRY = fileURLToPath(import.meta.url);

/** The cap on the life of a stub, so a failed test leaves nothing behind. */
export const DEFAULT_TTL_MS = 30_000;

/**
 * The name under which the child is told which variables to record. The helper
 * sets it from the keys of the environment the caller gave; the child adds
 * every `SPECSTRIDE_` and `STUB_` name of its own environment to it.
 */
export const RECORD_NAMES_VAR = "STUB_PROCESS_RECORD";

/** What the child writes, and what `spawnStubProcess` resolves with. */
export type StubReadyRecord = {
  /** The schema tag, so a reader can tell a complete record from anything else. */
  readonly kind: "specstride.test.stub-process/1";
  /** The process id of the stub. */
  readonly pid: number;
  /** The process id of whatever started it. */
  readonly ppid: number;
  /** The process group of the stub; `null` where the platform has none. */
  readonly pgid: number | null;
  /** The environment the stub holds, for the names it was told to record. */
  readonly env: Readonly<Record<string, string>>;
  /** Milliseconds since the epoch at which the stub became ready. */
  readonly startedAtMs: number;
  /** The cap on its life, in milliseconds. */
  readonly ttlMs: number;
};

/** How a stub ended: a signal, or an exit code. */
export type StubEnd = {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
};

/** A started stub and the ways a test reaches it. */
export type StubProcess = {
  /** The process id of the stub. */
  readonly pid: number;
  /** The child handle, for a test that wants to watch it end. */
  readonly child: ChildProcess;
  /** The record the stub wrote when it became ready. */
  readonly ready: StubReadyRecord;
  /** The path of that record. */
  readonly readyPath: string;
  /**
   * How it ended. The listener is attached when the stub is started, not when a
   * test asks, so a test cannot miss the end by looking too late.
   */
  readonly exited: Promise<StubEnd>;
  /** End it without warning and wait until it is gone. Safe to call twice. */
  readonly kill: () => Promise<void>;
};

function argOf(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

/** The names the child records: those it was told, plus the two prefixes. */
function namesToRecord(env: NodeJS.ProcessEnv): readonly string[] {
  const told = (env[RECORD_NAMES_VAR] ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const byPrefix = Object.keys(env).filter(
    (name) => name.startsWith("SPECSTRIDE_") || name.startsWith("STUB_"),
  );
  return [...new Set([...told, ...byPrefix])].sort();
}

/**
 * The process group of this process. Node has no `getpgid`, so it is read from
 * the platform: field 5 of `/proc/self/stat` on Linux (after the last `)`,
 * because the command name may itself hold a space or a bracket), and `ps`
 * elsewhere. `null` where neither answers — a stub records what it can see and
 * never fails for want of a group.
 */
export function currentProcessGroup(): number | null {
  try {
    const stat = readFileSync("/proc/self/stat", "utf8");
    const after = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const pgrp = Number(after[2]);
    if (Number.isInteger(pgrp) && pgrp > 0) return pgrp;
  } catch {
    // Not Linux, or no process file system: ask `ps`.
  }
  try {
    const out = execFileSync("ps", ["-o", "pgid=", "-p", String(process.pid)], {
      encoding: "utf8",
    });
    const pgrp = Number(out.trim());
    return Number.isInteger(pgrp) && pgrp > 0 ? pgrp : null;
  } catch {
    return null;
  }
}

/** Write a record where a reader never sees it half written (research D-5). */
function writeAtomically(path: string, text: string): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, text, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

/** Role 1 — the child: record the environment held, then sleep. */
function runAsChild(argv: readonly string[]): void {
  const readyPath = argOf(argv, "--ready");
  if (readyPath === undefined) {
    process.stderr.write("stub-process: --ready <file> is required\n");
    process.exit(2);
  }
  const ttlMs = Number(argOf(argv, "--ttl-ms") ?? DEFAULT_TTL_MS);

  const env: Record<string, string> = {};
  for (const name of namesToRecord(process.env)) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }

  const pgid = currentProcessGroup();

  const record: StubReadyRecord = {
    kind: "specstride.test.stub-process/1",
    pid: process.pid,
    ppid: process.ppid,
    pgid,
    env,
    startedAtMs: Date.now(),
    ttlMs,
  };
  writeAtomically(readyPath, `${JSON.stringify(record, null, 2)}\n`);

  // And now it sleeps. One referenced timer holds the event loop open: nothing
  // is read, nothing is written, and the process ends only when a signal ends
  // it or when the cap runs out. An unreferenced timer would let node exit at
  // once, which is the opposite of what a stub is for.
  setTimeout(() => process.exit(0), ttlMs);
}

/** How the caller wants the stub started. */
export type SpawnStubOptions = {
  /** The environment the stub is to hold, over and above what it inherits. */
  readonly env?: Readonly<Record<string, string>>;
  /** The cap on its life; `DEFAULT_TTL_MS` by default. */
  readonly ttlMs?: number;
  /** Where to put the ready record; a scratch directory by default. */
  readonly readyPath?: string;
  /** Start it in a session and group of its own (for the crash tests). */
  readonly detached?: boolean;
  /** How long to wait for the ready record before giving up. */
  readonly readyTimeoutMs?: number;
  /**
   * Where to send the standard error of the stub. Nowhere by default: a pipe
   * held by the test process would keep the test runner waiting for a stub that
   * a failing test forgot to kill.
   */
  readonly stderrPath?: string;
};

/** Role 2 — the helper: start a stub and wait until it holds its environment. */
export async function spawnStubProcess(options: SpawnStubOptions = {}): Promise<StubProcess> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const given = options.env ?? {};
  const readyPath =
    options.readyPath ?? join(mkdtempSync(join(tmpdir(), "specstride-stub-")), "ready.json");

  const stderr =
    options.stderrPath === undefined ? "ignore" : openSync(options.stderrPath, "a", 0o600);

  const child = spawn(
    process.execPath,
    [STUB_PROCESS_ENTRY, "--ready", readyPath, "--ttl-ms", String(ttlMs)],
    {
      env: { ...process.env, ...given, [RECORD_NAMES_VAR]: Object.keys(given).join(",") },
      cwd: dirname(STUB_PROCESS_ENTRY),
      // Standard input closed; no pipe back to the test process, so a stub a
      // failing test left behind cannot hold the test runner open.
      stdio: ["ignore", "ignore", stderr],
      detached: options.detached === true,
    },
  );

  // Watch for the end from the start, so no test can miss it.
  const exited = new Promise<StubEnd>((done) =>
    child.once("exit", (code, signal) => done({ code, signal })),
  );
  // The stub never keeps the loop of the test process alive: the test says when
  // it waits, with `kill` or with `exited`.
  child.unref();

  const pid = child.pid;
  if (pid === undefined) throw new Error("the stub was not started: it has no process id");

  const ready = await waitForReady(readyPath, child, options.readyTimeoutMs ?? 10_000);
  if (ready.pid !== pid) {
    throw new Error(`the ready record names the process ${ready.pid}, but the stub is ${pid}`);
  }

  let killed = false;
  const kill = async (): Promise<void> => {
    if (killed) return;
    killed = true;
    try {
      process.kill(ready.pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    const deadline = Date.now() + 5_000;
    for (;;) {
      try {
        process.kill(ready.pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      }
      if (Date.now() > deadline) throw new Error(`the stub ${ready.pid} would not die`);
      await new Promise((done) => setTimeout(done, 10));
    }
  };

  return { pid: ready.pid, child, ready, readyPath, exited, kill };
}

/** Read the ready record as soon as it is complete on disk. */
async function waitForReady(
  readyPath: string,
  child: ChildProcess,
  timeoutMs: number,
): Promise<StubReadyRecord> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  for (;;) {
    try {
      const record = JSON.parse(readFileSync(readyPath, "utf8")) as StubReadyRecord;
      if (record.kind === "specstride.test.stub-process/1") return record;
      lastError = `unexpected record kind ${String(record.kind)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `the stub ended before it was ready (exit ${String(child.exitCode)}, ` +
          `signal ${String(child.signalCode)}): ${lastError}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(`the stub did not become ready inside ${timeoutMs} ms: ${lastError}`);
    }
    await new Promise((done) => setTimeout(done, 10));
  }
}

/** Read the record of a stub that is already running. */
export function readStubRecord(readyPath: string): StubReadyRecord {
  return JSON.parse(readFileSync(readyPath, "utf8")) as StubReadyRecord;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === STUB_PROCESS_ENTRY) {
  runAsChild(process.argv.slice(2));
}
