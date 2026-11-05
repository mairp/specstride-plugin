/**
 * T041 and T045 — the registration of the layer `parallel` and its inertness
 * (feature 142, F142-FR-001 and F142-FR-005; rules PU-01, PU-04, PU-98).
 *
 * T041 (F142-FR-001): the layer is registered **only** when
 * `loop.parallel.units` is `on`. The default is `off`, and the `parity`
 * profile sets it `off` (owner ruling 56). With the value `off` the resolved
 * stack of loop layers holds no `parallel`, and the run record says
 * `loop.parallel.units=off` — the field is written whatever the value is, so
 * that a reader of the run record can always tell which way the option stood.
 *
 * T045 (F142-FR-005): with the option **off** no service of the tree store is
 * called, and no file, no event and no prompt block of the layer exists. With
 * the option **on** and no group started in a phase attempt, prompts, time
 * limits, commands of the runtime, events and files equal those of the option
 * off, apart from the named fields of register row DV-088, which
 * `DV_088_NAMED_FIELDS` lists. That is enforced here by construction and not
 * by discipline:
 *
 *  - with the option off `registrationOf` returns `null`: there is no layer
 *    object, so not one of the eight call points of EP-04 can be reached, and
 *    the engine stacks nothing (`resolvedStackOfLoopLayers`);
 *  - the layer object `parallelLayer` declares the service `treeStore` but
 *    holds no handle to it: every call point of it is a pure function of the
 *    view it is given and returns values. A service call of the tree store can
 *    only follow a directive the engine executes, and the only directives this
 *    module's layer returns while no group has started are none at all
 *    (`betweenPasses` returns `"none"`);
 *  - the layer writes no file in any case: the package is `core` in the
 *    package graph, so `node:fs` is forbidden to it, and the plan file of
 *    F142-FR-017 is written by the engine from the value the layer hands it.
 *
 * The module is pure. It reads no file, starts no process and holds no state.
 */
import { CALL_POINTS } from "@specstride/contracts/ep/loop-layer";
import type { Directive, LayerRegistration, LoopLayer } from "@specstride/contracts/ep/loop-layer";

import type { FallbackReason } from "./types.ts";

/* ================================================================== *
 * 1. The switch `loop.parallel.units` (T041, F142-FR-001, PU-01).
 * ================================================================== */

/** The id of this layer in the resolved stack of loop layers (§D.1, Wave 1). */
export const LAYER_ID = "parallel" as const;

/** The layer this one is stacked above, and above nothing else (F142-FR-002). */
export const STACKED_ABOVE = "micro" as const;

/** The switch of the option (row 20 of annex X §X.7). */
export const UNITS_KEY = "loop.parallel.units" as const;

/** The two values the switch takes. */
export const UNITS_VALUES = Object.freeze(["on", "off"] as const);
export type UnitsValue = (typeof UNITS_VALUES)[number];

/** The default of the switch: the option is off unless it is switched on. */
export const UNITS_DEFAULT: UnitsValue = "off";

/** The `parity` profile sets the switch `off` (owner ruling 56, row 20). */
export const PARITY_PROFILE = "parity" as const;
export const PARITY_PROFILE_SETS_IT_OFF = true as const;

/** The namespace of this layer in the ledger, written through the engine (LR-5). */
export const LEDGER_NAMESPACE = "parallel" as const;

/** The directives this layer declares at registration (§D.1). */
export const DIRECTIVES_DECLARED = Object.freeze([
  "requestPassGroup",
  "integrateGroup",
  "keep",
  "repair",
  "layerOffForAttempt",
  "layerOffForRun",
] as const satisfies readonly Directive[]);

/** The only service this layer declares, and it is given no handle to it (F142-FR-006). */
export const SERVICES_DECLARED = Object.freeze(["treeStore"] as const);

