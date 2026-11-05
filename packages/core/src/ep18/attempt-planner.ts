/**
 * T006 — the registry of attempt planners of EP-18
 * (`specstride.attempt-planner/1`; F149-FR-002, F100-FR-016).
 *
 * Like the registry of critic strategies, it is FILLED AT PROCESS START and
 * READ-ONLY AFTER LAUNCH: a first-party module registers its planner at load,
 * the launch seals the registry, and a registration offered afterwards is
 * refused with the reason `after-launch`.
 *
 * This registry holds one thing the other does not: the ORDER of the planners.
 * Wave 1 ships two, and F149-FR-002 fixes the order they are called in — the
 * planner of the recovery cycle gives the kind, then the planner of the
 * model-tier bump may change the model tier and turn `plain` into `bumped`. The
 * order is a property of the seam and not of the order in which the modules of
 * the process happened to load, so `attemptPlannersInOrder` sorts by
 * `PLANNER_ORDER` and a planner whose id is not in it comes after those that
 * are, in the order of its registration.
 *
 * The two planners themselves are T023 to T026 of phase 5. Phase 2 ships the
 * registry only.
 */
import {
  CLASSES_ACCEPTED_IN_WAVE_1,
  EXTENSION_POINT_ID_FORM,
  IMPLEMENTATION_CLASSES,
  INTERNAL_SEAM_POINT,
  standingOf,
  type ExtensionPointStanding,
  type ImplementationClass,
} from "@specstride/contracts/ep/extension-point";
import {
  ATTEMPT_PLANNER_ID,
  EP,
  type AttemptPlanner,
} from "@specstride/contracts/ep/critic-strategy";

/** The point this registry belongs to. */
export const POINT_ID = ATTEMPT_PLANNER_ID;
/** EP-18, the one internal seam (F100-FR-020). */
export const POINT = EP;
/** The standing of the point: `internal-seam`. */
export const STANDING: ExtensionPointStanding = standingOf(INTERNAL_SEAM_POINT);
/** The operation of this seam (annex E §E.1). */
export const OPERATION = "next" as const;

/**
 * The order the planners of Wave 1 are called in (F149-FR-002; `contracts/
 * ep18-seams.md`, "Wave 1"): the recovery cycle first, the model-tier bump
 * second. The second changes only the model tier and may turn `plain` into
 * `bumped`.
 */
export const PLANNER_ORDER = ["recovery", "tier-bump"] as const;

/** The planner of Wave 1 that is always on. */
export const RECOVERY_PLANNER_ID = "recovery" as const;
/** The planner of Wave 1 that is an option, off by default (F149-FR-003). */
export const TIER_BUMP_PLANNER_ID = "tier-bump" as const;

/** What a first-party module gives when it registers a planner. */
export type AttemptPlannerRegistration = {
  /** The id of the implementation; `recovery` and `tier-bump` in Wave 1. */
  readonly id: string;
  /** The id of the point; anything else is refused. */
  readonly pointId: string;
  /** The class, from the closed set of row 83 of annex X §X.6. */
  readonly implementationClass: ImplementationClass;
  /**
   * The planner itself, with its operation `next`. A planner of Wave 1 also
   * carries `plan`, the wider form of this seam (`SeamAttemptPlanner` below).
   */
  readonly planner: SeamAttemptPlanner;
};

/** A registered planner, as the registry holds it. */
export type RegisteredAttemptPlanner = AttemptPlannerRegistration & {
  /** The position of the registration, from 1, in the order of registration. */
  readonly ordinal: number;
  /**
   * The place of the planner in the order of the seam, from 1, or `null` where
   * `PLANNER_ORDER` does not name its id.
   */
  readonly order: number | null;
};

/** The reasons the registry refuses a registration. */
export const REFUSAL_REASONS = [
  "after-launch",
  "twice",
  "unknown-point",
  "unknown-class",
  "third-party-class",
  "no-operation",
] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

/** A registration the rules of the point refuse. */
export class AttemptPlannerRegistrationError extends Error {
  readonly id: string;
  readonly reason: RefusalReason;
  constructor(id: string, reason: RefusalReason, message: string) {
    super(message);
    this.name = "AttemptPlannerRegistrationError";
    this.id = id;
    this.reason = reason;
  }
}

