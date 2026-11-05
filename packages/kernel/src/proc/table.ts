/**
 * T075 — the process table, read by the kernel (F100-FR-234; research D-6, D-8).
 *
 * The core may not read the process table itself, and neither may the runtime's
 * platform readers: they call these functions (T010). Two platforms:
 *
 *   - **Linux**: the process file system. The start time of a process is field
 *     22 of `/proc/<pid>/stat`, in clock ticks since boot, which is only
 *     comparable together with the boot identity (D-8); the environment of a
 *     process of the same user is `/proc/<pid>/environ`; the processes of the
 *     user are the numeric entries of `/proc` whose directory this user owns.
 *   - **macOS**: `ps`, run with the locale `C` so that a time is not formatted
 *     by the consumer's locale. Every macOS value is `unverified` (D-6, D-8):
 *     no macOS runner exists, so no statement here was measured. Reading the
 *     environment of another process may be refused by the system, which is
 *     why `environOf` answers `null` instead of throwing (D-8, "Open").
 *
 * A value this module reads is compared and never handed on: the environment of
 * another process may hold a credential, so `findByRunToken` returns process
 * ids and never the environment it read to find them.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";

/** The requirement this module carries. */
export const PROC_TABLE_REQUIREMENT = "F100-FR-234" as const;

/** The research decisions this module carries out. */
export const PROC_TABLE_DECISIONS = ["D-6", "D-8"] as const;

/** Every statement about macOS here is `unverified` (D-6, D-8). */
export const MACOS_IS_UNVERIFIED = "unverified" as const;
export const MACOS_UNVERIFIED_REASON =
  "no macOS runner exists; every macOS branch of the process table is unverified (research D-6, D-8)" as const;

/** What the table is read through; a test gives its own. */
export type ProcessTableIo = {
  /** The platform, as `process.platform` names it. */
  readonly platform: string;
  /** The root of the process file system; a fixture tree in a test. */
  readonly procRoot: string;
  /** The user whose processes are the user's; `null` where the platform has none. */
  readonly uid: number | null;
  /** Read a file of the process file system, or `null` where it cannot be read. */
  readFile(path: string): string | null;
  /** The entries of a directory, or `null` where it cannot be read. */
  readDirectory(path: string): readonly string[] | null;
  /** The owning user of a path, or `null` where it cannot be read. */
  ownerOf(path: string): number | null;
  /** Run `ps` with the arguments given, under the locale `C`; `null` on failure. */
  runPs(args: readonly string[]): string | null;
};

