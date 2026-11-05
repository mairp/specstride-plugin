/**
 * T132 — the interface types of EP-06, the router rule table, from
 * `contracts/extension-points/EP-06.router-rules.json` and annex D, §D.4
 * (F100-FR-129, F100-FR-130).
 *
 * `specstride.router-rules/1`. Data. The router decides, from recorded
 * signals only, among choices that are already fixed; it runs nothing. One
 * function evaluates the table — the table evaluator of annex X §X.3.
 *
 * The three decision points are read from the key `routerDecisionPoints` of
 * `data/loop-layer-tables.json`.
 */
import loopLayerTables from "../../data/loop-layer-tables.json" with { type: "json" };

export const POINT_ID = "specstride.router-rules/1" as const;
export const EP = "EP-06" as const;
export const ANNEX_SECTION = "annex D, §D.4" as const;

/** The point is data; the one operation of its contract file is the event it emits. */
export const OPERATIONS = ["route.decided"] as const;
export type RouterOperation = (typeof OPERATIONS)[number];
export const IS_DATA = true as const;

/** The three decision points of §D.4. */
export const DECISION_POINTS = ["tools", "loop", "escalation"] as const;
export type DecisionPoint = (typeof DECISION_POINTS)[number];

const BACKTICKED = /`([^`]+)`/;
type RawPoint = { "Decision point": string; Chooses: string; Never: string };

/** One row of the decision-point table of §D.4. */
export type DecisionPointRow = {
  readonly decisionPoint: DecisionPoint;
  readonly chooses: string;
  readonly never: string;
};

/** The three rows of the decision-point table, in the order of the annex. */
export const decisionPointRows: readonly DecisionPointRow[] = Object.freeze(
  (loopLayerTables as { routerDecisionPoints: RawPoint[] }).routerDecisionPoints.map((row) =>
    Object.freeze({
      decisionPoint: (BACKTICKED.exec(row["Decision point"])?.[1] ??
        row["Decision point"]) as DecisionPoint,
      chooses: row.Chooses,
      never: row.Never,
    }),
  ),
);

/** The signals a table may read (§D.4, Inputs). */
export type Signals = Readonly<Record<string, string | number | boolean>>;

/** The signal that names a rung equal to a critic-class call in model and effort. */
export const SIGNAL_TARGET_IS_CRITIC_MODEL = "targetIsCriticModel" as const;

/** What the router never reads (§D.4, Inputs). */
export const NEVER_READ = [
  "task prose",
  "output of a check",
  "anything a model wrote",
  "a critic prompt",
  "a nonce",
  "a verdict",
] as const;

/** The output of one evaluation (§D.4, Outputs). */
export type RouteDecision = {
  readonly decisionPoint: DecisionPoint;
  readonly choice: string;
  readonly ruleId: string;
  readonly signals: Signals;
  readonly tableVersion: string;
};

/** F100-FR-129 — the router: one pure function over a versioned rule table. */
export type Router = {
  decide(decisionPoint: DecisionPoint, signals: Signals): RouteDecision;
};

/** The event every decision is, once a loop layer is engaged in the phase attempt. */
export const EVENT_OF_A_DECISION = "route.decided" as const;
/** Including one that changes nothing. */
export const A_DECISION_THAT_CHANGES_NOTHING_IS_STILL_AN_EVENT = true as const;
/** No routing decision reaches the critic. */
export const A_DECISION_REACHES_THE_CRITIC = false as const;

/** "Errors" of §D.4: a table without a default row for a decision point. */
export const A_TABLE_WITHOUT_A_DEFAULT_ROW = "fails validation at load" as const;

/**
 * "Failure of an implementation" of §D.4 — the plainer path: an invalid table
 * switches routing off for the run, announced, and `route.decided` carries
 * this rule id. The loop then runs in manifest order, on the base model tier,
 * with the pinned layer.
 */
export const RULE_ID_WHEN_ROUTING_IS_OFF = "config-off" as const;
export const FAILURE_PATH =
  "an invalid table switches routing off for the run, announced, and `route.decided` carries the rule id `config-off`; the loop runs in manifest order, on the base model tier, with the pinned layer" as const;
export const FAILURE_PATHS: Readonly<Record<RouterOperation, string>> = Object.freeze({
  "route.decided": FAILURE_PATH,
});

/**
 * "Unknown-value rule" of §D.4: an unknown decision point, an unknown signal
 * name and a choice outside the choice set each make the table invalid.
 */
export function tableIsInvalid(
  decisionPoint: string,
  signalNames: readonly string[],
  choice: string,
  knownSignals: readonly string[],
  choiceSet: readonly string[],
): string | undefined {
  if (!(DECISION_POINTS as readonly string[]).includes(decisionPoint)) {
    return `invalid table: the decision point \`${decisionPoint}\` is unknown (annex D, §D.4)`;
  }
  const bad = signalNames.find((s) => !knownSignals.includes(s));
  if (bad !== undefined) return `invalid table: the signal \`${bad}\` is unknown (annex D, §D.4)`;
  if (!choiceSet.includes(choice)) {
    return `invalid table: the choice \`${choice}\` is outside the choice set of \`${decisionPoint}\` (annex D, §D.4)`;
  }
  return undefined;
}

/** "Guarantees of an implementation": for every vector of signals exactly one row fires. */
export const EXACTLY_ONE_ROW_FIRES = true as const;

/** F100-FR-130 — the switch of escalation, its default and its caps. */
export const ESCALATION_SWITCH = "loop.escalation" as const;
export const ESCALATION_DEFAULT_ON = true as const;
export const ESCALATION_CAP_PER_TASK = 1 as const;
export const ESCALATION_CAP_PER_PHASE_ATTEMPT = 2 as const;
/** The choice a skipped escalation carries. */
export const SKIP_CHOICE = "skip" as const;
/** A rung sharing the model and differing in effort is no collision; it warns. */
export const WARNING_ON_A_SHARED_MODEL_AT_ANOTHER_EFFORT = "critic-diversity warning" as const;