const REGISTRY = new Map<string, RegisteredAttemptPlanner>();
let sealed = false;

/** F100-FR-016 — the launch seals the registry; it is read-only from then on. */
export function sealAttemptPlanners(): void {
  sealed = true;
}

/** True once the launch has sealed the registry. */
export function attemptPlannersAreSealed(): boolean {
  return sealed;
}

/**
 * Empty the registry and unseal it. For a test that fills the registry again;
 * never called by a run, which fills it once at process start.
 */
export function resetAttemptPlannersForTest(): void {
  REGISTRY.clear();
  sealed = false;
}

/**
 * Register a planner (F100-FR-016). A registration after the launch, a second
 * registration of one id, an id that is not an id of this point, a class
 * outside the closed set, the class `third-party` in Wave 1, and a planner
 * without its operation `next` are each refused.
 */
export function registerAttemptPlanner(
  registration: AttemptPlannerRegistration,
): RegisteredAttemptPlanner {
  if (sealed) {
    throw new AttemptPlannerRegistrationError(
      registration.id,
      "after-launch",
      `the registry of ${POINT} (${POINT_ID}) is read-only after launch; ` +
        `\`${registration.id}\` was offered after the launch (F100-FR-016)`,
    );
  }
  if (REGISTRY.has(registration.id)) {
    throw new AttemptPlannerRegistrationError(
      registration.id,
      "twice",
      `the attempt planner \`${registration.id}\` is registered twice (F100-FR-016)`,
    );
  }
  if (!EXTENSION_POINT_ID_FORM.test(registration.pointId) || registration.pointId !== POINT_ID) {
    throw new AttemptPlannerRegistrationError(
      registration.id,
      "unknown-point",
      `\`${registration.pointId}\` is no id of the attempt planner of ${POINT}; ` +
        `its id is ${POINT_ID} (F100-FR-013)`,
    );
  }
  if (!(IMPLEMENTATION_CLASSES as readonly string[]).includes(registration.implementationClass)) {
    throw new AttemptPlannerRegistrationError(
      registration.id,
      "unknown-class",
      `\`${registration.implementationClass}\` is no class of an implementation; ` +
        `the classes are ${IMPLEMENTATION_CLASSES.join(", ")} (F100-FR-014)`,
    );
  }
  if (!CLASSES_ACCEPTED_IN_WAVE_1.includes(registration.implementationClass)) {
    throw new AttemptPlannerRegistrationError(
      registration.id,
      "third-party-class",
      `${POINT} is an internal seam: it makes no promise to an implementer outside ` +
        `the repository of the product in Wave 1, so the class ` +
        `\`${registration.implementationClass}\` is refused (F100-FR-020)`,
    );
  }
  if (typeof registration.planner?.next !== "function") {
    throw new AttemptPlannerRegistrationError(
      registration.id,
      "no-operation",
      `the attempt planner \`${registration.id}\` carries no operation ` +
        `\`${OPERATION}\` (annex E §E.1)`,
    );
  }
  const place = (PLANNER_ORDER as readonly string[]).indexOf(registration.id);
  const entry: RegisteredAttemptPlanner = Object.freeze({
    ...registration,
    ordinal: REGISTRY.size + 1,
    order: place === -1 ? null : place + 1,
  });
  REGISTRY.set(registration.id, entry);
  return entry;
}

/** Every registered planner, in the order of registration. */
export function attemptPlanners(): readonly RegisteredAttemptPlanner[] {
  return Object.freeze([...REGISTRY.values()]);
}

/** The ids of the registered planners, in the order of registration. */
export function attemptPlannerIds(): readonly string[] {
  return Object.freeze([...REGISTRY.keys()]);
}

/** The registration of one id, or `undefined`. */
export function attemptPlanner(id: string): RegisteredAttemptPlanner | undefined {
  return REGISTRY.get(id);
}

/**
 * The registered planners in the order of the seam (F149-FR-002): those
 * `PLANNER_ORDER` names first and in its order, then the rest in the order of
 * their registration.
 */
