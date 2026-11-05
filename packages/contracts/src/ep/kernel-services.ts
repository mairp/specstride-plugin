/**
 * T222 — the interface types of the kernel services the core receives, and of
 * the calls of the engine into learning (annex A, §A.3 and §A.4;
 * F100-FR-234, F100-FR-235).
 *
 * A core package — the engine with the pass loop, and every loop-layer package
 * — imports the `contracts` package and the kernel package and nothing else of
 * the product. It starts no process, opens no connection and imports no
 * file-system module of the platform. What it may not import, the kernel offers
 * it as services, and the composition root hands those services to it as
 * arguments (F100-FR-234):
 *
 *  - a process primitive: start a process in a group and a session of its own
 *    with standard input closed; start such a process detached with a status
 *    record; signal a group polite, terminate, kill; read the start time of a
 *    process; search the process table for a run token; wait for an end;
 *  - a clock;
 *  - the registration call of the doctor's checks (annex G, §G.7; T153);
 *  - the atomic write (T023).
 *
 * An edge package may touch the file system or start a process on behalf of a
 * core package, behind an interface of this package: in Wave 1 one for the
 * integrity of checks (owner 116), one for the tree store (owner 143) and one
 * for the check runner (owner 148). A core package reaches an edge package
 * through its interface here and never by importing it.
 *
 * The calls of the engine into learning (F100-FR-235) are a plain function
 * interface of this package at layer L2, which the composition root hands to
 * the engine. It is no extension point in Wave 1. A failure of a call leaves
 * the run on the value it would have had without learning, and never undoes an
 * approval.
 */
import type { DoctorCheck } from "./doctor.ts";

/** The sections of annex A that own these interfaces. */
export const ANNEX_SECTIONS = ["annex A, §A.3", "annex A, §A.4"] as const;

/** The requirements this module carries. */
export const REQUIREMENTS = ["F100-FR-234", "F100-FR-235"] as const;

/** The layer at which the interfaces live (F100-FR-235). */
export const LAYER = "L2" as const;

/** They are no extension point in Wave 1 (F100-FR-235). */
export const IS_AN_EXTENSION_POINT_IN_WAVE_1 = false as const;

/** The core receives every service as an argument from the composition root. */
export const SERVICES_ARE_RECEIVED_AS_ARGUMENTS = true as const;
export const HANDED_BY = "the composition root" as const;

/* ------------------------------------------------------------------ *
 * F100-FR-234 — the process primitive.
 * ------------------------------------------------------------------ */

/** The operations of the process primitive (F100-FR-234), in the order of §A.3. */
export const PROCESS_OPERATIONS = [
  "start",
  "startDetached",
  "signalGroup",
  "startTimeOf",
  "findByRunToken",
  "waitForEnd",
] as const;
export type ProcessOperation = (typeof PROCESS_OPERATIONS)[number];

/** The three signals a group may be sent, from polite to final (F100-FR-234). */
export const GROUP_SIGNALS = ["polite", "terminate", "kill"] as const;
export type GroupSignal = (typeof GROUP_SIGNALS)[number];

/** What a caller gives to start a process (F100-FR-234). */
export type StartProcessInput = {
  /** A fixed argument list; no shell is used. */
  readonly argv: readonly string[];
  readonly cwd: string;
  /** The environment, as an allow-list the caller built. */
  readonly env: Readonly<Record<string, string>>;
  /** Where standard output goes; the caller names a file or nothing. */
  readonly stdoutFile?: string | undefined;
  /** Where standard error goes; the caller names a file or nothing. */
  readonly stderrFile?: string | undefined;
};

/**
 * F100-FR-234 — every process starts in a group and a session of its own, with
 * standard input closed. These are properties of the primitive, not options of
 * a call: a caller cannot ask for anything else.
 */
export const STARTS_IN_A_GROUP_OF_ITS_OWN = true as const;
export const STARTS_IN_A_SESSION_OF_ITS_OWN = true as const;
export const STANDARD_INPUT_IS_CLOSED = true as const;
export const NO_SHELL_IS_USED = true as const;