/**
 * What configuration says about the switch, by the rank of annex X §X.2: the
 * pin of the launch contract (1), a flag (2), the environment (4), project
 * configuration (5), user configuration (6), and the profile that is in force.
 * The switch is a neutral key, so every rank may set it; only the `parity`
 * profile overrides them all.
 */
export type UnitsConfiguration = {
  readonly launchContractPin?: string;
  readonly flag?: string;
  readonly environment?: string;
  readonly projectConfiguration?: string;
  readonly userConfiguration?: string;
  readonly profile?: string;
};

/** The ranks of annex X §X.2 this module reads, highest first. */
export const UNITS_RANKS = Object.freeze([
  "launchContractPin",
  "flag",
  "environment",
  "projectConfiguration",
  "userConfiguration",
] as const);

/** True where the text is one of the two values of the switch. */
export function isUnitsValue(value: string | undefined): value is UnitsValue {
  return value !== undefined && (UNITS_VALUES as readonly string[]).includes(value);
}

/**
 * The value of `loop.parallel.units` in force (F142-FR-001, PU-01).
 *
 * The ranks of annex X §X.2 are read highest first; a value that is neither
 * `on` nor `off` is no value of the switch and is passed over, so an unknown
 * value never switches the option on. The `parity` profile sets the switch
 * `off` whatever any rank said. With nothing set the default `off` stands.
 */
export function unitsInForce(configuration: UnitsConfiguration = {}): UnitsValue {
  if (configuration.profile === PARITY_PROFILE) return "off";
  for (const rank of UNITS_RANKS) {
    const value = configuration[rank];
    if (isUnitsValue(value)) return value;
  }
  return UNITS_DEFAULT;
}

/** True where the option is on: the only state in which the layer is registered. */
export function optionIsOn(configuration: UnitsConfiguration = {}): boolean {
  return unitsInForce(configuration) === "on";
}

/* ================================================================== *
 * 2. Registration, and the resolved stack (T041, F142-FR-001).
 * ================================================================== */

/** What this layer declares at registration, with the option on (F100-FR-116). */
export const REGISTRATION: LayerRegistration = Object.freeze({
  id: LAYER_ID,
  directives: DIRECTIVES_DECLARED,
  services: SERVICES_DECLARED,
  ledgerNamespace: LEDGER_NAMESPACE,
});

/**
 * The registration of the layer, or `null` where the option is off
 * (F142-FR-001). `null` is the whole of inertness at registration: with no
 * registration the engine builds no layer object, and not one call point of
 * EP-04 of this layer can be reached in the run.
 */
export function registrationOf(configuration: UnitsConfiguration = {}): LayerRegistration | null {
  return optionIsOn(configuration) ? REGISTRATION : null;
}

/**
 * The resolved stack of loop layers (F142-FR-001). With the option off the
 * stack holds no `parallel`; with it on, `parallel` is stacked above the
 * layers the loop strategy resolved, and above `micro` alone (F142-FR-002).
 */
export function resolvedStackOfLoopLayers(
  stackOfTheStrategy: readonly string[],
  configuration: UnitsConfiguration = {},
): readonly string[] {
  return optionIsOn(configuration)
    ? Object.freeze([...stackOfTheStrategy, LAYER_ID])
    : Object.freeze([...stackOfTheStrategy]);
}

/** True where the resolved stack holds this layer. */
export function stackHoldsTheLayer(stack: readonly string[]): boolean {
  return stack.includes(LAYER_ID);
}

/* ================================================================== *
 * 3. The fields of the run record (T041, F142-FR-001, F142-FR-022).
 * ================================================================== */

/** The run record fields of this feature (`data/loop-fields.json`, `runRecord`). */
export const RUN_RECORD_FIELDS = Object.freeze([
  "loop.parallel.units",
  "loop.parallel.workers",
  "loop.parallel.workersMax",
  "loop.parallel.quota_headroom",
  "loop.parallel.allow_detect",
  "loop.parallel.plan_hash",
  "loop.parallel.protection",
  "loop.parallel.worker_caches",
] as const);