export function attemptPlannersInOrder(): readonly RegisteredAttemptPlanner[] {
  return Object.freeze(
    [...REGISTRY.values()].sort((a, b) => {
      if (a.order !== null && b.order !== null) return a.order - b.order;
      if (a.order !== null) return -1;
      if (b.order !== null) return 1;
      return a.ordinal - b.ordinal;
    }),
  );
}

/**
 * The state of the registry as one canonical line: the point, whether the
 * registry is sealed, and the ids with their class in the ORDER OF THE SEAM. A
 * reader that holds two of these can tell whether the registry changed without
 * holding a reference into it; a test hashes it.
 */
export function attemptPlannerRegistryFingerprint(): string {
  const entries = attemptPlannersInOrder().map(
    (e) => `${String(e.order ?? 0)}=${e.id}:${e.implementationClass}`,
  );
  return `${POINT_ID} sealed=${String(sealed)} count=${String(entries.length)} [${entries.join(" ")}]`;
}

/* ==================================================================== *
 * T023 — the seam itself: `next` with the FIXED ORDER of the planners
 * (F149-FR-002; `contracts/ep18-seams.md`, `specstride.attempt-planner/1`).
 *
 * Everything above is the registry of phase 2. What follows is the seam the
 * engine calls after every rejection: it hands each registered planner the
 * history and the configuration, in the order `PLANNER_ORDER` fixes, and
 * returns ONE plan of the next phase attempt.
 *
 * The order carries meaning, not merely a sequence (F149-FR-002):
 *
 * | Place | What the planner at that place may give |
 * |---|---|
 * | 1 | the KIND of the next phase attempt, from `plain`, `diagnosed`, `accelerated` |
 * | 2 and later | the MODEL TIER, and a `plain` phase attempt turned into `bumped` |
 *
 * A later planner that offers any other kind is ignored: the kind of the
 * recovery cycle stands, which is what keeps a phase attempt that is due for
 * acceleration AND for a bump `accelerated` on the bumped model tier
 * (F149-FR-004; research.md D1).
 *
 * The seam never writes and never halts. It changes no count — the history it
 * hands over is frozen at every depth — and it produces no exit code and no
 * stop reason: `EXIT_CODES_FROM_A_PLANNER` and `STOP_REASONS_FROM_A_PLANNER`
 * are empty, and the result carries `exitCode: null` and `stopReason: null`
 * (F149-FR-002, F149-FR-007).
 * ==================================================================== */

import {
  isNextAttemptPlan,
  type AttemptTierDecision,
  type NextAttemptPlan,
  type SkippedBumpReason,
} from "@specstride/contracts/ep/ep18-values";
import {
  ATTEMPT_KIND_WHEN_UNKNOWN,
  type AttemptHistory,
  type AttemptKind,
} from "@specstride/contracts/ep/critic-strategy";
import { attemptKindOf, freezeDeep, type PhaseHistory } from "./history.ts";

/* ------------------------------------------------------------------ *
 * What the engine hands in.
 * ------------------------------------------------------------------ */

/**
 * One rung of the model-tier ladder of a harness, as the resolved registry
 * holds it (F149-FR-003): the name of the model tier and the model and effort
 * it runs with. The models and efforts are what the guard of F149-FR-005
 * compares a target with.
 */
export type ModelTierRung = {
  /** The name of the model tier; `modelTier` of a plan is one of these. */
  readonly tier: string;
  /** The model of the rung, or null where the registry names none. */
  readonly model: string | null;
  /** The effort of the rung, or null where the registry names none. */
  readonly effort: string | null;
};

/**
 * One critic-class call of the run: the critic, the diagnostician and release
 * verification (`consolidation.md` glossary row 18; rule IR-47). A bump never
 * targets the model AND effort of one of these (F149-FR-005).
 */
export type CriticClassCall = {
  /** Which critic-class call it is; carried into the record of a skip. */
  readonly role: string;
  readonly model: string | null;
  readonly effort: string | null;
};

/**
 * What the run RECORDED about the quota of a target (research.md D4). The state
 * is read, never probed: no call is made to find it out, and where nothing is
 * recorded the quota counts as not exhausted (F149-FR-005).
 */
