/**
 * T127 — the interface types of EP-04, the loop-layer interface, from
 * `contracts/extension-points/EP-04.loop-layer.json` and annex D, §D.1
 * (F100-FR-114 to F100-FR-120).
 *
 * `specstride.loop-layer/1`. A layer works inside a phase attempt of the one
 * engine, between the passes of the proposer, and can never touch the phase
 * gate. The classic loop is the engine with the layer `none`.
 *
 * The eight call points and the closed set of directives are read from the
 * keys `callPoints` and `directives` of `data/loop-layer-tables.json`, so
 * that the types and the tables of the annex cannot drift.
 */
import loopLayerTables from "../../data/loop-layer-tables.json" with { type: "json" };
import type { TreeStoreService } from "./tree-store.ts";

export const POINT_ID = "specstride.loop-layer/1" as const;
export const EP = "EP-04" as const;
export const ANNEX_SECTION = "annex D, §D.1" as const;

/** F100-FR-114 — the eight call points, in the fixed order of §D.1. */
export const CALL_POINTS = [
  "contributePrompt",
  "afterPass",
  "betweenPasses",
  "nextPassBlock",
  "onEvidence",
  "contributeCriticInput",
  "resume",
  "report",
] as const;
export type CallPoint = (typeof CALL_POINTS)[number];
/** The operations of the point are its call points. */
export const OPERATIONS = CALL_POINTS;

/** F100-FR-114 — the closed set of directives of §D.1. */
export const DIRECTIVES = [
  "keep",
  "repair",
  "unresolved",
  "layerOffForAttempt",
  "layerOffForRun",
  "giveIterationBack",
  "exemptShortPass",
  "exemptRepeatCounter",
  "requestPass",
  "requestPassGroup",
  "integrateGroup",
] as const;
export type Directive = (typeof DIRECTIVES)[number];

