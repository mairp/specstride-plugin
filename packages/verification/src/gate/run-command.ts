/**
 * T010 — the ONE call site of the check runner (feature 100, annex C §C.8,
 * EP-05 `specstride.check-runner/1`), and a fake runner for tests
 * (F105-FR-005, F105-FR-009, F105-FR-032; F100-FR-097).
 *
 * This feature never starts a process. Every command of the verification
 * gate, of release verification and of the commands staged before goes
 * through the operations of §C.8, and they are called from here and from
 * nowhere else in this package: `pin` once per manifest entry AT LAUNCH, and
 * `start`, `poll`, `result` and `cancel` per command while it runs. The one
 * exception is a detached command staged before, which has no deadline at
 * which it is ended and is started by the process primitive of the kernel
 * instead (F105-FR-035, `research.md` D-17); `DEADLINE_SIGNAL` is the signal
 * such a command carries, and `deadlineExceeded` builds its result here so
 * that both paths produce the same record shape.
 *
 * Three rules of §C.8 are kept here and are the reason the call site is one
 * function and not a call in each caller:
 *
 *  - A runner that THROWS is treated as `cannot-start`
 *    (`THROW_IS_TREATED_AS`), and at the verification gate `cannot-start` is
 *    a FAILED COMMAND, never an error that halts the run (F105-FR-032).
 *  - A condition the runner returns beside the exit result is kept, each in a
 *    field of its own, and does NOT by itself fail the command
 *    (F105-FR-032). An entry without a condition holds no such field, so
 *    under the `parity` profile the record has the as-is fields only
 *    (F105-FR-009).
 *  - A command that is still running at its time limit is `cancel`led and
 *    counts as failed with the error `timeout`.
 *
 * The gate's own rule — every command runs, also after one has failed, and
 * the gate never stops at a failure (`research.md` D-3) — belongs to the gate
 * that loops over these calls, not to this function: `runCommand` resolves
 * with a failed result and throws nothing a caller must catch.
 */
import {
  CONDITIONS,
  IDENTITY_KINDS,
  THROW_IS_TREATED_AS,
  type CheckHandle,
  type CheckResult,
  type CheckRunner,
  type CheckRunnerError,
  type Condition,
  type ManifestEntry,
  type PinnedIdentity,
  type PollResult,
  type StartInput,
  type ContainmentLevel,
} from "@specstride/contracts/ep/check-runner";
import { STAGED_COMMAND_SIGNALS, stagedCommandSignals } from "../mode/closed-sets.ts";

/** The operations of §C.8 this package calls, in the order it calls them. */
export const CALLED_OPERATIONS = ["pin", "start", "poll", "result", "cancel"] as const;
export type CalledOperation = (typeof CALLED_OPERATIONS)[number];

/**
 * Row 233 of annex X §X.6 — the signal of a staged command that has no exit
 * code. It is taken from the closed set of T008 and not written twice.
 */
export const DEADLINE_SIGNAL: "DEADLINE" = STAGED_COMMAND_SIGNALS[0];

/* ------------------------------------------------------------------ *
 * The command, as this feature hands it to the call site.
 * ------------------------------------------------------------------ */

/**
 * One command to run: its manifest entry, which carries what §C.8 needs, and
 * the as-is identity fields the result record of F105-FR-009 holds beside the
 * exit result.
 */
export type GateCommand = {
  /** `CMD-…`, the id of the command in the verification plan. */
  readonly commandId: string;
  /** The id the project declared, as declared. */
  readonly declaredId: string;
  /** Where the declaration came from (F105-FR-015). */
  readonly source: string;
  /** The entry of the check manifest, as `pin` and `environment` receive it. */
  readonly entry: ManifestEntry;
  /** The resolved executable; a fixed argument list, never a shell line. */
  readonly executable: string;
  /** The arguments, as declared. */
  readonly args: readonly string[];
  /** The declared environment of the command; the runner owns the rest. */
  readonly env: Readonly<Record<string, string>>;
  /** The working directory the command runs in. */
  readonly cwd: string;
};

/** What `runCommand` needs beside the command; §C.8 "Inputs" of `start`. */
export type RunOptions = {
  /** The environment allow-list `start` receives. */
  readonly environmentAllowList: readonly string[];
  /** The containment level the command runs at, the proposer's or stricter. */
  readonly containment: ContainmentLevel;
  /** The time limit in milliseconds; at it the command is `cancel`led. */
  readonly timeLimitMs: number;
  /** How long between two calls of `poll`. */
  readonly pollIntervalMs?: number;
  /** The clock and the wait; injected so a test needs no real time. */
  readonly clock?: Clock;
};