export type RecordedQuotaOfATarget = {
  /** The model tier the record is about. */
  readonly target: string;
  /** Whether the run recorded the quota of that target as exhausted. */
  readonly exhausted: boolean;
  /** Where the run recorded it: the quota classifier or the pause record. */
  readonly source: "quota-classifier" | "pause-record";
};

/**
 * Everything `next` receives (`contracts/ep18-seams.md`, "Input"): the history
 * of the phase attempts of the phase, the counts of the ledger, the recovery
 * markers, whether hint and feedback exist, the two facts of the recovery
 * cycle, configuration, the model-tier ladder, the models and efforts of the
 * critic-class calls, and the state of the quota of the target as the run
 * recorded it.
 */
export type AttemptPlannerInput = {
  /** The read-only history of the phase (T005). Frozen at every depth. */
  readonly history: PhaseHistory;
  /** The same history in the input type of the seam of feature 100. */
  readonly attemptHistory: AttemptHistory;
  /** The configuration of the run, by key of annex X §X.7. */
  readonly config: Readonly<Record<string, unknown>>;
  /** The harness of the proposer. A bump never moves to another one. */
  readonly harness: string;
  /** The model-tier ladder of THAT harness in the resolved registry. */
  readonly ladder: readonly ModelTierRung[];
  /** The model tier the role plan gives the proposer for the phase. */
  readonly baseModelTier: string;
  /** The critic-class calls of the run, with their models and efforts. */
  readonly criticClassCalls: readonly CriticClassCall[];
  /** What the run recorded about quotas. Read, never probed. */
  readonly quotaRecordedByTheRun: readonly RecordedQuotaOfATarget[];
  /**
   * Whether the model-tier bump is off for the REST OF THE RUN because its
   * table was invalid (F149-FR-006). The engine holds the latch; a planner is
   * pure and holds no state of its own.
   */
  readonly theTierBumpIsOffForTheRun: boolean;
};

/** What one planner receives: the input of the seam and the state of the walk. */
export type PlannerCallInput = AttemptPlannerInput & {
  /** The kind the planner at place 1 gave; `plain` before it ran. */
  readonly kindFromTheRecoveryCycle: AttemptKind;
  /** The model tier as the walk stands; the base tier before place 2. */
  readonly modelTier: string;
  /** The place of this planner in the order of the seam, from 1. */
  readonly place: number;
};

/* ------------------------------------------------------------------ *
 * What one planner gives back.
 * ------------------------------------------------------------------ */

/**
 * One event a planner offers the engine for the primary stream. No event of a
 * planner blocks and none carries an exit code or a stop reason
 * (F149-FR-007): `blocking` is `false` by type.
 */
export type AttemptPlannerEvent = {
  readonly name: string;
  readonly blocking: false;
  readonly ruleId?: string;
  readonly tableId?: string;
  readonly tableVersion?: string;
  readonly point?: string;
  readonly choice?: string;
  readonly skipReason?: SkippedBumpReason;
  readonly signals?: Readonly<Record<string, unknown>>;
  readonly fromModelTier?: string;
  readonly toModelTier?: string;
  readonly harness?: string;
  readonly freshSession?: boolean;
  readonly sameModelWarning?: boolean;
  readonly warning?: string;
  readonly reason?: string;
};

/** What a planner of this seam returns. Every field is optional. */
export type PlannerContribution = {
  /** The kind, read only from the planner at place 1 of the order. */
  readonly kind?: AttemptKind;
  /** The model tier, read only from a planner at place 2 or later. */
  readonly modelTier?: string;
  /** True after a bump; a new phase attempt starts a fresh session in any case. */
  readonly freshSession?: boolean;
  /** The decision record of a table where one was evaluated. */
  readonly decision?: AttemptTierDecision;
  /** The reason of a skip; present exactly when the choice is `skip`. */
  readonly skipReason?: SkippedBumpReason;
  /** The events of the contribution, for the primary stream. */
  readonly events?: readonly AttemptPlannerEvent[];
  /** An invalid table: the option goes off for the rest of the run, announced. */
  readonly switchTheOptionOffForTheRun?: boolean;
};

/** A contribution that changes nothing. */
export const NO_CONTRIBUTION: PlannerContribution = Object.freeze({});

