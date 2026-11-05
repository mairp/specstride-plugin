/**
 * T057 of feature 103 — THE REGISTRY OF LOOP LAYERS: what a layer declares,
 * what the engine offers, how two layers stack, and what the router may take
 * from a decision at `loop` (F103-FR-022, F103-FR-024, F103-FR-025,
 * F103-FR-029; annex D §D.1).
 *
 * ## Negotiation at registration
 *
 * A layer declares the directives and the services it uses. The engine offers
 * the eleven directives of the closed set and ONE service, the tree store of
 * annex D §D.2 — and it offers that service only where an IMPLEMENTATION of it
 * is registered (F103-FR-029). A declaration the engine cannot meet refuses the
 * layer at registration, with a message that names the layer and the directive
 * or the service. Nothing is silently dropped: a refused layer is not
 * registered at all, so the loop runs with the built-in layer `none`.
 *
 * This feature builds NOTHING of the tree store. `offeredServices` is handed
 * the implementations the engine holds; with none, the set of offered services
 * is empty and a layer that declared `treeStore` is refused. What is built
 * behind that reserved interface is another feature's content.
 *
 * ## Stacking
 *
 * At most two layers (`MAX_STACK_DEPTH`), outer first. Each layer has a ledger
 * namespace of its OWN: two layers that declare the same namespace are refused,
 * because a shared namespace is a way for one layer to hold state in another's
 * (F103-FR-024).
 *
 * ## A group needs the harness to declare `concurrentSessions`
 *
 * F103-FR-025 — the engine reads the capability `concurrentSessions` of the
 * harness port and refuses a request for a GROUP of passes where the harness
 * adapter does not declare it. `groupRefusal` is that reading: a capability
 * whose value is null, or whose provenance is null, is not declared.
 *
 * ## The router never switches a layer on
 *
 * F103-FR-022 — before the first pass of a phase attempt the engine consults
 * the router at the decision point `loop`, records the decision, and takes from
 * it ONLY a registered layer or off. A decision that names a layer the registry
 * does not hold is recorded and read as off; the router cannot switch a layer
 * on, which is `A_ROUTER_DECISION_CAN_SWITCH_A_LAYER_ON` being `false`.
 */
import {
  DIRECTIVES,
  MAX_STACK_DEPTH,
  OUTER_LAYER_FIRST,
} from "@specstride/contracts/ep/loop-layer";
import type { Directive, LayerRegistration, LoopLayer } from "@specstride/contracts/ep/loop-layer";
import type { Capabilities } from "@specstride/contracts/ep/harness";
import { DECISION_POINTS } from "@specstride/contracts/ep/router-rules";
import type { RouteDecision } from "@specstride/contracts/ep/router-rules";
import { BUILT_IN_LAYER_ID } from "./none.ts";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F103-FR-022", "F103-FR-024", "F103-FR-025", "F103-FR-029"] as const;

/** F103-FR-025 — the eleven directives the engine offers. */
export const DIRECTIVES_OFFERED: readonly Directive[] = DIRECTIVES;

/** F103-FR-029 — the one service of feature 103: the tree store of §D.2. */
export const TREE_STORE_SERVICE = "treeStore" as const;

/**
 * The five services a loop layer of feature 115 declares (F115-FR-002, annex
 * D §D.1 Inputs): the check runner, the router, the layer's own ledger
 * namespace, the fingerprints and the builder of the fact block. The core
 * stays layer-agnostic (F103-FR-028): the four generic services are keyed by
 * their fixed names, and a ledger namespace is keyed by the NAMESPACE NAME
 * the layer itself declared — the core never names a layer. Each service is
 * offered only where an implementation of it is handed, exactly as the tree
 * store is (F103-FR-029's rule is unchanged: nothing silently dropped).
 */
export const CHECK_RUNNER_SERVICE = "check-runner" as const;
export const ROUTER_SERVICE = "router" as const;
export const LEDGER_NAMESPACE_SERVICE_PREFIX = "ledger-namespace:" as const;
export const FINGERPRINTS_SERVICE = "fingerprints" as const;
export const FACT_BLOCK_BUILDER_SERVICE = "fact-block-builder" as const;

/** F103-FR-029 — this feature builds nothing of the tree-store service. */
export const THIS_FEATURE_BUILDS_THE_TREE_STORE = false as const;

