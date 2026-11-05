/**
 * T057 of feature 103 — THE EIGHT CALL POINTS, their fixed order after a pass,
 * the closed returns of `afterPass`, and what switches a layer off
 * (F103-FR-022, F103-FR-024, F103-FR-027; annex D §D.1).
 *
 * ## The eight call points
 *
 * `CALL_POINTS_IN_ORDER` is the closed, ordered set of the annex, and
 * `INVOKE_AT` is the one table through which the engine reaches every one of
 * them. There is no second way in: a call point the table does not hold is a
 * call point the engine does not make, which is what makes "the eight" a
 * checkable statement and not a hope.
 *
 * ## The fixed order after a pass
 *
 * `ORDER_AFTER_A_PASS` — the kill check, the yield check, the layer, and then
 * the classic accounting. `afterAPass` is that order as a driver: it runs the
 * four steps, records which ran, and stops at the first that ends the loop. The
 * classic loop (`../pass-loop/loop.ts`) keeps the same order through its hooks;
 * this module is the order as the layer side sees it, and both read the same
 * constant of `@specstride/contracts`.
 *
 * ## Stacking: outer first, inner only on `none`
 *
 * F103-FR-024 — at every call point the outer layer is called first and the
 * inner layer only where the outer returned `none`. `isNone` is what `none`
 * means at a call point whose return is not a word: the word itself, nothing at
 * all, or an EMPTY list of blocks or rows. A layer that returns one block has
 * answered, and the inner layer is not called.
 *
 * ## Failure: the layer goes off, and nothing else happens
 *
 * F103-FR-027 — a thrown error, an invalid ledger, a spent cap, a check that
 * cannot start and an unknown return value each switch the layer off for the
 * phase attempt; a failure of the application of a group switches it off for
 * the run. Each is announced and recorded, the classic loop carries on, and
 * NONE of them produces a run state, an exit code or a stop reason:
 * `NO_RUN_STATE_NO_EXIT_CODE_NO_STOP_REASON` is the shape of that end, and
 * `FAILURE_PRODUCES_A_RUN_STATE_AN_EXIT_CODE_OR_A_STOP_REASON` is `false`.
 *
 * An unknown return at `afterPass` is read as `none` AND switches the layer
 * off: the two halves of F103-FR-022's last sentence are one branch here, so
 * neither can be implemented without the other.
 */
import {
  AFTER_PASS_RESULTS,
  CALL_POINTS,
  ERRORS,
  FAILURE_OF_A_GROUP_APPLICATION,
  FAILURE_PATH,
  FAILURE_PRODUCES_AN_EXIT_CODE_OR_STOP_REASON,
  ORDER_AFTER_A_PASS,
  RETURN_WHEN_UNKNOWN,
} from "@specstride/contracts/ep/loop-layer";
import type {
  AfterPassResult,
  CallPoint,
  LoopLayer,
  PhaseAttemptView,
} from "@specstride/contracts/ep/loop-layer";
import { BUILT_IN_LAYER_ID } from "./none.ts";
import type { LoopLayerRegistry, RegisteredLayer } from "./registry.ts";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F103-FR-022", "F103-FR-024", "F103-FR-027"] as const;

/** F103-FR-022 — the eight call points, in the fixed order of annex D §D.1. */
export const CALL_POINTS_IN_ORDER = CALL_POINTS;

/** F103-FR-022 — the fixed order of the steps after a pass. */
export const ORDER_OF_THE_STEPS_AFTER_A_PASS = ORDER_AFTER_A_PASS;

/** F103-FR-022 — the closed set of returns of `afterPass`. */
export const AFTER_PASS_RETURNS = AFTER_PASS_RESULTS;

/** F103-FR-022 — a return outside that set is read as this. */
export const AFTER_PASS_WHEN_UNKNOWN = RETURN_WHEN_UNKNOWN;

/** F103-FR-027 — a failure inside a layer ends like this, and no other way. */
export const FAILURE_PATH_OF_A_LAYER = FAILURE_PATH;
export const FAILURE_OF_A_GROUP = FAILURE_OF_A_GROUP_APPLICATION;
export const FAILURE_PRODUCES_A_RUN_STATE_AN_EXIT_CODE_OR_A_STOP_REASON =
  FAILURE_PRODUCES_AN_EXIT_CODE_OR_STOP_REASON;

