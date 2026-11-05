/**
 * T025 and T026 — the planner of the MODEL-TIER BUMP: the option that is off by
 * default (F149-FR-003 to F149-FR-006).
 *
 * After K rejections of one phase BY THE CRITIC, the next phase attempt of that
 * phase runs on the rung above the model tier the role plan gives the proposer,
 * on the ladder of the SAME harness. The decision is not written in code: it is
 * a row of the pure table `attempt-planner.tier-bump`
 * (`packages/core/src/ep18/bump-table.ts`, T003), evaluated by the ONE table
 * evaluator of the kernel (`evaluateTable` of `@specstride/kernel`) over the
 * seven recorded signals of data-model.md (F149-FR-006). No signal is a model's
 * text, and none is found out by a call.
 *
 * ## T025 — the rule
 *
 * | Signal | From |
 * |---|---|
 * | `optionOn` | configuration, `attempt.tier_bump` (row 24 of annex X §X.7) |
 * | `criticRejections` | the ledger, through the history |
 * | `k` | configuration, `attempt.tier_bump_after` (row 128) |
 * | `alreadyBumped` | the history |
 * | `hasHigherTier` | the model-tier ladder of the proposer's harness |
 * | `targetIsCriticModel` | the models and efforts of the critic-class calls |
 * | `targetQuotaExhausted` | what the run recorded; false where nothing is |
 *
 * `planTheTierBump` is a PURE function of its input: it reads its argument and
 * the frozen table, makes no call of any kind, and changes no count (annex E
 * §E.1, "Guarantees of a planner"). It is the planner at place 2 of the order of
 * the seam, so it gives the MODEL TIER and may turn a `plain` phase attempt into
 * `bumped` — never any other kind, which is what keeps a phase attempt due for
 * acceleration `accelerated` on the bumped model tier (F149-FR-004).
 *
 * With the option OFF the planner contributes NOTHING AT ALL — no model tier, no
 * decision record, no event — so that a build with the option off cannot differ
 * on any surface from a build without the planner (F149-FR-003, F149-SC-003).
 * The row that says so is `TB-01-option-off`, and the planner acts on the row
 * rather than deciding beside the table.
 *
 * ## T026 — the count, the events and the fresh session
 *
 * The count of rejections by the critic lives in the ledger, namespace `core`,
 * field `counters`, under `criticRejections` (data-model.md). A planner changes
 * no count, so this module only says WHAT the engine appends:
 * `ledgerAppendOfTheCriticRejectionCount` builds the record and
 * `rejectionCountsTowardsK` decides whether a phase gate added to it. Only a
 * verdict REJECTED of the critic does: a failed verification gate, a MALFORMED
 * verdict and a phase attempt that ended without a verdict add nothing
 * (F149-FR-004). The count is kept PER PHASE, read back from the ledger — which
 * is why it survives a resume — and `countersResetOnPurpose` resets it with the
 * other counts.
 *
 * Every bump and every skip is an event that carries the rule id, the version of
 * the table and, for a skip, its reason (F149-FR-005). The phase attempt after a
 * bump starts a fresh session, which `freshSession` of the plan carries. Nothing
 * of a bump or a skip reaches the critic: `FIELDS_OF_A_BUMP` names the fields
 * and `theBumpReachesTheCritic` is the check the test applies to the critic
 * prompt, the fact block and the feedback.
 */
