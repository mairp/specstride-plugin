/**
 * T079 — the router: the signals and the calls of the table evaluator at the
 * three decision points (F115-FR-033, F115-FR-036; EP-06, annex D §D.4).
 *
 * The shipped table is data (`@specstride/contracts/data/router-table-115.json`,
 * T078) and is evaluated by the one evaluator of the graph, `evaluateTable`
 * of the kernel — the layer holds no second evaluator. Rows are tried in
 * order; the first whose predicate holds fires, so for every vector of
 * signals exactly one row fires. Every decision is recorded as one event of
 * the type `route.decided`, with the rule id, the signals read and the
 * version of the table — a decision that changes nothing included. No
 * decision reaches a critic-class call. An invalid table switches routing
 * off for the run, announced, with the rule id `config-off`; the loop then
 * runs in manifest order (the default row of the tools point), on the base
 * model tier (the escalation point is not consulted; the escalation is
 * skipped), with the pinned layer (the default row of the loop point).
 *
 * Limits (F115-FR-036; IR-53): `tools` only orders and excludes among the
 * entries of the check manifest — it adds no command and builds no argument
 * list; `loop` can only switch a registered layer off for a phase attempt
 * and never switches a layer on; the router is consulted only in a phase
 * attempt in which the layer is engaged.
 *
 * Purity: imports `@specstride/contracts` and `@specstride/kernel` only; no
 * `node:fs`, no process.
 */
import { evaluateTable, loadTable, TableLoadError, type LoadedTable } from "@specstride/kernel";
import shippedTableData from "@specstride/contracts/data/router-table-115.json" with { type: "json" };

/** The three decision points of the shipped table. */
export const DECISION_POINTS = ["tools", "loop", "escalation"] as const;
export type DecisionPoint = (typeof DECISION_POINTS)[number];

/** The type of the event of every decision (F115-FR-033). */
export const DECISION_EVENT_TYPE = "route.decided" as const;

/** The rule id the layer states when the table is invalid (F115-FR-033). */
export const CONFIG_OFF_RULE_ID = "config-off" as const;

/** The vector of signals of one decision, from recorded facts only. */
export type Signals = Readonly<Record<string, string | number | boolean | readonly string[]>>;

/** The event of one decision (F115-FR-033; the catalogue type). */
export type RouteEvent = {
  readonly type: typeof DECISION_EVENT_TYPE;
  readonly decisionPoint: DecisionPoint;
  readonly ruleId: string;
  readonly choice: string;
  readonly signalsRead: Signals;
  readonly tableVersion: string;
};

/**
 * The shipped table, loaded once at import. A table that fails the load is
 * an invalid table: routing is off for the run, announced, with the rule id
 * `config-off` (F115-FR-033).
 */
function loadShipped(): { ok: true; table: LoadedTable } | { ok: false; error: string } {
  try {
    return { ok: true, table: loadTable(shippedTableData) };
  } catch (error) {
    const reason = error instanceof TableLoadError ? error.message : String(error);
    return { ok: false, error: reason };
  }
}

const shipped = loadShipped();

/** The shipped table as the evaluator loaded it, when it is valid. */
export function shippedTable(): { ok: true; table: LoadedTable } | { ok: false; error: string } {
  return shipped;
}

/** The version of the shipped table, for the records. */
export function shippedTableVersion(): string {
  return shipped.ok ? shipped.table.version : "unknown";
}

/** The choice the loop falls back to when routing is off: the pinned layer stays. */
export const FALLBACK_LOOP_CHOICE = "stay" as const;
/** The choice `tools` falls back to when routing is off: manifest order, nothing excluded. */
export const FALLBACK_TOOLS_CHOICE = "run" as const;
/** The choice `escalation` falls back to when routing is off: no escalation, the base tier. */
export const FALLBACK_ESCALATION_CHOICE = "skip:off" as const;

/** The fallback choice per decision point when routing is off (F115-FR-033). */
export function fallbackChoice(point: DecisionPoint): string {
  switch (point) {
    case "tools":
      return FALLBACK_TOOLS_CHOICE;
    case "escalation":
      return FALLBACK_ESCALATION_CHOICE;
    case "loop":
      return FALLBACK_LOOP_CHOICE;
  }
}

