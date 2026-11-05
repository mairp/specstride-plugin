/**
 * T075 — the waiter of `startDetached` (F100-FR-234).
 *
 * F100-FR-234: *start such a process detached with a status record, in which
 * the kernel starts a waiter of its own in the new session, with no shell, and
 * the waiter starts the command, waits for its end and writes its exit code or
 * signal, its duration and its times of start and end atomically to a file the
 * caller names, so that the record exists when the process that started it has
 * ended* (the baseline does the same with a wrapper, B-1127, B-1070).
 *
 * This file IS that waiter. The kernel spawns it detached, so it is the leader
 * of the new session and of the new process group; the command it starts is its
 * child in the same session and group, which is why one `signalGroup` reaches
 * both. Its standard input is the null device and its standard output and
 * standard error are the two files the caller named, so the command inherits
 * all three and nothing goes back to whoever called `startDetached`.
 *
 * No shell is interposed anywhere: the command is a fixed argument list, and
 * the waiter is `node` running this file.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteJson } from "../atomic-write/index.ts";

/** The path of this file: what the kernel hands `node` as the waiter's entry. */
export const WAITER_ENTRY = fileURLToPath(import.meta.url);

/** The schema tag of the status record, so a reader can tell it is complete. */
export const DETACHED_STATUS_KIND = "specstride.kernel.detached-status/1" as const;

/** The status record the waiter writes (F100-FR-234, with its schema tag). */
export type WrittenDetachedStatus = {
  readonly kind: typeof DETACHED_STATUS_KIND;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly durationMs: number;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  /** The process id of the command, so a reader can tell it from the waiter. */
  readonly commandPid: number | null;
  /** The process id of the waiter, which leads the session and the group. */
  readonly waiterPid: number;
};

/** The flags the kernel gives the waiter; the command follows `--`. */
export const WAITER_STATUS_FLAG = "--status" as const;
export const WAITER_CWD_FLAG = "--cwd" as const;
export const WAITER_ARGV_SEPARATOR = "--" as const;

/** What the waiter was told to do. */
export type WaiterInstruction = {
  readonly statusFile: string;
  readonly cwd: string;
  readonly argv: readonly string[];
};

/** Read the instruction out of an argument list. Throws on a malformed one. */
export function parseWaiterArgv(argv: readonly string[]): WaiterInstruction {
  const separator = argv.indexOf(WAITER_ARGV_SEPARATOR);
  if (separator < 0) {
    throw new Error(`the waiter needs \`${WAITER_ARGV_SEPARATOR}\` before the command`);
  }
  const flags = argv.slice(0, separator);
  const command = argv.slice(separator + 1);
  const valueOf = (flag: string): string | undefined => {
    const at = flags.indexOf(flag);
    return at >= 0 ? flags[at + 1] : undefined;
  };
  const statusFile = valueOf(WAITER_STATUS_FLAG);
  const cwd = valueOf(WAITER_CWD_FLAG);
  if (statusFile === undefined) throw new Error(`the waiter needs ${WAITER_STATUS_FLAG} <file>`);
  if (cwd === undefined) throw new Error(`the waiter needs ${WAITER_CWD_FLAG} <directory>`);
  if (command.length === 0) throw new Error("the waiter was given no command to start");
  return Object.freeze({ statusFile, cwd, argv: Object.freeze([...command]) });
}

/** The waiter itself: start the command, wait for its end, write the record. */
function runAsWaiter(instruction: WaiterInstruction): void {
  const startedAtMs = Date.now();
  const startedMonotonic = process.hrtime.bigint();

  const [file, ...args] = instruction.argv;
  if (file === undefined) throw new Error("the waiter was given no command to start");

  // No shell. Standard input, output and error are the waiter's own, which the
  // kernel already pointed at the null device and at the two named files.
  const child = spawn(file, args, {
    cwd: instruction.cwd,
    env: process.env,
    stdio: ["inherit", "inherit", "inherit"],
    shell: false,
  });

  const write = (exitCode: number | null, signal: string | null): void => {
    const endedAtMs = Date.now();
    const durationMs = Number((process.hrtime.bigint() - startedMonotonic) / 1_000_000n);
    const record: WrittenDetachedStatus = {
      kind: DETACHED_STATUS_KIND,
      exitCode,
      signal,
      durationMs,
      startedAtMs,
      endedAtMs,
      commandPid: child.pid ?? null,
      waiterPid: process.pid,
    };
    atomicWriteJson(instruction.statusFile, record, { createDirectory: true });
  };

  child.once("error", (error) => {
    // The command could not be started at all: the record still exists, so a
    // reader never waits for a file that will never come.
    write(null, null);
    process.stderr.write(`kernel waiter: could not start the command: ${error.message}\n`);
    process.exit(127);
  });

  child.once("exit", (code, signal) => {
    write(code ?? null, signal ?? null);
    process.exit(0);
  });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === WAITER_ENTRY) {
  runAsWaiter(parseWaiterArgv(process.argv.slice(2)));
}