/**
 * A planner of this seam. `next` is the operation of feature 100 and the one
 * the registry requires; `plan` is this feature's wider form, which carries the
 * model tier, the decision record and the events that F149-FR-003 to
 * F149-FR-005 need and that a bare `AttemptKind` cannot hold. A planner that
 * carries only `next` is called through `next`.
 */
export type SeamAttemptPlanner = AttemptPlanner & {
  readonly plan?: (input: PlannerCallInput) => PlannerContribution;
};

/* ------------------------------------------------------------------ *
 * What the seam gives the engine.
 * ------------------------------------------------------------------ */

/** A planner that failed, with the kind that stood after its failure. */
export type PlannerFailure = {
  readonly id: string;
  readonly place: number;
  readonly message: string;
  /** `plain` where the planner at place 1 failed; the kind so far otherwise. */
  readonly kindAfterTheFailure: AttemptKind;
};

/** What `planNextAttempt` returns to the engine. */
export type PlannedNextAttempt = {
  /** The plan of the next phase attempt (data-model.md). */
  readonly plan: NextAttemptPlan;
  /** The kind the planner at place 1 gave; the guard of the plan reads it. */
  readonly kindFromTheRecoveryCycle: AttemptKind;
  /** The ids of the planners that were called, in the order they were called. */
  readonly calledInOrder: readonly string[];
  /** The events the planners offered, in order. */
  readonly events: readonly AttemptPlannerEvent[];
  /** The planners that failed. A failure is not a halt (F149-FR-002). */
  readonly failures: readonly PlannerFailure[];
  /** Always null: no exit code comes from a planner (F149-FR-002). */
  readonly exitCode: null;
  /** Always null: no stop reason comes from a planner (F149-FR-002). */
  readonly stopReason: null;
  /** Whether a planner asked for its option to go off for the rest of the run. */
  readonly switchTheOptionOffForTheRun: boolean;
};

/** The kinds the planner of the recovery cycle may give (F149-FR-002). */
export const KINDS_THE_RECOVERY_CYCLE_MAY_GIVE = ["plain", "diagnosed", "accelerated"] as const;

/** The one kind a later planner may introduce, and only out of `plain`. */
export const KIND_A_LATER_PLANNER_MAY_INTRODUCE = "bumped" as const;

/**
 * data-model.md, field `freshSession`: "a new phase attempt starts a fresh
 * session in every case". So the seam returns `true` always, and a bump does
 * not have to ask for what already holds.
 */
export const FRESH_SESSION_IN_EVERY_CASE = true as const;

/** No exit code comes from a planner (F149-FR-002, F149-FR-007). */
export const EXIT_CODES_FROM_A_PLANNER: readonly number[] = Object.freeze([]);

/** No stop reason comes from a planner (F149-FR-002, F149-FR-007). */
export const STOP_REASONS_FROM_A_PLANNER: readonly string[] = Object.freeze([]);

/** A planner changes no count, no limit and no halt (F149-FR-002). */
export const A_PLANNER_CHANGES_NO_COUNT = true as const;

/** Where the guard of the plan refuses what the planners built. */
export const GUARD_FAILURE_FALLS_BACK_TO =
  "the kind of the recovery cycle on the base model tier, with no decision and no skip reason";

/**
 * The kind of the recovery cycle, as the seam reads it: a kind outside
 * `KINDS_THE_RECOVERY_CYCLE_MAY_GIVE` — an unknown one, and `bumped`, which
 * only a later planner may introduce — is read as `plain` (F149-FR-002).
 */
export function recoveryCycleKindOf(value: unknown): AttemptKind {
  const kind = attemptKindOf(value);
  return (KINDS_THE_RECOVERY_CYCLE_MAY_GIVE as readonly string[]).includes(kind)
    ? kind
    : ATTEMPT_KIND_WHEN_UNKNOWN;
}

/** Call one planner, through `plan` where it has one and through `next` otherwise. */
function contributionOf(planner: SeamAttemptPlanner, input: PlannerCallInput): PlannerContribution {
  if (typeof planner.plan === "function") return planner.plan(input);
  return { kind: attemptKindOf(planner.next(input.attemptHistory)) };
}