/** F103-FR-027 — what a layer failure leaves behind: nothing of the run. */
export const NO_RUN_STATE_NO_EXIT_CODE_NO_STOP_REASON = Object.freeze({
  runState: undefined,
  exit_code: undefined,
  stopReason: undefined,
});

/** The four "Errors" of §D.1, as the annex words them. */
export const ERRORS_OF_A_LAYER = ERRORS;

/* ------------------------------------------------------------------ *
 * What switches a layer off, and for how long (F103-FR-027).
 * ------------------------------------------------------------------ */

/** The scope for which a layer goes off. */
export const OFF_SCOPES = ["phase-attempt", "run"] as const;
export type OffScope = (typeof OFF_SCOPES)[number];

/** The closed set of reasons a layer goes off. */
export const OFF_REASONS = [
  "thrown-error",
  "invalid-ledger",
  "spent-cap",
  "check-cannot-start",
  "unknown-return",
  "group-application-not-completed",
  "layerOffForAttempt",
  "layerOffForRun",
  "gate-not-executing",
] as const;
export type OffReason = (typeof OFF_REASONS)[number];

/** F103-FR-027 — the scope each reason switches the layer off for. */
export const SCOPE_OF_REASON: Readonly<Record<OffReason, OffScope>> = Object.freeze({
  "thrown-error": "phase-attempt",
  "invalid-ledger": "phase-attempt",
  "spent-cap": "phase-attempt",
  "check-cannot-start": "phase-attempt",
  "unknown-return": "phase-attempt",
  "group-application-not-completed": "run",
  layerOffForAttempt: "phase-attempt",
  layerOffForRun: "run",
  "gate-not-executing": "phase-attempt",
});

/** One layer switched off: announced, recorded, and nothing of the run. */
export type LayerOffRecord = {
  readonly layer: string;
  readonly reason: OffReason;
  readonly scope: OffScope;
  /** The call point at which it happened, where there was one. */
  readonly at?: CallPoint;
  /** The value the layer returned, where an unknown return was the reason. */
  readonly returned?: unknown;
  /** The line of compatibility output that announces it. */
  readonly announcement: string;
};

/** F103-FR-027 — the line that announces a layer switched off. */
export function offAnnouncement(layer: string, reason: OffReason, scope: OffScope): string {
  return `[LOOP] layer ${layer} off for the ${scope}: ${reason}`;
}

/** F103-FR-027 — the event recorded with it; it carries no exit code and no stop reason. */
export function offEvent(record: LayerOffRecord): {
  readonly asIsName: string;
  readonly fields: Readonly<Record<string, unknown>>;
} {
  return Object.freeze({
    asIsName: "layer.off",
    fields: Object.freeze({
      layer: record.layer,
      reason: record.reason,
      scope: record.scope,
      ...(record.at !== undefined ? { at: record.at } : {}),
    }),
  });
}

/* ------------------------------------------------------------------ *
 * The closed returns of `afterPass` (F103-FR-022).
 * ------------------------------------------------------------------ */

/** How the engine read what `afterPass` returned. */
export type AfterPassReading = {
  readonly result: AfterPassResult;
  /** True where the value was outside the closed set of three. */
  readonly wasUnknown: boolean;
  /** True where the layer must go off for the phase attempt because of it. */
  readonly switchesTheLayerOff: boolean;
  readonly returned: unknown;
};

/**
 * F103-FR-022 — read the return of `afterPass`. One of `accept`, `refuse` and
 * `none` stands; anything else is read as `none` AND switches the layer off for
 * the phase attempt.
 */
export function readAfterPass(returned: unknown): AfterPassReading {
  if (
    typeof returned === "string" &&
    (AFTER_PASS_RESULTS as readonly string[]).includes(returned)
  ) {
    return Object.freeze({
      result: returned as AfterPassResult,
      wasUnknown: false,
      switchesTheLayerOff: false,
      returned,
    });
  }
  return Object.freeze({
    result: AFTER_PASS_WHEN_UNKNOWN,
    wasUnknown: true,
    switchesTheLayerOff: true,
    returned,
  });
}

/* ------------------------------------------------------------------ *
 * The one table through which the engine reaches a call point.
 * ------------------------------------------------------------------ */

/** What a call point is given besides the read-only view. */
export type CallPointArguments = {
  readonly view: PhaseAttemptView;
  /** `afterPass` — the checkpoint found in the outbox. */
  readonly checkpoint?: unknown;
  /** `resume` — the state of the ledger, read-only. */
  readonly ledger?: readonly unknown[];
};