const BACKTICKED = /`([^`]+)`/;

type RawCallPoint = {
  "#": string;
  "Call point": string;
  When: string;
  "What the layer returns": string;
};
type RawDirective = { Directive: string; Meaning: string };

/** One row of the call-point table of §D.1. */
export type CallPointRow = {
  readonly ordinal: number;
  readonly callPoint: CallPoint;
  readonly when: string;
  readonly returns: string;
};

/** The eight rows of the call-point table, in the order of the annex. */
export const callPointRows: readonly CallPointRow[] = Object.freeze(
  (loopLayerTables as { callPoints: RawCallPoint[] }).callPoints.map((row) =>
    Object.freeze({
      ordinal: Number(row["#"]),
      callPoint: (BACKTICKED.exec(row["Call point"])?.[1] ?? row["Call point"]) as CallPoint,
      when: row.When,
      returns: row["What the layer returns"],
    }),
  ),
);

/** One row of the directive table of §D.1. */
export type DirectiveRow = { readonly directive: Directive; readonly meaning: string };

/** The eleven rows of the directive table, in the order of the annex. */
export const directiveRows: readonly DirectiveRow[] = Object.freeze(
  (loopLayerTables as { directives: RawDirective[] }).directives.map((row) =>
    Object.freeze({
      directive: (BACKTICKED.exec(row.Directive)?.[1] ?? row.Directive) as Directive,
      meaning: row.Meaning,
    }),
  ),
);

/** The fixed order after a pass (§D.1, Caller and time). */
export const ORDER_AFTER_A_PASS = [
  "kill check",
  "yield check",
  "layer",
  "classic accounting",
] as const;

/** What `afterPass` returns for the checkpoint found in the outbox. */
export const AFTER_PASS_RESULTS = ["accept", "refuse", "none"] as const;
export type AfterPassResult = (typeof AFTER_PASS_RESULTS)[number];

/** The value that an unknown return at a call point is read as (§D.1). */
export const RETURN_WHEN_UNKNOWN: AfterPassResult = "none";

/** One prompt block, in the form of §D.5. */
export type PromptBlock = {
  readonly id: string;
  readonly bytes: number;
  readonly hash: string;
  readonly writer: string;
  readonly protected: boolean;
  readonly stability: "stable" | "volatile";
  readonly text: string;
};

/** The read-only view of the phase attempt a layer is given (§D.1, Inputs). */
export type PhaseAttemptView = {
  readonly phase: number;
  readonly attempt: number;
  readonly counters: Readonly<Record<string, number>>;
  readonly checkManifest: readonly { readonly id: string }[];
  readonly fingerprints: Readonly<Record<string, string>>;
  /** With parallel units on. */
  readonly workerId?: string;
  readonly groupId?: string;
};

/** One pass the layer asks the engine to run (the directive `requestPass`). */
export type PassRequest = {
  readonly promptBlock: PromptBlock;
  readonly workingDirectory: string;
  readonly session: "fresh" | "continue";
  readonly timeLimitMs: number;
  readonly workerId?: string;
};

/** The directive `requestPassGroup`: a list of passes with a concurrency limit. */
export type PassGroupRequest = {
  readonly passes: readonly PassRequest[];
  readonly concurrency: number;
};

/**
 * The directive `integrateGroup`: per worker, `accepted` or the refusal
 * reason, which is how the verdicts of the audits of feature 142 reach the
 * engine before `compose`.
 */
export type IntegrateGroupRequest = {
  readonly perWorker: readonly {
    readonly workerId: string;
    readonly outcome: "accepted" | { readonly refused: string };
  }[];
};

/** One directive with its payload, as the engine receives it. */
export type DirectiveCall =
  | {
      readonly directive: Exclude<Directive, "requestPass" | "requestPassGroup" | "integrateGroup">;
    }
  | { readonly directive: "requestPass"; readonly request: PassRequest }
  | { readonly directive: "requestPassGroup"; readonly request: PassGroupRequest }
  | { readonly directive: "integrateGroup"; readonly request: IntegrateGroupRequest };

/** The outcome of `betweenPasses`: an outcome with directives. */
export type BetweenPassesOutcome = {
  readonly directives: readonly DirectiveCall[];
};

/** The services a layer may declare (§D.1, Inputs). */
export type LayerServices = {
  readonly treeStore?: TreeStoreService;
};

/** What a layer declares at registration (F100-FR-116). */
export type LayerRegistration = {
  readonly id: string;
  readonly directives: readonly Directive[];
  readonly services: readonly string[];
  /** The layer's own namespace in the ledger, written through the engine. */
  readonly ledgerNamespace: string;
};

/** F100-FR-114 — the loop-layer interface: the eight call points of §D.1. */
export type LoopLayer = {
  readonly registration: LayerRegistration;
  contributePrompt(view: PhaseAttemptView): readonly PromptBlock[];
  afterPass(view: PhaseAttemptView, checkpoint: unknown): AfterPassResult;
  betweenPasses(view: PhaseAttemptView): BetweenPassesOutcome | "none";
  nextPassBlock(view: PhaseAttemptView): PromptBlock | "none";
  onEvidence(view: PhaseAttemptView): { readonly closingCheck: boolean } | "none";
  contributeCriticInput(
    view: PhaseAttemptView,
  ): readonly Readonly<Record<string, unknown>>[] | "none";
  resume(view: PhaseAttemptView, ledger: readonly unknown[]): BetweenPassesOutcome | "none";
  report(): Readonly<Record<string, unknown>>;
};

/** F100-FR-115 — layers stack in a fixed order, to a depth of at most 2 in Wave 1. */
export const MAX_STACK_DEPTH = 2 as const;
/** At every call point the outer layer is called first, the inner only on `none`. */
export const OUTER_LAYER_FIRST = true as const;

/** The Wave 1 layers (§D.1, Wave 1 implementations). */
export const WAVE_1_LAYERS = ["none", "micro", "parallel"] as const;
/** Reserved and not built. */
export const RESERVED_LAYERS = ["autoresearch"] as const;

/** F100-FR-117 — what is withheld from every layer by construction. */
export const WITHHELD_FROM_EVERY_LAYER = [
  "every writer of the phase gate (approval, verdict, feedback, hint, recovery markers)",
  "every counter of the outer loop",
  "a harness handle",
  "the event writer and the ledger writer",
  "the project's repository",
  "any path of the workspace or of a worker tree as a writable handle",
] as const;

/** The four further facts the engine reports to a layer (§D.1, Outputs). */
export const FURTHER_FACTS = [
  "a missing object in the tree store",
  "a changed ledger",
  "an application of a group that was not completed",
  "a harness adapter that declares no spending limit",
] as const;

/**
 * "Errors" of §D.1: each switches the layer off for the phase attempt, and
 * none stops a run.
 */
export const ERRORS = [
  "a thrown error",
  "an invalid ledger",
  "a spent cap",
  "a check that cannot start",
] as const;

/**
 * "Failure of an implementation" of §D.1 — the plainer path: the layer is off
 * for the phase attempt and the classic loop carries on, announced and
 * recorded. No exit code and no stop reason results.
 */
export const FAILURE_PATH =
  "the layer is off for the phase attempt and the classic loop carries on, announced and recorded" as const;
/** A failure of the application of a group switches the layer off for the run. */
export const FAILURE_OF_A_GROUP_APPLICATION = "the layer is off for the rest of the run" as const;
export const FAILURE_PRODUCES_AN_EXIT_CODE_OR_STOP_REASON = false as const;

export const FAILURE_PATHS: Readonly<Record<CallPoint, string>> = Object.freeze(
  Object.fromEntries(CALL_POINTS.map((c) => [c, FAILURE_PATH])) as Record<CallPoint, string>,
);

/**
 * "Unknown-value rule" of §D.1: a directive or a service the engine does not
 * offer refuses the layer at registration; an unknown return value at a call
 * point is read as `none` and switches the layer off for the phase attempt.
 */
export function registrationRefusal(
  registration: LayerRegistration,
  directivesOffered: readonly string[] = DIRECTIVES,
  servicesOffered: readonly string[] = ["treeStore"],
): string | undefined {
  const badDirective = registration.directives.find((d) => !directivesOffered.includes(d));
  if (badDirective !== undefined) {
    return `refused at registration: the engine offers no directive \`${badDirective}\` (annex D, §D.1)`;
  }
  const badService = registration.services.find((s) => !servicesOffered.includes(s));
  if (badService !== undefined) {
    return `refused at registration: the engine offers no service \`${badService}\` (annex D, §D.1)`;
  }
  return undefined;
}

/** F100-FR-118 — the reason a layer is off where the verification gate does not execute. */
export const REASON_WHERE_THE_GATE_DOES_NOT_EXECUTE = "gate-not-executing" as const;
/** With no unit of work declared, a layer adds nothing but its protocol block. */
export const WITH_NO_UNIT_DECLARED_A_LAYER_EXECUTES_NOTHING = true as const;

/** F100-FR-120 — the switch of the closing check, and its bound. */
export const CLOSING_CHECK_SWITCH = "loop.micro.closing_check" as const;
export const CLOSING_CHECK_DEFAULT_ON = true as const;
export const CLOSING_CHECK_RETURNS_THE_PROPOSER_AT_MOST = 2 as const;

/** F100-FR-119 — a worker pass is outside the pass loop. */
export const A_WORKER_PASS_SPENDS_A_PASS_OF_THE_PASS_LIMIT = false as const;