/** What the run record is asked to hold about this layer. */
export type RunRecordInput = {
  readonly workers?: number;
  readonly workersMax?: number;
  readonly quotaHeadroomPerCent?: number;
  readonly allowDetect?: boolean;
  readonly planHash?: string;
  readonly protection?: "sandbox" | "detect";
  readonly workerCaches?: "profile" | "shared";
};

/**
 * The fields the run record holds for this layer (F142-FR-001).
 *
 * `loop.parallel.units` is always written, with the value in force: a run
 * record of a run with the option off says `loop.parallel.units=off`, which is
 * what F142-FR-001 requires and what makes "off" readable rather than merely
 * absent. Every other field of row DV-088 is written **only** with the option
 * on, so that a run with the option off carries no other field of the layer.
 */
export function runRecordFields(
  configuration: UnitsConfiguration = {},
  input: RunRecordInput = {},
): Readonly<Record<string, string>> {
  const units = unitsInForce(configuration);
  const fields: Record<string, string> = { [UNITS_KEY]: units };
  if (units === "off") return Object.freeze(fields);
  if (input.workers !== undefined) fields["loop.parallel.workers"] = String(input.workers);
  if (input.workersMax !== undefined) fields["loop.parallel.workersMax"] = String(input.workersMax);
  if (input.quotaHeadroomPerCent !== undefined) {
    fields["loop.parallel.quota_headroom"] = String(input.quotaHeadroomPerCent);
  }
  if (input.allowDetect !== undefined) {
    fields["loop.parallel.allow_detect"] = input.allowDetect ? "on" : "off";
  }
  if (input.planHash !== undefined) fields["loop.parallel.plan_hash"] = input.planHash;
  if (input.protection !== undefined) fields["loop.parallel.protection"] = input.protection;
  if (input.workerCaches !== undefined) {
    fields["loop.parallel.worker_caches"] = input.workerCaches;
  }
  return Object.freeze(fields);
}

/** The loop strategy a run with the option on still records (F142-FR-006). */
export const STRATEGY_RECORDED_WITH_THE_OPTION_ON = "micro" as const;

/* ================================================================== *
 * 4. Inertness (T045, F142-FR-005; rules PU-04, PU-98).
 * ================================================================== */

/**
 * The services of the tree store the layer calls with the option off: none
 * (F142-FR-005). The list is empty and is read by the inertness test, which
 * counts the calls a tree-store double recorded over a whole run.
 */
export const SERVICES_CALLED_WITH_THE_OPTION_OFF = Object.freeze([] as const);

/** The files the layer itself writes, with the option on or off: none (F142-FR-006). */
export const FILES_THE_LAYER_WRITES = Object.freeze([] as const);

/** The events that exist with the option off: none (F142-FR-005, SC-001). */
export const EVENTS_WITH_THE_OPTION_OFF = Object.freeze([] as const);

/** The prompt blocks that exist with the option off: none (F142-FR-005, SC-001). */
export const PROMPT_BLOCKS_WITH_THE_OPTION_OFF = Object.freeze([] as const);

/**
 * The named fields of register row DV-088: the only things that may differ
 * between a run with the option on in which no group started and the same run
 * with the option off (F142-FR-005, PU-04, PU-98).
 */
export const DV_088_NAMED_FIELDS = Object.freeze([
  "the run record fields `loop.parallel.*`",
  "the plan file and its hash event",
  "the reserved-tasks block",
  "the event `parallel.admission`",
  "the `parallel=` fields of the `[LOOP]` line",
] as const);

/** The run record fields DV-088 names, as the prefix they share. */
export const DV_088_RUN_RECORD_PREFIX = "loop.parallel." as const;

/** The plan file DV-088 names, by its logical name. */
export const DV_088_PLAN_FILE = "run:<runId>:parallel-plan" as const;