/** F103-FR-024 — layers stack to this depth at most, outer first. */
export const STACK_DEPTH = MAX_STACK_DEPTH;
export const OUTER_FIRST = OUTER_LAYER_FIRST;

/** F100-FR-014 — the two classes a layer may be accepted as. */
export const ACCEPTED_CLASSES = ["data", "first-party"] as const;
export type LayerClass = (typeof ACCEPTED_CLASSES)[number];

/** F103-FR-022 — the decision point at which the router is consulted. */
export const ROUTER_DECISION_POINT = "loop" as const;

/** F103-FR-022 — the router cannot switch a layer on. */
export const A_ROUTER_DECISION_CAN_SWITCH_A_LAYER_ON = false as const;

/** F103-FR-022 — the choice that means "no layer for this phase attempt". */
export const ROUTER_CHOICE_OFF = "off" as const;

/** The services the engine can offer, where an implementation of each is held. */
export type ServiceImplementations = {
  /** The tree store of §D.2, built by another feature behind this interface. */
  readonly treeStore?: unknown;
  /** The check runner the inner checks of a layer run through (F115-FR-013). */
  readonly "check-runner"?: unknown;
  /** The router of EP-06, offered to a layer that declares it (F115-FR-033). */
  readonly router?: unknown;
  /**
   * The ledger namespaces the engine can write for a layer, keyed by the
   * NAMESPACE NAME the layer declared (F115-FR-002): the engine, not the
   * layer, writes the layer's state. The core stays layer-agnostic
   * (F103-FR-028): the name of a namespace is the layer's word, never a
   * constant of this module.
   */
  readonly ledgerNamespaces?: Readonly<Record<string, unknown>>;
  /** The fingerprints of the working tree (F115-FR-014, annex D §D.1). */
  readonly fingerprints?: unknown;
  /** The builder of the fact block of annex D §D.7 (F115-FR-012). */
  readonly "fact-block-builder"?: unknown;
};

/**
 * F103-FR-029 (unchanged for the five services of feature 115) — the services
 * the engine offers. A service is offered only where an IMPLEMENTATION of it
 * is registered; with none, it is not offered and a layer that declared it is
 * refused at registration. A ledger namespace is offered under the prefixed
 * name the layer declared (`ledger-namespace:<name>`).
 */
export function offeredServices(implementations: ServiceImplementations = {}): readonly string[] {
  const offered: string[] = [];
  if (implementations.treeStore !== undefined && implementations.treeStore !== null) {
    offered.push(TREE_STORE_SERVICE);
  }
  if (
    implementations[CHECK_RUNNER_SERVICE] !== undefined &&
    implementations[CHECK_RUNNER_SERVICE] !== null
  ) {
    offered.push(CHECK_RUNNER_SERVICE);
  }
  if (implementations[ROUTER_SERVICE] !== undefined && implementations[ROUTER_SERVICE] !== null) {
    offered.push(ROUTER_SERVICE);
  }
  for (const [name, held] of Object.entries(implementations.ledgerNamespaces ?? {})) {
    if (held !== undefined && held !== null) {
      offered.push(`${LEDGER_NAMESPACE_SERVICE_PREFIX}${name}`);
    }
  }
  if (
    implementations[FINGERPRINTS_SERVICE] !== undefined &&
    implementations[FINGERPRINTS_SERVICE] !== null
  ) {
    offered.push(FINGERPRINTS_SERVICE);
  }
  if (
    implementations[FACT_BLOCK_BUILDER_SERVICE] !== undefined &&
    implementations[FACT_BLOCK_BUILDER_SERVICE] !== null
  ) {
    offered.push(FACT_BLOCK_BUILDER_SERVICE);
  }
  return Object.freeze(offered);
}

/** One layer the registry holds, with the class it was accepted as. */
export type RegisteredLayer = {
  readonly id: string;
  readonly layer: LoopLayer;
  readonly layerClass: LayerClass;
  readonly ledgerNamespace: string;
  readonly directives: readonly Directive[];
  readonly services: readonly string[];
};

/** The outcome of one registration: accepted with the record, or refused with why. */
export type RegistrationOutcome =
  | { readonly accepted: true; readonly record: RegisteredLayer }
  | { readonly accepted: false; readonly message: string };

/** F103-FR-025 — a refusal names the layer and the directive or the service. */
export function refusalForDirective(layerId: string, directive: string): string {
  return (
    `the layer \`${layerId}\` is refused at registration: the engine offers no ` +
    `directive \`${directive}\` (F103-FR-025, annex D §D.1)`
  );
}

