/**
 * T020 — the kind `command` of EP-05 (F148-FR-002, F148-FR-004).
 *
 * One execution of one command: a FIXED argument list, no shell, the declared
 * working directory, a process group of its own, the time limit of the
 * command, the environment of `environment.ts`, and each captured stream cut
 * to the first 64000 characters. A command passes only when its exit code is
 * 0, and the exit status is the one the runtime OBSERVED — it is never read
 * from a file (F148-FR-002).
 *
 * What is the baseline's, unchanged (Specstride at `9cab15d`,
 * `lib/verification_plan.py:1575`, items B-1120, B-1121, B-1124):
 * `shell: false`, the fixed argument list, the declared working directory, the
 * declared `env` as an OVERLAY and never a replacement, the time limit in
 * seconds, the cap of 64000 characters per stream with nothing beyond it kept,
 * and `passed` only on exit code 0.
 *
 * What this feature ADDS to the baseline, each with its reason:
 *
 * | Addition | Why | Register row |
 * |---|---|---|
 * | A process group of its own, ended by a signal to the negative process id | A command that forks leaves no orphan; `cancel` ends the whole group (`research.md` D-10) | — |
 * | The environment allow-list outside the `parity` profile | Threat T-21: no provider credential reaches a check | DV-113, row 125 |
 * | Standard input closed | A command never waits for a person (the constitution, Principle VIII) | — |
 * | The conditions beside the exit result | `research.md` D-7 | — |
 *
 * The time limit is kept by a timer of the runner and not by the option
 * `timeout` of the spawn, because the option signals the CHILD and this
 * feature has to end the whole GROUP (F148-FR-001, `cancel`).
 */
import { spawn, type ChildProcess } from "node:child_process";
import process from "node:process";
import type { ManifestEntry, PinnedIdentity } from "@specstride/contracts/ep/check-runner";
import {
  MAX_OUTPUT_CHARS,
  cannotStartResult,
  cut,
  passedOf,
  timedOutResult,
} from "../result/errors.ts";
import { interrupt, resultOf, type RunnerResult } from "../result/result.ts";
import { commandEnvironment, type EnvironmentOptions } from "./environment.ts";
import {
  effectiveContainment,
  type ContainmentLevel,
  type ContainmentOfAStart,
} from "./containment.ts";

/** The kind of identity this module runs. */
export const KIND = "command" as const;

/** The spawn options that are fixed for every command of a check. */
export const FIXED_SPAWN_OPTIONS = Object.freeze({
  /** F148-FR-002 — a fixed argument list, never a shell. */
  shell: false as const,
  /** `research.md` D-10 — a process group of its own. */
  detached: true as const,
  /** Principle VIII — standard input is closed; the streams are captured. */
  stdio: Object.freeze(["ignore", "pipe", "pipe"] as const),
});

/** The signals `cancel` and the time limit send to the group, in order. */
export const GROUP_SIGNALS = Object.freeze(["SIGTERM", "SIGKILL"] as const);

/** How long the group has to end on `SIGTERM` before `SIGKILL` follows. */
export const GRACE_MS = 2_000;

/** What one execution of the kind `command` is given. */
export type CommandRun = ContainmentOfAStart & {
  readonly entry: ManifestEntry;
  readonly identity: PinnedIdentity;
  readonly workingDirectory: string;
  readonly timeLimitMs: number;
  readonly profile: string;
  readonly maxOutputChars?: number;
  readonly environmentOptions?: EnvironmentOptions;
};

/** Why a running command ended. */
export type EndCause = "exit" | "time-limit" | "cancel" | "stop-request";

/** A running command: the group, the capture and the promise of its result. */
export type RunningCommand = {
  readonly commandId: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** The process group of the command: the negative of this is signalled. */
  readonly processGroup: number | null;
  readonly pid: number | null;
  readonly startedAt: number;
  /**
   * T028, F148-FR-006 — the containment level the command RAN at, as `start`
   * received it: the proposer's level or stricter where the proposer's is
   * known (row 25; `containment.ts`). It is read from the start and never
   * chosen here.
   */
  readonly containment: ContainmentLevel;
  /** True until the child has ended. */
  running(): boolean;
  /** The cause the command ended by, or null while it runs. */
  endCause(): EndCause | null;
  /** The result, once the command has ended. */
  readonly settled: Promise<RunnerResult>;
  /** End the whole process group (F148-FR-001, `cancel`). */
  cancel(cause?: "cancel" | "stop-request"): void;
};

/** A capture of one stream, bounded at the cap: nothing beyond it is kept. */
class BoundedCapture {
  private text = "";
  private dropped = 0;
  private readonly max: number;
  constructor(max: number) {
    this.max = max;
  }
  add(chunk: string): void {
    if (this.text.length >= this.max) {
      this.dropped += chunk.length;
      return;
    }
    const room = this.max - this.text.length;
    if (chunk.length <= room) {
      this.text += chunk;
      return;
    }
    this.text += chunk.slice(0, room);
    this.dropped += chunk.length - room;
  }
  value(): string {
    return this.text;
  }
  /** How many characters were seen past the cap and NOT kept (B-1121). */
  droppedChars(): number {
    return this.dropped;
  }
}

/**
 * The signal that ends a whole process group: the NEGATIVE process id.
 *
 * A group id that is not an integer above one is refused without a signal: `kill(0)`
 * signals the caller's own group and `kill(-1)` every process the caller may signal,
 * which as root is the whole host (2026-10-02: a group id of 1 reset the host).
 */
