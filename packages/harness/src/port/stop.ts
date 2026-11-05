/**
 * T023 — `stop` and `betweenPasses` on the process primitive of the kernel
 * (F109-FR-012).
 *
 * Every process of a harness starts in a process GROUP of its own: the
 * kernel's primitive guarantees it (it detaches the process, so the group id
 * equals the process id), and `startInOwnGroup` records the fact on the
 * handle. `stop` takes one of `polite`, `terminate`, `kill` and reports
 * whether the process ended. `betweenPasses` returns one of `continue`,
 * `stop` with the result 4, `stop` with the result 7; a failure of it is read
 * as `continue`.
 */

import {
  GROUP_SIGNALS,
  type GroupSignal,
  type ProcessPrimitive,
} from "@specstride/contracts/ep/kernel-services";

/** The modes of `stop` (closed set, row 125 of annex X §X.6). */
export const STOP_MODES = GROUP_SIGNALS;
export type StopMode = GroupSignal;

/** The unknown member of the set is read as `terminate` (row 125). */
export const UNKNOWN_STOP_MODE_READS_AS: StopMode = "terminate";

/** The outcomes of `betweenPasses` (closed set, row 37). */
export const BETWEEN_PASSES_OUTCOMES = ["continue", "stop:4", "stop:7"] as const;
export type BetweenPassesOutcome = (typeof BETWEEN_PASSES_OUTCOMES)[number];

/** The unknown member of the set is read as `continue` (row 37). */
export const UNKNOWN_OUTCOME_READS_AS: BetweenPassesOutcome = "continue";

/** The result code a `stop` outcome carries. */
export function resultCodeOf(outcome: BetweenPassesOutcome): null | 4 | 7 {
  switch (outcome) {
    case "continue":
      return null;
    case "stop:4":
      return 4;
    case "stop:7":
      return 7;
  }
}

/**
 * Start a harness process through the kernel primitive and record that it is
 * a process group of its own (the primitive guarantees it; this asserts it,
 * so a change of the primitive is caught here and not at the harness).
 */
export async function startInOwnGroup(
  primitive: ProcessPrimitive,
  input: Parameters<ProcessPrimitive["start"]>[0],
): Promise<{ readonly pid: number; readonly pgid: number; readonly ownGroup: true }> {
  const started = await primitive.start(input);
  if (started.pgid !== started.pid) {
    throw new Error(
      `the process ${started.pid} is not the process group of its own (pgid ${started.pgid})`,
    );
  }
  return { pid: started.pid, pgid: started.pgid, ownGroup: true };
}

/** What `stop` reports. */
export type StopResult = {
  /** Whether the process ended. */
  readonly ended: boolean;
  readonly mode: StopMode;
  readonly signal?: string;
};

/** How long `stop` waits for the end after the signal, before it reports `ended: false`. */
export const STOP_WAIT_MS = 10_000 as const;

/**
 * F109-FR-012 — stop the process group of a pass with one of the three modes
 * and report whether the process ended. A mode outside the closed set is read
 * as `terminate`. A group that is already gone reports `ended: false`? — no:
 * the caller asked for the process to end and the kernel reports a gone group
 * as served, so this reads `ended: true` with the mode kept.
 */
export async function stopProcess(options: {
  readonly primitive: ProcessPrimitive;
  readonly pid: number;
  readonly pgid: number;
  readonly mode: string;
  readonly timeoutMs?: number;
}): Promise<StopResult> {
  const mode: StopMode = (STOP_MODES as readonly string[]).includes(options.mode)
    ? (options.mode as StopMode)
    : UNKNOWN_STOP_MODE_READS_AS;
  try {
    options.primitive.signalGroup(options.pgid, mode);
  } catch (error) {
    // A refusal of the kernel (a group that is not an integer above one, a
    // process that is gone) is a stop that did not end the process.
    return { ended: false, mode, signal: error instanceof Error ? error.message : String(error) };
  }
  const wait = Promise.race([
    options.primitive.waitForEnd(options.pid),
    new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), options.timeoutMs ?? STOP_WAIT_MS),
    ),
  ]);
  const end = await wait;
  if (end === "timeout") {
    return { ended: false, mode };
  }
  return { ended: true, mode, signal: end.signal ?? undefined };
}

/** What `betweenPasses` receives: the handle of the pass that ended and its result. */
export type BetweenPassesInput = {
  readonly pid: number;
  readonly sessionId: string;
  readonly result: unknown;
  readonly workdir: string;
};

export type BetweenPassesHandler = (input: BetweenPassesInput) => unknown | Promise<unknown>;

/** Read the value a handler returned as one outcome of the closed set. */
export function readOutcome(value: unknown): BetweenPassesOutcome {
  if (typeof value === "number") {
    if (value === 4) {
      return "stop:4";
    }
    if (value === 7) {
      return "stop:7";
    }
    return UNKNOWN_OUTCOME_READS_AS;
  }
  if (typeof value === "string" && (BETWEEN_PASSES_OUTCOMES as readonly string[]).includes(value)) {
    return value as BetweenPassesOutcome;
  }
  if (typeof value === "object" && value !== null && "stop" in (value as Record<string, unknown>)) {
    return readOutcome((value as Record<string, unknown>).stop);
  }
  return UNKNOWN_OUTCOME_READS_AS;
}

/**
 * F109-FR-012 — run `betweenPasses` and read one of the three outcomes. A
 * failure of it — a throw, a rejection, any value outside the set — is read
 * as `continue`.
 */
export async function betweenPasses(
  handler: BetweenPassesHandler,
  input: BetweenPassesInput,
): Promise<BetweenPassesOutcome> {
  try {
    return readOutcome(await Promise.resolve(handler(input)));
  } catch {
    return UNKNOWN_OUTCOME_READS_AS;
  }
}
