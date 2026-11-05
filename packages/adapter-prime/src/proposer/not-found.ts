/**
 * The not-found results of the prime proposer (T022; covers F138-FR-011,
 * parity items C-054 / B-0572 / B-0573, test PT-138-C-054-*).
 *
 * A pass returns the result code 127, and MUST NOT start a process, when the
 * agent executable is not found or when the launcher is not found. The two
 * messages are the as-is messages of the baseline, word for word:
 *
 * - `<component>: Prime Agent not found: <executable> (set $SPECSTRIDE_PRIME_AGENT_BIN)`
 * - `<component>: Prime fleet launcher not found: <launcher> (set $SPECSTRIDE_PRIME_FLEET_BIN)`
 *
 * The code is the `exit_code` of a result record, kept in the record of the
 * pass (F100-FR-153). This module only DESCRIBES the result; it never spawns.
 */

/** The as-is result code of a not-found pass. */
export const NOT_FOUND_EXIT_CODE = 127;

/** The default component named in the message of a proposer pass. */
export const DEFAULT_COMPONENT = "proposer";

/** A not-found result: no command, an exit code and the as-is message. */
export type NotFoundResult = {
  kind: "not-found";
  /** No process is started; there is no command to run. */
  command: undefined;
  exitCode: typeof NOT_FOUND_EXIT_CODE;
  component: string;
  message: string;
  requirement: "F138-FR-011";
};

/**
 * The result for an agent executable that is not on the search path
 * (B-0572, fixture FX-18 `harness-missing-prime`).
 */
export function agentExecutableNotFound(
  executable: string,
  component: string = DEFAULT_COMPONENT,
): NotFoundResult {
  return {
    kind: "not-found",
    command: undefined,
    exitCode: NOT_FOUND_EXIT_CODE,
    component,
    message:
      `${component}: Prime Agent not found: ${executable} ` + `(set $SPECSTRIDE_PRIME_AGENT_BIN)`,
    requirement: "F138-FR-011",
  };
}

/**
 * The result for a launcher that is not found (B-0573, fixture FX-18
 * `harness-missing-prime-launcher`).
 */
export function launcherNotFound(
  launcher: string,
  component: string = DEFAULT_COMPONENT,
): NotFoundResult {
  return {
    kind: "not-found",
    command: undefined,
    exitCode: NOT_FOUND_EXIT_CODE,
    component,
    message:
      `${component}: Prime fleet launcher not found: ${launcher} ` +
      `(set $SPECSTRIDE_PRIME_FLEET_BIN)`,
    requirement: "F138-FR-011",
  };
}