/** The two events DV-088 names: the hash of the plan, and the admission per task. */
export const DV_088_EVENTS = Object.freeze(["parallel.plan", "parallel.admission"] as const);

/** The prompt block DV-088 names. */
export const DV_088_PROMPT_BLOCK = "parallel.reserved-tasks" as const;

/** The fields of the `[LOOP]` line DV-088 names, as the prefix they share. */
export const DV_088_LOOP_LINE_PREFIX = "parallel" as const;

/** True where the name is a field of the run record DV-088 names. */
export function isADv088RunRecordField(name: string): boolean {
  return name.startsWith(DV_088_RUN_RECORD_PREFIX);
}

/**
 * One prompt with the reserved-tasks block taken out of it (F142-FR-005).
 *
 * The block is a named field of DV-088, and a prompt is not: a pass of the main
 * line that carries the block differs from the same pass without it by the
 * block alone, so the block is **cut out of** the prompt and the prompt itself
 * stays in the comparison. The block runs from its own marker line to the
 * marker line of the next block, or to the end of the prompt.
 */
export function withoutTheReservedTasksBlock(prompt: string): string {
  const marker = `\n[${DV_088_PROMPT_BLOCK}]\n`;
  const at = prompt.indexOf(marker);
  if (at < 0) return prompt;
  const rest = prompt.slice(at + marker.length);
  const next = rest.search(/\n\[[^\]\n]+\]\n/);
  return next < 0 ? prompt.slice(0, at) : `${prompt.slice(0, at)}${rest.slice(next)}`;
}

/** True where the event type is one DV-088 names. */
export function isADv088Event(type: string): boolean {
  return (DV_088_EVENTS as readonly string[]).includes(type);
}

/**
 * What one run of a fixture produced, in the shape the inertness test compares
 * (F142-FR-005). Everything in it is observed, never declared: the prompts the
 * proposer was given, the time limits that were set, the commands of the
 * runtime that ran, the events that were written, the files of the control
 * plane and of the workspace, the run record and the `[LOOP]` line.
 */
export type RunOutputs = {
  readonly prompts: readonly string[];
  readonly promptBlockIds: readonly string[];
  readonly timeLimitsMs: readonly number[];
  readonly runtimeCommands: readonly string[];
  readonly events: readonly { readonly type: string; readonly data?: unknown }[];
  readonly files: Readonly<Record<string, string>>;
  readonly runRecord: Readonly<Record<string, string>>;
  readonly loopLine: readonly string[];
  readonly exitCode: number;
  readonly stopReason: string | null;
  readonly runState: string;
};

/**
 * The outputs with the named fields of DV-088 removed (F142-FR-005, PU-04).
 *
 * What is removed is exactly the five items `DV_088_NAMED_FIELDS` lists and
 * nothing beside them: the run record fields that begin `loop.parallel.`, the
 * plan file and its hash event, the reserved-tasks block (and the prompt text
 * that carries it), the event `parallel.admission`, and the fields of the
 * `[LOOP]` line that begin `parallel`. What is left must be equal across the
 * three ways a fixture is run; anything the layer added elsewhere survives the
 * removal and makes the comparison fail.
 */
export function withoutTheNamedFieldsOfDv088(outputs: RunOutputs): RunOutputs {
  const files: Record<string, string> = {};
  for (const [name, text] of Object.entries(outputs.files)) {
    if (name === DV_088_PLAN_FILE) continue;
    files[name] = text;
  }
  const runRecord: Record<string, string> = {};
  for (const [name, value] of Object.entries(outputs.runRecord)) {
    if (isADv088RunRecordField(name)) continue;
    runRecord[name] = value;
  }
  return Object.freeze({
    prompts: Object.freeze(outputs.prompts.map(withoutTheReservedTasksBlock)),
    promptBlockIds: Object.freeze(
      outputs.promptBlockIds.filter((id) => id !== DV_088_PROMPT_BLOCK),
    ),
    timeLimitsMs: Object.freeze([...outputs.timeLimitsMs]),
    runtimeCommands: Object.freeze([...outputs.runtimeCommands]),
    events: Object.freeze(outputs.events.filter((event) => !isADv088Event(event.type))),
    files: Object.freeze(files),
    runRecord: Object.freeze(runRecord),
    loopLine: Object.freeze(
      outputs.loopLine.filter((field) => !field.startsWith(DV_088_LOOP_LINE_PREFIX)),
    ),
    exitCode: outputs.exitCode,
    stopReason: outputs.stopReason,
    runState: outputs.runState,
  });
}

