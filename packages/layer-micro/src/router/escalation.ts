/**
 * T080 — the escalation of the model tier as the second repair
 * (F115-FR-034, F115-FR-035; IR-47).
 *
 * Escalation is a switch of its own, on by default. It acts only as the
 * second repair of a unit, after the same failure signature on two
 * consecutive proposals, and never on a taint, another integrity event, a
 * flaky command, a quota or rate error, a time limit or a crash of a
 * harness. The target is the next model tier of the ladder of the same
 * harness, pinned at launch, in a fresh session. The target is never a rung
 * that equals a critic-class call of the run in model and in effort: the
 * signal `targetIsCriticModel` is true only when both are equal, and the
 * escalation is then skipped with the reason `critic-collision`. A rung that
 * shares the model alone is used, and the critic-diversity warning is raised
 * and recorded with the escalation (signal `targetSharesCriticModel`).
 *
 * Caps: 1 per task id, 2 per phase attempt, inside the repairs and never in
 * addition. Every skip carries a reason of the closed set and is recorded as
 * an event of the type `escalation.skipped`, beside the `route.decided` of
 * the decision; when the quota of the target is exhausted the reason is
 * `quota` and the repair runs on the base model tier.
 *
 * F115-FR-035 — escalation and the model-tier bump after critic rejections
 * are separate rules with separate counts. An escalation never changes the
 * tier the next phase attempt starts on.
 *
 * Purity: imports `@specstride/contracts` only; no `node:fs`, no process.
 */
import { criticSignals } from "./route.ts";

/** The closed set of the skip reasons (annex X §X.6 row 140). */
export const ESCALATION_SKIP_REASONS = [
  "off",
  "integrity",
  "flaky",
  "not-due",
  "cap",
  "no-ladder",
  "critic-collision",
  "quota",
  "budget",
] as const;
export type EscalationSkipReason = (typeof ESCALATION_SKIP_REASONS)[number];

/** The caps of the escalation (row 65; F115-FR-034). */
export const ESCALATION_CAPS = Object.freeze({
  /** `loop.micro.caps.escalationsPerTask` */
  perTask: 1,
  /** `loop.micro.caps.escalationsPerAttempt` */
  perAttempt: 2,
});

/** One rung of the pinned ladder of the harness of the run. */
export type Rung = {
  readonly model: string;
  readonly effort: string;
};

/** The pinned ladder of the harness, lowest tier first. */
export type Ladder = readonly Rung[];

/** The counters of the escalations of one phase attempt (F115-FR-035). */
export type EscalationCounters = {
  readonly perTask: Readonly<Record<string, number>>;
  readonly perAttempt: number;
};

/** Fresh escalation counters. */
export function newEscalationCounters(): EscalationCounters {
  return { perTask: Object.freeze({}), perAttempt: 0 };
}

/**
 * F115-FR-035 — the counters of the model-tier bump after critic rejections:
 * a rule of its own, with counts of its own. Nothing here reads or writes
 * the escalation counters, and the other way round.
 */
export type ModelTierBumpCounters = {
  readonly bumps: number;
};

export function newModelTierBumpCounters(): ModelTierBumpCounters {
  return { bumps: 0 };
}

/**
 * F115-FR-034 — the next rung of the pinned ladder after the tier in force:
 * `undefined` when the tier in force is the last one.
 */
export function nextRung(ladder: Ladder, current: Rung): Rung | undefined {
  const index = ladder.findIndex(
    (rung) => rung.model === current.model && rung.effort === current.effort,
  );
  if (index === -1 || index + 1 >= ladder.length) return undefined;
  return ladder[index + 1];
}

/** The signals of the escalation decision point, from recorded facts only. */
export type EscalationSignals = {
  readonly escalationOn: boolean;
  /** Conditions of the failed result. */
  /** The conditions of the attempt, as the table reads them: a scalar signal. */
  readonly conditions: string;
  /** The kind of the newest integrity event of the attempt, or absent. */
  readonly integrityKind?: string;
  readonly commandFlaky: boolean;
  readonly signatureRepeated: boolean;
  readonly repairsUsed: number;
  readonly escalationsTask: number;
  readonly escalationsAttempt: number;
  readonly targetQuotaExhausted: boolean;
  readonly budgetAllows: boolean;
};

/** What an escalation plan states. */
export type EscalationPlan =
  | {
      readonly made: true;
      readonly target: Rung;
      /** F115-FR-034 — the escalated repair always runs in a fresh session. */
      readonly freshSession: true;
      /**
       * The critic-diversity warning, present exactly when the target shares
       * the model of a critic-class call and differs from it in effort
       * (F115-FR-034; F100-FR-130).
       */
      readonly criticDiversityWarning?: string;
      /** The signals the decision read, for the record beside `route.decided`. */
      readonly signals: Record<string, unknown>;
      readonly ruleId: string;
    }
  | {
      readonly made: false;
      readonly skip: EscalationSkipReason;
      /** The repair runs on the base model tier (always; F115-FR-034). */
      readonly repairOnBaseTier: true;
      readonly signals: Record<string, unknown>;
      readonly ruleId: string;
    };