/** The clock and the wait `runCommand` uses, so a test needs no real time. */
export type Clock = {
  /** Milliseconds, for the duration of a command. */
  now(): number;
  /** Wait between two calls of `poll`. */
  sleep(ms: number): Promise<void>;
};

/** The clock of a run. */
export const systemClock: Clock = Object.freeze({
  now: () => Date.now(),
  sleep: (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
});

/** The default interval between two calls of `poll`. */
export const DEFAULT_POLL_INTERVAL_MS = 25 as const;

/* ------------------------------------------------------------------ *
 * The result of one command.
 * ------------------------------------------------------------------ */

/**
 * The result of one command, as an entry of `commands` of the result record
 * (F105-FR-009). The as-is fields come first; `reused` and `reusedFrom` are
 * added by the reuse rules (F105-FR-033) and are absent here; a condition the
 * runner returned is added as a field of its own by `conditionFields`, and an
 * entry without a condition holds no such field.
 */
export type CommandResult = {
  readonly commandId: string;
  readonly declaredId: string;
  readonly source: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  /** The exit code, or `null` where the command has none (a signal instead). */
  readonly exitCode: number | null;
  /** The signal, or `null`; `DEADLINE` for a detached command staged before. */
  readonly signal: string | null;
  readonly durationMs: number;
  /** A reference to the captured output, never the output itself. */
  readonly stdout: string;
  readonly stderr: string;
  readonly passed: boolean;
  /** The error of §C.8 where the runner gave one; absent otherwise. */
  readonly error?: CheckRunnerError | undefined;
  /** The reason the runner put beside a condition, where it put one. */
  readonly reason?: string | undefined;
  /** One field per condition the runner returned; absent when there is none. */
  readonly tainted?: true | undefined;
  readonly cached?: true | undefined;
  readonly flaky?: true | undefined;
  readonly interrupted?: true | undefined;
  readonly unchecked?: true | undefined;
};

/**
 * The conditions of a result as these two functions read them. A result of
 * §C.8 carries every condition as a boolean; a `CommandResult` of this module
 * carries only the ones that are set, because an entry without a condition
 * holds no such field. Both shapes read the same way, so the parameter is the
 * widest of the two and neither caller needs a cast.
 */
export type ConditionsOfAResult = Readonly<Partial<Record<Condition, boolean | undefined>>>;

/**
 * The conditions of a result, each in a field of its own, and ONLY the ones
 * that are set: an entry without a condition holds no such field, so under
 * the `parity` profile the record has the as-is fields only (F105-FR-009).
 */
export function conditionFields(
  result: ConditionsOfAResult,
): Readonly<Partial<Record<Condition, true>>> {
  const out: Partial<Record<Condition, true>> = {};
  for (const condition of CONDITIONS) {
    if (result[condition] === true) out[condition] = true;
  }
  return Object.freeze(out);
}

/** The conditions a result carries, in the order of §C.8. */
export function conditionsOf(result: ConditionsOfAResult): readonly Condition[] {
  return Object.freeze(CONDITIONS.filter((c) => result[c] === true));
}

/**
 * F105-FR-032 — the verification gate decides on the EXIT RESULTS. A command
 * passed when it ended with the exit code 0 and the runner gave no error; a
 * condition beside the exit result never by itself fails it.
 */
export function passedFromExitResult(
  exitCode: number | null,
  error: CheckRunnerError | undefined,
): boolean {
  return error === undefined && exitCode === 0;
}

/* ------------------------------------------------------------------ *
 * `pin`, at launch.
 * ------------------------------------------------------------------ */

/** What `pinAtLaunch` gives for one entry of the check manifest. */
export type PinOutcome =
  | { readonly entryId: string; readonly pinned: PinnedIdentity; readonly refused?: undefined }
  | { readonly entryId: string; readonly pinned?: undefined; readonly refused: string };

/**
 * `pin` AT LAUNCH, once per entry of the check manifest (§C.8 "Caller and
 * time"; F105-FR-020). An unknown kind of identity refuses the entry, at
 * launch, which is the unknown-value rule of §C.8; a runner that throws is
 * treated as `cannot-start`, and at launch that too refuses the entry. The
 * function never throws, so one bad entry does not stop the launch from
 * reporting every other.
 */
export async function pinAtLaunch(
  runner: CheckRunner,
  entries: readonly ManifestEntry[],
): Promise<readonly PinOutcome[]> {
  const out: PinOutcome[] = [];
  for (const entry of entries) {
    try {
      const pinned = await runner.pin(entry);
      if (!(IDENTITY_KINDS as readonly string[]).includes(pinned.kind)) {
        out.push({
          entryId: entry.id,
          refused:
            `the entry \`${entry.id}\` is refused at launch: \`${String(pinned.kind)}\` is ` +
            `not a kind of identity of the check runner (feature 100, annex C §C.8)`,
        });
        continue;
      }
      out.push({ entryId: entry.id, pinned });
    } catch (error) {
      out.push({
        entryId: entry.id,
        refused:
          `the entry \`${entry.id}\` is refused at launch: the check runner threw at \`pin\`, ` +
          `which is treated as \`${THROW_IS_TREATED_AS}\` (feature 100, annex C §C.8): ` +
          messageOf(error),
      });
    }
  }
  return Object.freeze(out);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------------------------------------------------ *
 * `start`, `poll`, `result`, `cancel`, per command.
 * ------------------------------------------------------------------ */

/** A reference to captured output the runner did not give. */
const NO_OUTPUT = "" as const;

/**
 * Run ONE command through the check runner: `start`, then `poll` until it has
 * ended or its time limit has passed, then `result`; `cancel` when the time
 * limit passed first. It resolves with a `CommandResult` in every case and
 * throws nothing: a runner that throws, a runner that cannot start a command
 * and a command that ran over its time limit are all FAILED COMMANDS at the
 * verification gate (F105-FR-032; §C.8 "Failure of an implementation").
 */
export async function runCommand(
  runner: CheckRunner,
  command: GateCommand,
  options: RunOptions,
): Promise<CommandResult> {
  const clock = options.clock ?? systemClock;
  const interval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const started = clock.now();
  const input: StartInput = {
    identity: identityOf(command),
    workingDirectory: command.cwd,
    environmentAllowList: options.environmentAllowList,
    timeLimitMs: options.timeLimitMs,
    containment: options.containment,
  };

  let handle: CheckHandle;
  try {
    handle = await runner.start(input);
  } catch (error) {
    return failed(command, clock.now() - started, THROW_IS_TREATED_AS, messageOf(error));
  }

  // `poll` until the command has ended or its time limit has passed.
  for (;;) {
    let state: PollResult;
    try {
      state = await runner.poll(handle);
    } catch (error) {
      await cancelQuietly(runner, handle);
      return failed(command, clock.now() - started, THROW_IS_TREATED_AS, messageOf(error));
    }
    if (state.state === "ended") break;
    if (clock.now() - started >= options.timeLimitMs) {
      await cancelQuietly(runner, handle);
      return failed(
        command,
        clock.now() - started,
        "timeout",
        `the command ran past its time limit of ${String(options.timeLimitMs)} ms and was ` +
          `cancelled (feature 100, annex C §C.8)`,
      );
    }
    await clock.sleep(interval);
  }

  let result: CheckResult;
  try {
    result = await runner.result(handle);
  } catch (error) {
    return failed(command, clock.now() - started, THROW_IS_TREATED_AS, messageOf(error));
  }
  return Object.freeze({
    commandId: command.commandId,
    declaredId: command.declaredId,
    source: command.source,
    executable: command.executable,
    args: Object.freeze([...command.args]),
    env: Object.freeze({ ...command.env }),
    cwd: command.cwd,
    exitCode: result.exitCode,
    signal: null,
    durationMs: result.durationMs,
    stdout: result.output?.logicalName ?? NO_OUTPUT,
    stderr: result.output?.logicalName ?? NO_OUTPUT,
    passed: passedFromExitResult(result.exitCode, undefined),
    ...(result.reason === undefined ? {} : { reason: result.reason }),
    ...conditionFields(result),
  });
}

/** The identity `start` receives: the pin of the entry where it has one. */
function identityOf(command: GateCommand): PinnedIdentity {
  return Object.freeze({
    kind: command.entry.kind,
    executable: command.executable,
    argv: Object.freeze([command.executable, ...command.args]),
  });
}

/**
 * `cancel` a handle. A runner that throws at `cancel` is treated as
 * `cannot-start` too (§C.8), and the command has already failed, so the
 * throw is swallowed rather than replacing the reason the command failed for.
 */
async function cancelQuietly(runner: CheckRunner, handle: CheckHandle): Promise<void> {
  try {
    await runner.cancel(handle);
  } catch {
    // The command is failed either way; §C.8 gives `cancel` no other outcome.
  }
}

/** A failed command with the error of §C.8 that made it fail. */
function failed(
  command: GateCommand,
  durationMs: number,
  error: CheckRunnerError,
  reason: string,
): CommandResult {
  return Object.freeze({
    commandId: command.commandId,
    declaredId: command.declaredId,
    source: command.source,
    executable: command.executable,
    args: Object.freeze([...command.args]),
    env: Object.freeze({ ...command.env }),
    cwd: command.cwd,
    exitCode: null,
    signal: null,
    durationMs,
    stdout: NO_OUTPUT,
    stderr: NO_OUTPUT,
    passed: false,
    error,
    reason,
    ...(error === "interrupted" ? { interrupted: true as const } : {}),
  });
}

/**
 * F105-FR-035 — the result of a DETACHED command staged before, which is
 * never ended at its deadline and so has no exit code: it is reported as
 * `deadline_exceeded` with the signal `DEADLINE` of row 233 of annex X §X.6.
 * It does not go through the check runner (`research.md` D-17), and the
 * branch of row 233 says such a command counts as failed.
 */
export const DEADLINE_STATUS = "deadline_exceeded" as const;

/**
 * True when row 233 of annex X §X.6 still names `DEADLINE`. It is read from
 * the closed set of T008 at load, so a signal this module writes can never
 * leave the row behind.
 */
export const DEADLINE_IS_A_MEMBER_OF_ROW_233: boolean = stagedCommandSignals.has(DEADLINE_SIGNAL);

/** The result of a detached command staged before that passed its deadline. */
export function deadlineExceeded(command: GateCommand, durationMs: number): CommandResult {
  return Object.freeze({
    commandId: command.commandId,
    declaredId: command.declaredId,
    source: command.source,
    executable: command.executable,
    args: Object.freeze([...command.args]),
    env: Object.freeze({ ...command.env }),
    cwd: command.cwd,
    exitCode: null,
    signal: DEADLINE_SIGNAL,
    durationMs,
    stdout: NO_OUTPUT,
    stderr: NO_OUTPUT,
    // Row 233: a command reported with a signal and no exit code counts as
    // failed, so a detached command that passed its deadline never passes.
    passed: false,
    reason:
      `${DEADLINE_STATUS}: the detached command staged before passed its deadline and ` +
      `was not ended (F105-FR-035)`,
  });
}

/* ------------------------------------------------------------------ *
 * The fake runner, for tests.
 * ------------------------------------------------------------------ */

/** One call the fake runner recorded, in the order it was made. */
export type RecordedCall = {
  readonly operation: CalledOperation | "environment";
  /** The id of the manifest entry, for `pin` and `environment`. */
  readonly entryId?: string | undefined;
  /** The id of the handle, for `start`, `poll`, `result` and `cancel`. */
  readonly handleId?: string | undefined;
};

/** What the fake runner does for one command id. */
export type FakeScript = {
  /** The identity `pin` returns; the default is the kind of the entry. */
  readonly pin?: PinnedIdentity | undefined;
  /** `pin` throws with this message instead of returning. */
  readonly pinThrows?: string | undefined;
  /** `start` throws with this message: a runner that cannot start a command. */
  readonly startThrows?: string | undefined;
  /** `poll` throws with this message. */
  readonly pollThrows?: string | undefined;
  /** `result` throws with this message. */
  readonly resultThrows?: string | undefined;
  /**
   * How many times `poll` answers `running` before it answers `ended`. With
   * `neverEnds` the command never ends, which is how a test reaches the time
   * limit and the `cancel` that follows it.
   */
  readonly runningPolls?: number | undefined;
  /** `poll` never answers `ended`. */
  readonly neverEnds?: boolean | undefined;
  /** The result `result` returns; the default is the exit code 0. */
  readonly result?: Partial<CheckResult> | undefined;
};

/** The fake runner of T010, with what it recorded. */
export type FakeCheckRunner = CheckRunner & {
  /** Every call, in the order it was made. */
  readonly calls: readonly RecordedCall[];
  /** The calls of one operation. */
  callsOf(operation: RecordedCall["operation"]): readonly RecordedCall[];
  /** The command id a handle belongs to. */
  commandOf(handle: CheckHandle): string | undefined;
};

/** A result with the fields of §C.8 and no condition set. */
export function fakeResult(over: Partial<CheckResult> = {}): CheckResult {
  return Object.freeze({
    exitCode: 0,
    durationMs: 1,
    output: { logicalName: "attempt:1:1:1:check:output", hash: "0".repeat(64), size: 0 },
    tainted: false,
    cached: false,
    flaky: false,
    interrupted: false,
    unchecked: false,
    ...over,
  }) as CheckResult;
}

/**
 * A fake check runner for tests. It implements the six operations of §C.8
 * without starting a process: it hands out a handle per `start`, answers
 * `poll` from the script of the command, returns the scripted result, and
 * RECORDS every call, so a test can prove the order `pin` at launch, then
 * `start`, `poll`, `result`, and `cancel` when the time limit passed first.
 * `environment` starts no process and returns no handle, as §C.8 requires.
 */
export function createFakeCheckRunner(
  scripts: Readonly<Record<string, FakeScript>> = {},
): FakeCheckRunner {
  const calls: RecordedCall[] = [];
  const commandOfHandle = new Map<string, string>();
  const pollsOfHandle = new Map<string, number>();
  /** The executable of an entry, as `pin` saw it, to the id of that entry. */
  const entryOfExecutable = new Map<string, string>();
  let next = 0;

  const scriptOf = (id: string): FakeScript => scripts[id] ?? {};

  const runner: FakeCheckRunner = {
    calls,
    callsOf(operation) {
      return Object.freeze(calls.filter((c) => c.operation === operation));
    },
    commandOf(handle) {
      return commandOfHandle.get(handle.id);
    },
    async pin(entry: ManifestEntry): Promise<PinnedIdentity> {
      calls.push({ operation: "pin", entryId: entry.id });
      const script = scriptOf(entry.id);
      if (script.pinThrows !== undefined) throw new Error(script.pinThrows);
      const executable = script.pin?.executable ?? entry.argv[0] ?? "";
      if (executable !== "") entryOfExecutable.set(executable, entry.id);
      return (
        script.pin ??
        Object.freeze({
          kind: entry.kind,
          executable: entry.argv[0] ?? "",
          size: 0,
          hash: "0".repeat(64),
          argv: Object.freeze([...entry.argv]),
        })
      );
    },
    async start(input: StartInput): Promise<CheckHandle> {
      const id = `fake-handle-${String(++next)}`;
      const executable = input.identity.executable ?? input.identity.argv?.[0] ?? id;
      // A script is keyed by the id of the manifest entry. Where `pin` ran
      // first the executable leads back to that id; where a test calls
      // `start` without it, the key is the executable itself.
      const commandId = entryOfExecutable.get(executable) ?? executable;
      const script = scriptOf(commandId);
      calls.push({ operation: "start", handleId: id });
      if (script.startThrows !== undefined) throw new Error(script.startThrows);
      commandOfHandle.set(id, commandId);
      pollsOfHandle.set(id, 0);
      return Object.freeze({ id });
    },
    async poll(handle: CheckHandle): Promise<PollResult> {
      calls.push({ operation: "poll", handleId: handle.id });
      const script = scriptOf(commandOfHandle.get(handle.id) ?? "");
      if (script.pollThrows !== undefined) throw new Error(script.pollThrows);
      const seen = (pollsOfHandle.get(handle.id) ?? 0) + 1;
      pollsOfHandle.set(handle.id, seen);
      if (script.neverEnds === true) return Object.freeze({ state: "running" });
      if (seen <= (script.runningPolls ?? 0)) return Object.freeze({ state: "running" });
      return Object.freeze({ state: "ended" });
    },
    async result(handle: CheckHandle): Promise<CheckResult> {
      calls.push({ operation: "result", handleId: handle.id });
      const script = scriptOf(commandOfHandle.get(handle.id) ?? "");
      if (script.resultThrows !== undefined) throw new Error(script.resultThrows);
      return fakeResult(script.result ?? {});
    },
    async cancel(handle: CheckHandle): Promise<void> {
      calls.push({ operation: "cancel", handleId: handle.id });
    },
    environment(entry: ManifestEntry, profile: string): Readonly<Record<string, string>> {
      calls.push({ operation: "environment", entryId: entry.id });
      // §C.8: under `parity` the environment of the process is overlaid with
      // the declared `env`; otherwise the allow-list with no credential is.
      const base: Record<string, string> =
        profile === "parity" ? { SPECSTRIDE_PROFILE: "parity" } : {};
      return Object.freeze({ ...base, ...(entry.env ?? {}) });
    },
  };
  return runner;
}