/** F103-FR-025, F103-FR-029 — the refusal for a service the engine does not offer. */
export function refusalForService(layerId: string, service: string): string {
  return (
    `the layer \`${layerId}\` is refused at registration: the engine offers no ` +
    `service \`${service}\` (F103-FR-025, F103-FR-029, annex D §D.1, §D.2)`
  );
}

/**
 * F103-FR-025, F103-FR-029 — what refuses a declaration, or `undefined` where
 * the engine can meet it. A directive is looked up in the closed set of the
 * eleven; a service in the set the engine offers NOW, which is empty until an
 * implementation is registered.
 */
export function declarationRefusal(
  registration: LayerRegistration,
  servicesOffered: readonly string[],
  directivesOffered: readonly string[] = DIRECTIVES_OFFERED,
): string | undefined {
  const badDirective = registration.directives.find((d) => !directivesOffered.includes(d));
  if (badDirective !== undefined) return refusalForDirective(registration.id, badDirective);
  const badService = registration.services.find((s) => !servicesOffered.includes(s));
  if (badService !== undefined) return refusalForService(registration.id, badService);
  return undefined;
}

/** What the engine knows when it registers a layer. */
export type RegistrationOptions = {
  /** F100-FR-014 — a layer is accepted only as data or as first-party code. */
  readonly layerClass: LayerClass;
  /** F103-FR-029 — the service implementations the engine holds. */
  readonly services?: ServiceImplementations;
};

/**
 * F103-FR-025 — register one layer, or refuse it.
 *
 * The order of the checks is the order of the message a reader needs: the
 * class first (a layer that is neither data nor first-party code is not a
 * layer of this product at all), then the directives, then the services.
 */
export function registerLoopLayer(
  layer: LoopLayer,
  options: RegistrationOptions,
): RegistrationOutcome {
  const registration = layer.registration;
  if (!(ACCEPTED_CLASSES as readonly string[]).includes(options.layerClass)) {
    return Object.freeze({
      accepted: false as const,
      message:
        `the layer \`${registration.id}\` is refused at registration: a layer is accepted ` +
        `only as data or as first-party code (F100-FR-014)`,
    });
  }
  const refusal = declarationRefusal(registration, offeredServices(options.services));
  if (refusal !== undefined) {
    return Object.freeze({ accepted: false as const, message: refusal });
  }
  return Object.freeze({
    accepted: true as const,
    record: Object.freeze({
      id: registration.id,
      layer,
      layerClass: options.layerClass,
      ledgerNamespace: registration.ledgerNamespace,
      directives: Object.freeze([...registration.directives]),
      services: Object.freeze([...registration.services]),
    }),
  });
}

/**
 * The registry of the phase attempt: the stack, outer first, of at most two
 * layers. The built-in layer `none` is not in it — `none` is what an empty
 * stack means, and `./call-points.ts` reads an empty stack that way.
 */
export class LoopLayerRegistry {
  private readonly layers: RegisteredLayer[] = [];

  /** F103-FR-024, F103-FR-025 — register one layer at the inner end of the stack. */
  register(layer: LoopLayer, options: RegistrationOptions): RegistrationOutcome {
    const registration = layer.registration;
    if (this.layers.length >= STACK_DEPTH) {
      return Object.freeze({
        accepted: false as const,
        message:
          `the layer \`${registration.id}\` is refused at registration: layers stack to a ` +
          `depth of at most ${String(STACK_DEPTH)} (F103-FR-024, annex D §D.1)`,
      });
    }
    if (this.layers.some((held) => held.id === registration.id)) {
      return Object.freeze({
        accepted: false as const,
        message:
          `the layer \`${registration.id}\` is refused at registration: a layer of that id ` +
          `is already registered (F103-FR-024)`,
      });
    }
    if (this.layers.some((held) => held.ledgerNamespace === registration.ledgerNamespace)) {
      return Object.freeze({
        accepted: false as const,
        message:
          `the layer \`${registration.id}\` is refused at registration: the ledger namespace ` +
          `\`${registration.ledgerNamespace}\` is already another layer's; each layer has a ` +
          `namespace of its own (F103-FR-024)`,
      });
    }
    const outcome = registerLoopLayer(layer, options);
    if (outcome.accepted) this.layers.push(outcome.record);
    return outcome;
  }

