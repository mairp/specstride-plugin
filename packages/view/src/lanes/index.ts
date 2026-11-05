/**
 * T005 — the lane table AS DATA, and its use of the injected table evaluator
 * (`contracts/lane-and-attention.md`; F129-FR-016).
 *
 * The derivation of a card into a lane is the work of User Story 4 (phase 4 of
 * `tasks.md`). What this module holds now is the table itself, the point, the
 * signals it reads, and the ordering of the lanes, so that nothing outside the
 * read model derives a lane.
 */
import type { Lane, LaneTableRow, ViewCard, ViewLane } from "../model/view.ts";
import { LANES } from "../model/view.ts";
import { firstMatchEvaluator, type TableEvaluator, type TableRow } from "../model/ports.ts";

/** The point of the table (annex X §X.3). */
export const LANE_TABLE_POINT = "lane" as const;

/** The signals the lane table reads. */
export const LANE_SIGNALS = [
  "phaseApproved",
  "isCurrentPhase",
  "runState",
  "dead",
  "criticCallOpen",
  "verificationOpen",
  "passOpen",
  "unitOpen",
  "workerPassOpen",
] as const;
export type LaneSignal = (typeof LANE_SIGNALS)[number];

/** The signals of one card, as the table reads them. */
export type LaneSignals = Readonly<Record<LaneSignal, unknown>>;

const truth = (signals: LaneSignals, name: LaneSignal): boolean => signals[name] === true;
const state = (signals: LaneSignals): string =>
  typeof signals.runState === "string" ? signals.runState : "";

/** The eight rows L-01 to L-08; the first matching row fires, L-08 is the default. */
export const LANE_TABLE: readonly (TableRow & {
  readonly id: LaneTableRow;
  readonly choice: Lane;
})[] = Object.freeze([
  {
    id: "L-01",
    choice: "approved",
    when: (s: Readonly<Record<string, unknown>>) => truth(s as LaneSignals, "phaseApproved"),
  },
  {
    id: "L-02",
    choice: "failed",
    when: (s: Readonly<Record<string, unknown>>) =>
      truth(s as LaneSignals, "isCurrentPhase") && state(s as LaneSignals) === "failed",
  },
  {
    id: "L-03",
    choice: "blocked",
    when: (s: Readonly<Record<string, unknown>>) =>
      truth(s as LaneSignals, "isCurrentPhase") &&
      (["blocked-on-human", "stopped"].includes(state(s as LaneSignals)) ||
        truth(s as LaneSignals, "dead")),
  },
  {
    id: "L-04",
    choice: "paused",
    when: (s: Readonly<Record<string, unknown>>) =>
      truth(s as LaneSignals, "isCurrentPhase") && state(s as LaneSignals) === "paused-quota",
  },
  {
    id: "L-05",
    choice: "reviewing",
    when: (s: Readonly<Record<string, unknown>>) => truth(s as LaneSignals, "criticCallOpen"),
  },
  {
    id: "L-06",
    choice: "verifying",
    when: (s: Readonly<Record<string, unknown>>) => truth(s as LaneSignals, "verificationOpen"),
  },
  {
    id: "L-07",
    choice: "proposing",
    when: (s: Readonly<Record<string, unknown>>) =>
      truth(s as LaneSignals, "passOpen") ||
      truth(s as LaneSignals, "unitOpen") ||
      truth(s as LaneSignals, "workerPassOpen"),
  },
  { id: "L-08", choice: "queued", when: () => true, isDefault: true },
] as const);

/** The lane of one card: the first matching row of the table fires. */
export function laneOf(
  signals: LaneSignals,
  evaluateTable: TableEvaluator = firstMatchEvaluator,
): { readonly lane: Lane; readonly ruleId: LaneTableRow } {
  const fired = evaluateTable(LANE_TABLE, signals);
  return Object.freeze({ lane: fired.choice as Lane, ruleId: fired.id as LaneTableRow });
}

/**
 * The run-level facts a card's row reads besides its own phase row
 * (`contracts/lane-and-attention.md`). The five open pairs belong to the
 * current attempt: a card of a phase that is not the current one reads them
 * as `false`, because an open pair of another phase is not this card's.
 */
export type CardContext = {
  readonly currentPhase: number | null;
  readonly runState: string;
  readonly dead: boolean;
  readonly criticCallOpen?: boolean;
  readonly verificationOpen?: boolean;
  readonly passOpen?: boolean;
  readonly unitOpen?: boolean;
  readonly workerPassOpen?: boolean;
};

/** The signals of the lane table for the card of one phase (F129-FR-016). */
export function cardSignalsOf(
  phase: { readonly number: number; readonly approved: boolean },
  ctx: CardContext,
): LaneSignals {
  const isCurrentPhase = ctx.currentPhase !== null && phase.number === ctx.currentPhase;
  return Object.freeze({
    phaseApproved: phase.approved === true,
    isCurrentPhase,
    runState: ctx.runState,
    dead: ctx.dead === true,
    criticCallOpen: isCurrentPhase && ctx.criticCallOpen === true,
    verificationOpen: isCurrentPhase && ctx.verificationOpen === true,
    passOpen: isCurrentPhase && ctx.passOpen === true,
    unitOpen: isCurrentPhase && ctx.unitOpen === true,
    workerPassOpen: isCurrentPhase && ctx.workerPassOpen === true,
  });
}

/**
 * One card per phase, its lane and its rule id read from the table through the
 * INJECTED evaluator (F129-FR-016). A cycle of a micro-loop is a pass inside a
 * phase attempt, never a phase, so it owns no card and no lane.
 */
export function cardsOf(
  phases: readonly {
    readonly number: number;
    readonly approved: boolean;
    readonly title?: string | null;
  }[],
  ctx: CardContext,
  evaluateTable: TableEvaluator = firstMatchEvaluator,
): readonly ViewCard[] {
  return Object.freeze(
    phases.map((phase) => {
      const signals = cardSignalsOf(phase, ctx);
      const fired = laneOf(signals, evaluateTable);
      return Object.freeze({
        id: `card:p${phase.number}`,
        feature: null,
        phase: phase.number,
        lane: fired.lane,
        ruleId: fired.ruleId,
        flags: Object.freeze({
          dead: ctx.dead === true && ctx.currentPhase === phase.number,
          stale: false,
          yielded: false,
        }),
      });
    }),
  );
}

/** The eight lanes in order, each with the ids of its cards (F129-FR-016). */
export function lanesOf(cards: readonly ViewCard[]): readonly ViewLane[] {
  return Object.freeze(
    LANES.map((lane) =>
      Object.freeze({
        lane,
        cards: Object.freeze(cards.filter((card) => card.lane === lane).map((card) => card.id)),
      }),
    ),
  );
}