import {
  evaluateTable,
  loadTable,
  TableLoadError,
  type LoadedTable,
  type Predicate,
  type TableRow,
} from "@specstride/kernel";
import { outcomesOfTheBumpRule, reasonsOfASkippedBump } from "@specstride/contracts/enums/all-sets";
import { profileRow, type ProfileRow } from "@specstride/contracts/profile/parity";
import {
  DIVERSITY_RESULTS_THAT_WARN,
  TIER_BUMP_DEFAULT_ON,
  WARNING_NAME,
  type AttemptKind,
  type Verdict,
} from "@specstride/contracts/ep/critic-strategy";
import type { AttemptTierDecision, SkippedBumpReason } from "@specstride/contracts/ep/ep18-values";
import { BUMP_TABLE, BUMP_TABLE_POINT, SKIP_REASON_OF_RULE, type BumpTable } from "./bump-table.ts";
import { CRITIC_REJECTIONS_COUNTER, HISTORY_COUNTERS, countersOfThePhase } from "./history.ts";
import type { LedgerRecordOfTheHistory } from "./history.ts";
import {
  POINT_ID,
  TIER_BUMP_PLANNER_ID,
  registerAttemptPlanner,
  type AttemptPlannerEvent,
  type CriticClassCall,
  type ModelTierRung,
  type PlannerCallInput,
  type PlannerContribution,
  type RecordedQuotaOfATarget,
  type RegisteredAttemptPlanner,
  type SeamAttemptPlanner,
} from "./attempt-planner.ts";
import type { AttemptHistory } from "@specstride/contracts/ep/critic-strategy";

/* ------------------------------------------------------------------ *
 * The option and K.
 * ------------------------------------------------------------------ */

/** Row 24 of annex X §X.7 — "Model-tier bump after K rejections". */
export const TIER_BUMP_PARITY_ROW = 24 as const;
/** Row 128 of annex X §X.7 — "K of the model-tier bump". */
export const K_PARITY_ROW = 128 as const;

/** The configuration key of the option (row 24). */
export const TIER_BUMP_OPTION_KEY = "attempt.tier_bump" as const;
/** The configuration key of K (row 128). */
export const TIER_BUMP_AFTER_KEY = "attempt.tier_bump_after" as const;

/** The literals the option takes. */
export const ON = "on" as const;
export const OFF = "off" as const;

/** The default of K (research.md D2; row 128 of annex X §X.7). */
export const DEFAULT_K = 2 as const;

/** The option is off by default (F149-FR-003; F100-FR-140). */
export const THE_OPTION_IS_OFF_BY_DEFAULT = TIER_BUMP_DEFAULT_ON === false;

/** With the option off the planner contributes nothing at all (F149-FR-003). */
export const THE_OPTION_OFF_CONTRIBUTES_NOTHING = true as const;

/** The row of the option, as `data/parity-profile.json` holds it. */
export function rowOfTheOption(): ProfileRow {
  const row = profileRow(TIER_BUMP_PARITY_ROW);
  if (row === undefined) {
    throw new Error(
      `the \`parity\` profile holds no row ${String(TIER_BUMP_PARITY_ROW)}; the model-tier ` +
        `bump is switched by that row of annex X §X.7 (F149-FR-003)`,
    );
  }
  return row;
}

/** The row of K, as `data/parity-profile.json` holds it. */
export function rowOfK(): ProfileRow {
  const row = profileRow(K_PARITY_ROW);
  if (row === undefined) {
    throw new Error(
      `the \`parity\` profile holds no row ${String(K_PARITY_ROW)}; K of the model-tier bump ` +
        `is that row of annex X §X.7 (F149-FR-003)`,
    );
  }
  return row;
}

/**
 * Whether the option is on, from the configuration. The default of the row is
 * `off` and under the `parity` profile it is `off`, so a value the option does
 * not offer is read as OFF: an unreadable switch never silently switches a paid
 * model tier on (F149-FR-003).
 */
export function theBumpIsOn(config: Readonly<Record<string, unknown>> = {}): boolean {
  const held = config[TIER_BUMP_OPTION_KEY];
  if (held === ON || held === true) return true;
  return false;
}

/**
 * K, from the configuration, with the default of row 128 (2). A value that is
 * no whole number above 0 is read as the default.
 */
export function kOfTheBump(config: Readonly<Record<string, unknown>> = {}): number {
  const held = config[TIER_BUMP_AFTER_KEY];
  const value = typeof held === "string" ? Number(held) : held;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  return DEFAULT_K;
}

/* ------------------------------------------------------------------ *
 * The ladder and the target.
 * ------------------------------------------------------------------ */

/** A bump never moves to another harness (F149-FR-005). */
export const A_BUMP_NEVER_MOVES_TO_ANOTHER_HARNESS = true as const;