  /** The stack as the call points read it: OUTER FIRST (F103-FR-024). */
  stack(): readonly RegisteredLayer[] {
    return Object.freeze([...this.layers]);
  }

  /** True where no layer is registered, which is the built-in layer `none`. */
  isEmpty(): boolean {
    return this.layers.length === 0;
  }

  /** One registered layer by its id, or `undefined`. */
  find(id: string): RegisteredLayer | undefined {
    return this.layers.find((held) => held.id === id);
  }
}

/* ------------------------------------------------------------------ *
 * The capability a group of passes needs (F103-FR-025).
 * ------------------------------------------------------------------ */

/** The capability of the harness port that a group of passes needs. */
export const GROUP_CAPABILITY = "concurrentSessions" as const;

/** The two directives of a group, which that capability gates. */
export const GROUP_DIRECTIVES = ["requestPassGroup", "integrateGroup"] as const;

/**
 * F103-FR-025 — the refusal of a request for a group of passes where the
 * harness adapter does not declare `concurrentSessions`, or `undefined` where
 * it does. A capability with no value, or with no provenance, is not declared:
 * a value the product never saw is `unverified`, not a promise.
 */
export function groupRefusal(
  capabilities: Pick<Capabilities, "concurrentSessions"> | undefined,
  directive: string = GROUP_DIRECTIVES[0],
): string | undefined {
  const capability = capabilities?.concurrentSessions;
  if (capability === undefined || capability.value === null || capability.provenance === null) {
    return (
      `the directive \`${directive}\` is refused: the harness adapter declares no ` +
      `\`${GROUP_CAPABILITY}\` (F103-FR-025, annex D §D.1)`
    );
  }
  if (capability.value < 2) {
    return (
      `the directive \`${directive}\` is refused: the harness adapter declares ` +
      `\`${GROUP_CAPABILITY}\` of ${String(capability.value)}, which runs no group ` +
      `(F103-FR-025)`
    );
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * The router at the decision point `loop` (F103-FR-022).
 * ------------------------------------------------------------------ */

/** What the engine takes from the router, and records, before the first pass. */
export type LoopDecision = {
  /** The decision as the router made it, recorded whatever the engine takes. */
  readonly decision: RouteDecision;
  /** The registered layer the engine took, or `undefined` for off. */
  readonly took: RegisteredLayer | undefined;
  /** The id recorded in the run record: a layer's id, or `none`. */
  readonly recorded: string;
  /** Why the engine took nothing, where it took nothing. */
  readonly refusedBecause?: string;
};

/**
 * F103-FR-022 — consult the router at `loop`, record the decision, and take
 * from it ONLY a registered layer or off.
 *
 * Three readings, and all three record the decision:
 *
 *  - the choice `off`: the engine takes nothing;
 *  - a choice that is a REGISTERED layer: the engine takes that layer;
 *  - a choice that names a layer the registry does not hold: the engine takes
 *    nothing and says why. This is the half of the rule that is easy to lose —
 *    a router that could name an unregistered layer would be switching one on.
 *
 * A decision made at any other decision point is not this one and is refused
 * outright: the engine asked about the loop.
 */
export function layerFromRouterAtLoop(
  decision: RouteDecision,
  registry: LoopLayerRegistry,
): LoopDecision {
  if (decision.decisionPoint !== ROUTER_DECISION_POINT) {
    return Object.freeze({
      decision,
      took: undefined,
      recorded: BUILT_IN_LAYER_ID,
      refusedBecause:
        `the decision was made at \`${decision.decisionPoint}\` and not at ` +
        `\`${ROUTER_DECISION_POINT}\` (F103-FR-022; the points are ` +
        `${DECISION_POINTS.join(", ")})`,
    });
  }
  if (decision.choice === ROUTER_CHOICE_OFF) {
    return Object.freeze({ decision, took: undefined, recorded: BUILT_IN_LAYER_ID });
  }
  const held = registry.find(decision.choice);
  if (held === undefined) {
    return Object.freeze({
      decision,
      took: undefined,
      recorded: BUILT_IN_LAYER_ID,
      refusedBecause:
        `the router chose \`${decision.choice}\`, which is not a registered layer; the ` +
        `router takes only a registered layer or off and cannot switch a layer on ` +
        `(F103-FR-022)`,
    });
  }
  return Object.freeze({ decision, took: held, recorded: held.id });
}
