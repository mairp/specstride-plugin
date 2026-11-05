/**
 * T044 (part 1) — the errors of a critic call (F130-FR-026).
 *
 * A critic call whose process exits non-zero fails with a message that
 * carries the first 300 characters of standard error, or of standard output
 * when standard error is empty (the harness reports some provider failures
 * on standard output). A call whose standard output is empty fails. A call
 * that exceeds its time limit, and a launcher that cannot start, fail with
 * their own messages. No failed call yields a verdict. A reference error of
 * the model (`dsh-conflicting-providers`, `dsh-invalid-model-ref` of FX-07)
 * ends the run with engine exit 1 and the stop reason `critic_unavailable`.
 */

/** The number of leading characters of the stream a failure message carries. */
export const CRITIC_ERROR_TAIL = 300 as const;

/** The prefix of every critic failure message. */
export const CRITIC_ERROR_PREFIX = "dsh critic:" as const;

/** The stop reason the engine records for a failed critic call (FX-07). */
export const CRITIC_UNAVAILABLE = "critic_unavailable" as const;

/** The first COUNT characters of TEXT (F130-FR-026: 300). */
export function firstCharacters(text: string, count: number = CRITIC_ERROR_TAIL): string {
  return text.slice(0, count);
}

/** The message of a non-zero exit: stderr first, stdout where stderr is empty. */
export function criticNonZeroExitMessage(input: {
  readonly status: number;
  readonly stderr: string;
  readonly stdout: string;
}): string {
  const stream = input.stderr.trim() !== "" ? input.stderr : input.stdout;
  return (
    `${CRITIC_ERROR_PREFIX} the process exited with status ${input.status}: ` +
    `${firstCharacters(stream)}`
  );
}

/** The message of an empty standard output (F130-FR-026: the call fails). */
export function criticEmptyStdoutMessage(input: { readonly status: number }): string {
  return (
    `${CRITIC_ERROR_PREFIX} the process printed no reply on standard output ` +
    `(status ${input.status}); the call fails`
  );
}

/** The message of a call past its time limit (F130-FR-026). */
export function criticTimeoutMessage(timeoutMs: number): string {
  return `${CRITIC_ERROR_PREFIX} the call exceeded its time limit of ${timeoutMs} ms`;
}

/** The message of a launcher that could not start the process (F130-FR-026). */
export function criticLaunchMessage(detail: string): string {
  return `${CRITIC_ERROR_PREFIX} the process could not be started: ${detail}`;
}

/** The end of a run whose critic reference failed (F130-FR-028, FX-07). */
export type CriticUnavailableEnd = {
  readonly engineExit: 1;
  readonly stopReason: typeof CRITIC_UNAVAILABLE;
};

/** The two reference scenarios of FX-07 and their ends. */
export const CRITIC_REFERENCE_SCENARIOS = Object.freeze({
  "dsh-conflicting-providers": "conflicting DSH providers",
  "dsh-invalid-model-ref": "invalid DSH model ref",
} as const);

/**
 * F130-FR-028 — a reference error of the critic fails the call as F130-FR-026
 * says and the phase gate scores it as a failed critic call: engine exit 1,
 * stop reason `critic_unavailable`.
 */
export function criticReferenceFailure(message: string): CriticUnavailableEnd & {
  readonly message: string;
} {
  return { engineExit: 1, stopReason: CRITIC_UNAVAILABLE, message };
}