/** The result of one consultation of the router. */
export type RouteResult = {
  /** False only when the router was not consulted at all (not engaged). */
  readonly decided: boolean;
  readonly ruleId?: string;
  readonly choice?: string;
  readonly event?: RouteEvent;
  /** True when the table was invalid: routing is off for the run. */
  readonly routingOff?: true;
  /** The announcement of the invalid table, with the rule id `config-off`. */
  readonly announcement?: string;
};

/**
 * F115-FR-036 — the router is consulted only in a phase attempt in which the
 * layer is engaged. Before that, no decision exists and no event is written.
 */
export function route(point: DecisionPoint, signals: Signals): RouteResult {
  if (!shipped.ok) {
    // F115-FR-033 — an invalid table: routing off for the run, announced,
    // with the rule id `config-off`; the loop runs on the fallback choice.
    const choice = fallbackChoice(point);
    return {
      decided: true,
      ruleId: CONFIG_OFF_RULE_ID,
      choice,
      routingOff: true,
      announcement: `routing is off for the run: the router table is invalid (${shipped.error})`,
      event: {
        type: DECISION_EVENT_TYPE,
        decisionPoint: point,
        ruleId: CONFIG_OFF_RULE_ID,
        choice,
        signalsRead: {},
        tableVersion: "unknown",
      },
    };
  }
  const decision = evaluateTable(shipped.table, point, { ...signals });
  return {
    decided: true,
    ruleId: decision.ruleId,
    choice: decision.choice,
    event: {
      type: DECISION_EVENT_TYPE,
      decisionPoint: point,
      ruleId: decision.ruleId,
      choice: decision.choice,
      signalsRead: decision.signals as Signals,
      tableVersion: decision.tableVersion,
    },
  };
}

/**
 * F115-FR-036 — the decision point `tools` only orders and excludes among
 * the entries of the check manifest. The choices it can return are read from
 * the table, and none of them adds a command or builds an argument list: the
 * exclude choices carry only a reason, and `run` keeps the manifest order.
 */
export function isToolsChoiceAllowed(choice: string): boolean {
  return (
    choice === "run" ||
    choice.startsWith("exclude:flaky") ||
    choice.startsWith("exclude:slow") ||
    choice.startsWith("exclude:budget")
  );
}

/**
 * F115-FR-036 — the decision point `loop` never switches a layer on: every
 * non-default choice of the point is an `off:` choice.
 */
export function loopChoiceSwitchesLayerOn(choice: string): boolean {
  return choice !== "stay" && !choice.startsWith("off:");
}

/**
 * F115-FR-036 — the gated entrypoint of the router: the table is consulted
 * only when the layer is engaged in the phase attempt (a checkpoint was
 * accepted). Without engagement no decision exists, no event is written and
 * no choice is returned: the result states `decided: false` and carries no
 * event at all. With engagement it is exactly `route(point, signals)`.
 */
export function routeIfEngaged(
  point: DecisionPoint,
  signals: Signals & { readonly engaged?: boolean },
): RouteResult {
  if (signals.engaged !== true) {
    return { decided: false };
  }
  const { engaged: _engaged, ...rest } = signals;
  return route(point, rest as Signals);
}

/**
 * F115-FR-033 — `targetIsCriticModel` is true only when the rung equals a
 * critic-class call of the run in model and in effort. Computed by the
 * caller of the escalation point from the pinned ladder and the critic-class
 * calls; the table reads the boolean only.
 */
export function criticSignals(
  target: { readonly model: string; readonly effort: string },
  criticCalls: readonly { readonly model: string; readonly effort: string }[],
): { readonly targetIsCriticModel: boolean; readonly targetSharesCriticModel: boolean } {
  const equal = criticCalls.some(
    (call) => call.model === target.model && call.effort === target.effort,
  );
  const shares = criticCalls.some((call) => call.model === target.model);
  return { targetIsCriticModel: equal, targetSharesCriticModel: shares && !equal };
}