/**
 * What a run of a fixture with the option **off** must show for F142-FR-005
 * and F142-SC-001 to hold: no call of a service of the tree store, no file of
 * the layer, no event of the layer and no prompt block of the layer. The
 * counts are observed by the caller — the calls of a tree-store double, the
 * directory listing of the control plane and of the worker root, the event
 * stream and the prompt blocks of the passes — and this function says whether
 * they are inert.
 */
export type ObservedWithTheOptionOff = {
  readonly treeStoreCalls: readonly string[];
  readonly filesOfTheLayer: readonly string[];
  readonly eventsOfTheLayer: readonly string[];
  readonly promptBlocksOfTheLayer: readonly string[];
};

/** Why a run with the option off was not inert, or an empty list where it was. */
export function breachesOfInertness(observed: ObservedWithTheOptionOff): readonly string[] {
  const breaches: string[] = [];
  if (observed.treeStoreCalls.length > 0) {
    breaches.push(
      `${observed.treeStoreCalls.length} service(s) of the tree store were called: ${observed.treeStoreCalls.join(", ")}`,
    );
  }
  if (observed.filesOfTheLayer.length > 0) {
    breaches.push(`a file of the layer exists: ${observed.filesOfTheLayer.join(", ")}`);
  }
  if (observed.eventsOfTheLayer.length > 0) {
    breaches.push(`an event of the layer exists: ${observed.eventsOfTheLayer.join(", ")}`);
  }
  if (observed.promptBlocksOfTheLayer.length > 0) {
    breaches.push(
      `a prompt block of the layer exists: ${observed.promptBlocksOfTheLayer.join(", ")}`,
    );
  }
  return Object.freeze(breaches);
}

/* ================================================================== *
 * 5. The layer object: eight call points, inert until a group starts.
 * ================================================================== */

/** What the layer is given at registration, beside the view of a call point. */
export type LayerInput = {
  readonly configuration?: UnitsConfiguration;
  /** The fallback reason the preconditions found, or `null` where none did. */
  readonly fallback?: FallbackReason | null;
  /** The directives to return at `betweenPasses`, where a group may start. */
  readonly betweenPasses?: LoopLayer["betweenPasses"];
  /** The prompt blocks to contribute, where a group waits (F142-FR-018). */
  readonly contributePrompt?: LoopLayer["contributePrompt"];
  /** What `report` adds to the `[LOOP]` line (F142-FR-022). */
  readonly report?: LoopLayer["report"];
};

/**
 * The layer object of EP-04, or `null` where the option is off (T041, T045).
 *
 * With the option off there is no object: that is inertness by construction.
 * With the option on but a fallback reason in force, the object exists — the
 * run record and the `[LOOP]` line must carry the reason — and every call
 * point of it is inert: no prompt block, no directive, nothing for the critic
 * and no closing check. With the option on and no fallback, the call points
 * that this phase does not own are given by `input`, and the ones that are
 * missing stay inert, which is what F142-FR-005 asks of a phase attempt in
 * which no group started.
 */
