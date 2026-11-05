/**
 * T010 — the platform readers of the runtime (F122-FR-013, F122-FR-025,
 * F122-FR-042; research D-6, D-8).
 *
 * Six readings the lock, the probe and the process registry need from the
 * machine, and one judgement built on them:
 *
 *   1. the start time of a process,
 *   2. the identity of the boot,
 *   3. the host name,
 *   4. the identity of the pid namespace,
 *   5. the environment of a process of the same user,
 *   6. the list of processes of the user,
 *   7. whether a recorded process lives, as F122-FR-042 states it.
 *
 * **These readers read nothing themselves.** The start time of a process and
 * the search of the process table for a run token go through the PROCESS
 * PRIMITIVE of the kernel (T075, F100-FR-234): `startTimeOf` and
 * `findByRunToken` of `@specstride/kernel`. The rest go through the process
 * table of the kernel in the same package. This module imports no
 * `node:child_process` and opens no file of the process file system of its
 * own; `node:fs` and `node:os` appear here only to BUILD the seam that the
 * live machine is read through, and every reader takes that seam as an
 * argument so a test can hand it a recorded one (T011).
 *
 * That is the division the owner's ruling of 2026-09-30 draws: the primitive
 * lives in the kernel and holds no run policy, and the policy — what a start
 * time is compared with, what counts as alive, what a mismatch means — lives
 * here.
 *
 * **Linux and macOS.** Every macOS value is `unverified` (D-6, D-8): no macOS
 * machine exists in this lane, so no statement about macOS here was measured.
 * The marking is not a comment but a value, `MACOS_VERIFICATION`, which a test
 * reads.
 */
import { hostname } from "node:os";
import { readlinkSync } from "node:fs";
import {
  bootIdentity as kernelBootIdentity,
  environOf as kernelEnvironOf,
  listProcessesOfTheUser as kernelListProcessesOfTheUser,
  platformProcessTableIo,
  stateOf as kernelStateOf,
  processPrimitive,
  type ProcessOfTheUser,
  type ProcessTableIo,
} from "@specstride/kernel";
// The interface of the primitive is owned by feature 100's contract, not by
// the kernel that implements it: the readers here depend on the contract.
import type { ProcessPrimitive } from "@specstride/contracts/ep/kernel-services";

/** The requirements these readers carry. */
export const PLATFORM_REQUIREMENTS = ["F122-FR-013", "F122-FR-025", "F122-FR-042"] as const;

/** The research decisions these readers carry out. */
export const PLATFORM_DECISIONS = ["D-6", "D-8"] as const;

/** The two platforms with a branch here. */
export const PLATFORMS_WITH_A_BRANCH = ["linux", "darwin"] as const;

/**
 * D-6, D-8 — every macOS value of this module is `unverified`. It is a value
 * and not a comment so that `packages/runtime/test/unit/platform.test.ts` can
 * assert it, and so that a later macOS runner has one place to change.
 */
export const MACOS_VERIFICATION = "unverified" as const;
export const MACOS_UNVERIFIED_REASON: string =
  "no macOS machine exists in this lane, so no statement about macOS in the platform readers " +
  "was measured (research D-6, D-8; the owner's out-of-band ruling of 2026-09-30)";

/**
 * The readers read nothing of the process table themselves: the start time of
 * a process and the search for a run token go through the kernel primitive.
 * A test reads this to show that the rule is stated and not merely followed.
 */
export const READ_THROUGH_THE_KERNEL_PRIMITIVE = ["startTimeOf", "findByRunToken"] as const;

/* ------------------------------------------------------------------ *
 * The seam.
 * ------------------------------------------------------------------ */

/**
 * What the platform is read through. It widens the process table seam of the
 * kernel with the three things these readers need and the table does not have:
 * the host name, the target of a symlink of the process file system (the pid
 * namespace is one), and the answer of the platform to a signal of zero, which
 * is how liveness is asked without a signal being sent.
 */
export type PlatformIo = ProcessTableIo & {
  /** The host name, or `null` where the platform does not answer. */
  hostName(): string | null;
  /** The target of a symlink, or `null` where it cannot be read. */
  readLink(path: string): string | null;
  /**
   * `kill(pid, 0)`: it sends NO signal and only asks the platform whether it
   * would have been delivered. The four answers are the platform's own.
   */
  signalZero(pid: number): SignalZeroAnswer;
};