/**
 * F103-FR-022 — the eight call points as the engine makes them. Exactly one
 * entry per member of `CALL_POINTS_IN_ORDER`, which a test checks both ways.
 */
export const INVOKE_AT: Readonly<
  Record<CallPoint, (layer: LoopLayer, args: CallPointArguments) => unknown>
> = Object.freeze({
  contributePrompt: (layer, args) => layer.contributePrompt(args.view),
  afterPass: (layer, args) => layer.afterPass(args.view, args.checkpoint),
  betweenPasses: (layer, args) => layer.betweenPasses(args.view),
  nextPassBlock: (layer, args) => layer.nextPassBlock(args.view),
  onEvidence: (layer, args) => layer.onEvidence(args.view),
  contributeCriticInput: (layer, args) => layer.contributeCriticInput(args.view),
  resume: (layer, args) => layer.resume(args.view, args.ledger ?? Object.freeze([])),
  report: (layer) => layer.report(),
});

/**
 * F103-FR-024 — what `none` is at a call point.
 *
 * The word itself; nothing at all; an empty LIST, which is how a point whose
 * return is blocks or rows says `none`; or an empty RECORD, which is how
 * `report` says it has no field of the `[LOOP]` line to add. Anything else is
 * an answer, and the inner layer is not called.
 *
 * A record with one key is an answer even where its value is false:
 * `{ closingCheck: false }` of `onEvidence` says "no closing check", which is
 * a decision and not a silence.
 */