export function parallelLayer(input: LayerInput = {}): LoopLayer | null {
  const configuration = input.configuration ?? {};
  if (!optionIsOn(configuration)) return null;
  const off = input.fallback !== undefined && input.fallback !== null;
  return Object.freeze({
    registration: REGISTRATION,
    contributePrompt: (view) =>
      off || input.contributePrompt === undefined
        ? Object.freeze([])
        : input.contributePrompt(view),
    afterPass: () => "none" as const,
    betweenPasses: (view) =>
      off || input.betweenPasses === undefined ? ("none" as const) : input.betweenPasses(view),
    nextPassBlock: () => "none" as const,
    onEvidence: () => "none" as const,
    contributeCriticInput: () => "none" as const,
    resume: () => "none" as const,
    report: () => (input.report === undefined ? Object.freeze({}) : input.report()),
  });
}

/* ================================================================== *
 * 6. The layer decides and the engine executes (T074, F142-FR-006;
 *    rules PU-06, PU-07, PU-08).
 * ================================================================== */

/** F142-FR-006 — the layer decides. */
export const THE_LAYER_DECIDES = true as const;

/** F142-FR-006 — the layer executes nothing: the engine does. */
export const THE_LAYER_EXECUTES = false as const;

/** F142-FR-006 — what the engine owns, and the layer therefore does not. */
export const THE_ENGINE_OWNS = Object.freeze([
  "the group executor",
  "the tree store",
  "integration",
] as const);

/**
 * F142-FR-006 — what is withheld from the layer **by construction**, in the
 * order of the requirement. "By construction" is the whole claim: each item is
 * withheld because there is no way to hand it over, not because the layer
 * declines to use it.
 */
export const WITHHELD_FROM_THE_LAYER = Object.freeze([
  "every writer of the phase gate",
  "every counter of the outer loop",
  "a harness handle",
  "the event writer",
  "the ledger writer",
  "direct access to a repository",
  "any path of the workspace or of a worker tree as a writable handle",
] as const);
export type WithheldFromTheLayer = (typeof WITHHELD_FROM_THE_LAYER)[number];

/** F142-FR-006 — a run with the option on still records the loop strategy `micro`. */
export const STRATEGY_WITH_THE_OPTION_ON = STRATEGY_RECORDED_WITH_THE_OPTION_ON;

/**
 * The names a handle of one of the withheld things would carry, by the subject
 * each belongs to. A property of the layer object whose name matches one of
 * these, or whose value offers one of these methods, is a withheld thing the
 * layer holds.
 */
export const NAMES_OF_A_WITHHELD_THING: readonly RegExp[] = Object.freeze([
  /gate.*writ|writ.*gate/i,
  /approv/i,
  /counter/i,
  /harness/i,
  /event.*writ|writ.*event|emit/i,
  /ledger/i,
  /\bgit\b|repositor/i,
  /workspace|worker ?root|worker ?tree|tree ?store|store ?root/i,
  /\bwrite|append|commit|unlink|mkdir|rm\b/i,
]);

/** The methods a writable handle offers; a value that offers one is a writer. */
export const METHODS_OF_A_WRITER = Object.freeze([
  "write",
  "writeFile",
  "append",
  "appendFile",
  "commit",
  "unlink",
  "mkdir",
  "rm",
  "apply",
  "tick",
] as const);

/** The nine members of the loop-layer interface of §D.1, and nothing beside. */
export const MEMBERS_OF_THE_INTERFACE = Object.freeze(["registration", ...CALL_POINTS] as const);

/**
 * The withheld things an object holds (T074, F142-FR-006): the properties whose
 * name names one, and the properties whose value offers a method of a writer.
 * Run on the layer object this module returns, it is empty — the object holds the
 * nine members of §D.1 and nothing else, and every one of them is a function of
 * the view it is given.
 */
