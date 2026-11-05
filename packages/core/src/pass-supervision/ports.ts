/**
 * T005 of feature 118 — the ports of pass supervision
 * (`specs/118-pass-supervision-and-jobs/plan.md`, "Project Structure";
 * F118-FR-002, F118-FR-031, F118-FR-044).
 *
 * Every system access the supervision module uses is injected through one of
 * these interfaces. The core imports neither `node:fs` nor `node:fs/promises`
 * nor `node:child_process` (F100-FR-012, `contracts/data/package-graph.json`;
 * `assumption: CQ-185`): the file reader and the file writer are provided by
 * the kernel (`@specstride/kernel`: `stable-read`, `atomic-write`) through the
 * edge that builds this module, and the launcher and the signal sender are
 * provided by the process primitive of the kernel that feature 122 owns.
 *
 * F118-FR-044 — the `Ingress` port is the ONE point of redaction. No other
 * port redacts, and no code of this feature redacts by itself: text that comes
 * from outside the runtime reaches a sink or a prompt only through `Ingress`,
 * which redacts it and cuts it to a size cap (F100-FR-009, F100-FR-205).
 *
 * Every interface here is a type-level contract only: this file holds no
 * implementation, so that the decisions of the module stay pure functions over
 * fakes of these ports (the samples of the test kit, T006).
 */

/* ------------------------------------------------------------------ *
 * Clock
 * ------------------------------------------------------------------ */

/** The clock of the supervision module (tick, deadlines, elapsed time). */
export interface Clock {
  /** The current time of the run, in milliseconds since the epoch. */
  nowMs(): number;
}

/* ------------------------------------------------------------------ *
 * Process list
 * ------------------------------------------------------------------ */

/** One process of the tree of a pass, as the process list reports it. */
export interface PassProcess {
  /** The process id. */
  readonly pid: number;
  /** The process group id of the process (F118-FR-031: the tree kill). */
  readonly groupId: number;
  /** The process session id the process runs in. */
  readonly sessionId: number;
  /** When the process started, in milliseconds since the epoch (F100-FR-064). */
  readonly startedAtMs: number;
  /** The command line of the process (outside text; only through `Ingress`). */
  readonly commandLine: string;
  /** The CPU time the process has used so far, in milliseconds (F118-FR-003). */
  readonly cpuTimeMs: number;
}

/** The process list of the host, read per pass (F118-FR-002). */
export interface ProcessList {
  /**
   * The whole process tree that descends from `rootPid`, including `rootPid`
   * itself, or an empty list when the root is gone (the pass has ended).
   */
  tree(rootPid: number): readonly PassProcess[];
}

/* ------------------------------------------------------------------ *
 * File reader and file writer
 * ------------------------------------------------------------------ */

/**
 * The identity of a file at one moment: what lets a reader tell "the same
 * file, more bytes" from "another file at the same path" (the identity check
 * of the `first_failure` predicate, F118-FR-038; the adoption check of
 * F118-FR-031).
 */
export interface FileIdentity {
  /** The device the file lives on. */
  readonly device: number;
  /** The inode of the file. */
  readonly inode: number;
  /** The size of the file, in bytes, at the moment of the reading. */
  readonly sizeBytes: number;
}

/** The bytes of a file read after an offset, with the file's identity. */
export interface FileSlice {
  /** The bytes read (the whole file, or the tail after `offsetBytes`). */
  readonly bytes: Uint8Array;
  /** The offset the reading started at, in bytes. */
  readonly offsetBytes: number;
  /** The identity of the file as it stands after this reading. */
  readonly identity: FileIdentity;
  /** The modification time of the file, in milliseconds since the epoch. */
  readonly modifiedAtMs: number;
}

/** Reading of the files of the control plane and of the files a predicate reads. */
export interface FileReader {
  /**
   * The bytes of `path` from `offsetBytes` on, with the identity and the
   * modification time, or `undefined` when the file does not exist. A file
   * shorter than the offset reads as an empty tail with the identity of the
   * file as it stands.
   */
  readAfter(path: string, offsetBytes: number): FileSlice | undefined;

  /** The identity and the modification time of `path`, or `undefined`. */
  identify(
    path: string,
  ): { readonly identity: FileIdentity; readonly modifiedAtMs: number } | undefined;
}

/** The writing of the files of the control plane (F118-FR-002, data model). */
export interface FileWriter {
  /**
   * Write `bytes` to `path` atomically: a reader sees either the previous
   * content or the whole new content, never a half file.
   */
  writeAtomic(path: string, bytes: Uint8Array): void;
}

/* ------------------------------------------------------------------ *
 * Signal sender and process launcher
 * ------------------------------------------------------------------ */

/** The signals the stop ladder and the stop of a job use. */
export type SupervisionSignal = "polite" | "terminate" | "kill";

