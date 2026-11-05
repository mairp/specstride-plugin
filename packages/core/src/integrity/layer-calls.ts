/**
 * T015 — the calls of the loop layer at `onEvidence` and
 * `contributeCriticInput`, and the layer off for the phase attempt when it
 * fails at either call (feature 149, F149-FR-007; R23, invariants IR-05 and
 * IR-07; annex D §D.1).
 *
 * F149-FR-007, fourth sentence: "The loop layer MUST be called at
 * `onEvidence` before the phase gate and at `contributeCriticInput` before the
 * critic prompt is assembled, and the whole verification gate MUST run
 * afterwards whatever the layer returned." And the edge case of the
 * specification: "A loop layer fails at `onEvidence` or at
 * `contributeCriticInput`: the layer is off for the phase attempt and the phase
 * gate runs in full."
 *
 * So the order around one phase gate is fixed, and this module is the only
 * place that walks it:
 *
 * | # | Step | Who |
 * |---|---|---|
 * | 1 | `onEvidence` | the loop layer, when phase evidence appears (§D.1 row 5) |
 * | 2 | the whole verification gate | the phase gate, every command, always |
 * | 3 | `contributeCriticInput` | the loop layer, before the critic prompt is assembled (§D.1 row 6) |
 * | 4 | the critic prompt | feature 117, from the rows of step 3 |
 * | 5 | `judge` | the critic strategy, once per phase gate (annex E §E.1) |
 *
 * Nothing a layer returns at step 1 or step 3 can take step 2 away, shorten it,
 * or replace it with a result of its own (IR-03, IR-05). A failure at step 1 or
 * step 3 — a thrown error, or a return value the engine does not offer — takes
 * the layer off for the phase attempt and the rest of the walk is the classic
 * loop: the engine with the layer off (decision 21).
 *
 * The last sentence of F149-FR-007, "A seam, a loop layer and the bump MUST add
 * no exit code and no stop reason", is IR-07 and is held by
 * `EXIT_CODES_ADDED`, `STOP_REASONS_ADDED` and the two subset functions at the
 * end of the module: a failure here produces neither.
 *
 * The module reads no file and starts no process: the engine hands in the layer,
 * the view and the verification gate (F100-FR-012, F100-FR-234).
 */
import {
  CALL_POINTS,
  DIRECTIVES,
  FAILURE_PATH,
  FAILURE_PRODUCES_AN_EXIT_CODE_OR_STOP_REASON,
  RETURN_WHEN_UNKNOWN,
  type CallPoint,
  type Directive,
  type PhaseAttemptView,
} from "@specstride/contracts/ep/loop-layer";
import { STOP_REASONS, type StopReason } from "@specstride/contracts/codes/stop-reasons";
import { ENGINE_EXIT_CODES } from "@specstride/contracts/codes/engine";

/* ------------------------------------------------------------------ *
 * The two call points and the order of the walk.
 * ------------------------------------------------------------------ */

/** The two call points of EP-04 that stand around the phase gate. */
export const CALL_POINTS_AROUND_THE_PHASE_GATE = ["onEvidence", "contributeCriticInput"] as const;
export type CallPointAroundThePhaseGate = (typeof CALL_POINTS_AROUND_THE_PHASE_GATE)[number];

/** Both are call points of §D.1: the names cannot drift from the annex. */
export const BOTH_ARE_CALL_POINTS_OF_THE_ANNEX: boolean = CALL_POINTS_AROUND_THE_PHASE_GATE.every(
  (point) => (CALL_POINTS as readonly string[]).includes(point),
);

/** The five steps of one phase gate, in the fixed order of the walk. */
export const STEPS_OF_THE_PHASE_GATE = [
  "onEvidence",
  "verification-gate",
  "contributeCriticInput",
  "critic-prompt",
  "judge",
] as const;
export type StepOfThePhaseGate = (typeof STEPS_OF_THE_PHASE_GATE)[number];

