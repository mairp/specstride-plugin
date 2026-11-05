/**
 * T057 of feature 103 — THE BUILT-IN LAYER `none` (F103-FR-023; annex D §D.1,
 * "Purpose" and "Guarantees of the core").
 *
 * The classic loop IS the engine with this layer: the strategy `classic`,
 * which is the value of the key `loop.strategy` under the `parity` profile
 * (row 1 of annex X §X.7). The layer returns `none` at every one of the eight
 * call points, declares no directive and no service, and therefore engages
 * never.
 *
 * ## What `none` is at a call point whose return is not a word
 *
 * Six call points return `none` literally. Two cannot, because their return is
 * a list or a record, and for those `none` is the empty value of that shape:
 *
 *  - `contributePrompt` returns NO block — not even a protocol block, because
 *    a built-in layer has no protocol to announce (F103-FR-038 gives the block
 *    to a layer that is registered);
 *  - `report` returns the layer fields of the `[LOOP]` line for a layer that
 *    never engaged: the id `none`, not engaged, no unit of work.
 *
 * `NONE_AT_EVERY_CALL_POINT` states, per call point, which of the three it is,
 * so a test reads the rule from the module rather than from this comment.
 *
 * ## Inertness
 *
 * F103-FR-023 is a statement about OUTPUT, not about code: with this layer,
 * and with a registered layer that never engages because no unit of work is
 * declared, the output equals the classic loop apart from the fields the
 * divergence register names. Those fields are `INERTNESS_EXCEPTIONS`, and
 * nothing else may differ — in particular no time limit of a pass and no
 * command of the runtime (`TIME_LIMITS_AND_COMMANDS_DIFFER_BEFORE_ENGAGEMENT`
 * is `false`).
 *
 * ## The gate that does not execute
 *
 * In a run whose verification gate does not execute, the layer is OFF and the
 * announcement carries the reason `gate-not-executing` (F103-FR-023).
 */
import {
  CALL_POINTS,
  REASON_WHERE_THE_GATE_DOES_NOT_EXECUTE,
  RETURN_WHEN_UNKNOWN,
} from "@specstride/contracts/ep/loop-layer";
import type {
  AfterPassResult,
  BetweenPassesOutcome,
  CallPoint,
  LayerRegistration,
  LoopLayer,
  PromptBlock,
} from "@specstride/contracts/ep/loop-layer";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F103-FR-022", "F103-FR-023"] as const;

/** F103-FR-023 — the id of the built-in layer. */
export const BUILT_IN_LAYER_ID = "none" as const;

/** F103-FR-023 — the strategy the built-in layer is, and its key. */
export const CLASSIC_STRATEGY = "classic" as const;
export const STRATEGY_KEY = "loop.strategy" as const;

/** F103-FR-023 — the value of that key under the `parity` profile. */
export const STRATEGY_UNDER_PARITY = CLASSIC_STRATEGY;

/** F103-FR-023 — the reason announced where the verification gate does not execute. */
export const GATE_NOT_EXECUTING = REASON_WHERE_THE_GATE_DOES_NOT_EXECUTE;

/** F103-FR-023 — the built-in layer declares no directive and no service. */
export const registrationOfNone: LayerRegistration = Object.freeze({
  id: BUILT_IN_LAYER_ID,
  directives: Object.freeze([]),
  services: Object.freeze([]),
  ledgerNamespace: BUILT_IN_LAYER_ID,
});

/** How `none` is expressed at each call point: the word, an empty list, or inert fields. */
export const NONE_AT_EVERY_CALL_POINT: Readonly<
  Record<CallPoint, "the word `none`" | "no block" | "inert fields">
> = Object.freeze({
  contributePrompt: "no block",
  afterPass: "the word `none`",
  betweenPasses: "the word `none`",
  nextPassBlock: "the word `none`",
  onEvidence: "the word `none`",
  contributeCriticInput: "the word `none`",
  resume: "the word `none`",
  report: "inert fields",
});

/** The fields of the `[LOOP]` line of a layer that never engaged. */
export const REPORT_OF_NONE: Readonly<Record<string, unknown>> = Object.freeze({
  layer: BUILT_IN_LAYER_ID,
  strategy: CLASSIC_STRATEGY,
  engaged: false,
  units: 0,
});

/**
 * F103-FR-023 — the built-in layer `none`: `none` at every call point.
 *
 * `afterPass` returns `RETURN_WHEN_UNKNOWN` of the contract, which IS the word
 * `none`, so that the one value this layer gives and the value an unknown
 * return is read as cannot drift apart.
 */
export const layerNone: LoopLayer = Object.freeze({
  registration: registrationOfNone,
  contributePrompt(): readonly PromptBlock[] {
    return Object.freeze([]);
  },
  afterPass(): AfterPassResult {
    return RETURN_WHEN_UNKNOWN;
  },
  betweenPasses(): BetweenPassesOutcome | "none" {
    return "none";
  },
  nextPassBlock(): PromptBlock | "none" {
    return "none";
  },
  onEvidence(): { readonly closingCheck: boolean } | "none" {
    return "none";
  },
  contributeCriticInput(): readonly Readonly<Record<string, unknown>>[] | "none" {
    return "none";
  },
  resume(): BetweenPassesOutcome | "none" {
    return "none";
  },
  report(): Readonly<Record<string, unknown>> {
    return REPORT_OF_NONE;
  },
});

/**
 * F103-FR-023 — the only output a layer that is on and never engages may add.
 * The divergence register names each: the layer fields of the run record and
 * of the `[LOOP]` line (DV-012, DV-018), the protocol block of F103-FR-038
 * (DV-020) and the ledger records of F103-FR-039 (DV-053).
 */
export const INERTNESS_EXCEPTIONS = [
  "the layer fields of the run record",
  "the layer fields of the `[LOOP]` line",
  "the protocol block of the registered layer (F103-FR-038)",
  "the ledger records of the layer's namespace (F103-FR-039)",
] as const;

/** F103-FR-023 — until a layer is engaged, neither of these differs. */
export const TIME_LIMITS_AND_COMMANDS_DIFFER_BEFORE_ENGAGEMENT = false as const;

/**
 * F103-FR-023 — the counters a layer that never engages leaves untouched: it
 * leaves ALL of them, so the comparison a test makes is of the whole record
 * and `countersAreEqual` is that comparison, by key and by value.
 */
export function countersAreEqual(
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>,
): boolean {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.every((key) => left[key] === right[key]);
}

/**
 * F103-FR-023 — the layer is off in a run whose verification gate does not
 * execute, with the reason `gate-not-executing`. The gate modes in which it
 * does not execute are `plan` and `off` (F100-FR-118); every other mode runs
 * it, and the layer stays as the router left it.
 */
export const GATE_MODES_THAT_DO_NOT_EXECUTE = ["plan", "off"] as const;

export function offBecauseTheGateDoesNotExecute(
  gateMode: string,
): { readonly off: true; readonly reason: typeof GATE_NOT_EXECUTING } | undefined {
  if ((GATE_MODES_THAT_DO_NOT_EXECUTE as readonly string[]).includes(gateMode)) {
    return Object.freeze({ off: true as const, reason: GATE_NOT_EXECUTING });
  }
  return undefined;
}

/** The eight call points, in the fixed order, as this module answers them. */
export const CALL_POINTS_OF_NONE = CALL_POINTS;