/** The events of an escalation plan. */
export type EscalationEvents =
  | { readonly decided: "route.decided"; readonly skipped: undefined }
  | {
      readonly decided: "route.decided";
      readonly skipped: {
        readonly type: "escalation.skipped";
        readonly reason: EscalationSkipReason;
      };
    };

/**
 * F115-FR-034 — plan the escalation for one repair decision. The row order
 * and the predicates of the shipped table decide; this function carries the
 * signals to the decision and states its outcome: the target with the fresh
 * session, or the skip with its reason and the repair on the base tier.
 */
export function planEscalation(
  signals: EscalationSignals,
  deps: {
    /** The tier in force, read from the read-only view of the attempt. */
    readonly currentTier: Rung;
    /** The pinned ladder of the harness (F115-FR-034). */
    readonly ladder: Ladder;
    /** The critic-class calls of the run: the critic, the diagnostician, release verification. */
    readonly criticCalls: readonly Rung[];
    /** The decision of the table at the point `escalation`. */
    readonly decide: (signals: Record<string, unknown>) => {
      readonly choice: string;
      readonly ruleId: string;
    };
  },
): EscalationPlan {
  const target = nextRung(deps.ladder, deps.currentTier);
  const critic = criticSignals(target ?? deps.currentTier, deps.criticCalls);
  const vector: Record<string, unknown> = {
    escalationOn: signals.escalationOn,
    conditions: signals.conditions,
    ...(signals.integrityKind === undefined ? {} : { integrityKind: signals.integrityKind }),
    commandFlaky: signals.commandFlaky,
    signatureRepeated: signals.signatureRepeated,
    repairsUsed: signals.repairsUsed,
    escalationsTask: signals.escalationsTask,
    escalationsAttempt: signals.escalationsAttempt,
    ...(target === undefined ? {} : { nextTier: `${target.model}:${target.effort}` }),
    targetIsCriticModel: critic.targetIsCriticModel,
    targetSharesCriticModel: critic.targetSharesCriticModel,
    targetQuotaExhausted: signals.targetQuotaExhausted,
    budgetAllows: signals.budgetAllows,
  };
  const decision = deps.decide(vector);
  const choice = decision.choice;
  if (choice.startsWith("skip:")) {
    const reason = choice.slice("skip:".length) as EscalationSkipReason;
    return {
      made: false,
      skip: reason,
      repairOnBaseTier: true,
      signals: vector,
      ruleId: decision.ruleId,
    };
  }
  // `next-tier`: the target exists (the row `esc.no-ladder` skipped otherwise).
  const rung = target as Rung;
  return {
    made: true,
    target: rung,
    freshSession: true,
    ...(critic.targetSharesCriticModel
      ? {
          criticDiversityWarning:
            `the escalation target ${rung.model}:${rung.effort} shares the model of a ` +
            "critic-class call of the run and differs from it in effort; the " +
            "critic-diversity warning is raised and recorded with the escalation",
        }
      : {}),
    signals: vector,
    ruleId: decision.ruleId,
  };
}

/** The events of one escalation plan, for the ledger. */
export function escalationEvents(plan: EscalationPlan): EscalationEvents {
  if (plan.made) return { decided: "route.decided", skipped: undefined };
  return {
    decided: "route.decided",
    skipped: { type: "escalation.skipped", reason: plan.skip },
  };
}

/**
 * F115-FR-034 — record one escalation on the counters: 1 per task id, 2 per
 * phase attempt, inside the repairs and never in addition.
 */
export function recordEscalation(counters: EscalationCounters, taskId: string): EscalationCounters {
  return {
    perTask: Object.freeze({
      ...counters.perTask,
      [taskId]: (counters.perTask[taskId] ?? 0) + 1,
    }),
    perAttempt: counters.perAttempt + 1,
  };
}

/** F115-FR-034 — the caps hold for the task id and the attempt. */
export function escalationAllowed(
  counters: EscalationCounters,
  taskId: string,
  caps: { readonly perTask: number; readonly perAttempt: number } = ESCALATION_CAPS,
): boolean {
  return (counters.perTask[taskId] ?? 0) < caps.perTask && counters.perAttempt < caps.perAttempt;
}

/**
 * F115-FR-035 — an escalation never changes the tier the next phase attempt
 * starts on: the tier in force for an attempt comes from its read-only view,
 * and the layer reads it there. The bump rule counts separately.
 */
export function tierForNextAttempt(baseTier: Rung, _escalations: EscalationCounters): Rung {
  return baseTier;
}

/**
 * IR-47 — the target equals no critic-class call in model and in effort:
 * the pairing of the target against the critic-class calls, as the signals
 * state it.
 */
export function targetAgainstCriticCalls(
  target: Rung,
  criticCalls: readonly Rung[],
): { readonly targetIsCriticModel: boolean; readonly targetSharesCriticModel: boolean } {
  return criticSignals(target, criticCalls);
}