/** `onEvidence` stands before the phase gate; `contributeCriticInput` before the prompt. */
export const STEP_BEFORE_THE_PHASE_GATE: StepOfThePhaseGate = "onEvidence";
export const STEP_BEFORE_THE_CRITIC_PROMPT: StepOfThePhaseGate = "contributeCriticInput";

/**
 * §D.1, "Unknown-value rule": an unknown return at a call point is read as
 * `none`. The annex's own value is asserted against the literal this module
 * uses, so the two cannot drift.
 */
export const VALUE_WHEN_UNKNOWN = "none" as const;
export const VALUE_WHEN_UNKNOWN_IS_THE_ANNEX_VALUE: boolean =
  (RETURN_WHEN_UNKNOWN as string) === VALUE_WHEN_UNKNOWN;

/** The directive the engine applies when a layer fails at a call point (§D.1). */
export const DIRECTIVE_ON_A_FAILURE: Directive = "layerOffForAttempt";

/** It is a directive of the closed set of §D.1. */
export const DIRECTIVE_ON_A_FAILURE_IS_OF_THE_SET: boolean = (
  DIRECTIVES as readonly string[]
).includes(DIRECTIVE_ON_A_FAILURE);

/** The names of the events this module raises on the primary stream. */
export const LAYER_CALL_EVENT = "integrity.layer.call" as const;
export const LAYER_OFF_EVENT = "integrity.layer.off-for-attempt" as const;
export const LAYER_EVENT_NAMES = [LAYER_CALL_EVENT, LAYER_OFF_EVENT] as const;

/* ------------------------------------------------------------------ *
 * What the engine hands in.
 * ------------------------------------------------------------------ */

/** One row of the fact block, as a layer returns it at `contributeCriticInput`. */
export type FactBlockRow = Readonly<Record<string, unknown>>;

/** What `onEvidence` returns (§D.1 row 5). */
export type OnEvidenceReturn = { readonly closingCheck: boolean } | "none";

/** What `contributeCriticInput` returns (§D.1 row 6). */
export type ContributeCriticInputReturn = readonly FactBlockRow[] | "none";

/**
 * The two call points of the layer, as the engine holds them. A layer carries
 * six more; this module calls these two and nothing else, and it is handed no
 * writer of the phase gate (`gate-writers-guard.ts`).
 */
export type LayerAtThePhaseGate = {
  readonly id: string;
  onEvidence?(view: PhaseAttemptView): OnEvidenceReturn;
  contributeCriticInput?(view: PhaseAttemptView): ContributeCriticInputReturn;
};

/** The result of the verification gate, as the engine's gate returns it. */
export type VerificationGateResult = {
  /** Whether every command of the phase passed. */
  readonly passed: boolean;
  /** The ids of the commands that were EXECUTED, in order. */
  readonly commandsExecuted: readonly string[];
  /** The condition of the result, where it carries one (annex C §C.8). */
  readonly condition?: string;
  readonly conditionReason?: string;
};

/** The verification gate as this module calls it: the whole of it, always. */
export type VerificationGate = (view: PhaseAttemptView) => Promise<VerificationGateResult>;

/** Everything the engine hands in to walk one phase gate. */
export type PhaseGateWalkDependencies = {
  /** The read-only view of the phase attempt (§D.1, Inputs). */
  readonly view: PhaseAttemptView;
  /** The layer, or `undefined` for the classic loop (the layer `none`). */
  readonly layer?: LayerAtThePhaseGate | undefined;
  /** The verification gate of the phase gate. */
  readonly verificationGate: VerificationGate;
  /** Where the engine writes an event (`events-primary`). */
  readonly onEvent?: (event: LayerCallEvent) => void;
};

/* ------------------------------------------------------------------ *
 * The outcome of one call, and of the whole walk.
 * ------------------------------------------------------------------ */

/** Why a layer is off for the phase attempt. */
export const OFF_REASONS = ["threw", "unknown-return"] as const;
export type OffReason = (typeof OFF_REASONS)[number];