/** What `kill(pid, 0)` can tell us (F122-FR-042). */
export const SIGNAL_ZERO_ANSWERS = [
  /** It exists and this user may signal it. */
  "permitted",
  /** It exists and this user may NOT signal it: `EPERM`. */
  "permission-refused",
  /** No such process: `ESRCH`. */
  "gone",
  /** The platform answered something else. */
  "unknown",
] as const;
export type SignalZeroAnswer = (typeof SIGNAL_ZERO_ANSWERS)[number];

/**
 * The smallest process id these readers will ask the platform about. `0` and
 * every negative number name a process GROUP and not a process, and `1` is
 * init. HOST SAFETY (the owner's ruling of 2026-10-02): a signal of zero to a
 * group as root asks about every process on the machine, and this module never
 * does it. A recorded entry with such an id is not a process of this runtime.
 */
export const SMALLEST_PROCESS_ID = 2 as const;

/** True where `pid` is an id of a single process this module may ask about. */
export function isAskableProcessId(pid: number): boolean {
  return Number.isInteger(pid) && pid >= SMALLEST_PROCESS_ID;
}

/** The platform of this machine, read through `node:fs` and `node:os`. */
export const platformIo: PlatformIo = Object.freeze({
  ...platformProcessTableIo,
  hostName(): string | null {
    try {
      const name = hostname();
      return typeof name === "string" && name.length > 0 ? name : null;
    } catch {
      return null;
    }
  },
  readLink(path: string): string | null {
    try {
      return readlinkSync(path);
    } catch {
      return null;
    }
  },
  signalZero(pid: number): SignalZeroAnswer {
    // Never a group, never init: `isAskableProcessId` is checked by every
    // caller, and checked again here so the seam itself cannot be misused.
    if (!isAskableProcessId(pid)) return "unknown";
    try {
      process.kill(pid, 0);
      return "permitted";
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ESRCH") return "gone";
      if (code === "EPERM") return "permission-refused";
      return "unknown";
    }
  },
});

/**
 * A seam over a RECORDED platform, for a test (T011).
 *
 * It answers from maps and touches no disk at all. Two reasons, and both
 * matter:
 *
 *   - a recorded process file system as a tree of real files would be a tree
 *     of files with no extension (`stat`, `environ`, `ns/pid`), and a file
 *     with no extension inside a package is a finding of the product-wide
 *     language check: every component of the product is TypeScript, and
 *     anything else enters only through the Language Ledger (F100-FR-030). A
 *     recorded fixture is DATA, so it belongs in a `.json` file;
 *   - `ns/pid` is a symbolic link whose target names a namespace of the
 *     machine that recorded it. Git would not carry it, and a checkout could
 *     not reproduce it. A map can hold it exactly.
 *
 * `files` maps a path to its content, `links` maps a path to a link target,
 * `ps` maps the arguments `ps` was called with — joined by a space — to its
 * recorded output, and `signals` says what the platform would answer to a
 * signal of zero. A recorded platform SENDS no signal and reads no file.
 */
export function recordedPlatformIo(input: {
  readonly platform: string;
  readonly procRoot: string;
  readonly uid?: number | null;
  readonly hostName?: string | null;
  readonly files?: Readonly<Record<string, string>>;
  readonly ps?: Readonly<Record<string, string>>;
  readonly links?: Readonly<Record<string, string>>;
  readonly signals?: Readonly<Record<number, SignalZeroAnswer>>;
  /** The owner of a path, where a test wants one that is not the asker. */
  readonly owners?: Readonly<Record<string, number>>;
}): PlatformIo {
  const files = input.files ?? {};
  const ps = input.ps ?? {};
  const links = input.links ?? {};
  const signals = input.signals ?? {};
  const owners = input.owners ?? {};
  const uid = input.uid === undefined ? null : input.uid;
  /** Every path the recorded platform knows about, file or link. */
  const paths = Object.freeze([...Object.keys(files), ...Object.keys(links)]);

  return Object.freeze({
    platform: input.platform,
    procRoot: input.procRoot,
    uid,
    readFile(path: string): string | null {
      return files[path] ?? null;
    },
    readDirectory(path: string): readonly string[] | null {
      // The entries of a directory are derived from the recorded paths, so a
      // fixture lists each file once and the directories come out of it.
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const entries = new Set<string>();
      for (const known of paths) {
        if (!known.startsWith(prefix)) continue;
        const rest = known.slice(prefix.length);
        const head = rest.split("/")[0];
        if (head !== undefined && head.length > 0) entries.add(head);
      }
      return entries.size > 0 ? Object.freeze([...entries]) : null;
    },
    ownerOf(path: string): number | null {
      const named = owners[path];
      if (named !== undefined) return named;
      // A recorded entry the fixture knows belongs to the asker unless the
      // fixture says otherwise; one it does not know belongs to nobody.
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const known = paths.some((p) => p === path || p.startsWith(prefix));
      return known ? uid : null;
    },
    runPs(args: readonly string[]): string | null {
      return ps[args.join(" ")] ?? null;
    },
    hostName(): string | null {
      return input.hostName === undefined ? null : input.hostName;
    },
    readLink(path: string): string | null {
      return links[path] ?? null;
    },
    signalZero(pid: number): SignalZeroAnswer {
      // A recorded platform sends nothing either: it answers from the map.
      return signals[pid] ?? "gone";
    },
  });
}