/** The process table of the machine this process runs on. */
export const platformProcessTableIo: ProcessTableIo = Object.freeze({
  platform: process.platform,
  procRoot: "/proc",
  uid: typeof process.getuid === "function" ? process.getuid() : null,
  readFile(path: string): string | null {
    try {
      return readFileSync(path, "latin1");
    } catch {
      return null;
    }
  },
  readDirectory(path: string): readonly string[] | null {
    try {
      return readdirSync(path);
    } catch {
      return null;
    }
  },
  ownerOf(path: string): number | null {
    try {
      return statSync(path).uid;
    } catch {
      return null;
    }
  },
  runPs(args: readonly string[]): string | null {
    try {
      return execFileSync("ps", [...args], {
        encoding: "latin1",
        env: { ...process.env, LC_ALL: "C", LANG: "C" },
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch {
      return null;
    }
  },
});

/* ------------------------------------------------------------------ *
 * The clock ticks of the platform.
 * ------------------------------------------------------------------ */

/**
 * The clock ticks per second that field 22 of `/proc/<pid>/stat` counts in.
 * `USER_HZ` is 100 on every Linux the product supports; the value is read from
 * `getconf` where it answers, so the constant is a fallback and not a claim.
 */
export const DEFAULT_CLOCK_TICKS_PER_SECOND = 100 as const;

let ticksPerSecond: number | undefined;

export function clockTicksPerSecond(io: ProcessTableIo = platformProcessTableIo): number {
  if (io !== platformProcessTableIo) return DEFAULT_CLOCK_TICKS_PER_SECOND;
  if (ticksPerSecond !== undefined) return ticksPerSecond;
  try {
    const text = execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim();
    const value = Number(text);
    ticksPerSecond = Number.isFinite(value) && value > 0 ? value : DEFAULT_CLOCK_TICKS_PER_SECOND;
  } catch {
    ticksPerSecond = DEFAULT_CLOCK_TICKS_PER_SECOND;
  }
  return ticksPerSecond;
}

/* ------------------------------------------------------------------ *
 * The boot: its identity and its time (research D-6).
 * ------------------------------------------------------------------ */

/**
 * The identity of the boot (D-6). Linux: the boot identifier of the kernel.
 * macOS: the boot time of the kernel from `sysctl`, `unverified`. `null` where
 * neither answers — a caller reads that as "the boot cannot be told", which
 * makes a probe `unknown` rather than letting a reused process id pass.
 */
export function bootIdentity(io: ProcessTableIo = platformProcessTableIo): string | null {
  if (io.platform === "linux") {
    const text = io.readFile(`${io.procRoot}/sys/kernel/random/boot_id`);
    const id = text?.trim();
    return id !== undefined && id.length > 0 ? id : null;
  }
  if (io.platform === "darwin") {
    // `unverified` (D-6): no macOS runner has measured this.
    const text = io.runPs(["-o", "lstart=", "-p", "1"]);
    const line = text?.trim();
    return line !== undefined && line.length > 0 ? `boot-of-pid-1:${line}` : null;
  }
  return null;
}

/** Milliseconds since the epoch at which the machine booted; `null` where unknown. */
export function bootTimeMs(io: ProcessTableIo = platformProcessTableIo): number | null {
  if (io.platform === "linux") {
    const text = io.readFile(`${io.procRoot}/stat`);
    if (text === null) return null;
    for (const line of text.split("\n")) {
      if (!line.startsWith("btime ")) continue;
      const seconds = Number(line.slice("btime ".length).trim());
      if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    }
    return null;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * The start time of a process (research D-8).
 * ------------------------------------------------------------------ */

/**
 * The fields of `/proc/<pid>/stat` after the closing bracket of the command
 * name. The command name itself may hold a space or a bracket, so the split
 * starts at the LAST `)` and never at the second field.
 */
function statFieldsAfterTheName(text: string): readonly string[] {
  const end = text.lastIndexOf(")");
  if (end < 0) return [];
  return text
    .slice(end + 2)
    .trim()
    .split(/\s+/);
}

/** Field 22 of `/proc/<pid>/stat` is at this offset after the command name. */
const STARTTIME_OFFSET_AFTER_THE_NAME = 19 as const;
/** Field 5, the process group, is at this offset. */
const PGRP_OFFSET_AFTER_THE_NAME = 2 as const;
/** Field 6, the session, is at this offset. */
const SESSION_OFFSET_AFTER_THE_NAME = 3 as const;
/** Field 3, the state of the process, is the first field after the name. */
const STATE_OFFSET_AFTER_THE_NAME = 0 as const;

/**
 * The start time of a process in clock ticks since boot (D-8), which is only
 * comparable together with the boot identity. `null` where the process is gone
 * or the platform does not answer.
 */
export function startTicksOf(
  pid: number,
  io: ProcessTableIo = platformProcessTableIo,
): number | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (io.platform !== "linux") return null;
  const text = io.readFile(`${io.procRoot}/${pid}/stat`);
  if (text === null) return null;
  const fields = statFieldsAfterTheName(text);
  const ticks = Number(fields[STARTTIME_OFFSET_AFTER_THE_NAME]);
  return Number.isFinite(ticks) ? ticks : null;
}

/**
 * F100-FR-234 — the start time of a process, in milliseconds since the epoch,
 * or `null` where the process is gone.
 *
 * Linux: the boot time plus field 22 of `/proc/<pid>/stat` in clock ticks
 * (D-8). macOS: `ps -o lstart=`, under the locale `C`, `unverified` (D-8).
 */
export function startTimeOf(
  pid: number,
  io: ProcessTableIo = platformProcessTableIo,
): number | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (io.platform === "linux") {
    const ticks = startTicksOf(pid, io);
    const boot = bootTimeMs(io);
    if (ticks === null || boot === null) return null;
    return Math.round(boot + (ticks / clockTicksPerSecond(io)) * 1000);
  }
  if (io.platform === "darwin") {
    // `unverified` (D-8): no macOS runner has measured this.
    const text = io.runPs(["-o", "lstart=", "-p", String(pid)]);
    const line = text?.trim();
    if (line === undefined || line.length === 0) return null;
    const ms = Date.parse(line);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** The state letter of a process: `Z` for one that exited and was not collected. */
export function stateOf(pid: number, io: ProcessTableIo = platformProcessTableIo): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (io.platform === "linux") {
    const text = io.readFile(`${io.procRoot}/${pid}/stat`);
    if (text === null) return null;
    const state = statFieldsAfterTheName(text)[STATE_OFFSET_AFTER_THE_NAME];
    return state !== undefined && state.length > 0 ? state : null;
  }
  if (io.platform === "darwin") {
    const text = io.runPs(["-o", "state=", "-p", String(pid)]);
    const line = text?.trim();
    if (line === undefined || line.length === 0) return null;
    // `unverified` (D-8): macOS prints `Z` for a zombie too, with modifiers.
    return line[0] ?? null;
  }
  return null;
}

/** The process group of a process, or `null` where it cannot be read. */
export function processGroupOf(
  pid: number,
  io: ProcessTableIo = platformProcessTableIo,
): number | null {
  return statNumberOf(pid, PGRP_OFFSET_AFTER_THE_NAME, ["-o", "pgid=", "-p"], io);
}

/**
 * The command line of a process, NULs folded to spaces; empty where the
 * process is gone or the platform does not answer. Linux: `/proc/<pid>/cmdline`.
 * macOS: `ps -o command=`, `unverified` (D-6, D-8) — a host without the
 * process file system still answers, so a caller that must recognise a
 * process by its command line can on both platforms.
 */
export function commandLineOf(pid: number, io: ProcessTableIo = platformProcessTableIo): string {
  if (!Number.isInteger(pid) || pid <= 0) return "";
  if (io.platform === "linux") {
    const text = io.readFile(`${io.procRoot}/${pid}/cmdline`);
    if (text === null) return "";
    return text.split("\0").join(" ").trim();
  }
  if (io.platform === "darwin") {
    // `unverified` (D-6, D-8): no macOS runner has measured this.
    const text = io.runPs(["-o", "command=", "-ww", "-p", String(pid)]);
    return (text ?? "").trim();
  }
  return "";
}

/** The session of a process, or `null` where it cannot be read. */
export function sessionOf(pid: number, io: ProcessTableIo = platformProcessTableIo): number | null {
  return statNumberOf(pid, SESSION_OFFSET_AFTER_THE_NAME, ["-o", "sess=", "-p"], io);
}

function statNumberOf(
  pid: number,
  offset: number,
  psArgs: readonly string[],
  io: ProcessTableIo,
): number | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (io.platform === "linux") {
    const text = io.readFile(`${io.procRoot}/${pid}/stat`);
    if (text === null) return null;
    const value = Number(statFieldsAfterTheName(text)[offset]);
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  const out = io.runPs([...psArgs, String(pid)]);
  const value = Number(out?.trim());
  return Number.isInteger(value) && value > 0 ? value : null;
}

/* ------------------------------------------------------------------ *
 * The environment of a process, and the processes of the user (D-8).
 * ------------------------------------------------------------------ */

/**
 * The environment of a process of the same user (D-8), or `null` where it
 * cannot be read. On macOS the system may refuse it, which is `unverified` and
 * the reason the answer is `null` and never an error (D-8, "Open").
 */
export function environOf(
  pid: number,
  io: ProcessTableIo = platformProcessTableIo,
): Readonly<Record<string, string>> | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (io.platform === "linux") {
    const text = io.readFile(`${io.procRoot}/${pid}/environ`);
    if (text === null) return null;
    const env: Record<string, string> = {};
    for (const pair of text.split("\0")) {
      if (pair.length === 0) continue;
      const at = pair.indexOf("=");
      if (at <= 0) continue;
      env[pair.slice(0, at)] = pair.slice(at + 1);
    }
    return Object.freeze(env);
  }
  if (io.platform === "darwin") {
    // `unverified` (D-8): `ps -E` shows the environment of processes of the
    // same user, and the system may refuse it for some processes.
    const text = io.runPs(["-E", "-ww", "-o", "command=", "-p", String(pid)]);
    const line = text?.trim();
    if (line === undefined || line.length === 0) return null;
    const env: Record<string, string> = {};
    for (const word of line.split(/\s+/)) {
      const at = word.indexOf("=");
      if (at <= 0) continue;
      env[word.slice(0, at)] = word.slice(at + 1);
    }
    return Object.freeze(env);
  }
  return null;
}

/** One process of the user, as the table reports it. */
export type ProcessOfTheUser = {
  readonly pid: number;
  /** Clock ticks since boot on Linux; `null` elsewhere (D-8). */
  readonly startTicks: number | null;
  /** Milliseconds since the epoch, where the platform can say. */
  readonly startTimeMs: number | null;
};

/**
 * The list of processes of the user (D-8). Linux: the numeric entries of the
 * process file system whose directory this user owns. macOS: `ps -u <uid>`,
 * `unverified`.
 *
 * This is the one reader of the process table; `findByRunToken` and the
 * platform readers of the runtime (T010) both go through it and never read the
 * table themselves.
 */
export function listProcessesOfTheUser(
  io: ProcessTableIo = platformProcessTableIo,
): readonly ProcessOfTheUser[] {
  const found: ProcessOfTheUser[] = [];
  if (io.platform === "linux") {
    const entries = io.readDirectory(io.procRoot) ?? [];
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number(entry);
      if (pid <= 0) continue;
      if (io.uid !== null && io.ownerOf(`${io.procRoot}/${entry}`) !== io.uid) continue;
      found.push(
        Object.freeze({
          pid,
          startTicks: startTicksOf(pid, io),
          startTimeMs: startTimeOf(pid, io),
        }),
      );
    }
    return Object.freeze(found.sort((a, b) => a.pid - b.pid));
  }
  if (io.platform === "darwin") {
    // `unverified` (D-8).
    const text = io.runPs(io.uid === null ? ["-o", "pid="] : ["-u", String(io.uid), "-o", "pid="]);
    for (const line of (text ?? "").split("\n")) {
      const pid = Number(line.trim());
      if (!Number.isInteger(pid) || pid <= 0) continue;
      found.push(Object.freeze({ pid, startTicks: null, startTimeMs: startTimeOf(pid, io) }));
    }
    return Object.freeze(found.sort((a, b) => a.pid - b.pid));
  }
  return Object.freeze(found);
}

/**
 * F100-FR-234 — search the process table of the user for a run token (D-8).
 *
 * The token is matched against the VALUES of the environment of each process,
 * so the kernel needs to know no variable name and holds no run policy. The
 * environment read is compared and never returned: it may hold a credential.
 * The answer is the process ids that carry the token.
 */
export function findByRunToken(
  runToken: string,
  io: ProcessTableIo = platformProcessTableIo,
): readonly number[] {
  if (typeof runToken !== "string" || runToken.length === 0) return Object.freeze([]);
  const carriers: number[] = [];
  for (const candidate of listProcessesOfTheUser(io)) {
    const env = environOf(candidate.pid, io);
    if (env === null) continue;
    for (const value of Object.values(env)) {
      if (value === runToken) {
        carriers.push(candidate.pid);
        break;
      }
    }
  }
  return Object.freeze(carriers);
}
