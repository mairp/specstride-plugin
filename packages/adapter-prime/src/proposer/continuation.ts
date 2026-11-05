/**
 * Session continuation and the tool allow-list of the prime proposer (T024;
 * covers F138-FR-014 and F138-FR-016, tests CT-138-14 and CT-138-16 in
 * `tests/characterization/138/continuation-tools.test.ts`).
 *
 * Continuation (F138-FR-014): outside the `parity` profile, a pass after the
 * first pass of a phase attempt MAY resume the session of the earlier pass BY
 * THE ID the initial record of the earlier pass stated, INSIDE the session
 * directory of the phase attempt (`attempt:<N>:<k>:<n>:session`). "The
 * latest" session is NEVER resumed: without both the id and the attempt
 * directory the pass starts fresh and context is carried through files.
 * Every other start (a new phase attempt, a relaunch, a watchdog kill, a
 * critic-class call, the first pass of an attempt) carries the flag that
 * stores none. Under `parity` every pass carries the no-session flag and no
 * continuation argument exists.
 *
 * Tools (F138-FR-016): outside `parity` the tools are an allow-list the
 * consumer may narrow (`harnesses.prime.tools`), passed with `--tools` and
 * recorded per run. Under `parity` no allow-list is passed.
 */

/** The no-session flag: the flag that stores none (F138-FR-046, saved sessions). */
export const NO_SESSION_FLAG = "--no-session";

/** The continuation arguments of the pinned version (argument table). */
export const CONTINUE_FLAGS = [
  "--session-dir",
  "{attemptSessionDir}",
  "-r",
  "{sessionId}",
] as const;

/** The default tool allow-list the descriptor declares (F138-FR-016). */
export const DEFAULT_TOOL_ALLOW_LIST = ["read", "edit", "write", "shell"] as const;

/** The flag that hands the allow-list to the agent executable. */
export const TOOLS_FLAG = "--tools";

/** The name of the session directory of one phase attempt. */
export function attemptSessionDirName(phase: number, unit: number, attempt: number): string {
  return `attempt:${phase}:${unit}:${attempt}:session`;
}

/** The inputs of the session-flags decision of one pass. */
export type SessionPlan = {
  profile: "parity" | "default";
  /** The session id the initial record of the earlier pass stated. */
  continueSessionId?: string | undefined;
  /** The session directory of the phase attempt in force. */
  attemptSessionDir?: string | undefined;
};

/**
 * The session flags of one pass. A continuation exists only when BOTH the
 * session id of the earlier pass AND the attempt's session directory are
 * present — "the latest" is never resumed (F138-FR-014); anything else is a
 * fresh start with the flag that stores none. Under `parity` the answer is
 * always the no-session flag, and no continuation argument exists.
 */
export function sessionFlags(plan: SessionPlan): string[] {
  if (plan.profile === "parity") return [NO_SESSION_FLAG];
  const id = plan.continueSessionId?.trim();
  const dir = plan.attemptSessionDir?.trim();
  if (id && dir) {
    return ["--session-dir", dir, "-r", id];
  }
  return [NO_SESSION_FLAG];
}

/**
 * The continuation arguments proper: empty unless this pass really continues
 * the session of the earlier pass of the SAME phase attempt. Under `parity`
 * this is always empty (F138-FR-014: no invocation carries a continuation
 * argument).
 */
export function continuationArguments(plan: SessionPlan): string[] {
  if (plan.profile === "parity") return [];
  const flags = sessionFlags(plan);
  return flags[0] === NO_SESSION_FLAG ? [] : flags;
}

/** The inputs of the allow-list decision of one pass. */
export type ToolsPlan = {
  profile: "parity" | "default";
  /** The narrowed allow-list of the consumer (`harnesses.prime.tools`). */
  allowList?: string[] | undefined;
};

/**
 * The tool arguments of one pass (F138-FR-016): outside `parity` the
 * allow-list in force (the consumer's narrowed list, or the descriptor's
 * default), passed with `--tools`; under `parity` nothing is passed.
 */
export function toolArguments(plan: ToolsPlan): string[] {
  if (plan.profile === "parity") return [];
  const list =
    plan.allowList && plan.allowList.length > 0 ? plan.allowList : [...DEFAULT_TOOL_ALLOW_LIST];
  return [TOOLS_FLAG, list.join(",")];
}
