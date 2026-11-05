/**
 * T057 of feature 103 — THE ELEVEN DIRECTIVES: executed and accounted for by
 * the engine, never by a layer (F103-FR-025, F103-FR-026, F103-FR-029; annex D
 * §D.1, "Outputs").
 *
 * A layer issues directives; this module is the engine executing them. The
 * closed set is the eleven of `@specstride/contracts`, and `EXECUTE` holds
 * exactly one entry per member, so a directive the engine does not execute
 * cannot exist and a twelfth cannot be slipped in.
 *
 * ## The three outcomes of a unit of work
 *
 * `keep`, `repair` and `unresolved` are the outcomes a layer declares for a
 * unit of work. The engine records each, WITH THE UNIT IT NAMES, in the layer's
 * own namespace of the ledger; it changes NO counter of the outer loop for
 * them; and it takes NO other action. What follows from an outcome is the
 * content of the layer, not of this module — which is why `repair` here writes
 * a record and does not start a pass.
 *
 * `counters` comes back as the very object that went in where no directive
 * touches a counter, so "no counter changed" is checkable by identity and not
 * only by value.
 *
 * ## What the engine does not build here
 *
 * `requestPassGroup` and `integrateGroup` are carried out by the services of
 * the feature that builds concurrent units of work; this module reaches them
 * through `GroupServices` and builds neither. With those units off no directive
 * of a group is ever issued (`UNITS_OFF_ISSUES_NO_GROUP_DIRECTIVE`), and a
 * group is refused outright where the harness adapter declares no
 * `concurrentSessions` (F103-FR-025, `groupRefusal` of `./registry.ts`).
 *
 * ## A directive the layer did not declare is refused
 *
 * F103-FR-025 — a layer declares at registration the directives it uses. One it
 * did not declare is refused at execution and recorded as a refusal, not
 * executed quietly: `UNDECLARED_DIRECTIVE_IS_REFUSED` is `true`.
 */
import { DIRECTIVES } from "@specstride/contracts/ep/loop-layer";
import type {
  Directive,
  DirectiveCall,
  IntegrateGroupRequest,
  PassGroupRequest,
  PassRequest,
} from "@specstride/contracts/ep/loop-layer";
import type { Capabilities } from "@specstride/contracts/ep/harness";
import type { Counters } from "../pass-loop/accounting.ts";
import { groupRefusal, type RegisteredLayer } from "./registry.ts";
import type { LayerOffRecord, LoopLayerStack, OffReason } from "./call-points.ts";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F103-FR-025", "F103-FR-026", "F103-FR-029"] as const;

/** F103-FR-026 — the eleven directives, in the order of annex D §D.1. */
export const THE_ELEVEN_DIRECTIVES = DIRECTIVES;

/** F103-FR-026 — the three that are outcomes of a unit of work. */
export const UNIT_OUTCOMES = ["keep", "repair", "unresolved"] as const;
export type UnitOutcome = (typeof UNIT_OUTCOMES)[number];

/** F103-FR-026 — no directive changes a counter of the outer loop. */
export const A_DIRECTIVE_CHANGES_A_COUNTER_OF_THE_OUTER_LOOP = false as const;

/** F103-FR-026 — the three outcomes take no action beyond their ledger record. */
export const AN_OUTCOME_TAKES_ANY_OTHER_ACTION = false as const;

/** F103-FR-026 — with concurrent units of work off, no directive of a group is issued. */
export const UNITS_OFF_ISSUES_NO_GROUP_DIRECTIVE = true as const;

/** F103-FR-025 — a directive the layer did not declare is refused. */
export const UNDECLARED_DIRECTIVE_IS_REFUSED = true as const;

/** F103-FR-026 — a pass a layer requests, and a worker pass, are outside the iteration loop. */
export const A_REQUESTED_PASS_IS_INSIDE_THE_ITERATION_LOOP = false as const;