/** The target of a signal, with the identity check of the registry. */
export interface SignalTarget {
  readonly pid: number;
  /** The start time the registry holds for `pid` (F100-FR-064). */
  readonly startedAtMs: number;
  /** The hash of the run token the registry entry carries (F100-FR-064). */
  readonly runTokenHash: string;
}

/** Why a signal was not sent. */
export type SignalRefusal =
  | "no-such-process"
  | "start-time-mismatch"
  | "start-time-unobservable"
  | "run-token-mismatch"
  | "not-an-integer-above-one";

/** The sending of a signal, through the process primitive of feature 122. */
export interface SignalSender {
  /**
   * Send `signal` to `target`. Refuses a target whose recorded start time or
   * run token no longer matches the live process (F100-FR-064), a pid that is
   * not an integer above one (host-safety ruling of 2026-10-02), and a live
   * process whose start time the host cannot observe: a process the sender
   * cannot IDENTIFY is never signalled — the caller that spawned it ends it
   * through the handle it holds instead.
   */
  signal(target: SignalTarget, signal: SupervisionSignal): SignalRefusal | undefined;
}

/** How the runtime starts a detached job (F118-FR-019, mode `launch`). */
export interface LaunchRequest {
  /** The argument list, no shell, no newline and no NUL in any member. */
  readonly argv: readonly string[];
  /** The working directory of the job. */
  readonly cwd: string;
  /** Start the job in its own process session, out of the reach of a pass kill. */
  readonly ownSession: true;
  /** The containment level the runtime starts the job at. */
  readonly containment?: string | undefined;
}

/** A job the runtime launched, as the launcher reports it. */
export interface LaunchedJob {
  readonly pid: number;
  readonly groupId: number;
  readonly sessionId: number;
  readonly startedAtMs: number;
}

/** The launching of a detached job, through the process primitive of feature 122. */
export interface ProcessLauncher {
  /** Start `request` in its own process session and return its identity. */
  launch(request: LaunchRequest): LaunchedJob;
}

/* ------------------------------------------------------------------ *
 * Event writer
 * ------------------------------------------------------------------ */

/** One event in the envelope `specstride.event/1` (F118-FR-027, F118-FR-042). */
export interface SupervisionEvent {
  readonly type: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** The writing of the events of the run; best-effort (Principle V). */
export interface EventWriter {
  /**
   * Write one event to the stream of the run. Returns `false`, and never
   * throws, when the stream cannot take the event: a failure to write an event
   * never ends a pass or a wait.
   */
  write(event: SupervisionEvent): boolean;
}

/* ------------------------------------------------------------------ *
 * Registry access
 * ------------------------------------------------------------------ */

/** The identity block every entry of `run:<runId>:procs` carries. */
export interface RegistryIdentity {
  readonly pid: number;
  readonly groupId: number;
  readonly sessionId: number;
  readonly startedAtMs: number;
  readonly runTokenHash: string;
}

/** The class of an entry of the process registry (F118-FR-031). */
export type RegistryClass = "pass" | "job" | "adoptable";

/** One entry of the process registry `specstride.procs/1` (feature 100). */
export interface RegistryEntry {
  readonly logicalName: string;
  readonly identity: RegistryIdentity;
  readonly registryClass: RegistryClass;
  /** True when the entry must survive the stop of the run (adoptable jobs). */
  readonly survivesStop: boolean;
}

/** The reading and the writing of the process registry (F118-FR-031). */
export interface RegistryAccess {
  /** The entry of a logical name, or `undefined`. */
  get(logicalName: string): RegistryEntry | undefined;
  /** Write or replace one entry (an atomic write of the registry file). */
  put(entry: RegistryEntry): void;
  /** Remove one entry. */
  remove(logicalName: string): void;
  /** Every entry of the run with the class `adoptable`, for the adoption. */
  adoptable(): readonly RegistryEntry[];
}

/* ------------------------------------------------------------------ *
 * Ingress — the ONE point of redaction (F118-FR-044)
 * ------------------------------------------------------------------ */

/** The classes of the ingress (closed set row 89 of annex X §X.6). */
export type IngressClass = "tool-arguments" | "stream-text" | "check-output" | "free-text";

/** What the ingress returned for one text. */
export type AdmittedText =
  { readonly kind: "text"; readonly text: string } | { readonly kind: "dropped" };

/**
 * The one ingress of feature 100 with its redactor (F100-FR-009). Text that
 * comes from outside the runtime — a command line, a yield's `reason` and
 * `job.argv`, a job log slice, a ledger signature — reaches a sink or a prompt
 * only after `admit`. When the redactor cannot run, the text is dropped and
 * the record says so (F100-FR-205); the kill, the wait and the resume go on.
 */
export interface Ingress {
  admit(text: string, ingressClass: IngressClass): AdmittedText;
}