/** One failure of a layer at a call point. */
export type LayerCallFailure = {
  readonly callPoint: CallPointAroundThePhaseGate;
  readonly layerId: string;
  readonly reason: OffReason;
  /** The message of the error, or the value the engine does not offer, as text. */
  readonly detail: string;
  /** §D.1: the layer is off for the phase attempt and the classic loop carries on. */
  readonly path: typeof FAILURE_PATH;
  /** IR-07: no exit code and no stop reason comes of it. */
  readonly exitCode: undefined;
  readonly stopReason: undefined;
};

/** One event of the walk, on the primary stream. */
export type LayerCallEvent = {
  readonly name: (typeof LAYER_EVENT_NAMES)[number];
  readonly callPoint?: CallPointAroundThePhaseGate;
  readonly layerId: string;
  readonly reason?: OffReason;
  readonly directive?: Directive;
  /** A failure of a layer halts nothing (§D.1, "Failure of an implementation"). */
  readonly blocking: false;
};

/** The outcome of one call of a layer at one of the two call points. */
export type LayerCallOutcome<T> = {
  readonly callPoint: CallPointAroundThePhaseGate;
  /** The value, or the value an unknown return is read as (`none`). */
  readonly value: T | "none";
  /** Present where the call failed. */
  readonly failure?: LayerCallFailure;
};

/** What the engine gets back from one walk of the phase gate. */
export type PhaseGateWalk = {
  /** The steps actually taken, in order. */
  readonly steps: readonly StepOfThePhaseGate[];
  /** Whether the layer was called at each point, and what it returned. */
  readonly onEvidence: LayerCallOutcome<{ readonly closingCheck: boolean }> | undefined;
  readonly contributeCriticInput: LayerCallOutcome<readonly FactBlockRow[]> | undefined;
  /** True once the layer failed at either call: the classic loop from then on. */
  readonly layerOffForTheAttempt: boolean;
  /** Every failure, in the order the calls were made. */
  readonly failures: readonly LayerCallFailure[];
  /** Whether a closing check runs, from `onEvidence`; false where the layer is off. */
  readonly closingCheck: boolean;
  /** The rows of the fact block the layer contributed; empty where it is off. */
  readonly factBlockRows: readonly FactBlockRow[];
  /** The result of the verification gate, which ran whatever the layer returned. */
  readonly verification: VerificationGateResult;
  /** Every event raised, in order. */
  readonly events: readonly LayerCallEvent[];
  /** IR-07: the walk adds neither. */
  readonly exitCode: undefined;
  readonly stopReason: undefined;
};

/* ------------------------------------------------------------------ *
 * One call of a layer at one call point.
 * ------------------------------------------------------------------ */

/**
 * Call a layer at one of the two call points.
 *
 * A thrown error and a return value the engine does not offer are the same
 * failure: the value is read as `none` (§D.1, "Unknown-value rule") and the
 * layer is off for the phase attempt. Nothing of it halts the run.
 */
export function callTheLayerAt<T>(
  callPoint: CallPointAroundThePhaseGate,
  layerId: string,
  call: () => unknown,
  isKnownReturn: (value: unknown) => value is T,
): LayerCallOutcome<T> {
  let returned: unknown;
  try {
    returned = call();
  } catch (error) {
    return Object.freeze({
      callPoint,
      value: "none" as const,
      failure: failureOf(
        callPoint,
        layerId,
        "threw",
        error instanceof Error ? error.message : String(error),
      ),
    });
  }
  if (returned === "none") return Object.freeze({ callPoint, value: "none" as const });
  if (isKnownReturn(returned)) return Object.freeze({ callPoint, value: returned });
  return Object.freeze({
    callPoint,
    value: "none" as const,
    failure: failureOf(callPoint, layerId, "unknown-return", textOf(returned)),
  });
}

function failureOf(
  callPoint: CallPointAroundThePhaseGate,
  layerId: string,
  reason: OffReason,
  detail: string,
): LayerCallFailure {
  return Object.freeze({
    callPoint,
    layerId,
    reason,
    detail,
    path: FAILURE_PATH,
    exitCode: undefined,
    stopReason: undefined,
  });
}