/** The target of a bump: one rung of the ladder of the proposer's harness. */
export type TargetOfTheBump = ModelTierRung & {
  /** The harness of the proposer, which a bump never leaves. */
  readonly harness: string;
};

const normalize = (value: string | null | undefined): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : null;

/** The sentinel a model or an effort the registry does not name compares as. */
export const NOT_NAMED = "(none)" as const;

const compared = (value: string | null | undefined): string => normalize(value) ?? NOT_NAMED;

/**
 * The rung above a model tier on the ladder, or null at the top of the ladder
 * and for a tier the ladder does not hold. "The next model tier MUST be the rung
 * above the model tier that the role plan gives the proposer for the phase"
 * (F149-FR-003).
 */
export function rungAbove(ladder: readonly ModelTierRung[], tier: string): ModelTierRung | null {
  const at = ladder.findIndex((rung) => compared(rung.tier) === compared(tier));
  if (at === -1) return null;
  return ladder[at + 1] ?? null;
}

/** The target of a bump on this harness, or null where there is none. */
export function targetOfTheBump(
  harness: string,
  ladder: readonly ModelTierRung[],
  baseModelTier: string,
): TargetOfTheBump | null {
  const rung = rungAbove(ladder, baseModelTier);
  if (rung === null) return null;
  return Object.freeze({ ...rung, harness });
}

/** Whether the ladder has a rung above the base model tier. */
export function hasHigherTier(ladder: readonly ModelTierRung[], baseModelTier: string): boolean {
  return rungAbove(ladder, baseModelTier) !== null;
}

/**
 * Whether the target EQUALS a critic-class call of the run in model AND in
 * effort (F149-FR-005; CQ-204). A target that shares only the model is NOT a
 * collision: it is used, and the critic-diversity warning is raised
 * (`targetSharesOnlyTheModel`).
 *
 * Equality is equality of the pair (model, effort), normalized; a model or an
 * effort the registry does not name compares as `NOT_NAMED`, so two calls on the
 * same model with no effort stated anywhere are read as the same call. The
 * alternative — an unnamed effort never equal to anything — would bump onto the
 * critic's own call wherever a role plan states no effort, which is the one
 * outcome ruling 49 forbids.
 */
export function targetIsCriticModel(
  target: TargetOfTheBump | null,
  criticClassCalls: readonly CriticClassCall[],
): boolean {
  if (target === null) return false;
  return criticClassCalls.some(
    (call) =>
      compared(call.model) === compared(target.model) &&
      compared(call.effort) === compared(target.effort),
  );
}

/**
 * Whether the target shares the MODEL of a critic-class call and differs from it
 * in effort. Not a collision (ruling 49; F100-FR-140): the bump is made, and the
 * critic-diversity warning is raised and recorded, as for escalation
 * (F149-FR-005).
 */
export function targetSharesOnlyTheModel(
  target: TargetOfTheBump | null,
  criticClassCalls: readonly CriticClassCall[],
): boolean {
  if (target === null) return false;
  if (targetIsCriticModel(target, criticClassCalls)) return false;
  return criticClassCalls.some((call) => compared(call.model) === compared(target.model));
}

/** The result of the diversity test this feature records for a bump. */
export const DIVERSITY_RESULT_OF_A_SHARED_MODEL = "same-model" as const;

/** The warning a shared model raises; feature 111 owns the name. */
export const BUMP_WARNING_NAME = WARNING_NAME;

/** The results of the diversity test that warn, re-exported for the test. */
export const RESULTS_THAT_WARN = DIVERSITY_RESULTS_THAT_WARN;

/** No call is made to find out the quota of a target (F149-FR-005; research.md D4). */
export const NO_CALL_IS_MADE_TO_FIND_OUT_THE_QUOTA = true as const;

/**
 * Whether the quota of the target is exhausted, FROM WHAT THE RUN RECORDED. A
 * target no record names counts as not exhausted, and nothing here probes
 * anything: the function reads its two arguments (F149-FR-005).
 */
export function targetQuotaExhausted(
  target: TargetOfTheBump | null,
  recorded: readonly RecordedQuotaOfATarget[],
): boolean {
  if (target === null) return false;
  const record = recorded.find((r) => compared(r.target) === compared(target.tier));
  if (record === undefined) return false;
  return record.exhausted === true;
}

