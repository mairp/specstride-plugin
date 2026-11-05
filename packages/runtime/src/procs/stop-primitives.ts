/**
 * T055 — the stop primitives of Lisa, extracted (F122-FR-025).
 *
 * STEP 1 OF TWO: this is the EXTRACTION. The source is
 * `<lisa>` at `363e6a3`, `packages/scheduler/src/stop.ts` and
 * `packages/scheduler/src/stop-now.ts` (STAGE-B-RULES.md, "Source
 * repositories"; ruling 13). The behaviour is carried over unchanged so that
 * the characterization tests of T049 can be written against it BEFORE it is
 * changed:
 *
 *   - the stop request is written atomically (temporary file, fsync, rename)
 *     and removed after a clean halt (`StopController`, Lisa `stop.ts`);
 *   - the in-flight pass is recorded in one file and read back from it
 *     (`PassRegistry`, Lisa `stop-now.ts`);
 *   - a forced stop writes the request FIRST and only then signals, so that a
 *     pass which exits on its own is still halted at its next boundary;
 *   - the children of a process are found by walking the process table;
 *   - nothing of the durable state of the run is touched, so the run stays
 *     resumable.
 *
 * What is deliberately NOT carried over is Lisa's naming: `.lisa/stop.flag`
 * and `.lisa/proposer.pid` are names of the baseline product. The names here
 * come from this product, and the shape of the file — one atomic write, one
 * read, one removal — is the baseline's.
 *
 * STEP 2 adds the identity check, the walk of children on macOS and the
 * signal through `signalGroup` of the kernel primitive. It is below, under
 * "Step 2", and the step-1 behaviour above is left intact so that the
 * characterization tests keep passing over it.
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { platformIo, recordedProcessLives, type PlatformIo } from "./platform.ts";
import {
  IDENTITY_MISMATCH,
  kernelSignaller,
  signalUnderTheIdentityCheck,
  type IdentityDependencies,
  type IdentityResult,
  type MismatchRecord,
  type Signaller,
} from "./identity.ts";
import type { ProcessRegistry } from "@specstride/contracts/records/process-registry";

/** Where the primitives were extracted from (STAGE-B-RULES.md). */
export const EXTRACTED_FROM = Object.freeze({
  repository: "<lisa>",
  commit: "363e6a3",
  files: Object.freeze(["packages/scheduler/src/stop.ts", "packages/scheduler/src/stop-now.ts"]),
});

/** The requirement the extraction is brought under. */
export const STOP_PRIMITIVE_REQUIREMENTS = ["F122-FR-025"] as const;

/* ================================================================== *
 * Step 1 — the extraction, carried over unchanged in behaviour.
 * ================================================================== */

/** The name of the stop request inside the control root of a workspace. */
export const STOP_REQUEST_NAME = "stop.request" as const;

/** The name of the file the in-flight pass is recorded in. */
export const IN_FLIGHT_NAME = "in-flight.json" as const;

/** How forcefully a stop was asked for (Lisa `StopMode`). */
export const STOP_MODES = ["clean", "now"] as const;
export type StopMode = (typeof STOP_MODES)[number];

/** The parsed contents of a stop request; an empty request is still valid. */
export type StopRequest = {
  readonly mode: StopMode;
  readonly requestedAt?: string;
  readonly by?: string;
  /** F122-FR-028 — only this field ends a process of class `adoptable`. */
  readonly jobs?: boolean;
};

/**
 * The durable stop request of one workspace (Lisa's `StopController`).
 *
 * `request()` writes it atomically so a reader at a boundary never sees a
 * half-written file; `isRequested()` is the bare existence gate the loop keys
 * on; `consume()` removes it after a CLEAN halt so a later resume continues
 * rather than stopping again at once.
 */
export class StopController {
  readonly stateDir: string;
  readonly stopRequestPath: string;

  constructor(stateDir: string) {
    this.stateDir = stateDir;
    this.stopRequestPath = join(stateDir, STOP_REQUEST_NAME);
  }

  /** Write the request. Atomic: a temporary file, fsync, then a rename. */
  request(options: { mode?: StopMode; by?: string; at?: string; jobs?: boolean } = {}): string {
    mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
    const body = `${JSON.stringify({
      mode: options.mode ?? "clean",
      ...(options.at === undefined ? {} : { requestedAt: options.at }),
      ...(options.by === undefined ? {} : { by: options.by }),
      ...(options.jobs === undefined ? {} : { jobs: options.jobs }),
    } satisfies StopRequest)}\n`;
    const temporary = `${this.stopRequestPath}.tmp`;
    const fd = openSync(temporary, "w", 0o600);
    try {
      writeSync(fd, body);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, this.stopRequestPath);
    return this.stopRequestPath;
  }