/** A value the engine does not offer, as text for the record. */
function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** The known return of `onEvidence` (§D.1 row 5). */
export function isOnEvidenceReturn(value: unknown): value is { readonly closingCheck: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { closingCheck?: unknown }).closingCheck === "boolean"
  );
}

/** The known return of `contributeCriticInput` (§D.1 row 6): rows of the fact block. */
export function isContributeCriticInputReturn(value: unknown): value is readonly FactBlockRow[] {
  return (
    Array.isArray(value) &&
    value.every((row) => typeof row === "object" && row !== null && !Array.isArray(row))
  );
}

/* ------------------------------------------------------------------ *
 * The walk of one phase gate.
 * ------------------------------------------------------------------ */

/**
 * T015 — walk one phase gate with the loop layer on.
 *
 * The walk is the four guarantees of F149-FR-007 in one function:
 *
 *  - `onEvidence` is called before the phase gate, and `contributeCriticInput`
 *    before the critic prompt is assembled;
 *  - the WHOLE verification gate runs afterwards, whatever either call
 *    returned — there is no branch of this function in which it does not run,
 *    and no value of the layer reaches its result;
 *  - a failure at either call takes the layer off for the PHASE ATTEMPT: the
 *    second call is not made after a failure at the first, the rows of the fact
 *    block are empty, no closing check runs, and the phase gate runs in full;
 *  - neither an exit code nor a stop reason comes of any of it.
 */
export async function walkThePhaseGate(deps: PhaseGateWalkDependencies): Promise<PhaseGateWalk> {
  const layer = deps.layer;
  const layerId = layer?.id ?? "none";
  const events: LayerCallEvent[] = [];
  const failures: LayerCallFailure[] = [];
  const steps: StepOfThePhaseGate[] = [];
  const raise = (event: LayerCallEvent): void => {
    events.push(event);
    deps.onEvent?.(event);
  };

  let off = false;

  /* Step 1 — `onEvidence`, when phase evidence appears, before the phase gate. */
  let onEvidence: LayerCallOutcome<{ readonly closingCheck: boolean }> | undefined;
  if (layer?.onEvidence !== undefined) {
    steps.push("onEvidence");
    const method = layer.onEvidence.bind(layer);
    onEvidence = callTheLayerAt<{ readonly closingCheck: boolean }>(
      "onEvidence",
      layerId,
      () => method(deps.view),
      isOnEvidenceReturn,
    );
    raise(
      Object.freeze({ name: LAYER_CALL_EVENT, callPoint: "onEvidence", layerId, blocking: false }),
    );
    if (onEvidence.failure !== undefined) {
      off = true;
      failures.push(onEvidence.failure);
      raise(
        Object.freeze({
          name: LAYER_OFF_EVENT,
          callPoint: "onEvidence",
          layerId,
          reason: onEvidence.failure.reason,
          directive: DIRECTIVE_ON_A_FAILURE,
          blocking: false,
        }),
      );
    }
  }

  /* Step 2 — the whole verification gate, whatever the layer returned. There is
   * no `if` around this call: that is the guarantee. */
  steps.push("verification-gate");
  const verification = await deps.verificationGate(deps.view);

  /* Step 3 — `contributeCriticInput`, before the critic prompt is assembled.
   * A layer that is off for the phase attempt is not called again. */
  let contributeCriticInput: LayerCallOutcome<readonly FactBlockRow[]> | undefined;
  if (!off && layer?.contributeCriticInput !== undefined) {
    steps.push("contributeCriticInput");
    const method = layer.contributeCriticInput.bind(layer);
    contributeCriticInput = callTheLayerAt<readonly FactBlockRow[]>(
      "contributeCriticInput",
      layerId,
      () => method(deps.view),
      isContributeCriticInputReturn,
    );
    raise(
      Object.freeze({
        name: LAYER_CALL_EVENT,
        callPoint: "contributeCriticInput",
        layerId,
        blocking: false,
      }),
    );
    if (contributeCriticInput.failure !== undefined) {
      off = true;
      failures.push(contributeCriticInput.failure);
      raise(
        Object.freeze({
          name: LAYER_OFF_EVENT,
          callPoint: "contributeCriticInput",
          layerId,
          reason: contributeCriticInput.failure.reason,
          directive: DIRECTIVE_ON_A_FAILURE,
          blocking: false,
        }),
      );
    }
  }

  /* Steps 4 and 5 — the critic prompt and `judge`. They are the phase gate's
   * and run in full; the layer has no say in either. */
  steps.push("critic-prompt");
  steps.push("judge");

  const rows =
    contributeCriticInput !== undefined && contributeCriticInput.value !== "none"
      ? Object.freeze([...contributeCriticInput.value])
      : Object.freeze([]);

  return Object.freeze({
    steps: Object.freeze(steps),
    onEvidence,
    contributeCriticInput,
    layerOffForTheAttempt: off,
    failures: Object.freeze(failures),
    closingCheck:
      !off && onEvidence !== undefined && onEvidence.value !== "none"
        ? onEvidence.value.closingCheck
        : false,
    factBlockRows: off ? Object.freeze([]) : rows,
    verification,
    events: Object.freeze(events),
    exitCode: undefined,
    stopReason: undefined,
  });
}