/* ------------------------------------------------------------------ *
 * The signals and the table.
 * ------------------------------------------------------------------ */

/** The seven signals of data-model.md, in the order the table declares them. */
export const BUMP_SIGNALS = [
  "optionOn",
  "criticRejections",
  "k",
  "alreadyBumped",
  "hasHigherTier",
  "targetIsCriticModel",
  "targetQuotaExhausted",
] as const;

/** The vector of signals the table is evaluated over. */
export type BumpSignals = {
  readonly optionOn: boolean;
  readonly criticRejections: number;
  readonly k: number;
  readonly alreadyBumped: boolean;
  readonly hasHigherTier: boolean;
  readonly targetIsCriticModel: boolean;
  readonly targetQuotaExhausted: boolean;
};

/**
 * The vector of signals of one call of the planner, built from the input alone
 * (F149-FR-006: "evaluated by the one table evaluator from recorded signals
 * only"). The option is off for the whole run once its table was found invalid,
 * which the engine carries in `theTierBumpIsOffForTheRun`.
 */
export function signalsOfTheBump(input: PlannerCallInput): BumpSignals {
  const target = targetOfTheBump(input.harness, input.ladder, input.baseModelTier);
  return Object.freeze({
    optionOn: theBumpIsOn(input.config) && input.theTierBumpIsOffForTheRun !== true,
    criticRejections: input.history.counters[CRITIC_REJECTIONS_COUNTER] ?? 0,
    k: kOfTheBump(input.config),
    alreadyBumped: input.history.bumped === true,
    hasHigherTier: target !== null,
    targetIsCriticModel: targetIsCriticModel(target, input.criticClassCalls),
    targetQuotaExhausted: targetQuotaExhausted(target, input.quotaRecordedByTheRun),
  });
}

/** The rule id of the row that switches everything off when the option is off. */
export const OPTION_OFF_RULE = "TB-01-option-off" as const;
/** The rule id of the row that bumps. */
export const BUMP_RULE = "TB-07-bump" as const;
/** The rule id of the row that fires where the phase was bumped already. */
export const ALREADY_BUMPED_RULE = "TB-03-already-bumped" as const;

/**
 * Load the bump table through the LOAD CHECK of the table evaluator of the
 * kernel (annex X §X.3). A table that does not pass it is invalid, and
 * `TableLoadError` is what `planTheTierBump` turns into "the option is off for
 * the run, announced" (F149-FR-006).
 */
export function loadTheBumpTable(table: BumpTable = BUMP_TABLE): LoadedTable {
  return loadTable(table);
}

/**
 * Bind an operand that names a SIGNAL instead of a literal.
 *
 * `TB-02-below-k` compares two declared signals, `criticRejections` and `k`;
 * the leaf form of annex X §X.3 compares a signal with a literal, so the table
 * carries the signal NAME `"k"` as the value of that leaf (the head of
 * `bump-table.ts`). The evaluator compares numbers, so the operand is bound to
 * the value of the signal before the table is evaluated. Where no operand names
 * a signal the table comes back unchanged.
 */
export function bindSignalOperands(
  table: LoadedTable,
  signals: Readonly<Record<string, unknown>>,
): LoadedTable {
  const declared = new Set(Object.keys(signals));
  const bindPredicate = (node: Predicate): Predicate => ({
    ...node,
    ...(typeof node.value === "string" && declared.has(node.value)
      ? { value: signals[node.value] }
      : {}),
    ...(node.of === undefined ? {} : { of: node.of.map(bindPredicate) }),
  });
  const rows: Record<string, TableRow[]> = {};
  for (const [point, pointRows] of Object.entries(table.rows)) {
    rows[point] = pointRows.map((row: TableRow) =>
      row.when === undefined ? row : { ...row, when: bindPredicate(row.when) },
    );
  }
  return { ...table, rows };
}

