/**
 * T075 — the process primitive of the kernel (F100-FR-234).
 *
 * The kernel offers to the core what the core may not import (F100-FR-012): a
 * way to start a process. Every process this primitive starts is
 *
 *   - in a process GROUP of its own and a process SESSION of its own, because
 *     the platform is asked to detach it, which calls `setsid`; the group id
 *     then equals the process id, and `signalGroup` reaches the process and
 *     everything it starts and nothing else;
 *   - started with standard input on the null device, so that nothing can be
 *     read from it and no pipe leads back to whoever started it;
 *   - started with standard output and standard error on the two files the
 *     caller names, and on the null device where the caller names none;
 *   - started with NO SHELL: a fixed argument list, never a command line.
 *
 * These are properties of the primitive and not options of a call: a caller
 * cannot ask for anything else (`STARTS_IN_A_SESSION_OF_ITS_OWN` and its
 * neighbours in `@specstride/contracts/ep/kernel-services`).
 *
 * The kernel holds NO RUN POLICY. There is no registry here, no identity check,
 * no search for survivors and no adoption: those stay in
 * `packages/runtime/src/procs/` and call this primitive (the owner's ruling of
 * 2026-09-30).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import type {
  GroupSignal,
  ProcessEnd,
  ProcessPrimitive,
  StartDetachedInput,
  StartProcessInput,
  StartedProcess,
} from "@specstride/contracts/ep/kernel-services";
import { FILE_MODE, DIRECTORY_MODE } from "../atomic-write/path-guard.ts";
import { systemClock } from "./clock.ts";
import { assertSignallableProcess, signalGroup } from "./signals.ts";
import {
  platformProcessTableIo,
  processGroupOf,
  findByRunToken as findByRunTokenInTheTable,
  startTimeOf as startTimeOfInTheTable,
  type ProcessTableIo,
} from "./table.ts";
import {
  WAITER_ENTRY,
  WAITER_CWD_FLAG,
  WAITER_STATUS_FLAG,
  WAITER_ARGV_SEPARATOR,
} from "./waiter.ts";

/** The section of annex A that owns the primitive, and its requirement. */
export const PROC_ANNEX_SECTION = "annex A, §A.3" as const;
export const PROC_REQUIREMENT = "F100-FR-234" as const;

/** The kernel holds no run policy; the owner's ruling of 2026-09-30. */
export const THE_KERNEL_HOLDS_RUN_POLICY = false as const;
export const RUN_POLICY_LIVES_IN = "packages/runtime/src/procs/" as const;

/** Where standard input of every started process points: nothing can be read. */
export const STANDARD_INPUT_DEVICE = "/dev/null" as const;

/** Open the null device for reading, so standard input yields an end of file. */
function openTheNullDevice(): number {
  return openSync(STANDARD_INPUT_DEVICE, "r");
}

/** Open an output file for appending, owner-only, creating its directory. */
function openOutput(path: string | undefined): number {
  if (path === undefined) return openSync(STANDARD_INPUT_DEVICE, "w");
  mkdirSync(dirname(path), { recursive: true, mode: DIRECTORY_MODE });
  return openSync(path, "a", FILE_MODE);
}

/**
 * The children this primitive started, so that `waitForEnd` can report a real
 * exit code for one of them instead of only "it is gone". A child is forgotten
 * when it ends.
 */
const started = new Map<number, ChildProcess>();

/** The arguments the platform is given; the same for `start` and the waiter. */
function spawnInItsOwnSessionAndGroup(
  file: string,
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>>,
  stdoutFile: string | undefined,
  stderrFile: string | undefined,
): StartedProcess {
  const stdin = openTheNullDevice();
  const stdout = openOutput(stdoutFile);
  const stderr = openOutput(stderrFile);
  const startedAtMs = systemClock.nowMs();
  try {
    const child = spawn(file, [...args], {
      cwd,
      env: { ...env },
      // Standard input on the null device; the two outputs on the named files.
      stdio: [stdin, stdout, stderr],
      // `detached` calls `setsid`: a session and a group of its own.
      detached: true,
      shell: false,
    });
    const pid = child.pid;
    if (pid === undefined) {
      throw new Error(`the process \`${file}\` was not started: it has no process id`);
    }
    // The started process never holds the event loop of its starter open: that
    // is what lets the starter end while the process goes on.
    child.unref();
    started.set(pid, child);
    child.once("exit", () => started.delete(pid));
    // The group of a process started with `detached` is its own process id;
    // the table is read so that the answer is observed and not assumed.
    const pgid = processGroupOf(pid) ?? pid;
    return Object.freeze({ pid, pgid, startedAtMs });
  } finally {
    // The starter keeps none of the three descriptors: the child holds its own.
    for (const fd of [stdin, stdout, stderr]) {
      try {
        closeSync(fd);
      } catch {
        /* the child holds its own copy; a failed close changes nothing */
      }
    }
  }
}

