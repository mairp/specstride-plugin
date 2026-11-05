/**
 * `@specstride/policy` — the money half of feature 127 (budgets, the one spend
 * ledger, hard caps, alerts, notional cost). Created by T002; the modules of
 * `plan.md`, **Source Code** land here as the later phases implement them:
 *
 * | Module | Content | Requirements | Task |
 * |---|---|---|---|
 * | `ledger.ts` | the spend ledger: atomic write, previous generation, `usageId`, increments, coverage counters, three billing modes apart | F127-FR-028 to F127-FR-031 | T007 |
 * | `rebuild.ts` | the rebuild of an unreadable ledger and the unknown state | F127-FR-032 | T008 |
 * | `ceilings.ts` | the evaluation of ceilings: dimensions, scopes, hard and soft, 0 or non-finite is off | F127-FR-024, F127-FR-025 | T009 |
 *
 * Phase 4 (T040, T043, T045, T047, T049, T051, T053, T057) added the modules
 * of user story 2 — the fallback and the alerts:
 *
 * | Module | Content | Requirements | Task |
 * |---|---|---|---|
 * | `fallback.ts` | the walk: the list from the role plan, the trigger and the delay, the skip reasons | F127-FR-018, F127-FR-019 | T040 |
 * | `fallback-gate.ts` | the terms gate `evaluate` at every switch; a refused entry is skipped with an event | F127-FR-020 | T043 |
 * | `fallback-billing.ts` | the cap requirement and the `loud` alert `billing-mode-change` before the first call on the key | F127-FR-021 | T045 |
 * | `fallback-switch.ts` | what a switch does: boundary, fresh session, `fallback.switched`, the critic-diversity warning | F127-FR-022 | T047 |
 * | `fallback-return.ts` | the return, `stay`, and the exhaustion pause | F127-FR-023 | T049 |
 * | `alerts.ts` | the alert rules: thresholds, levels by billing mode, deduplication, re-arm | F127-FR-037 | T051 |
 * | `observed.ts` | provider warnings and the observation-based alerts of a subscription | F127-FR-038 | T053 |
 * | `announce.ts` | the announcement of caps, billing mode and fallback entries at launch and at `resume` | F127-FR-041 | T057 |
 *
 * The eight modules of phase 4 are exported as NAMESPACES, because several of
 * them hold a name of the same shape (`ALERT_KIND_*`, `SKIP_REASON_*`, a
 * `level`, a `reason`) and because `./fallback-billing.ts` and `./alerts.ts`
 * each own a part of the alert kinds. A caller writes
 * `budget.fallback.walkFallback(...)` and `budget.alerts.levelForThreshold(...)`.
 *
 * Phase 5 (T066, T068, T070, T072) added the modules of user story 3 — the
 * hard cap that holds:
 *
 * | Module | Content | Requirements | Task |
 * |---|---|---|---|
 * | `enforce.ts` | the enforcement at every usage record and at the safe boundaries, on the sum of live processes; the stop operation, polite first; the headroom as a process-level spending limit | F127-FR-033 | T066 |
 * | `cap-stop.ts` | the hard-cap stop: `budget.exceeded`, `blocked` with `budget-cap`, no rejection, no bypass | F127-FR-034 | T068 |
 * | `unmeasurable.ts` | unmeasurable spend: the announcement, the doctor finding, the `warn` alert once, the remaining ceilings | F127-FR-035 | T070 |
 * | `critic-cap.ts` | the cap requirement of an automatically picked metered critic, and the reason `no-cap` | F127-FR-036 | T072 |
 *
 * Phase 6 (T074, T075) added the two modules of user story 4 — the whole-run
 * wall-clock budget of the baseline:
 *
 * | Module | Content | Requirements | Task |
 * |---|---|---|---|
 * | `wall-clock.ts` | the budget: the key `loop.maxWallMin` and its alias, the whole-minute test, 0 and a non-numeric value never trip, the start and the limit handed to the pass loop | F127-FR-026 | T074 |
 * | `wall-boundary.ts` | the checks at each phase-boundary step after the stop request, and the exit-4 path: the as-is line, `run_stop` `wall_budget` with `phase`, a terminal record with `retryable: true` and no blocked reason | F127-FR-027 | T075 |
 *
 * The ports these modules take are the ones of `../quota/ports.ts` — one set
 * for the whole feature, so that the clock, the random source, the file writer
 * and the event writer are faked once (`packages/policy/test/support/`, T003).
 */
export * from "./ledger.ts";
export * from "./rebuild.ts";
export * from "./ceilings.ts";

export * as fallback from "./fallback.ts";
export * as fallbackGate from "./fallback-gate.ts";
export * as fallbackBilling from "./fallback-billing.ts";
export * as fallbackSwitch from "./fallback-switch.ts";
export * as fallbackReturn from "./fallback-return.ts";
export * as alerts from "./alerts.ts";
export * as observed from "./observed.ts";
export * as announce from "./announce.ts";

export * as enforce from "./enforce.ts";
export * as capStop from "./cap-stop.ts";
export * as unmeasurable from "./unmeasurable.ts";
export * as criticCap from "./critic-cap.ts";

export * as wallClock from "./wall-clock.ts";
export * as wallBoundary from "./wall-boundary.ts";

export type {
  AtomicWrite,
  Clock,
  EventWriter,
  PolicyEvent,
  PolicyPorts,
  PortName,
  RandomSource,
  Sleeper,
} from "../quota/ports.ts";
export { PORTS } from "../quota/ports.ts";