/** The signal names a row reads, including those a `value` names (`TB-02`). */
function signalsReadByTheRow(
  table: LoadedTable,
  point: string,
  ruleId: string,
  declared: readonly string[],
): readonly string[] {
  const row = (table.rows[point] ?? []).find((r) => r.ruleId === ruleId);
  if (row === undefined || row.when === undefined) return [];
  const out: string[] = [];
  const walk = (node: Predicate): void => {
    for (const operand of node.of ?? []) walk(operand);
    if (typeof node.signal === "string" && !out.includes(node.signal)) out.push(node.signal);
    if (
      typeof node.value === "string" &&
      declared.includes(node.value) &&
      !out.includes(node.value)
    )
      out.push(node.value);
  };
  walk(row.when);
  return out;
}

/** Row 253 of annex X §X.6 — an unknown outcome of the bump rule is `none`. */
export function bumpOutcomeOf(value: unknown): "bump" | "skip" | "none" {
  return typeof value === "string" && outcomesOfTheBumpRule.has(value)
    ? (value as "bump" | "skip" | "none")
    : "none";
}

/**
 * Row 254 of annex X §X.6 — the reason of a skipped bump, derived from the rule
 * that fired (`contracts/README.md`). A rule the map does not name gives
 * `undefined`, and a reason outside the closed set is refused by the same map,
 * so no plan can carry a reason that is not a member.
 */
export function skipReasonOfTheRule(ruleId: string): SkippedBumpReason | undefined {
  const reason = SKIP_REASON_OF_RULE[ruleId];
  return reason !== undefined && reasonsOfASkippedBump.has(reason) ? reason : undefined;
}

/**
 * Evaluate the bump rule: the ONE table evaluator of the kernel over the frozen
 * table and the vector of signals (F149-FR-006). Pure. The decision record
 * carries the table id, the table version, the decision point, the rule id, the
 * signals the rule read and the choice (annex X §X.3, F100-FR-204).
 *
 * Throws `TableLoadError` where the table is invalid; `planTheTierBump` catches
 * it and switches the option off for the run, announced.
 */
export function evaluateTheBumpRule(
  signals: BumpSignals,
  table: BumpTable = BUMP_TABLE,
): AttemptTierDecision {
  const loaded = loadTheBumpTable(table);
  const vector: Record<string, unknown> = { ...signals };
  const decision = evaluateTable(bindSignalOperands(loaded, vector), BUMP_TABLE_POINT, vector);
  const read = signalsReadByTheRow(loaded, BUMP_TABLE_POINT, decision.ruleId, Object.keys(vector));
  const recorded: Record<string, unknown> = {};
  for (const name of read) recorded[name] = vector[name];
  return Object.freeze({
    tableId: decision.tableId,
    tableVersion: decision.tableVersion,
    point: decision.point,
    ruleId: decision.ruleId,
    signals: Object.freeze(recorded),
    choice: bumpOutcomeOf(decision.choice),
  });
}

/* ------------------------------------------------------------------ *
 * T026 — the events of a bump and of a skip.
 * ------------------------------------------------------------------ */

/** The event of a bump on the primary stream. */
export const BUMP_EVENT = "ep18.attempt.tier-bump" as const;
/** The event of a skipped bump on the primary stream. */
export const BUMP_SKIPPED_EVENT = "ep18.attempt.tier-bump-skipped" as const;
/** The announcement that an invalid table switched the option off for the run. */
export const BUMP_OFF_EVENT = "ep18.attempt.tier-bump-off" as const;
/** The three names, which are this feature's until feature 111's catalogue carries them. */
export const TIER_BUMP_EVENT_NAMES = [BUMP_EVENT, BUMP_SKIPPED_EVENT, BUMP_OFF_EVENT] as const;

/**
 * The event of a decision of the bump rule. Every bump and every skip is one,
 * and it carries the RULE ID, the VERSION OF THE TABLE and, for a skip, its
 * REASON (F149-FR-005). It never blocks.
 */
