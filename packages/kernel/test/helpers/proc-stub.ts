/**
 * T076 — the stub child of the tests of the process primitive.
 *
 * It is deliberately dull: it reports, in a record a test reads back off disk,
 * every property F100-FR-234 claims about a started process, and then it
 * sleeps until it is signalled or its time to live runs out. Nothing here calls
 * a model, a harness or an engine.
 *
 * What it reports
 *   - its process id, its parent, its process GROUP and its SESSION, so a test
 *     can see that both are new and that both equal its own process id;
 *   - what standard input gave it: `eof` where nothing could be read, which is
 *     what "standard input closed" means to a process, and the number of bytes
 *     where something could;
 *   - where its three descriptors point, read from the process file system, so
 *     that "the two outputs land in the named files" is observed and not
 *     assumed;
 *   - the children it started, which are in its group and not in a group of
 *     their own, so that `signalGroup` can be shown to reach every member.
 *
 * It also writes a marker to standard output and to standard error, which is
 * how a test proves the two named files are the two the caller named.
 */
import { spawn } from "node:child_process";
import { readFileSync, readSync, readlinkSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROC_STUB_ENTRY = fileURLToPath(import.meta.url);

/** The cap on the life of a stub, so a failed test leaves nothing behind. */
export const DEFAULT_TTL_MS = 30_000;

/** The marker the stub writes on standard output, and the one on standard error. */
export const STDOUT_MARKER = "proc-stub: this line went to standard output";
export const STDERR_MARKER = "proc-stub: this line went to standard error";

/** What the stub writes, and what a test reads back. */
export type StubReport = {
  readonly kind: "specstride.kernel.test.proc-stub/1";
  readonly pid: number;
  readonly ppid: number;
  /** The process group, from the process file system; `null` where unreadable. */
  readonly pgid: number | null;
  /** The session, from the process file system; `null` where unreadable. */
  readonly sid: number | null;
  /** `eof` where standard input gave nothing, else the bytes it gave. */
  readonly stdin: "eof" | number;
  /** Where the three descriptors point, where the platform says. */
  readonly fds: Readonly<Record<string, string | null>>;
  /** The children the stub started, each in the stub's own group. */
  readonly children: readonly number[];
  readonly startedAtMs: number;
};

function argOf(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

/** Fields of `/proc/self/stat` after the command name; the name may hold a `)`. */
function selfStatFields(): readonly string[] {
  try {
    const text = readFileSync("/proc/self/stat", "utf8");
    return text
      .slice(text.lastIndexOf(")") + 2)
      .trim()
      .split(/\s+/);
  } catch {
    return [];
  }
}

function numberOrNull(value: string | undefined): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function targetOf(fd: number): string | null {
  try {
    return readlinkSync(`/proc/self/fd/${fd}`);
  } catch {
    return null;
  }
}

/** Read standard input to its end, without blocking for ever. */
function readStandardInput(): "eof" | number {
  try {
    let read = 0;
    const buffer = Buffer.alloc(4096);
    for (;;) {
      let got = 0;
      try {
        got = readSync(0, buffer, 0, buffer.length, null);
      } catch {
        break;
      }
      if (got === 0) break;
      read += got;
    }
    return read === 0 ? "eof" : read;
  } catch {
    return "eof";
  }
}

function writeAtomically(path: string, text: string): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, text, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

function runAsStub(argv: readonly string[]): void {
  const reportPath = argOf(argv, "--report");
  if (reportPath === undefined) {
    process.stderr.write("proc-stub: --report <file> is required\n");
    process.exit(2);
  }
  const ttlMs = Number(argOf(argv, "--ttl-ms") ?? DEFAULT_TTL_MS);
  const childCount = Number(argOf(argv, "--children") ?? 0);
  const exitWith = argOf(argv, "--exit-with");
  const signalSelf = argOf(argv, "--signal-self");

  process.stdout.write(`${STDOUT_MARKER}\n`);
  process.stderr.write(`${STDERR_MARKER}\n`);

  const children: number[] = [];
  for (let n = 0; n < childCount; n += 1) {
    // A child of the stub, NOT detached: it stays in the stub's group, which is
    // what makes it a member `signalGroup` must reach.
    const child = spawn(process.execPath, ["-e", `setTimeout(() => process.exit(0), ${ttlMs});`], {
      stdio: ["ignore", "inherit", "inherit"],
      detached: false,
    });
    child.unref();
    if (child.pid !== undefined) children.push(child.pid);
  }

  const fields = selfStatFields();
  const report: StubReport = {
    kind: "specstride.kernel.test.proc-stub/1",
    pid: process.pid,
    ppid: process.ppid,
    pgid: numberOrNull(fields[2]),
    sid: numberOrNull(fields[3]),
    stdin: readStandardInput(),
    fds: Object.freeze({ "0": targetOf(0), "1": targetOf(1), "2": targetOf(2) }),
    children: Object.freeze(children),
    startedAtMs: Date.now(),
  };
  writeAtomically(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  if (signalSelf !== undefined) {
    setTimeout(() => process.kill(process.pid, signalSelf as NodeJS.Signals), 50);
    setTimeout(() => process.exit(0), ttlMs);
    return;
  }
  if (exitWith !== undefined) {
    setTimeout(() => process.exit(Number(exitWith)), 50);
    return;
  }
  // One referenced timer holds the event loop open: the stub sleeps.
  setTimeout(() => process.exit(0), ttlMs);
}

export function readStubReport(path: string): StubReport {
  return JSON.parse(readFileSync(path, "utf8")) as StubReport;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === PROC_STUB_ENTRY) {
  runAsStub(process.argv.slice(2));
}