/* ------------------------------------------------------------------ *
 * 1. The start time of a process — through the kernel primitive.
 * ------------------------------------------------------------------ */

/**
 * F122-FR-025 — the start time of a process, in milliseconds since the epoch,
 * or `null` where the process is gone or the platform cannot say.
 *
 * It goes through `startTimeOf` of the kernel primitive and reads no field of
 * the process table itself (T075, F100-FR-234). On Linux the value is derived
 * from the boot time and the clock ticks of `/proc/<pid>/stat`, so it is only
 * comparable together with the boot identity (D-8); on macOS it comes from
 * `ps` and is `unverified`.
 */
export function startTimeOfProcess(
  pid: number,
  primitive: ProcessPrimitive = processPrimitive,
): number | null {
  if (!isAskableProcessId(pid)) return null;
  return primitive.startTimeOf(pid);
}

/* ------------------------------------------------------------------ *
 * 2. The identity of the boot (D-6).
 * ------------------------------------------------------------------ */

/**
 * D-6 — the identity of the boot. Linux: the boot identifier of the kernel.
 * macOS: the boot time of the kernel, `unverified`. `null` where neither
 * answers, which a probe reads as `unknown` rather than letting a reused
 * process id pass (F122-FR-013, row P2 of the probe decision table).
 */
export function bootIdentity(io: PlatformIo = platformIo): string | null {
  return kernelBootIdentity(io);
}

/* ------------------------------------------------------------------ *
 * 3. The host name (D-6).
 * ------------------------------------------------------------------ */

/**
 * D-6 — the host name. A host name in the owner record that differs from the
 * prober's makes the probe `held-foreign` (F122-FR-013, row P3), so a reading
 * that fails must not look like agreement: it is `null`, and a comparison
 * against `null` is never equality.
 */
export function hostNameOfTheMachine(io: PlatformIo = platformIo): string | null {
  return io.hostName();
}

/* ------------------------------------------------------------------ *
 * 4. The identity of the pid namespace (D-6).
 * ------------------------------------------------------------------ */

/** Where the pid namespace of a process is named on Linux. */
export const PID_NAMESPACE_LINK = "ns/pid" as const;

/**
 * D-6 — the identity of the pid namespace of a process. Linux: the target of
 * `/proc/<pid>/ns/pid`, which reads `pid:[<number>]`. macOS: `null`, because
 * the platform has no such thing — and that `null` is `unverified` only in the
 * sense that no macOS machine confirmed the absence.
 *
 * Two owner records made in different pid namespaces name different worlds:
 * the same number is a different process in each, so a differing namespace
 * makes the probe `held-foreign` exactly as a differing host name does
 * (F122-FR-013, row P3).
 */