export function tierBumpEventOf(args: {
  readonly decision: AttemptTierDecision;
  readonly fromModelTier: string;
  readonly toModelTier: string;
  readonly harness: string;
  readonly skipReason?: SkippedBumpReason;
  readonly sameModelWarning?: boolean;
}): AttemptPlannerEvent {
  const skipping = args.decision.choice === "skip";
  return Object.freeze({
    name: skipping ? BUMP_SKIPPED_EVENT : BUMP_EVENT,
    blocking: false as const,
    ruleId: args.decision.ruleId,
    tableId: args.decision.tableId,
    tableVersion: args.decision.tableVersion,
    point: args.decision.point,
    choice: args.decision.choice,
    signals: args.decision.signals,
    fromModelTier: args.fromModelTier,
    toModelTier: args.toModelTier,
    harness: args.harness,
    ...(skipping ? { skipReason: args.skipReason } : { freshSession: true }),
    ...(args.sameModelWarning === true
      ? { sameModelWarning: true, warning: BUMP_WARNING_NAME }
      : {}),
  });
}

/** The announcement of an invalid table (F149-FR-006). It never blocks. */
export function bumpOffForTheRunEventOf(reason: string): AttemptPlannerEvent {
  return Object.freeze({
    name: BUMP_OFF_EVENT,
    blocking: false as const,
    tableId: BUMP_TABLE.id,
    tableVersion: BUMP_TABLE.version,
    reason,
  });
}

/* ------------------------------------------------------------------ *
 * The planner.
 * ------------------------------------------------------------------ */

/** The phase attempt after a bump starts a fresh session (F149-FR-005). */
export const THE_PHASE_ATTEMPT_AFTER_A_BUMP_STARTS_A_FRESH_SESSION = true as const;

/**
 * The planner of the model-tier bump as a PURE function (F149-FR-003 to
 * F149-FR-006).
 *
 * | Rule that fires | What it contributes |
 * |---|---|
 * | `TB-01-option-off` | nothing at all, so a build with the option off cannot differ from one without the planner |
 * | `TB-02-below-k` | the decision record only: below K nothing is bumped |
 * | `TB-03-already-bumped` | the decision record and the bumped model tier, which the later phase attempts of the phase keep |
 * | `TB-04`, `TB-05`, `TB-06` | the decision record, the reason of the skip and the event of a skip; the model tier stays the one it would have had |
 * | `TB-07-bump` | the bumped model tier, `bumped`, the event of a bump, a fresh session |
 * | `TB-00-default` | the decision record only |
 */
export function planTheTierBump(
  input: PlannerCallInput,
  table: BumpTable = BUMP_TABLE,
): PlannerContribution {
  /* The option is OFF FOR THE REST OF THE RUN: its table was found invalid and
   * the engine holds the latch (F149-FR-006). Nothing at all, as with the option
   * off, so the announcement is made once and not at every rejection. */
  if (input.theTierBumpIsOffForTheRun === true) return Object.freeze({});

  const signals = signalsOfTheBump(input);
  let decision: AttemptTierDecision;
  try {
    decision = evaluateTheBumpRule(signals, table);
  } catch (error) {
    /* An invalid table switches the bump off FOR THE RUN, announced
     * (F149-FR-006). The kind stays the one the recovery cycle gave, because
     * this planner contributes nothing else. */
    const reason = error instanceof TableLoadError ? error.message : String(error);
    return Object.freeze({
      switchTheOptionOffForTheRun: true,
      events: Object.freeze([bumpOffForTheRunEventOf(reason)]),
    });
  }

  /* The option off: nothing at all (F149-FR-003, F149-SC-003). */
  if (decision.ruleId === OPTION_OFF_RULE) return Object.freeze({});

  const target = targetOfTheBump(input.harness, input.ladder, input.baseModelTier);

  if (decision.choice === "skip") {
    const skipReason = skipReasonOfTheRule(decision.ruleId);
    return Object.freeze({
      decision,
      ...(skipReason === undefined ? {} : { skipReason }),
      events: Object.freeze([
        tierBumpEventOf({
          decision,
          fromModelTier: input.modelTier,
          toModelTier: input.modelTier,
          harness: input.harness,
          ...(skipReason === undefined ? {} : { skipReason }),
        }),
      ]),
    });
  }

  if (decision.choice === "bump" && target !== null) {
    const sameModelWarning = targetSharesOnlyTheModel(target, input.criticClassCalls);
    return Object.freeze({
      kind: "bumped" as AttemptKind,
      modelTier: target.tier,
      freshSession: THE_PHASE_ATTEMPT_AFTER_A_BUMP_STARTS_A_FRESH_SESSION,
      decision,
      events: Object.freeze([
        tierBumpEventOf({
          decision,
          fromModelTier: input.modelTier,
          toModelTier: target.tier,
          harness: target.harness,
          ...(sameModelWarning ? { sameModelWarning: true } : {}),
        }),
      ]),
    });
  }

  /* `none`. The one case that still changes the model tier is the phase that was
   * bumped already: a bump holds for the LATER phase attempts of that phase
   * (F149-FR-004), and the phase is bumped at most once, so no event is raised
   * and the kind stays the one the recovery cycle gave. */
  if (decision.ruleId === ALREADY_BUMPED_RULE && target !== null) {
    return Object.freeze({ modelTier: target.tier, decision });
  }
  return Object.freeze({ decision });
}

