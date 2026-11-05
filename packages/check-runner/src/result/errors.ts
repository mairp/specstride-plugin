/**
 * T022 — the errors of the check runner, the time limit and the start error
 * (F148-FR-004; as-is item B-1122 of cluster C-080).
 *
 * The errors are the closed set of row 54: `cannot-start`, `timeout`,
 * `interrupted`, with `cannot-start` as the unknown value. Three behaviours
 * are the baseline's, byte for byte, and are reproduced here as the baseline
 * writes them (Specstride at `9cab15d`, `lib/verification_plan.py`, lines
 * 1584 to 1593):
 *
 * | The baseline | Here |
 * |---|---|
 * | `code = None`, `signal = "TIMEOUT"`, `stderr = (stderr + "\ncommand timed out")[:64000]` | `timedOutResult` |
 * | `code = None`, `stdout = ""`, `stderr = str(exc)`, `signal = "EXEC_ERROR"` | `cannotStartResult` |
 * | `passed = code == 0` | `passedOf` |
 *
 * The literal `command timed out`, and the signals `TIMEOUT` and `EXEC_ERROR`,
 * are the three as-is literals of `data/as-is-literals.json`, which the
 * compared records reproduce; they are read from that file by the parity test,
 * not retyped there.
 *
 * Both a time limit and a start error COUNT AS FAILED at the verification
 * gate, and neither is a condition: the exit result stands on its own
 * (F148-FR-003).
 */
import {
  RUNNER_ERRORS,
  type RunnerError,
  type ResultSignal,
  SIGNAL_OF_ANOTHER_FEATURE,
} from "./closed-sets.ts";
import { resultOf, type ExitResult, type RunnerResult } from "./result.ts";

/** The cap of each captured stream, in characters (F148-FR-002, B-1121). */
export const MAX_OUTPUT_CHARS = 64_000;

/** B-1122 — the text the baseline adds to standard error on a time limit. */
export const TIMED_OUT_TEXT = "command timed out";

/** B-1122 — the baseline puts the text on a line of its own. */
export const TIMED_OUT_SEPARATOR = "\n";

/** B-1122 — the signal of a result that ran over its time limit. */
export const TIMEOUT_SIGNAL: ResultSignal = "TIMEOUT";

/** B-1122 — the signal of a command that could not be started. */
export const EXEC_ERROR_SIGNAL: ResultSignal = "EXEC_ERROR";

/** F148-FR-004 — the unknown value of row 54. */
export const ERROR_WHEN_UNKNOWN: RunnerError = "cannot-start";

/**
 * F148-FR-004 — an unknown error is read as `cannot-start`, and a runner that
 * throws is treated as `cannot-start`. The function never throws.
 */
export function readRunnerError(value: unknown): RunnerError {
  if (typeof value === "string" && (RUNNER_ERRORS as readonly string[]).includes(value)) {
    return value as RunnerError;
  }
  return ERROR_WHEN_UNKNOWN;
}

/** F148-FR-004 — a runner that throws is treated as `cannot-start`. */
export function errorOfAThrow(_thrown: unknown): RunnerError {
  return ERROR_WHEN_UNKNOWN;
}

/** B-1121 — the first `max` CHARACTERS of a stream; nothing beyond is kept. */
export function cut(value: string, max: number = MAX_OUTPUT_CHARS): string {
  return value.length <= max ? value : value.slice(0, max);
}

/** B-1124 — a command passes only when its exit code is 0. */
export function passedOf(exitCode: number | null): boolean {
  return exitCode === 0;
}

/**
 * B-1122 — standard error of a command that ran over its time limit: what the
 * command had written, the separator, the literal, the whole cut to the cap.
 * The cut comes LAST, as at the baseline, so a command that filled the cap
 * before the time limit loses the literal rather than its own output.
 */
export function stderrOfATimeLimit(stderr: string, max: number = MAX_OUTPUT_CHARS): string {
  return cut(`${stderr}${TIMED_OUT_SEPARATOR}${TIMED_OUT_TEXT}`, max);
}

/**
 * F148-FR-004, B-1122 — the result of a command that ran over its time limit:
 * no exit code, the signal `TIMEOUT`, `command timed out` added to standard
 * error. It counts as failed.
 */
export function timedOutResult(
  parts: Omit<ExitResult, "exitCode" | "signal" | "passed">,
  max: number = MAX_OUTPUT_CHARS,
): RunnerResult {
  return resultOf(
    {
      ...parts,
      stdout: cut(parts.stdout, max),
      stderr: stderrOfATimeLimit(parts.stderr, max),
      exitCode: null,
      signal: TIMEOUT_SIGNAL,
      passed: false,
    },
    { error: "timeout" },
  );
}

/**
 * F148-FR-004, B-1122 — the result of a command that could not be started:
 * no exit code, the signal `EXEC_ERROR`, no standard output, and the message
 * of the failed start on standard error. It counts as failed.
 *
 * As at the baseline, standard error of a start error is the message as it
 * stands and is not cut: there is no command output to bound.
 */
export function cannotStartResult(
  parts: Omit<ExitResult, "exitCode" | "signal" | "passed" | "stdout" | "stderr">,
  cause: unknown,
): RunnerResult {
  return resultOf(
    {
      ...parts,
      stdout: "",
      stderr: messageOf(cause),
      exitCode: null,
      signal: EXEC_ERROR_SIGNAL,
      passed: false,
    },
    { error: "cannot-start" },
  );
}

/** The message of a failed start, as the baseline's `str(exc)` gives it. */
export function messageOf(cause: unknown): string {
  if (cause === null || cause === undefined) return "";
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/**
 * F148-FR-004 — both a time limit and a start error count as failed at the
 * verification gate. A result with no exit code counts as failed whatever its
 * signal, which is also the unknown value of row 233.
 */
export function countsAsFailed(result: {
  readonly exitCode: number | null;
  readonly signal: string | null;
}): boolean {
  return result.exitCode !== 0;
}

/** The three errors of row 54, with what each one means and who may set it. */
export const RUNNER_ERROR_MEANINGS: Readonly<Record<RunnerError, string>> = Object.freeze({
  "cannot-start": "the executable could not be started, or a runner threw",
  timeout: "the command ran over the time limit of the command",
  interrupted: "the command was ended by `cancel` or by a stop request before its own end",
});

/**
 * The signal `DEADLINE` of row 233 belongs to the owner of the verification
 * gate and is never set by the check runner; a result that carries it is read
 * here and passed through, not produced.
 */
export const SIGNAL_NEVER_SET_HERE = SIGNAL_OF_ANOTHER_FEATURE;