/** One record the engine writes in a layer's own namespace of the ledger. */
export type LayerLedgerRecord = {
  /** The layer's namespace; the engine writes it, the layer never does. */
  readonly namespace: string;
  /** The outcome the layer declared. */
  readonly kind: UnitOutcome;
  /** The unit of work the outcome names. */
  readonly unit: string;
};

/** A directive that names a unit of work. */
export type DirectiveWithUnit = {
  readonly directive: UnitOutcome;
  readonly unit: string;
};

/** A directive as the engine receives it: the contract's form, or one with a unit. */
export type ExecutableDirective = DirectiveCall | DirectiveWithUnit;

/** The services that carry out the two directives of a group; built elsewhere. */
export type GroupServices = {
  /** Run a group of passes with its concurrency limit, and return when each ended. */
  runGroup?(request: PassGroupRequest): unknown;
  /** Integrate the results of a group through the reserved tree-store service. */
  integrateGroup?(request: IntegrateGroupRequest): unknown;
};

/** What the engine knows while it executes the directives of one layer. */
export type DirectiveContext = {
  /** The layer that issued them, with the directives it declared at registration. */
  readonly layer: RegisteredLayer;
  /** The counters as they stand; no directive changes one. */
  readonly counters: Counters;
  /** The stack, so that `layerOffForAttempt` and `layerOffForRun` reach it. */
  readonly stack?: LoopLayerStack;
  /** The capabilities of the harness port; a group needs `concurrentSessions`. */
  readonly capabilities?: Pick<Capabilities, "concurrentSessions">;
  /** Run one pass the layer requested; absent means the engine ran none. */
  runPass?(request: PassRequest): unknown;
  /** The services of a group, built by another feature. */
  readonly groupServices?: GroupServices;
  /** The exact argument lists of the inner check set, for `exemptRepeatCounter`. */
  readonly innerCheckSet?: readonly (readonly string[])[];
};

/** One directive, as the engine accounted for it. */
export type DirectiveAccount = {
  readonly directive: Directive;
  /** True where the engine carried it out; false where it refused it. */
  readonly executed: boolean;
  /** Why it was refused, where it was. */
  readonly refusedBecause?: string;
  /** The unit of work, for the three outcomes. */
  readonly unit?: string;
};

/** Everything the execution of a list of directives produced. */
export type DirectiveExecution = {
  /** One account per directive, in the order the layer issued them. */
  readonly accounts: readonly DirectiveAccount[];
  /** The records written in the layer's namespace. */
  readonly records: readonly LayerLedgerRecord[];
  /** The counters AFTER execution; the same object where nothing touched one. */
  readonly counters: Counters;
  /** `giveIterationBack` — the pass number is handed back, as a yield does. */
  readonly passGivenBack: boolean;
  /** `exemptShortPass` — the short-pass counter is left as it was. */
  readonly shortPassCounterLeftAsItWas: boolean;
  /** `exemptRepeatCounter` — the exact argument lists exempted. */
  readonly repeatCounterExemptions: readonly (readonly string[])[];
  /** The layers switched off by `layerOffForAttempt` or `layerOffForRun`. */
  readonly switchedOff: readonly LayerOffRecord[];
  /** The passes the engine ran because the layer requested them. */
  readonly passesRun: readonly PassRequest[];
  /** The groups the engine ran, and the integrations it performed. */
  readonly groupsRun: readonly PassGroupRequest[];
  readonly integrations: readonly IntegrateGroupRequest[];
  /** Every refusal, in the order it happened. */
  readonly refusals: readonly string[];
};

/** The unit a directive names, where it names one. */
export function unitOf(call: ExecutableDirective): string | undefined {
  const unit = (call as { readonly unit?: unknown }).unit;
  return typeof unit === "string" ? unit : undefined;
}

/** True where the directive is one of the three outcomes of a unit of work. */
export function isUnitOutcome(directive: string): directive is UnitOutcome {
  return (UNIT_OUTCOMES as readonly string[]).includes(directive);
}