/** A process the primitive started. */
export type StartedProcess = {
  readonly pid: number;
  /** The process group, which `signalGroup` takes. */
  readonly pgid: number;
  /** When the process started, from the clock of the kernel. */
  readonly startedAtMs: number;
};

/**
 * F100-FR-234 — what `startDetached` writes. The kernel starts a waiter of its
 * own in the new session, with no shell; the waiter starts the command, waits
 * for its end and writes this record atomically to a file the caller names, so
 * that the record exists when the process that started it has ended. The
 * baseline does the same with a wrapper (B-1127, B-1070).
 */
export type DetachedStatusRecord = {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly durationMs: number;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
};

/** The as-is items the detached start reproduces. */
export const DETACHED_BASELINE_ITEMS = ["B-1127", "B-1070"] as const;

/** The fields of the status record, so that a reader can check it is complete. */
export const DETACHED_STATUS_FIELDS = [
  "exitCode",
  "signal",
  "durationMs",
  "startedAtMs",
  "endedAtMs",
] as const;

/**
 * F100-FR-234 — the kernel starts a waiter of its own in the new session, with
 * no shell, so that the record exists when the process that started it has
 * ended.
 */
export const DETACHED_HAS_A_WAITER_IN_THE_NEW_SESSION = true as const;
export const RECORD_EXISTS_WHEN_THE_STARTER_HAS_ENDED = true as const;

/** What a caller gives to start a detached process (F100-FR-234). */
export type StartDetachedInput = StartProcessInput & {
  /** The file the waiter writes the status record to, atomically. */
  readonly statusFile: string;
};

/** How a process ended, as `waitForEnd` reports it. */
export type ProcessEnd = {
  readonly exitCode: number | null;
  readonly signal: string | null;
};

/** The process primitive of the kernel (F100-FR-234). */
export type ProcessPrimitive = {
  /** Start a process in a group and a session of its own, stdin closed. */
  start(input: StartProcessInput): Promise<StartedProcess>;
  /** Start such a process detached; the waiter writes the status record. */
  startDetached(input: StartDetachedInput): Promise<StartedProcess>;
  /** Signal a process group: polite, terminate, kill. */
  signalGroup(pgid: number, signal: GroupSignal): void;
  /** The start time of a process, or `null` where it is gone. */
  startTimeOf(pid: number): number | null;
  /** Search the process table for a run token; the pids that carry it. */
  findByRunToken(runToken: string): readonly number[];
  /** Wait for a process to end. */
  waitForEnd(pid: number): Promise<ProcessEnd>;
};

/* ------------------------------------------------------------------ *
 * F100-FR-234 — the clock.
 * ------------------------------------------------------------------ */

/**
 * The clock of the kernel. A core package reads no clock of the platform: the
 * table evaluator of the kernel is pure for the same reason (annex X, §X.3).
 */
export type Clock = {
  /** Milliseconds since the epoch. */
  nowMs(): number;
  /** The same instant as a timestamp of the event envelope (annex X, §X.1). */
  nowIso(): string;
  /** A monotonic reading, for a duration that a clock change must not move. */
  monotonicMs(): number;
};

/* ------------------------------------------------------------------ *
 * F100-FR-234 — the registration call of the doctor's checks.
 * ------------------------------------------------------------------ */

/**
 * The registration call of the doctor's checks (annex G, §G.7; T153 states the
 * shape of a check and that the call lives in the kernel package). A package
 * registers its checks at load; the doctor reads the registry.
 */
export type DoctorRegistration = {
  register(check: DoctorCheck): void;
  registered(): readonly DoctorCheck[];
};

/** Where the registration call lives (§G.7, Wave 1; T153). */
export const DOCTOR_REGISTRATION_LIVES_IN = "@specstride/kernel" as const;

/* ------------------------------------------------------------------ *
 * F100-FR-234 — the atomic write.
 * ------------------------------------------------------------------ */

/**
 * The atomic write of the kernel (annex B, §B.2, SL-2; T023): a temporary name
 * in the same directory, fsync, rename into place. A core package writes every
 * file through this service and imports no file-system module.
 */