export function endProcessGroup(processGroup: number, signal: NodeJS.Signals): boolean {
  if (!Number.isInteger(processGroup) || processGroup <= 1) return false;
  try {
    process.kill(-processGroup, signal);
    return true;
  } catch {
    // The group is already gone: ending it is done.
    return false;
  }
}

/**
 * F148-FR-002, F148-FR-004 — start one command and return the running command.
 * A start that fails gives a settled result with the signal `EXEC_ERROR` and
 * the error `cannot-start`; nothing is thrown at the caller.
 */
export function startCommand(run: CommandRun): RunningCommand {
  const max = run.maxOutputChars ?? MAX_OUTPUT_CHARS;
  const executable = run.identity.executable ?? "";
  const args = [...(run.identity.argv ?? run.entry.argv ?? [])];
  const cwd = run.workingDirectory;
  const env = commandEnvironment(run.entry, run.profile, run.environmentOptions ?? {});
  // F148-FR-006, row 25 — the containment level as `start` received it: the
  // level of the proposer or stricter. The runner never chooses it.
  const containment = effectiveContainment(run);
  const startedAt = Date.now();

  let child: ChildProcess | undefined;
  let startError: unknown;
  try {
    child = spawn(executable, args, {
      cwd,
      env: { ...env },
      shell: FIXED_SPAWN_OPTIONS.shell,
      detached: FIXED_SPAWN_OPTIONS.detached,
      stdio: [...FIXED_SPAWN_OPTIONS.stdio],
    });
  } catch (thrown) {
    startError = thrown;
  }

  const exitParts = {
    commandId: run.entry.id,
    executable,
    args: Object.freeze([...args]),
    cwd,
    durationMs: 0,
  };

  if (child === undefined) {
    const result = cannotStartResult(exitParts, startError);
    return Object.freeze({
      commandId: run.entry.id,
      executable,
      args: Object.freeze([...args]),
      cwd,
      processGroup: null,
      pid: null,
      startedAt,
      containment,
      running: () => false,
      endCause: () => "exit" as EndCause,
      settled: Promise.resolve(result),
      cancel: () => undefined,
    });
  }

  const started = child;
  const stdout = new BoundedCapture(max);
  const stderr = new BoundedCapture(max);
  started.stdout?.setEncoding("utf8");
  started.stderr?.setEncoding("utf8");
  started.stdout?.on("data", (chunk: string) => stdout.add(chunk));
  started.stderr?.on("data", (chunk: string) => stderr.add(chunk));

  let alive = true;
  let cause: EndCause | null = null;
  let timer: NodeJS.Timeout | undefined;
  let grace: NodeJS.Timeout | undefined;

  const group = typeof started.pid === "number" ? started.pid : null;

  const end = (next: Exclude<EndCause, "exit">): void => {
    if (!alive) return;
    cause ??= next;
    if (group !== null) {
      endProcessGroup(group, GROUP_SIGNALS[0]);
      grace = setTimeout(() => {
        if (alive && group !== null) endProcessGroup(group, GROUP_SIGNALS[1]);
      }, GRACE_MS);
      grace.unref?.();
    } else {
      started.kill(GROUP_SIGNALS[0]);
    }
  };

  if (run.timeLimitMs > 0) {
    timer = setTimeout(() => end("time-limit"), run.timeLimitMs);
    timer.unref?.();
  }

  const settled = new Promise<RunnerResult>((resolve) => {
    const finish = (exitCode: number | null, signalOfTheOs: string | null): void => {
      if (!alive) return;
      alive = false;
      if (timer !== undefined) clearTimeout(timer);
      if (grace !== undefined) clearTimeout(grace);
      const durationMs = Date.now() - startedAt;
      const parts = {
        commandId: run.entry.id,
        executable,
        args: Object.freeze([...args]),
        cwd,
        durationMs,
        stdout: cut(stdout.value(), max),
        stderr: cut(stderr.value(), max),
      };
      if (cause === "time-limit") {
        resolve(timedOutResult(parts, max));
        return;
      }
      cause ??= "exit";
      const observed = resultOf({
        ...parts,
        exitCode,
        signal: exitCode === null ? signalOfTheOs : null,
        passed: passedOf(exitCode),
      });
      // F148-FR-003 — a command ended by `cancel` or by a stop request before
      // its own end carries `interrupted` with the error `interrupted`, and is
      // never stated as a pass. The exit result the runtime observed stands
      // beside the condition and is not replaced by it.
      if (cause === "cancel" || cause === "stop-request") {
        resolve(interrupt(observed, cause));
        return;
      }
      resolve(observed);
    };

    started.on("error", (thrown: Error) => {
      if (!alive) return;
      alive = false;
      if (timer !== undefined) clearTimeout(timer);
      if (grace !== undefined) clearTimeout(grace);
      resolve(cannotStartResult({ ...exitParts, durationMs: Date.now() - startedAt }, thrown));
    });
    started.on("close", (code: number | null, signalOfTheOs: NodeJS.Signals | null) => {
      finish(code, signalOfTheOs);
    });
  });

  return Object.freeze({
    commandId: run.entry.id,
    executable,
    args: Object.freeze([...args]),
    cwd,
    processGroup: group,
    pid: group,
    startedAt,
    containment,
    running: () => alive,
    endCause: () => cause,
    settled,
    cancel: (reason: "cancel" | "stop-request" = "cancel") => end(reason),
  });
}

/** One execution of one command, run to its end. */
export async function runCommand(run: CommandRun): Promise<RunnerResult> {
  return await startCommand(run).settled;
}