  /** The bare existence gate a loop checks at each boundary. */
  isRequested(): boolean {
    return existsSync(this.stopRequestPath);
  }

  /** The recorded request, or `undefined` where none was written. */
  read(): StopRequest | undefined {
    let text: string;
    try {
      text = readFileSync(this.stopRequestPath, "utf8").trim();
    } catch {
      return undefined;
    }
    // An empty request is a clean stop with every default (F100-FR-065).
    if (text === "") return { mode: "clean" };
    try {
      const raw = JSON.parse(text) as Partial<StopRequest>;
      return Object.freeze({
        mode: raw.mode === "now" ? "now" : "clean",
        ...(raw.requestedAt === undefined ? {} : { requestedAt: raw.requestedAt }),
        ...(raw.by === undefined ? {} : { by: raw.by }),
        ...(raw.jobs === undefined ? {} : { jobs: raw.jobs === true }),
      });
    } catch {
      // An unreadable request still means "stop": the safe reading.
      return { mode: "clean" };
    }
  }

  /** True where the stop was asked for with `--now`. */
  isForceful(): boolean {
    return this.read()?.mode === "now";
  }

  /** F122-FR-028 — true only where the request carries the field `jobs`. */
  endsAdoptableJobs(): boolean {
    return this.read()?.jobs === true;
  }

  /** Remove the request after a CLEAN halt. True where one was there. */
  consume(): boolean {
    try {
      statSync(this.stopRequestPath);
    } catch {
      return false;
    }
    try {
      unlinkSync(this.stopRequestPath);
      return true;
    } catch {
      return false;
    }
  }
}

/** What the in-flight record holds: the pid AND the group it leads. */
export type InFlightPass = {
  readonly pid: number;
  readonly processGroup: number;
  readonly procId?: string;
};

/**
 * The in-flight pass registry (Lisa's `PassRegistry`). Lisa recorded a bare
 * pid; this records the GROUP beside it, because the signal of step 2 goes to
 * a group and a group that was never recorded cannot be signalled.
 */
export class InFlightRegistry {
  readonly stateDir: string;
  readonly recordPath: string;

  constructor(stateDir: string) {
    this.stateDir = stateDir;
    this.recordPath = join(stateDir, IN_FLIGHT_NAME);
  }