export function withheldThingsHeldBy(value: object): readonly string[] {
  const held: string[] = [];
  for (const [name, member] of Object.entries(value)) {
    if (!(MEMBERS_OF_THE_INTERFACE as readonly string[]).includes(name)) {
      held.push(`the property "${name}" is no member of the loop-layer interface`);
    }
    if (NAMES_OF_A_WITHHELD_THING.some((pattern) => pattern.test(name))) {
      held.push(`the property "${name}" names a withheld thing`);
    }
    if (member !== null && typeof member === "object") {
      for (const method of METHODS_OF_A_WRITER) {
        if (typeof (member as Record<string, unknown>)[method] === "function") {
          held.push(`the property "${name}" offers the writer method "${method}"`);
        }
      }
    }
  }
  return Object.freeze(held);
}

/**
 * The service handles a layer object holds (F142-FR-006). The layer **declares**
 * the tree store (`SERVICES_DECLARED`) and holds no handle to it: a declaration
 * is what lets the engine execute a directive, not what lets the layer call a
 * service.
 */
export function serviceHandlesHeldBy(value: object): readonly string[] {
  return Object.freeze(
    SERVICES_DECLARED.filter((service) => service in (value as Record<string, unknown>)),
  );
}

/** F142-FR-006 — the paths of the workspace and of a worker tree the layer holds. */
export const WRITABLE_PATHS_THE_LAYER_HOLDS = Object.freeze([] as const);

/**
 * What the layer declares at registration (T074, F142-FR-006): the six
 * directives of `DIRECTIVES_DECLARED` and the one service of
 * `SERVICES_DECLARED`, with its ledger namespace. The declaration is the whole
 * of what the layer may ask the engine for: a directive it did not declare is
 * refused at registration (F100-FR-116).
 */
export function declarationOfTheLayer(): {
  readonly id: string;
  readonly directives: readonly Directive[];
  readonly services: readonly string[];
  readonly ledgerNamespace: string;
  readonly withheld: readonly WithheldFromTheLayer[];
  readonly ownedByTheEngine: readonly string[];
  readonly strategyRecorded: string;
} {
  return Object.freeze({
    id: LAYER_ID,
    directives: DIRECTIVES_DECLARED,
    services: SERVICES_DECLARED,
    ledgerNamespace: LEDGER_NAMESPACE,
    withheld: WITHHELD_FROM_THE_LAYER,
    ownedByTheEngine: THE_ENGINE_OWNS,
    strategyRecorded: STRATEGY_WITH_THE_OPTION_ON,
  });
}

/**
 * The directives a run asked for that the layer did not declare: empty, always.
 * The engine refuses a layer that returns an undeclared directive, so the check
 * belongs with the declaration.
 */
export function directivesNotDeclared(asked: readonly string[]): readonly string[] {
  const declared = new Set<string>(DIRECTIVES_DECLARED);
  return Object.freeze([...new Set(asked.filter((directive) => !declared.has(directive)))]);
}

/**
 * Everything F142-FR-006 asks of a layer object, as one list of breaches: the
 * withheld things it holds, the service handles it holds, and a registration
 * that declares something else than `declarationOfTheLayer` says. Empty on the
 * object `parallelLayer` returns.
 */
export function breachesOfF142FR006(layer: LoopLayer): readonly string[] {
  const breaches = [...withheldThingsHeldBy(layer)];
  for (const service of serviceHandlesHeldBy(layer)) {
    breaches.push(`the layer holds a handle to the service "${service}"`);
  }
  const declaration = declarationOfTheLayer();
  if (layer.registration.id !== declaration.id) {
    breaches.push(`the registration declares the id "${layer.registration.id}"`);
  }
  for (const directive of layer.registration.directives) {
    if (!(declaration.directives as readonly string[]).includes(directive)) {
      breaches.push(`the registration declares the undeclared directive "${directive}"`);
    }
  }
  for (const service of layer.registration.services) {
    if (!(declaration.services as readonly string[]).includes(service)) {
      breaches.push(`the registration declares the service "${service}"`);
    }
  }
  return Object.freeze(breaches);
}