export type AtomicWrite = {
  write(path: string, content: string | Uint8Array): void;
  /** Read a file the runtime wrote; a core package has no reader of its own. */
  read(path: string): string;
  /** True when the file exists. */
  exists(path: string): boolean;
};

/* ------------------------------------------------------------------ *
 * The whole of what the composition root hands a core package.
 * ------------------------------------------------------------------ */

/** The kernel services a core package receives as arguments (F100-FR-234). */
export type KernelServices = {
  readonly process: ProcessPrimitive;
  readonly clock: Clock;
  readonly doctor: DoctorRegistration;
  readonly atomicWrite: AtomicWrite;
};

/** The names of the four services, for a check over a composition root. */
export const KERNEL_SERVICES = ["process", "clock", "doctor", "atomicWrite"] as const;
export type KernelServiceName = (typeof KERNEL_SERVICES)[number];

/* ------------------------------------------------------------------ *
 * F100-FR-234 — the three edge packages, reached through their interface.
 * ------------------------------------------------------------------ */

/**
 * The three edge packages of Wave 1, with the owner of each. An edge package
 * may touch the file system or start a process on behalf of a core package,
 * behind an interface of this package. A core package reaches one through its
 * interface and never by importing it.
 */
export const EDGE_PACKAGES = Object.freeze([
  Object.freeze({
    name: "@specstride/integrity",
    purpose: "the integrity of checks",
    owner: "116",
  }),
  Object.freeze({ name: "@specstride/tree-store", purpose: "the tree store", owner: "143" }),
  Object.freeze({ name: "@specstride/check-runner", purpose: "the check runner", owner: "148" }),
]);

/** Three edge packages in Wave 1, no fourth (F100-FR-234). */
export const EDGE_PACKAGE_COUNT = 3 as const;

/** The owners of the three edge packages, in the order of §A.3. */
export const EDGE_PACKAGE_OWNERS = ["116", "143", "148"] as const;

/** F100-FR-234 — a core package never imports an edge package. */
export const A_CORE_PACKAGE_IMPORTS_AN_EDGE_PACKAGE = false as const;
export const A_CORE_PACKAGE_REACHES_AN_EDGE_PACKAGE_THROUGH =
  "its interface in the `contracts` package" as const;

/** F100-FR-234 — what an edge package may do that a core package may not. */
export const AN_EDGE_PACKAGE_MAY = ["touch the file system", "start a process"] as const;

/** F100-FR-012, F100-FR-234 — the modules a core package never imports. */
export const FORBIDDEN_TO_A_CORE_PACKAGE = [
  "node:fs",
  "node:fs/promises",
  "node:child_process",
  "node:net",
  "node:http",
  "node:https",
  "node:dgram",
] as const;

/* ------------------------------------------------------------------ *
 * F100-FR-235 — the calls of the engine into learning.
 * ------------------------------------------------------------------ */

/**
 * The operations of the learning interface (F100-FR-235). Five operations, of
 * which the tamper bracket is two: `resolve`, `observe`, `evaluate`, `report`,
 * and `bracketTake` with `bracketCheck`.
 */
export const LEARNING_OPERATIONS = [
  "resolve",
  "observe",
  "evaluate",
  "report",
  "bracketTake",
  "bracketCheck",
] as const;
export type LearningOperation = (typeof LEARNING_OPERATIONS)[number];

/** Five operations, of which the bracket is two (F100-FR-235). */
export const LEARNING_OPERATION_COUNT = 5 as const;
export const BRACKET_IS_TWO_OPERATIONS = ["bracketTake", "bracketCheck"] as const;

/** What `resolve` returns: a value and its arm, for a knob and a phase. */
export type ResolvedKnob = {
  /** The value the run uses for the knob. */
  readonly value: unknown;
  /** Which arm the run is on: `applied` or `baseline` (row 189 of §X.6). */
  readonly arm: string;
  /** The decision the value came from, where it came from one. */
  readonly decisionId?: string | undefined;
};

/** What `report` returns: the last recorded evaluation of an active decision. */
export type ReportedDecision = {
  readonly decisionId: string;
  readonly knob: string;
  /** The label of the last recorded evaluation (row 190 of §X.6). */
  readonly label: string;
  readonly arm: string;
};