export function isNone(value: unknown): boolean {
  if (value === "none" || value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

/* ------------------------------------------------------------------ *
 * The stack of layers at one call point (F103-FR-024, F103-FR-027).
 * ------------------------------------------------------------------ */

/** What one call at one call point produced. */
export type CallResult = {
  readonly point: CallPoint;
  /** The value the engine takes: a layer's answer, or `none`. */
  readonly value: unknown;
  /** The id of the layer whose answer it is, or `none` where no layer answered. */
  readonly from: string;
  /** The layers consulted, in the order they were consulted: OUTER FIRST. */
  readonly consulted: readonly string[];
  /** The layers switched off during this call, with the reason. */
  readonly switchedOff: readonly LayerOffRecord[];
  /** `afterPass` only — how the return was read. */
  readonly afterPass?: AfterPassReading;
};

/**
 * The layer side of one phase attempt: the stack the registry holds, which
 * layers are off and for how long, and every call point the engine made.
 *
 * An EMPTY stack, and a stack every member of which is off, are both the
 * built-in layer `none`: `call` returns `none` from `none` and the classic loop
 * carries on. That is why a layer failure needs no further path — going off IS
 * the path.
 */
export class LoopLayerStack {
  private readonly offForTheRun = new Map<string, LayerOffRecord>();
  private readonly offForTheAttempt = new Map<string, LayerOffRecord>();
  private readonly calls: CallResult[] = [];
  private readonly offRecords: LayerOffRecord[] = [];

  private readonly registry: LoopLayerRegistry;

  constructor(registry: LoopLayerRegistry) {
    this.registry = registry;
  }

  /** The stack, outer first, as the registry holds it. */
  layers(): readonly RegisteredLayer[] {
    return this.registry.stack();
  }

  /** True where the layer is on: registered, and off for neither scope. */
  isOn(layerId: string): boolean {
    if (this.registry.find(layerId) === undefined) return false;
    return !this.offForTheRun.has(layerId) && !this.offForTheAttempt.has(layerId);
  }

  /** The layers that are on, outer first; empty means the built-in layer `none`. */
  layersOn(): readonly RegisteredLayer[] {
    return Object.freeze(this.registry.stack().filter((held) => this.isOn(held.id)));
  }

  /** F103-FR-027 — switch a layer off, announced and recorded. */
  switchOff(
    layerId: string,
    reason: OffReason,
    at?: CallPoint,
    returned?: unknown,
  ): LayerOffRecord {
    const scope = SCOPE_OF_REASON[reason];
    const record: LayerOffRecord = Object.freeze({
      layer: layerId,
      reason,
      scope,
      ...(at !== undefined ? { at } : {}),
      ...(returned !== undefined ? { returned } : {}),
      announcement: offAnnouncement(layerId, reason, scope),
    });
    if (scope === "run") this.offForTheRun.set(layerId, record);
    else this.offForTheAttempt.set(layerId, record);
    this.offRecords.push(record);
    return record;
  }

  /**
   * The next phase attempt begins: what was off FOR THE PHASE ATTEMPT comes
   * back on, and what was off FOR THE RUN stays off. The two maps exist for
   * this one difference.
   */
  newPhaseAttempt(): void {
    this.offForTheAttempt.clear();
  }

  /** Every layer switched off so far, in the order it happened. */
  offSoFar(): readonly LayerOffRecord[] {
    return Object.freeze([...this.offRecords]);
  }

  /** Every call the engine made, in the order it made them. */
  callsSoFar(): readonly CallResult[] {
    return Object.freeze([...this.calls]);
  }

  /**
   * F103-FR-022, F103-FR-024, F103-FR-027 — one call point.
   *
   * The outer layer first; the inner one only where the outer returned `none`.
   * A throw switches that layer off for the phase attempt and the call carries
   * on to the inner layer, because a layer that failed has returned nothing and
   * `none` is what nothing is. At `afterPass` the closed set of three is
   * enforced and an unknown return switches the layer off as well.
   */
  call(point: CallPoint, args: CallPointArguments): CallResult {
    const consulted: string[] = [];
    const switchedOff: LayerOffRecord[] = [];
    let value: unknown = "none";
    let from: string = BUILT_IN_LAYER_ID;
    let reading: AfterPassReading | undefined;

    for (const held of this.layersOn()) {
      consulted.push(held.id);
      let returned: unknown;
      try {
        returned = INVOKE_AT[point](held.layer, args);
      } catch {
        switchedOff.push(this.switchOff(held.id, "thrown-error", point));
        continue;
      }
      if (point === "afterPass") {
        const read = readAfterPass(returned);
        reading = read;
        if (read.switchesTheLayerOff) {
          switchedOff.push(this.switchOff(held.id, "unknown-return", point, returned));
          continue;
        }
        if (read.result !== "none") {
          value = read.result;
          from = held.id;
          break;
        }
        continue;
      }
      if (!isNone(returned)) {
        value = returned;
        from = held.id;
        break;
      }
    }

    const result: CallResult = Object.freeze({
      point,
      value,
      from,
      consulted: Object.freeze(consulted),
      switchedOff: Object.freeze(switchedOff),
      ...(reading !== undefined ? { afterPass: reading } : {}),
    });
    this.calls.push(result);
    return result;
  }

  /** The call points the engine has made, in order, as plain names. */
  pointsCalled(): readonly CallPoint[] {
    return Object.freeze(this.calls.map((c) => c.point));
  }
}

/* ------------------------------------------------------------------ *
 * The fixed order after a pass (F103-FR-022).
 * ------------------------------------------------------------------ */

/** One step of the order after a pass; a result ends the loop. */
export type AfterPassStep = () => { readonly exit_code: number } | undefined | void;

/** The four steps, by the names of `ORDER_AFTER_A_PASS`. */
export type AfterPassSteps = {
  readonly killCheck?: AfterPassStep;
  readonly yieldCheck?: AfterPassStep;
  readonly layer?: AfterPassStep;
  readonly classicAccounting?: AfterPassStep;
};

/** What `afterAPass` observed: which steps ran, in order, and what ended the loop. */
export type AfterPassRun = {
  readonly ran: readonly string[];
  readonly endedAt?: string;
  readonly exit_code?: number;
};

/**
 * F103-FR-022 — run the four steps after a pass in the fixed order and report
 * which ran. An absent step is a no-op that still counts as its place in the
 * order, so a feature that fills one later does not move the steps around it.
 */
export function afterAPass(steps: AfterPassSteps): AfterPassRun {
  const byName: Readonly<Record<string, AfterPassStep | undefined>> = Object.freeze({
    "kill check": steps.killCheck,
    "yield check": steps.yieldCheck,
    layer: steps.layer,
    "classic accounting": steps.classicAccounting,
  });
  const ran: string[] = [];
  for (const name of ORDER_AFTER_A_PASS) {
    ran.push(name);
    const ended = byName[name]?.();
    if (ended !== undefined && ended !== null && typeof ended.exit_code === "number") {
      return Object.freeze({
        ran: Object.freeze(ran),
        endedAt: name,
        exit_code: ended.exit_code,
      });
    }
  }
  return Object.freeze({ ran: Object.freeze(ran) });
}