export function pidNamespaceOf(pid: number, io: PlatformIo = platformIo): string | null {
  if (!isAskableProcessId(pid)) return null;
  if (io.platform === "linux") {
    const target = io.readLink(`${io.procRoot}/${pid}/${PID_NAMESPACE_LINK}`);
    if (target === null) return null;
    const trimmed = target.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  // macOS has no pid namespace (D-6); `unverified`, as every macOS value here.
  return null;
}

/** The pid namespace of this process, which a probe compares the owner's with. */
export function pidNamespaceOfThisProcess(io: PlatformIo = platformIo): string | null {
  return pidNamespaceOf(process.pid, io);
}

/* ------------------------------------------------------------------ *
 * 5. The environment of a process of the same user (D-8).
 * ------------------------------------------------------------------ */

/**
 * D-8 — the environment of a process of the same user, or `null` where it
 * cannot be read. On macOS the system may refuse it for some processes, which
 * is why the answer is `null` and never an error (D-8, "Open"); the fallback
 * is the registry entry with pid and start time, and a doctor warning that the
 * search is incomplete.
 *
 * It goes through the process table of the kernel. **The value is compared and
 * never handed on** by any caller that looks for a token: an environment may
 * hold a credential, which is why `findProcessesByRunToken` below returns
 * process ids and not the environments it read.
 */
export function environmentOfAProcessOfTheSameUser(
  pid: number,
  io: PlatformIo = platformIo,
): Readonly<Record<string, string>> | null {
  if (!isAskableProcessId(pid)) return null;
  return kernelEnvironOf(pid, io);
}

/* ------------------------------------------------------------------ *
 * 6. The list of processes of the user (D-6, D-8).
 * ------------------------------------------------------------------ */

/**
 * D-8 — the list of processes of the user. Linux: the numeric entries of the
 * process file system whose directory this user owns. macOS: `ps -u <uid>`,
 * `unverified`. It goes through the process table of the kernel.
 *
 * This is what the search for survivors walks (F122-FR-027): it lists the
 * processes of the user and reads the environment of each.
 */
export function processesOfTheUser(io: PlatformIo = platformIo): readonly ProcessOfTheUser[] {
  return kernelListProcessesOfTheUser(io);
}

/**
 * F122-FR-024, F122-FR-027 — the processes of the user that carry a run token,
 * through `findByRunToken` of the kernel primitive (T075) and never by reading
 * the table here. The answer is process ids; the environments the search read
 * are not returned, because they may hold a credential.
 */
export function findProcessesByRunToken(
  runToken: string,
  primitive: ProcessPrimitive = processPrimitive,
): readonly number[] {
  return primitive.findByRunToken(runToken);
}

/* ------------------------------------------------------------------ *
 * 7. Whether a recorded process lives (F122-FR-042).
 * ------------------------------------------------------------------ */

/**
 * Why a recorded process was judged alive or not. A closed set, so a caller
 * can tell "it lives" from "we cannot say it does not", which F122-FR-042
 * needs it to do.
 */
export const LIVENESS_REASONS = [
  /** The platform would deliver a signal, and the identity matches. */
  "identity-matches",
  /** It exists and this user may not signal it. ALIVE (F122-FR-042). */
  "permission-refused",
  /** It exited and was not collected by its parent. NOT alive (F122-FR-042). */
  "exited-not-collected",
  /** No such process. */
  "gone",
  /** The start time differs: the id belongs to another process now. */
  "pid-reused",
  /** A reuse of the id cannot be told apart. ALIVE (F122-FR-042). */
  "pid-reuse-cannot-be-told",
  /** The id is not an id of a single process, so it is not asked about. */
  "not-a-process",
] as const;
export type LivenessReason = (typeof LIVENESS_REASONS)[number];

/**
 * What a reader learns when it asks whether a recorded process lives.
 *
 * The last two fields carry the rule of F122-FR-042's last sentence — *such an
 * answer MUST be used only to refuse a claim that a run is complete, never to
 * make one* — in the type rather than in a comment. `alive` is a conservative
 * answer: it is `true` whenever the platform cannot rule life out. So it can
 * refuse "this run is complete", and it can never establish it.
 */
export type RecordedProcessLiveness = {
  /** `true` wherever life cannot be ruled out (F122-FR-042). */
  readonly alive: boolean;
  readonly reason: LivenessReason;
  /** The start time the platform reports now, where it could be read. */
  readonly observedStartTimeMs: number | null;
  /** F122-FR-042: this answer may refuse a claim that a run is complete. */
  readonly mayRefuseAClaimOfCompletion: true;
  /** F122-FR-042: and it may never make one. */
  readonly mayMakeAClaimOfCompletion: false;
};

/** What a caller knows about the process it recorded. */
export type RecordedProcess = {
  readonly pid: number;
  /** The start time the entry recorded, where it has one. */
  readonly startTimeMs?: number | null;
};

/**
 * How far two readings of one start time may differ and still be the same
 * process. On Linux both readings come from the same two fields — the boot
 * time in seconds and the clock ticks of the process — so the same process
 * reads identically and this margin is never needed; it is here because the
 * boot time is recorded in SECONDS, so a value written by a reader that
 * rounded differently is still the same process.
 */
export const START_TIME_TOLERANCE_MS = 1_000 as const;

/**
 * F122-FR-042 — whether a recorded process lives, asked WITHOUT intent to
 * signal it. The three readings the requirement names, in the order that makes
 * each of them reachable:
 *
 *   - **"alive" for a process the asker may not signal for lack of
 *     permission**: `EPERM` means it is there. Permission is about the asker,
 *     not about the process.
 *   - **"not alive" for a process that has exited and was not yet collected by
 *     its parent**: a process in state `Z` still answers a signal of zero, so
 *     the state is read FIRST. Were it asked second, every uncollected child
 *     would read as alive for as long as its parent took to wait for it.
 *   - **"alive" where the operating system cannot tell whether a process id
 *     was reused**: a recorded entry without a start time, or a live start
 *     time the platform will not give, leaves reuse undecidable, and the
 *     conservative answer is the one the requirement names.
 *
 * Nothing here sends a signal: `signalZero` asks the platform whether one
 * would be delivered and delivers none.
 */
export function recordedProcessLives(
  recorded: RecordedProcess,
  io: PlatformIo = platformIo,
  primitive: ProcessPrimitive = processPrimitive,
): RecordedProcessLiveness {
  const answer = (
    alive: boolean,
    reason: LivenessReason,
    observedStartTimeMs: number | null,
  ): RecordedProcessLiveness =>
    Object.freeze({
      alive,
      reason,
      observedStartTimeMs,
      mayRefuseAClaimOfCompletion: true as const,
      mayMakeAClaimOfCompletion: false as const,
    });

  // An id that is not a single process is not asked about at all, and above
  // all is never signalled: `0`, a negative number and `1` are refused here
  // before any call reaches the platform (the owner's ruling of 2026-10-02).
  if (!isAskableProcessId(recorded.pid)) return answer(false, "not-a-process", null);

  // A process that exited and was not collected still answers a signal of
  // zero, so its state is read before the platform is asked.
  if (hasExitedWithoutBeingCollected(recorded.pid, io)) {
    return answer(false, "exited-not-collected", null);
  }

  const reachable = io.signalZero(recorded.pid);
  if (reachable === "gone") return answer(false, "gone", null);
  if (reachable === "permission-refused") {
    // It is there. The start time cannot be read either, which is exactly the
    // case the requirement calls alive.
    return answer(true, "permission-refused", null);
  }

  const observed = startTimeOfProcess(recorded.pid, primitive);
  const recordedStart = recorded.startTimeMs ?? null;
  if (recordedStart === null || observed === null) {
    // Reuse of the id cannot be told apart: alive (F122-FR-042).
    return answer(true, "pid-reuse-cannot-be-told", observed);
  }
  if (Math.abs(observed - recordedStart) <= START_TIME_TOLERANCE_MS) {
    return answer(true, "identity-matches", observed);
  }
  // The platform CAN tell, and it says this id belongs to another process now.
  return answer(false, "pid-reused", observed);
}

/** The state letter of a process that exited and was not yet collected. */
export const ZOMBIE_STATE = "Z" as const;

/**
 * Whether a process has exited and was not yet collected by its parent. Linux:
 * the state field of `/proc/<pid>/stat`. macOS: the state column of `ps`,
 * `unverified`.
 *
 * The state is read through the process table of the kernel, which both
 * platforms share, so the two branches are the kernel's and not repeated here.
 */
export function hasExitedWithoutBeingCollected(pid: number, io: PlatformIo = platformIo): boolean {
  if (!isAskableProcessId(pid)) return false;
  return kernelStateOf(pid, io) === ZOMBIE_STATE;
}

/* ------------------------------------------------------------------ *
 * The whole set of readers, as one value a composition root hands on.
 * ------------------------------------------------------------------ */

/** Every reading of the platform this feature needs, bound to one seam. */
export type PlatformReaders = {
  startTimeOfProcess(pid: number): number | null;
  bootIdentity(): string | null;
  hostName(): string | null;
  pidNamespaceOf(pid: number): string | null;
  pidNamespaceOfThisProcess(): string | null;
  environmentOf(pid: number): Readonly<Record<string, string>> | null;
  processesOfTheUser(): readonly ProcessOfTheUser[];
  findProcessesByRunToken(runToken: string): readonly number[];
  recordedProcessLives(recorded: RecordedProcess): RecordedProcessLiveness;
};

/** Bind every reader to one seam and one primitive. */
export function createPlatformReaders(
  io: PlatformIo = platformIo,
  primitive: ProcessPrimitive = processPrimitive,
): PlatformReaders {
  return Object.freeze({
    startTimeOfProcess: (pid: number) => startTimeOfProcess(pid, primitive),
    bootIdentity: () => bootIdentity(io),
    hostName: () => hostNameOfTheMachine(io),
    pidNamespaceOf: (pid: number) => pidNamespaceOf(pid, io),
    pidNamespaceOfThisProcess: () => pidNamespaceOfThisProcess(io),
    environmentOf: (pid: number) => environmentOfAProcessOfTheSameUser(pid, io),
    processesOfTheUser: () => processesOfTheUser(io),
    findProcessesByRunToken: (runToken: string) => findProcessesByRunToken(runToken, primitive),
    recordedProcessLives: (recorded: RecordedProcess) =>
      recordedProcessLives(recorded, io, primitive),
  });
}

export type { ProcessOfTheUser };