/** One file of the tamper bracket, by logical name (F100-FR-228). */
export type BracketFile = {
  readonly logicalName: string;
  readonly path: string;
};

/** What `bracketTake` returns, and `bracketCheck` takes back. */
export type BracketMark = {
  readonly files: readonly BracketFile[];
  /** The size and the hash of the leading bytes of each file. */
  readonly marks: readonly {
    readonly path: string;
    readonly size: number | null;
    readonly hash: string | null;
  }[];
};

/** What `bracketCheck` reports (F100-FR-228). */
export type BracketReport = {
  readonly unchanged: boolean;
  /** The logical name of each file that shrank or whose leading bytes changed. */
  readonly changed: readonly string[];
  /** A changed file leaves the run out of every baseline and every evaluation. */
  readonly runIsLeftOut: boolean;
};

/**
 * F100-FR-235 — the plain function interface of the `contracts` package at
 * layer L2 through which the engine calls learning. The composition root hands
 * it to the engine; it is no extension point in Wave 1.
 */
export type Learning = {
  /** A value and its arm for a knob and a phase, at the start of a pass. */
  resolve(knob: string, phase: number): Promise<ResolvedKnob>;
  /** An approved phase. */
  observe(phase: number): Promise<void>;
  /** The applied decisions of an approved phase. */
  evaluate(phase: number): Promise<void>;
  /** The last recorded evaluation of every active decision, read-only. */
  report(): Promise<readonly ReportedDecision[]>;
  /** The tamper bracket, before a proposer pass (F100-FR-228). */
  bracketTake(files: readonly BracketFile[]): Promise<BracketMark>;
  /** The tamper bracket, after a proposer pass (F100-FR-228). */
  bracketCheck(mark: BracketMark): Promise<BracketReport>;
};

/** `report` is read-only: it writes nothing (F100-FR-235). */
export const REPORT_IS_READ_ONLY = true as const;

/** What `report` is for: the lines printed at exit (F100-FR-235). */
export const REPORT_IS_FOR = "the lines printed at exit" as const;

/**
 * F100-FR-235 — a failure of a call leaves the run on the value it would have
 * had without learning, and never undoes an approval.
 */
export const A_FAILURE_LEAVES_THE_RUN_ON_THE_VALUE_WITHOUT_LEARNING = true as const;
export const A_FAILURE_UNDOES_AN_APPROVAL = false as const;

/** The arm a run is on when learning did not answer (F100-FR-235). */
export const ARM_WITHOUT_LEARNING = "baseline" as const;

/**
 * F100-FR-235 — call `resolve` and fall back to the value the run would have
 * had without learning. A failure is not an error of the run: the value stands
 * and the arm is `baseline`.
 */
export async function resolveOrWithoutLearning(
  learning: Pick<Learning, "resolve">,
  knob: string,
  phase: number,
  valueWithoutLearning: unknown,
): Promise<ResolvedKnob> {
  try {
    return await learning.resolve(knob, phase);
  } catch {
    return Object.freeze({ value: valueWithoutLearning, arm: ARM_WITHOUT_LEARNING });
  }
}

/**
 * F100-FR-235 — call `observe` or `evaluate` and swallow a failure: neither may
 * undo an approval, so a failure of either leaves the approval as it is.
 */
export async function observeOrLeaveTheApproval(
  learning: Pick<Learning, "observe">,
  phase: number,
): Promise<{ readonly called: boolean; readonly approvalUndone: false }> {
  try {
    await learning.observe(phase);
    return Object.freeze({ called: true, approvalUndone: false as const });
  } catch {
    return Object.freeze({ called: false, approvalUndone: false as const });
  }
}

/** F100-FR-235 — the same for `evaluate`. */
export async function evaluateOrLeaveTheApproval(
  learning: Pick<Learning, "evaluate">,
  phase: number,
): Promise<{ readonly called: boolean; readonly approvalUndone: false }> {
  try {
    await learning.evaluate(phase);
    return Object.freeze({ called: true, approvalUndone: false as const });
  } catch {
    return Object.freeze({ called: false, approvalUndone: false as const });
  }
}