/**
 * The seam `next` of `specstride.attempt-planner/1` (F149-FR-002).
 *
 * It calls every registered planner ONCE, in the order of the seam
 * (`attemptPlannersInOrder`), hands each a FROZEN input, and builds one plan of
 * the next phase attempt out of what they gave. A planner that throws is
 * recorded as a failure and contributes nothing: at place 1 the kind is then
 * `plain` (F149-FR-002, "A planner that fails, and an unknown kind, MUST give
 * `plain`"), and at a later place the model tier and the kind stay as they
 * were. Nothing here halts, writes or counts.
 */
export function planNextAttempt(input: AttemptPlannerInput): PlannedNextAttempt {
  const calledInOrder: string[] = [];
  const events: AttemptPlannerEvent[] = [];
  const failures: PlannerFailure[] = [];

  let recoveryKind: AttemptKind = ATTEMPT_KIND_WHEN_UNKNOWN;
  let kind: AttemptKind = ATTEMPT_KIND_WHEN_UNKNOWN;
  let modelTier = input.baseModelTier;
  let decision: AttemptTierDecision | undefined;
  let skipReason: SkippedBumpReason | undefined;
  let offForTheRun = input.theTierBumpIsOffForTheRun;

  let place = 0;
  for (const registered of attemptPlannersInOrder()) {
    place += 1;
    calledInOrder.push(registered.id);
    const callInput: PlannerCallInput = freezeDeep({
      ...input,
      theTierBumpIsOffForTheRun: offForTheRun,
      kindFromTheRecoveryCycle: recoveryKind,
      modelTier,
      place,
    });

    let contribution: PlannerContribution;
    try {
      contribution = contributionOf(registered.planner, callInput);
    } catch (error) {
      failures.push(
        Object.freeze({
          id: registered.id,
          place,
          message: error instanceof Error ? error.message : String(error),
          kindAfterTheFailure: place === 1 ? ATTEMPT_KIND_WHEN_UNKNOWN : kind,
        }),
      );
      if (place === 1) {
        recoveryKind = ATTEMPT_KIND_WHEN_UNKNOWN;
        kind = ATTEMPT_KIND_WHEN_UNKNOWN;
      }
      continue;
    }

    if (place === 1) {
      /* The planner at place 1 gives the KIND and nothing else. */
      recoveryKind = recoveryCycleKindOf(contribution.kind);
      kind = recoveryKind;
      for (const event of contribution.events ?? []) events.push(event);
      if (contribution.switchTheOptionOffForTheRun === true) offForTheRun = true;
      continue;
    }

    /* Place 2 and later: the MODEL TIER, and `plain` turned into `bumped`. */
    if (typeof contribution.modelTier === "string" && contribution.modelTier.length > 0) {
      modelTier = contribution.modelTier;
    }
    if (
      attemptKindOf(contribution.kind ?? kind) === KIND_A_LATER_PLANNER_MAY_INTRODUCE &&
      recoveryKind === ATTEMPT_KIND_WHEN_UNKNOWN
    ) {
      kind = KIND_A_LATER_PLANNER_MAY_INTRODUCE;
    }
    if (contribution.decision !== undefined) decision = contribution.decision;
    if (contribution.skipReason !== undefined) skipReason = contribution.skipReason;
    if (contribution.switchTheOptionOffForTheRun === true) offForTheRun = true;
    for (const event of contribution.events ?? []) events.push(event);
  }

  const built: NextAttemptPlan = Object.freeze({
    kind,
    modelTier,
    freshSession: FRESH_SESSION_IN_EVERY_CASE,
    ...(decision === undefined ? {} : { decision }),
    ...(skipReason === undefined ? {} : { skipReason }),
  });
  const plan: NextAttemptPlan = isNextAttemptPlan(built, recoveryKind)
    ? built
    : Object.freeze({
        kind: recoveryKind,
        modelTier: input.baseModelTier,
        freshSession: FRESH_SESSION_IN_EVERY_CASE,
      });

  return Object.freeze({
    plan,
    kindFromTheRecoveryCycle: recoveryKind,
    calledInOrder: Object.freeze([...calledInOrder]),
    events: Object.freeze([...events]),
    failures: Object.freeze([...failures]),
    exitCode: null,
    stopReason: null,
    switchTheOptionOffForTheRun: offForTheRun,
  });
}
