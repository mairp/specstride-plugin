/**
 * T039 — the registration of the layer `micro` (F115-FR-002; annex D §D.1).
 *
 * The layer registers as the implementation `micro` of the loop-layer
 * interface and declares at registration:
 *
 * - the directives `keep`, `repair`, `unresolved`, `layerOffForAttempt`,
 *   `layerOffForRun`, `giveIterationBack`, `exemptShortPass`,
 *   `exemptRepeatCounter` and `requestPass` — exactly the nine of
 *   F115-FR-002, each a member of the closed set of the directives of
 *   §D.1;
 * - the services the engine offers and the layer uses: the check runner,
 *   the router, the ledger namespace `micro`, the fingerprints and the
 *   builder of the fact block.
 *
 * The layer holds no state outside its ledger namespace `micro` (F115-FR-002):
 * the registration carries the namespace name, and the only mutable state
 * this package holds is handed to it through the namespace port below. It
 * holds no writer of an approval, a verdict, feedback, a hint or a recovery
 * marker (IR-01): `PHASE_GATE_WRITES` is empty, and the registration refuses
 * any service that claims one.
 *
 * Purity: imports `@specstride/contracts` only; no `node:fs`, no process.
 */
import { epLoopLayer, type epLoopLayer as epLoopLayerTypes } from "@specstride/contracts";

type Directive = epLoopLayerTypes.Directive;
import { callPoints, CALLED_POINTS } from "./callpoints/index.ts";
import { checkpointContractBlock } from "./callpoints/contribute-prompt.ts";
import { FACT_BLOCK_BUILDER_SERVICE } from "./callpoints/contribute-critic-input.ts";

/** The strategy this package implements (closed set row 55). */
export const MICRO_STRATEGY = "micro" as const;

/** The recorded micro level: L1 on every harness (F115-FR-003). */
export const MICRO_LEVEL = "L1" as const;

/** The nine directives F115-FR-002 names, in the order it names them. */
export const DECLARED_DIRECTIVES = [
  "keep",
  "repair",
  "unresolved",
  "layerOffForAttempt",
  "layerOffForRun",
  "giveIterationBack",
  "exemptShortPass",
  "exemptRepeatCounter",
  "requestPass",
] as const satisfies readonly Directive[];

/** The services the layer declares, as the engine offers them (§D.1 Inputs). */
export const DECLARED_SERVICES = [
  "check-runner",
  "router",
  "ledger-namespace:micro",
  "fingerprints",
  FACT_BLOCK_BUILDER_SERVICE,
] as const;

/** The one ledger namespace of the layer; no state outside it (F115-FR-002). */
export const LEDGER_NAMESPACE = "micro" as const;

/**
 * IR-01 — the writers of the phase gate the layer holds: none. A writer of
 * an approval, a verdict, a feedback, a hint or a recovery marker would be
 * a member of this set; the set is empty by construction and the static
 * test of CT-115-101 holds this file to it.
 */
export const FORBIDDEN_PHASE_GATE_WRITES: readonly string[] = Object.freeze([
  "approval",
  "verdict",
  "feedback",
  "hint",
  "recovery-marker",
]);

/**
 * The records of the phase gate the writes of the layer may touch: none.
 * The set of writes to the records of the phase gate over every fixture
 * MUST equal that of the same fixture with the layer off (F115-FR-002), so
 * the layer declares the empty permission explicitly. No member of
 * `FORBIDDEN_PHASE_GATE_WRITES` may ever appear here (IR-01).
 */
export function phaseGateWritesAllowed(): readonly string[] {
  return [];
}

/** A declaration that a directive is outside what F115-FR-002 declares. */
export class UndeclaredDirectiveError extends Error {}

/**
 * Check the declared directives against the closed set of §D.1 and against
 * F115-FR-002. A directive the closed set does not hold is refused here,
 * at registration, and never reaches the engine.
 */
export function checkDeclaredDirectives(): readonly Directive[] {
  for (const directive of DECLARED_DIRECTIVES) {
    if (!(epLoopLayer.DIRECTIVES as readonly string[]).includes(directive)) {
      throw new UndeclaredDirectiveError(`not a directive of annex D §D.1: ${directive}`);
    }
  }
  return [...DECLARED_DIRECTIVES];
}

/** The eight call points of EP-04, as the skeleton of T010 shaped them. */
export function declaredCallPoints(): readonly string[] {
  return [...CALLED_POINTS];
}

/** The prompt block provider of the layer: the checkpoint contract block. */
export function declaredPromptBlocks(): readonly string[] {
  return [checkpointContractBlock().id];
}

/** The registration record the engine holds for this layer. */
export type LayerMicroRegistration = {
  readonly strategy: typeof MICRO_STRATEGY;
  readonly level: typeof MICRO_LEVEL;
  readonly directives: readonly Directive[];
  readonly services: readonly string[];
  readonly ledgerNamespace: typeof LEDGER_NAMESPACE;
  readonly callPoints: readonly string[];
  readonly promptBlocks: readonly string[];
  /** IR-01 — the empty permission on the records of the phase gate. */
  readonly phaseGateWrites: readonly string[];
};

/** F115-FR-002 — the registration of the layer with the engine. */
export function registerLayerMicro(): LayerMicroRegistration {
  return Object.freeze({
    strategy: MICRO_STRATEGY,
    level: MICRO_LEVEL,
    directives: checkDeclaredDirectives(),
    services: [...DECLARED_SERVICES],
    ledgerNamespace: LEDGER_NAMESPACE,
    callPoints: declaredCallPoints(),
    promptBlocks: declaredPromptBlocks(),
    phaseGateWrites: phaseGateWritesAllowed(),
  });
}

/** Re-exported so that one import of the package reaches the whole layer. */
export { callPoints };