type Sink = {
  accounts: DirectiveAccount[];
  records: LayerLedgerRecord[];
  passGivenBack: boolean;
  shortPassExempt: boolean;
  exemptions: (readonly string[])[];
  switchedOff: LayerOffRecord[];
  passesRun: PassRequest[];
  groupsRun: PassGroupRequest[];
  integrations: IntegrateGroupRequest[];
  refusals: string[];
};

function refuse(sink: Sink, directive: Directive, because: string): void {
  sink.accounts.push(Object.freeze({ directive, executed: false, refusedBecause: because }));
  sink.refusals.push(because);
}

function done(sink: Sink, directive: Directive, unit?: string): void {
  sink.accounts.push(
    Object.freeze({ directive, executed: true, ...(unit !== undefined ? { unit } : {}) }),
  );
}

/** Switch the layer off through the stack, where the engine holds one. */
function switchOff(sink: Sink, context: DirectiveContext, reason: OffReason): void {
  const record = context.stack?.switchOff(context.layer.id, reason);
  if (record !== undefined) sink.switchedOff.push(record);
}

/**
 * F103-FR-026 — one entry per directive of the closed set. Each returns
 * nothing: what it did is in the sink, which is what makes the accounting one
 * record of the whole list rather than eleven return shapes.
 */
const EXECUTE: Readonly<
  Record<Directive, (sink: Sink, call: ExecutableDirective, context: DirectiveContext) => void>
> = Object.freeze({
  // The three outcomes of a unit of work: one record in the layer's namespace,
  // no counter changed, no other action.
  keep: recordOutcome,
  repair: recordOutcome,
  unresolved: recordOutcome,

  layerOffForAttempt(sink, _call, context) {
    switchOff(sink, context, "layerOffForAttempt");
    done(sink, "layerOffForAttempt");
  },
  layerOffForRun(sink, _call, context) {
    switchOff(sink, context, "layerOffForRun");
    done(sink, "layerOffForRun");
  },
  giveIterationBack(sink) {
    sink.passGivenBack = true;
    done(sink, "giveIterationBack");
  },
  exemptShortPass(sink) {
    sink.shortPassExempt = true;
    done(sink, "exemptShortPass");
  },
  exemptRepeatCounter(sink, _call, context) {
    // The EXACT argument lists of the inner check set, copied so that a later
    // change of the set cannot change an exemption already granted.
    for (const argv of context.innerCheckSet ?? []) sink.exemptions.push(Object.freeze([...argv]));
    done(sink, "exemptRepeatCounter");
  },
  requestPass(sink, call, context) {
    const request = (call as { readonly request?: PassRequest }).request;
    if (request === undefined) {
      refuse(sink, "requestPass", "the directive `requestPass` carries no pass request");
      return;
    }
    // Outside the iteration loop: the engine runs the pass and no counter of
    // the outer loop moves (F103-FR-026).
    context.runPass?.(request);
    sink.passesRun.push(request);
    done(sink, "requestPass");
  },
  requestPassGroup(sink, call, context) {
    const request = (call as { readonly request?: PassGroupRequest }).request;
    if (request === undefined) {
      refuse(sink, "requestPassGroup", "the directive `requestPassGroup` carries no group request");
      return;
    }
    const refusal = groupRefusal(context.capabilities, "requestPassGroup");
    if (refusal !== undefined) {
      refuse(sink, "requestPassGroup", refusal);
      return;
    }
    const service = context.groupServices?.runGroup;
    if (service === undefined) {
      refuse(
        sink,
        "requestPassGroup",
        "the directive `requestPassGroup` is refused: no service of a group is registered " +
          "(F103-FR-026; the services are another feature's content)",
      );
      return;
    }
    service.call(context.groupServices, request);
    sink.groupsRun.push(request);
    done(sink, "requestPassGroup");
  },
  integrateGroup(sink, call, context) {
    const request = (call as { readonly request?: IntegrateGroupRequest }).request;
    if (request === undefined) {
      refuse(sink, "integrateGroup", "the directive `integrateGroup` carries no integration");
      return;
    }
    const refusal = groupRefusal(context.capabilities, "integrateGroup");
    if (refusal !== undefined) {
      refuse(sink, "integrateGroup", refusal);
      return;
    }
    const service = context.groupServices?.integrateGroup;
    if (service === undefined) {
      refuse(
        sink,
        "integrateGroup",
        "the directive `integrateGroup` is refused: no service of a group is registered " +
          "(F103-FR-026, F103-FR-029; the tree-store service is reserved here and built " +
          "elsewhere)",
      );
      return;
    }
    service.call(context.groupServices, request);
    sink.integrations.push(request);
    done(sink, "integrateGroup");
  },
});