/**
 * The walk of the classic loop: the engine with the layer off (decision 21).
 * It is the same walk with no layer, which is how CT-149-7 compares the two.
 */
export function theClassicWalk(
  view: PhaseAttemptView,
  verificationGate: VerificationGate,
): Promise<PhaseGateWalk> {
  return walkThePhaseGate({ view, verificationGate });
}

/* ------------------------------------------------------------------ *
 * IR-07 — a seam, a loop layer and the bump add no exit code and no
 * stop reason.
 * ------------------------------------------------------------------ */

/** F149-FR-007, last sentence: the three add none. Both lists are empty. */
export const EXIT_CODES_ADDED: readonly number[] = Object.freeze([]);
export const STOP_REASONS_ADDED: readonly string[] = Object.freeze([]);

/** §D.1: a failure of a layer produces neither. */
export const A_FAILURE_PRODUCES_AN_EXIT_CODE_OR_STOP_REASON =
  FAILURE_PRODUCES_AN_EXIT_CODE_OR_STOP_REASON;

/** The exit codes of the engine, which the three do not add to (annex E §E.4). */
export const EXIT_CODES_OF_THE_ENGINE: readonly number[] = Object.freeze([...ENGINE_EXIT_CODES]);

/** The stop reasons of the engine, which the three do not add to (annex E §E.3). */
export const STOP_REASONS_OF_THE_ENGINE: readonly StopReason[] = Object.freeze([...STOP_REASONS]);

/** True when every exit code seen with the layer and the bump on was already there. */
export function exitCodesAreASubset(
  withTheOptionsOn: readonly number[],
  withThemOff: readonly number[],
): boolean {
  return withTheOptionsOn.every((code) => withThemOff.includes(code));
}

/** True when every stop reason seen with the layer and the bump on was already there. */
export function stopReasonsAreASubset(
  withTheOptionsOn: readonly string[],
  withThemOff: readonly string[],
): boolean {
  return withTheOptionsOn.every((reason) => withThemOff.includes(reason));
}

/** The members of the two sets that the options added, which must be none. */
export function addedByTheOptions(
  withTheOptionsOn: readonly (string | number)[],
  withThemOff: readonly (string | number)[],
): readonly (string | number)[] {
  return Object.freeze(withTheOptionsOn.filter((value) => !withThemOff.includes(value)));
}

/** The call point of §D.1 a point of this module belongs to, for the record. */
export function annexCallPointOf(point: CallPointAroundThePhaseGate): CallPoint {
  return point;
}