/**
 * The planner of the model-tier bump. `next` is the operation of annex E §E.1;
 * it gives no kind of its own, because the kind of a bump can be reached only
 * out of the `plain` the planner at place 1 gave, and `next` cannot see it.
 */
export const tierBumpPlanner: SeamAttemptPlanner = Object.freeze({
  next(_history: AttemptHistory): AttemptKind {
    return "plain";
  },
  plan(input: PlannerCallInput): PlannerContribution {
    return planTheTierBump(input);
  },
});

/**
 * Register the planner of the bump at process start, under the id
 * `PLANNER_ORDER` names second (`tier-bump`), so that it is called after the
 * planner of the recovery cycle whatever order the modules loaded in. The
 * registration does NOT switch the option on: `attempt.tier_bump` does, and
 * with it off the planner contributes nothing.
 */
export function registerTierBumpPlanner(): RegisteredAttemptPlanner {
  return registerAttemptPlanner({
    id: TIER_BUMP_PLANNER_ID,
    pointId: POINT_ID,
    implementationClass: "first-party",
    planner: tierBumpPlanner,
  });
}

/* ------------------------------------------------------------------ *
 * T026 — the count of rejections by the critic, in the ledger, through
 * the engine.
 * ------------------------------------------------------------------ */

/** The name of the count in `counters` of the ledger (data-model.md). */
export const CRITIC_REJECTIONS = CRITIC_REJECTIONS_COUNTER;

/** The namespace of the ledger the count lives in (annex B §B.13). */
export const COUNT_NAMESPACE = "core" as const;

/** Only a verdict REJECTED of the critic counts towards K (F149-FR-004). */
export const VERDICTS_THAT_COUNT_TOWARDS_K: readonly Verdict[] = Object.freeze(["REJECTED"]);

/**
 * The count of the bump and the count of the escalation of the micro-loop layer
 * are SEPARATE, and neither reads or changes the other (F149-FR-006;
 * F100-FR-140). The escalation's count belongs to feature 115 and lives in the
 * namespace of that layer; this module names it only to say that it never reads
 * it, and reads counts from the namespace `core` alone.
 */
export const BUMP_AND_ESCALATION_SHARE_NO_COUNT = true as const;

/** The one count this module reads. It reads no count of a loop layer. */
export const COUNTS_THIS_MODULE_READS: readonly string[] = Object.freeze([
  CRITIC_REJECTIONS_COUNTER,
]);

/** What one phase gate ended with, as the count reads it. */
export type PhaseGateOutcomeForTheCount = {
  /** Whether the verification gate of the phase attempt passed. */
  readonly verificationGatePassed: boolean;
  /** The verdict of the phase gate, or null where the phase attempt had none. */
  readonly verdict: Verdict | null;
};

/**
 * Whether a phase gate added to the count of rejections by the critic. Only a
 * verdict REJECTED of the critic does; a failed verification gate, a MALFORMED
 * verdict and a phase attempt that ended without a verdict add nothing
 * (F149-FR-004; `COUNTS_TOWARDS_K` of feature 100).
 */