  /** Record the in-flight pass. Atomic, as the baseline's was. */
  record(pass: InFlightPass): void {
    mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
    const temporary = `${this.recordPath}.tmp`;
    const fd = openSync(temporary, "w", 0o600);
    try {
      writeSync(fd, `${JSON.stringify(pass)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, this.recordPath);
  }

  /** Clear the record; a missing file is not an error. */
  clear(): void {
    try {
      unlinkSync(this.recordPath);
    } catch {
      /* already gone — the common case */
    }
  }

  /** The recorded pass, or `undefined` where none is in flight. */
  read(): InFlightPass | undefined {
    let text: string;
    try {
      text = readFileSync(this.recordPath, "utf8").trim();
    } catch {
      return undefined;
    }
    try {
      const raw = JSON.parse(text) as Partial<InFlightPass>;
      if (!Number.isInteger(raw.pid) || (raw.pid as number) <= 1) return undefined;
      const pid = raw.pid as number;
      const group = Number.isInteger(raw.processGroup) ? (raw.processGroup as number) : pid;
      return Object.freeze({
        pid,
        processGroup: group,
        ...(typeof raw.procId === "string" ? { procId: raw.procId } : {}),
      });
    } catch {
      return undefined;
    }
  }

  /** Whether a pass is recorded as in flight. */
  hasInFlight(): boolean {
    return this.read() !== undefined;
  }
}

/**
 * The durable state a stop never touches, so that the run stays resumable
 * (Lisa `stop-now.ts`: *no evidence, no marker, and no archived attempt is
 * ever touched — killing a pass can only ever LOSE un-written work*).
 */
export const A_STOP_NEVER_TOUCHES = Object.freeze([
  "gate evidence",
  "gate approval markers",
  "the event file",
  "archived attempts",
]);

/* ------------------------------------------------------------------ *
 * Step 1 — finding children, and the forced stop.
 * ------------------------------------------------------------------ */

/**
 * The direct children of a process (Lisa's `procChildren`). The baseline
 * scanned `/proc/<child>/stat` for a matching parent id, needing neither
 * `pgrep` nor a shell, and returned `[]` on any read error. The same walk,
 * through the process-table seam of T010 so that a test can hand it a
 * recorded platform and so that step 2 can add the macOS branch beside it.
 *
 * The parent id is field 4 of `stat`, read AFTER the last `)`: the command
 * name may itself hold a space or a bracket.
 */
export function childrenOnLinux(pid: number, io: PlatformIo = platformIo): readonly number[] {
  const out: number[] = [];
  const entries = io.readDirectory(io.procRoot);
  if (entries === null) return Object.freeze(out);
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    const child = Number.parseInt(name, 10);
    if (child === pid) continue;
    const stat = io.readFile(`${io.procRoot}/${name}/stat`);
    if (stat === null) continue;
    const rparen = stat.lastIndexOf(")");
    if (rparen < 0) continue;
    const rest = stat.slice(rparen + 2).split(" ");
    const ppid = Number.parseInt(rest[1] ?? "", 10);
    if (ppid === pid) out.push(child);
  }
  return Object.freeze(out.sort((a, b) => a - b));
}

/** The whole descendant tree of a process, children before parents. */
export function descendantsOf(
  pid: number,
  children: (of: number) => readonly number[],
): readonly number[] {
  const found: number[] = [];
  const seen = new Set<number>([pid]);
  const walk = (one: number): void => {
    for (const kid of children(one)) {
      if (seen.has(kid)) continue;
      seen.add(kid);
      walk(kid);
      found.push(kid);
    }
  };
  walk(pid);
  return Object.freeze(found);
}

/** What a forced stop did. */
export type StopNowResult = {
  /** The request that was written FIRST, always. */
  readonly stopRequestPath: string;
  /** The in-flight pass that was targeted, where one was recorded. */
  readonly target: InFlightPass | null;
  /** The group that was signalled, where one was. */
  readonly signalledGroup: number | null;
  /** How many signals left this process. */
  readonly signalsSent: number;
  /** True where a pass was recorded and its process was already gone. */
  readonly staleRecord: boolean;
  /** The children of the target that the walk found. */
  readonly children: readonly number[];
};

/** What a forced stop reaches the machine through. */
export type StopNowDependencies = {
  readonly io?: PlatformIo;
  readonly signaller?: Signaller;
  readonly children?: (pid: number) => readonly number[];
};

/**
 * A forced stop (Lisa's `stopNow`): write the durable request FIRST — so that
 * even a pass which exits on its own before the signal lands is still halted
 * at its next boundary — and only then signal the RECORDED GROUP.
 *
 * The baseline walked the tree and sent `SIGTERM` to each pid in turn. Here
 * the signal goes to the recorded process group, which the runtime created
 * and which reaches the leader and every child of it at once; the walk is
 * kept because the result reports what the stop was aimed at.
 */
export function stopNow(
  stateDir: string,
  options: { by?: string; at?: string; jobs?: boolean } & StopNowDependencies = {},
): StopNowResult {
  const io = options.io ?? platformIo;
  const stop = new StopController(stateDir);
  const stopRequestPath = stop.request({
    mode: "now",
    ...(options.by === undefined ? {} : { by: options.by }),
    ...(options.at === undefined ? {} : { at: options.at }),
    ...(options.jobs === undefined ? {} : { jobs: options.jobs }),
  });

  const target = new InFlightRegistry(stateDir).read() ?? null;
  if (target === null) {
    return Object.freeze({
      stopRequestPath,
      target: null,
      signalledGroup: null,
      signalsSent: 0,
      staleRecord: false,
      children: Object.freeze([]),
    });
  }
  const childrenOf = options.children ?? ((pid: number) => childrenOnLinux(pid, io));
  const children = descendantsOf(target.pid, childrenOf);

  // Liveness WITHOUT a signal: `recordedProcessLives` asks the platform
  // whether a signal would be delivered and delivers none.
  const alive = recordedProcessLives({ pid: target.pid }, io).alive;
  if (!alive) {
    return Object.freeze({
      stopRequestPath,
      target,
      signalledGroup: null,
      signalsSent: 0,
      staleRecord: true,
      children,
    });
  }
  const signaller = options.signaller ?? kernelSignaller;
  signaller(target.processGroup, "terminate");
  return Object.freeze({
    stopRequestPath,
    target,
    signalledGroup: target.processGroup,
    signalsSent: 1,
    staleRecord: false,
    children,
  });
}

/* ================================================================== *
 * Step 2 — under the identity check, with the macOS walk, through the
 * kernel's `signalGroup` (T055, T075).
 * ================================================================== */

/**
 * F122-FR-025 — *the stop primitives extracted from Lisa MUST be brought
 * under this rule and MUST find child processes on Linux and on macOS alike*.
 *
 * The walk of children on macOS. There is no process file system, so the
 * parent id comes from `ps -A -o pid=,ppid=`, which lists every process of the
 * machine with its parent. Marked `unverified`: no macOS machine exists in
 * this lane, so no statement here was measured (research D-6, D-8).
 */
export const MACOS_CHILD_WALK_VERIFICATION = "unverified" as const;
export const MACOS_CHILD_WALK_REASON: string =
  "no macOS machine exists in this lane, so the walk of children on macOS was not measured " +
  "(research D-6, D-8; the owner's out-of-band ruling of 2026-09-30)";

/** The arguments `ps` is given on macOS to list every process with its parent. */
export const MACOS_PS_ARGUMENTS: readonly string[] = Object.freeze(["-A", "-o", "pid=,ppid="]);

/** The direct children of a process on macOS, from `ps`. `unverified`. */
export function childrenOnMacos(pid: number, io: PlatformIo = platformIo): readonly number[] {
  const out: number[] = [];
  const text = io.runPs(MACOS_PS_ARGUMENTS);
  if (text === null) return Object.freeze(out);
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const child = Number.parseInt(parts[0] ?? "", 10);
    const parent = Number.parseInt(parts[1] ?? "", 10);
    if (!Number.isInteger(child) || !Number.isInteger(parent)) continue;
    if (child === pid) continue;
    if (parent === pid) out.push(child);
  }
  return Object.freeze(out.sort((a, b) => a - b));
}

/**
 * The children of a process, on Linux and on macOS alike. The branch is taken
 * from the seam's own `platform`, so a recorded macOS platform exercises the
 * macOS walk on this machine (T011's way of testing a branch it cannot run).
 */
export function childrenOf(pid: number, io: PlatformIo = platformIo): readonly number[] {
  return io.platform === "darwin" ? childrenOnMacos(pid, io) : childrenOnLinux(pid, io);
}

/** What a forced stop under the identity check did. */
export type GuardedStopResult = StopNowResult & {
  /** The entry the stop was aimed at, where the caller named one. */
  readonly procId: string | null;
  /** The identity check, where one was made. */
  readonly identity: IdentityResult | null;
  /** F122-FR-025 — the recorded mismatch, where the identity did not match. */
  readonly mismatch: MismatchRecord | null;
  /** The end cause the entry is to be closed with, where there is one. */
  readonly endCause: string | null;
};

/**
 * F122-FR-025 — the forced stop, under the identity check.
 *
 * The extraction above signals the group it was told to. This does not: the
 * group comes from the REGISTRY ENTRY, and the entry has to pass the identity
 * check first — the process id, the start time the operating system reports
 * and the run token the process holds must all match. On a mismatch nothing is
 * signalled, the mismatch is recorded, and the entry is to be closed with
 * `identity-mismatch`.
 *
 * The request is still written FIRST, exactly as the baseline wrote it: a pass
 * that exits on its own between the write and the check is still halted at its
 * next boundary.
 *
 * The signal itself goes through `signalGroup` of the kernel primitive (T075),
 * which refuses the group ids 0, 1 and every negative number before anything
 * leaves this process.
 */
export function stopNowUnderTheIdentityCheck(
  stateDir: string,
  entry: ProcessRegistry | null,
  options: {
    by?: string;
    at?: string;
    jobs?: boolean;
    signaller?: Signaller;
    io?: PlatformIo;
    children?: (pid: number) => readonly number[];
  } & IdentityDependencies = {},
): GuardedStopResult {
  const io = options.io ?? platformIo;
  const stop = new StopController(stateDir);
  const stopRequestPath = stop.request({
    mode: "now",
    ...(options.by === undefined ? {} : { by: options.by }),
    ...(options.at === undefined ? {} : { at: options.at }),
    ...(options.jobs === undefined ? {} : { jobs: options.jobs }),
  });
  const base = {
    stopRequestPath,
    target: null,
    signalledGroup: null,
    signalsSent: 0,
    staleRecord: false,
    children: Object.freeze([] as number[]),
    procId: null,
    identity: null,
    mismatch: null,
    endCause: null,
  } satisfies GuardedStopResult;
  if (entry === null) return Object.freeze(base);

  const childrenWalk = options.children ?? ((pid: number) => childrenOf(pid, io));
  const children = descendantsOf(entry.pid, childrenWalk);
  const guarded = signalUnderTheIdentityCheck(entry, "terminate", { ...options, io });
  if (guarded.outcome === IDENTITY_MISMATCH) {
    return Object.freeze({
      ...base,
      target: Object.freeze({
        pid: entry.pid,
        processGroup: entry.processGroup,
        procId: entry.procId,
      }),
      children,
      procId: entry.procId,
      identity: guarded.identity,
      mismatch: guarded.record,
      endCause: IDENTITY_MISMATCH,
    });
  }
  return Object.freeze({
    ...base,
    target: Object.freeze({
      pid: entry.pid,
      processGroup: entry.processGroup,
      procId: entry.procId,
    }),
    signalledGroup: guarded.processGroup,
    signalsSent: guarded.signalsSent,
    children,
    procId: entry.procId,
    identity: guarded.identity,
    endCause: "signalled",
  });
}
