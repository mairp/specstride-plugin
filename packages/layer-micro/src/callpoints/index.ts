/**
 * T010 — the skeleton of the eight call points of EP-04
 * (`specstride.loop-layer/1`, annex D §D.1; F115-FR-002).
 *
 * The eight points are the fixed set `CALL_POINTS` of
 * `@specstride/contracts/src/ep/loop-layer.ts`. At this phase the layer
 * registers and is inert: every point returns `none`, so a harness that
 * exercises the layer observes exactly the classic loop (F115-FR-006; the
 * second suite of feature 141). The behaviour of each point arrives with the
 * user stories; the signature of every point is already the one the
 * interface fixes, so a story changes bodies, not shapes.
 *
 * Purity: this module imports `@specstride/contracts` only, holds no
 * `node:fs` or `node:fs/promises` import, and starts no process
 * (F100-FR-012; research.md D-1).
 */
import { epLoopLayer } from "@specstride/contracts";

const CALL_POINTS = epLoopLayer.CALL_POINTS;
type CallPoint = (typeof CALL_POINTS)[number];

/**
 * The value every call point of the skeleton returns: `none`, the value an
 * unknown return is read as (annex D §D.1, `RETURN_WHEN_UNKNOWN`).
 */
export type NoneResult = "none";

/** The read-only view of the phase attempt the engine hands the layer. */
export type PhaseAttemptView = {
  /** The run the phase attempt belongs to. */
  readonly runId: string;
  /** The number of the phase, as the task list names it. */
  readonly phase: number;
};

/** One call into the layer, as the engine makes it: a point and its view. */
export type CallPointInvocation = {
  readonly point: CallPoint;
  readonly view: PhaseAttemptView;
};

/**
 * F115-FR-002 — the eight call points, each a function that returns `none`.
 * The keys are exactly the eight points of `CALL_POINTS`, in the order of
 * annex D §D.1.
 */
export type CallPoints = {
  readonly [P in CallPoint]: (invocation: CallPointInvocation) => NoneResult;
};

/** `contributePrompt` — the layer adds the checkpoint contract block (later). */
export function contributePrompt(_invocation: CallPointInvocation): NoneResult {
  return "none";
}

/** `afterPass` — the layer reads the checkpoint claim of the pass (later). */
export function afterPass(_invocation: CallPointInvocation): NoneResult {
  return "none";
}

/** `betweenPasses` — the layer decides keep, repair or unresolved (later). */
export function betweenPasses(_invocation: CallPointInvocation): NoneResult {
  return "none";
}

/** `nextPassBlock` — the layer contributes the next pass prompt (later). */
export function nextPassBlock(_invocation: CallPointInvocation): NoneResult {
  return "none";
}

/** `onEvidence` — the layer runs the closing check at phase evidence (later). */
export function onEvidence(_invocation: CallPointInvocation): NoneResult {
  return "none";
}

/** `contributeCriticInput` — the layer returns the rows of the units (later). */
export function contributeCriticInput(_invocation: CallPointInvocation): NoneResult {
  return "none";
}

/** `resume` — the layer acts by the last record of its namespace (later). */
export function resume(_invocation: CallPointInvocation): NoneResult {
  return "none";
}

/** `report` — the layer reports its counters and the `[LOOP]` line (later). */
export function report(_invocation: CallPointInvocation): NoneResult {
  return "none";
}

/**
 * The eight call points as one object, keyed by the point, each returning
 * `none`. The key set is checked against `CALL_POINTS` at import time by the
 * static test, so a point the annex adds cannot be missed silently.
 */
export const callPoints: CallPoints = Object.freeze({
  contributePrompt,
  afterPass,
  betweenPasses,
  nextPassBlock,
  onEvidence,
  contributeCriticInput,
  resume,
  report,
});

/** The names of the eight call points, in the order of `CALL_POINTS`. */
export const CALLED_POINTS: readonly CallPoint[] = CALL_POINTS;