/**
 * F100-FR-234 — start a process in a group and a session of its own, with
 * standard input closed and, where the caller names them, two files as its
 * standard output and standard error.
 */
export function startProcess(input: StartProcessInput): Promise<StartedProcess> {
  const [file, ...args] = input.argv;
  if (file === undefined) throw new Error("`start` was given no command: `argv` is empty");
  return Promise.resolve(
    spawnInItsOwnSessionAndGroup(
      file,
      args,
      input.cwd,
      input.env,
      input.stdoutFile,
      input.stderrFile,
    ),
  );
}

/**
 * F100-FR-234 — start such a process detached, with a status record: the kernel
 * starts a waiter of its own in the new session, with no shell, which starts
 * the command, waits for its end and writes exit code or signal, duration and
 * the times of start and end with the atomic write of the kernel to the file
 * the caller names, so that the record exists when the process that started it
 * has ended.
 *
 * The identity returned is the WAITER's: it leads the new session and the new
 * group, and the command is its child in that same group, so one
 * `signalGroup(pgid, …)` reaches both.
 */
export function startProcessDetached(input: StartDetachedInput): Promise<StartedProcess> {
  if (input.argv.length === 0) {
    throw new Error("`startDetached` was given no command: `argv` is empty");
  }
  if (typeof input.statusFile !== "string" || input.statusFile.length === 0) {
    throw new Error("`startDetached` needs the file the waiter writes the status record to");
  }
  return Promise.resolve(
    spawnInItsOwnSessionAndGroup(
      process.execPath,
      [
        WAITER_ENTRY,
        WAITER_STATUS_FLAG,
        input.statusFile,
        WAITER_CWD_FLAG,
        input.cwd,
        WAITER_ARGV_SEPARATOR,
        ...input.argv,
      ],
      input.cwd,
      input.env,
      input.stdoutFile,
      input.stderrFile,
    ),
  );
}

/** How often `waitForEnd` looks at a process it did not start. */
export const WAIT_POLL_MS = 20 as const;

/**
 * F100-FR-234 — wait for a process to end.
 *
 * For a process this primitive started, the answer is its real exit code or
 * signal. For any other process of the user, the kernel is not its parent and
 * can learn only that it is gone, so the answer carries neither.
 *
 * A wait HOLDS THE EVENT LOOP of its caller open for as long as it lasts, and
 * only for that long. The two are not in conflict: `start` unrefs the child so
 * that a starter which never waits can end while the process goes on, and this
 * function refs it again for the span of the wait, because a caller that asked
 * to be told of an end means to be still there when it comes. Without the ref
 * the loop of the caller runs dry, the platform resolves it, and the promise
 * this function returned is never settled at all — which is a wait that
 * silently answers nothing rather than a wait that answers late.
 */
export function waitForEnd(pid: number): Promise<ProcessEnd> {
  assertSignallableProcess(pid);
  const child = started.get(pid);
  if (child !== undefined) {
    if (child.exitCode !== null || child.signalCode !== null) {
      return Promise.resolve(Object.freeze({ exitCode: child.exitCode, signal: child.signalCode }));
    }
    return new Promise<ProcessEnd>((done) => {
      // Held open for the span of the wait; released as the end is reported.
      child.ref();
      child.once("exit", (code, signal) => {
        child.unref();
        done(Object.freeze({ exitCode: code ?? null, signal: signal ?? null }));
      });
    });
  }
  return new Promise<ProcessEnd>((done) => {
    const look = (): void => {
      try {
        process.kill(pid, 0);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ESRCH") {
          done(Object.freeze({ exitCode: null, signal: null }));
          return;
        }
        // `EPERM`: it lives and this user may not signal it (F122-FR-042).
      }
      // Referenced on purpose: the next look must happen, so the loop of the
      // caller stays alive until the process this wait is about is gone.
      setTimeout(look, WAIT_POLL_MS);
    };
    look();
  });
}

/** Make a primitive over a process table a test chooses. */
export function createProcessPrimitive(
  io: ProcessTableIo = platformProcessTableIo,
): ProcessPrimitive {
  return Object.freeze({
    start: startProcess,
    startDetached: startProcessDetached,
    signalGroup: (pgid: number, signal: GroupSignal): void => signalGroup(pgid, signal),
    startTimeOf: (pid: number): number | null => startTimeOfInTheTable(pid, io),
    findByRunToken: (runToken: string): readonly number[] => findByRunTokenInTheTable(runToken, io),
    waitForEnd,
  });
}

/**
 * The process primitive of this machine (F100-FR-234). The composition root
 * hands this to the core and to every loop layer as an argument; nothing in the
 * core imports `node:child_process` itself.
 */
export const processPrimitive: ProcessPrimitive = createProcessPrimitive();
