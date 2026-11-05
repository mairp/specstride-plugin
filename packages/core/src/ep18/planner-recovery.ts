/**
 * T024 — the planner of the recovery cycle, the planner of Wave 1 that is
 * ALWAYS ON (F149-FR-002; feature 100 annex E §E.1).
 *
 * It is the planner at place 1 of the order of the seam, so it gives the KIND
 * of the next phase attempt and nothing else: no model tier, no decision
 * record, no event. It gives it from the two FACTS of the history,
 * `diagnosisMade` and `accelerationDue` (data-model.md, "History of a phase"):
 *
 * | Fact | Kind |
 * |---|---|
 * | `accelerationDue` | `accelerated` |
 * | `diagnosisMade` (and no acceleration due) | `diagnosed` |
 * | neither | `plain` |
 *
 * Both facts are worked out by the OWNER OF THE RECOVERY CYCLE — the first part
 * of the split of feature 101 — and put into the history by the engine. This
 * planner never works them out again (data-model.md: "a planner does not work
 * them out again"), reads nothing else, and is therefore a pure function of the
 * history: the same history gives the same kind, every time, with no I/O, no
 * clock and no model (annex E §E.1, "Guarantees of a planner").
 *
 * The precedence between the two facts is this module's reading, recorded
 * because annex E §E.1 names both kinds and not their order: an accelerated
 * phase attempt is the one that FOLLOWS a diagnosis, so where both facts stand
 * the kind is `accelerated`. It is the same precedence F149-FR-004 fixes for
 * the one case the sources do settle — a phase attempt due for acceleration and
 * for a bump at once is `accelerated` — and it is declared as data in
 * `RECOVERY_KIND_PRECEDENCE`, so a later reading changes one list.
 */
import {
  ATTEMPT_KIND_WHEN_UNKNOWN,
  type AttemptHistory,
  type AttemptKind,
} from "@specstride/contracts/ep/critic-strategy";

import {
  POINT_ID,
  RECOVERY_PLANNER_ID,
  registerAttemptPlanner,
  type PlannerCallInput,
  type PlannerContribution,
  type RegisteredAttemptPlanner,
  type SeamAttemptPlanner,
} from "./attempt-planner.ts";
import type { PhaseHistory } from "./history.ts";

/** This planner is always on; it is no option (F149-FR-002). */
export const THE_RECOVERY_PLANNER_IS_ALWAYS_ON = true as const;

/**
 * The two facts of the history this planner reads, by the names data-model.md
 * gives them. It reads NOTHING else.
 */
export const FACTS_THE_RECOVERY_PLANNER_READS = ["diagnosisMade", "accelerationDue"] as const;

/**
 * The kinds in the order they are tried. The first whose fact stands is the
 * kind; `plain` closes the list and always stands.
 */
export const RECOVERY_KIND_PRECEDENCE = ["accelerated", "diagnosed", "plain"] as const;

/** The two facts of the history, as this planner takes them. */
export type RecoveryFacts = {
  /** Whether a diagnosis was made after the last rejection. */
  readonly diagnosisMade: boolean;
  /** Whether an accelerated phase attempt is due. */
  readonly accelerationDue: boolean;
};

/**
 * The two facts of the projection of the history that the seam of feature 100
 * carries (`AttemptHistory`), under the names of data-model.md. The projection
 * and the history hold the SAME two facts; this is the one place that maps the
 * two spellings onto each other.
 */
export function recoveryFactsOfTheAttemptHistory(history: AttemptHistory): RecoveryFacts {
  return Object.freeze({
    diagnosisMade: history.diagnosisWasMadeForTheNewestSignature === true,
    accelerationDue: history.anAcceleratedPhaseAttemptIsDue === true,
  });
}

/** The two facts of the read-only history of a phase (T005). */
export function recoveryFactsOfThePhaseHistory(history: PhaseHistory): RecoveryFacts {
  return Object.freeze({
    diagnosisMade: history.diagnosisMade === true,
    accelerationDue: history.accelerationDue === true,
  });
}

/**
 * The kind of the next phase attempt, from the facts `diagnosisMade` and
 * `accelerationDue` (F149-FR-002; annex E §E.1). A pure function of its one
 * argument: it reads no clock, no file and no model, and changes nothing.
 */
export function recoveryKindOf(facts: RecoveryFacts): AttemptKind {
  for (const kind of RECOVERY_KIND_PRECEDENCE) {
    if (kind === "accelerated" && facts.accelerationDue === true) return "accelerated";
    if (kind === "diagnosed" && facts.diagnosisMade === true) return "diagnosed";
    if (kind === "plain") return ATTEMPT_KIND_WHEN_UNKNOWN;
  }
  return ATTEMPT_KIND_WHEN_UNKNOWN;
}

/**
 * The planner of the recovery cycle. `next` is the operation of annex E §E.1
 * and reads the projection of the history; `plan` is the wider form of the
 * seam and reads the history itself. Both give the same kind for the same
 * facts, and `plan` gives the kind ALONE: no model tier, no decision record,
 * no event, nothing that belongs to a later planner (F149-FR-002).
 */
export const recoveryCyclePlanner: SeamAttemptPlanner = Object.freeze({
  next(history: AttemptHistory): AttemptKind {
    return recoveryKindOf(recoveryFactsOfTheAttemptHistory(history));
  },
  plan(input: PlannerCallInput): PlannerContribution {
    return Object.freeze({ kind: recoveryKindOf(recoveryFactsOfThePhaseHistory(input.history)) });
  },
});

/**
 * Register the planner of the recovery cycle at process start, under the id
 * `PLANNER_ORDER` names first (`recovery`), so that the order of the seam puts
 * it at place 1 whatever order the modules of the process loaded in.
 */
export function registerRecoveryPlanner(): RegisteredAttemptPlanner {
  return registerAttemptPlanner({
    id: RECOVERY_PLANNER_ID,
    pointId: POINT_ID,
    implementationClass: "first-party",
    planner: recoveryCyclePlanner,
  });
}