/**
 * F103-FR-026 — the three outcomes of a unit of work: ONE record in the layer's
 * namespace, naming the unit; no counter of the outer loop; no other action.
 */
function recordOutcome(sink: Sink, call: ExecutableDirective, context: DirectiveContext): void {
  const directive = call.directive as UnitOutcome;
  const unit = unitOf(call);
  if (unit === undefined) {
    refuse(
      sink,
      directive,
      `the directive \`${directive}\` is refused: it names no unit of work, and the engine ` +
        `records the outcome WITH the unit it names (F103-FR-026)`,
    );
    return;
  }
  sink.records.push(
    Object.freeze({ namespace: context.layer.ledgerNamespace, kind: directive, unit }),
  );
  done(sink, directive, unit);
}

/**
 * F103-FR-026 — execute and account for every directive of a layer.
 *
 * The counters that come back are the very object that went in: no directive of
 * the eleven changes a counter, and returning the same object says so in a way
 * a test can check by identity.
 */
export function executeDirectives(
  calls: readonly ExecutableDirective[],
  context: DirectiveContext,
): DirectiveExecution {
  const sink: Sink = {
    accounts: [],
    records: [],
    passGivenBack: false,
    shortPassExempt: false,
    exemptions: [],
    switchedOff: [],
    passesRun: [],
    groupsRun: [],
    integrations: [],
    refusals: [],
  };
  for (const call of calls) {
    const directive = call.directive as string;
    if (!(DIRECTIVES as readonly string[]).includes(directive)) {
      // Outside the closed set: refused, named, and never executed.
      const because =
        `the directive \`${directive}\` is outside the closed set of the eleven ` +
        `(F103-FR-025, annex D §D.1)`;
      sink.accounts.push(
        Object.freeze({
          directive: directive as Directive,
          executed: false,
          refusedBecause: because,
        }),
      );
      sink.refusals.push(because);
      continue;
    }
    if (!context.layer.directives.includes(directive as Directive)) {
      refuse(
        sink,
        directive as Directive,
        `the directive \`${directive}\` is refused: the layer \`${context.layer.id}\` did not ` +
          `declare it at registration (F103-FR-025)`,
      );
      continue;
    }
    EXECUTE[directive as Directive](sink, call, context);
  }
  return Object.freeze({
    accounts: Object.freeze(sink.accounts),
    records: Object.freeze(sink.records),
    // The SAME object: no directive of the eleven changes a counter.
    counters: context.counters,
    passGivenBack: sink.passGivenBack,
    shortPassCounterLeftAsItWas: sink.shortPassExempt,
    repeatCounterExemptions: Object.freeze(sink.exemptions),
    switchedOff: Object.freeze(sink.switchedOff),
    passesRun: Object.freeze(sink.passesRun),
    groupsRun: Object.freeze(sink.groupsRun),
    integrations: Object.freeze(sink.integrations),
    refusals: Object.freeze(sink.refusals),
  });
}

/** The directives the engine executes, read back from the table: the eleven. */
export function directivesTheEngineExecutes(): readonly Directive[] {
  return Object.freeze(Object.keys(EXECUTE) as Directive[]);
}