export function rejectionCountsTowardsK(outcome: PhaseGateOutcomeForTheCount): boolean {
  if (outcome.verificationGatePassed !== true) return false;
  if (outcome.verdict === null) return false;
  return VERDICTS_THAT_COUNT_TOWARDS_K.includes(outcome.verdict);
}

/** The count after one phase gate. */
export function criticRejectionsAfter(
  current: number,
  outcome: PhaseGateOutcomeForTheCount,
): number {
  const from = Number.isInteger(current) && current >= 0 ? current : 0;
  return rejectionCountsTowardsK(outcome) ? from + 1 : from;
}

/** The record the ENGINE appends to the ledger. This module writes nothing. */
export type LedgerAppendOfTheCount = {
  /** The namespace: `core`. No loop layer can move a count of the phase gate. */
  readonly ns: typeof COUNT_NAMESPACE;
  /** The phase the count belongs to: the count is kept PER PHASE. */
  readonly phase: number;
  /** The counts as they stand after the phase gate. */
  readonly counters: Readonly<Record<string, number>>;
};

/**
 * The ledger record of the count of rejections by the critic, for the engine to
 * append (data-model.md: "Appended through the engine"). The planner changes no
 * count; this function returns a VALUE and touches nothing.
 */
export function ledgerAppendOfTheCriticRejectionCount(args: {
  readonly phase: number;
  readonly counters: Readonly<Record<string, number>>;
  readonly outcome: PhaseGateOutcomeForTheCount;
}): LedgerAppendOfTheCount {
  const current = args.counters[CRITIC_REJECTIONS_COUNTER] ?? 0;
  return Object.freeze({
    ns: COUNT_NAMESPACE,
    phase: args.phase,
    counters: Object.freeze({
      ...args.counters,
      [CRITIC_REJECTIONS_COUNTER]: criticRejectionsAfter(current, args.outcome),
    }),
  });
}

/**
 * The count of rejections by the critic of one phase, read back from the
 * ledger. Because it is read from the ledger and not held in memory, it SURVIVES
 * A RESUME: a new engine start reads the same records and reads the same count
 * (F149-FR-004).
 */
export function criticRejectionsOfThePhase(
  ledger: readonly LedgerRecordOfTheHistory[],
  phase: number,
): number {
  return countersOfThePhase(ledger, phase)[CRITIC_REJECTIONS_COUNTER] ?? 0;
}

/**
 * The counts after a reset on purpose: the count of rejections by the critic is
 * reset WITH the other counts (F149-FR-004). Every count of `HISTORY_COUNTERS`
 * and every other count the record holds goes to 0.
 */
export function countersResetOnPurpose(
  counters: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of HISTORY_COUNTERS) out[name] = 0;
  for (const name of Object.keys(counters)) out[name] = 0;
  return Object.freeze(out);
}

/**
 * The counts with which the NEXT phase starts: 0 for the count of rejections by
 * the critic, so the next phase starts on the base model tier (F149-FR-004).
 */
export function countersOfTheNextPhase(
  counters: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  return Object.freeze({ ...counters, [CRITIC_REJECTIONS_COUNTER]: 0 });
}

/* ------------------------------------------------------------------ *
 * Nothing of a bump reaches the critic.
 * ------------------------------------------------------------------ */

/**
 * The fields and names a bump or a skip is made of. NONE of them may be in the
 * critic prompt, in the fact block or in the feedback (F149-FR-005). The test
 * of CT-149-5 applies `theBumpReachesTheCritic` to those three surfaces.
 */
export const FIELDS_OF_A_BUMP: readonly string[] = Object.freeze([
  "tier-bump",
  "tier_bump",
  "attempt.tier_bump",
  "modelTier",
  "bumped",
  "criticRejections",
  "TB-0",
  "attempt-planner.tier-bump",
  BUMP_EVENT,
  BUMP_SKIPPED_EVENT,
]);

/**
 * Every name of a bump that one of the three surfaces carries. Empty is what
 * F149-FR-005 requires: nothing about a bump or a skip reaches the critic.
 */
export function theBumpReachesTheCritic(surface: string): readonly string[] {
  return Object.freeze(FIELDS_OF_A_BUMP.filter((field) => surface.includes(field)));
}
