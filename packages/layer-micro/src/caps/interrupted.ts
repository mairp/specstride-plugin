/**
 * T076 — the interrupted check (F115-FR-024; IR-50).
 *
 * A check that was interrupted is recorded as `interrupted` and runs again.
 * The first interruption counts neither as a cycle nor as a failure. The
 * second interruption of the same check in a phase attempt counts as a
 * cycle.
 *
 * Purity: imports `@specstride/contracts` only; no `node:fs`, no process.
 */

/**
 * The key of a check within the phase attempt: the task ids it checked, in
 * the order they were declared, so that "the same check" is the check of the
 * same unit.
 */
export function checkKeyOf(taskIds: readonly string[]): string {
  return taskIds.join(",");
}

/** The counters of the interruptions of one phase attempt. */
export type InterruptionCounters = {
  /** Interruptions so far, per check key. */
  readonly byCheck: Readonly<Record<string, number>>;
  /** Cycles the interruptions spent in the attempt. */
  readonly cyclesSpent: number;
};

/** Fresh interruption counters of a phase attempt. */
export function newInterruptionCounters(): InterruptionCounters {
  return { byCheck: Object.freeze({}), cyclesSpent: 0 };
}

/** What one interruption of a check means for the counters (F115-FR-024). */
export type InterruptionOutcome = {
  /** The check is recorded as `interrupted`. */
  readonly status: "interrupted";
  /** How often this check was interrupted in the attempt, including now. */
  readonly times: number;
  /** False for the first interruption, true from the second on. */
  readonly countedAsCycle: boolean;
  /** An interruption never counts as a failure (F115-FR-024). */
  readonly countedAsFailure: false;
  /** The check runs again. */
  readonly action: "rerun";
};

/**
 * F115-FR-024 — record one interruption of a check. The first counts
 * neither as a cycle nor as a failure; the second and every later
 * interruption of the same check in the attempt counts as a cycle.
 */
export function recordInterruption(
  counters: InterruptionCounters,
  taskIds: readonly string[],
): { readonly counters: InterruptionCounters; readonly outcome: InterruptionOutcome } {
  const key = checkKeyOf(taskIds);
  const times = (counters.byCheck[key] ?? 0) + 1;
  const countedAsCycle = times >= 2;
  return {
    counters: {
      byCheck: Object.freeze({ ...counters.byCheck, [key]: times }),
      cyclesSpent: counters.cyclesSpent + (countedAsCycle ? 1 : 0),
    },
    outcome: {
      status: "interrupted",
      times,
      countedAsCycle,
      countedAsFailure: false,
      action: "rerun",
    },
  };
}

/**
 * IR-50 (d) — the counts are kept per task id: two different checks that
 * share no task id interrupt each on their own count.
 */
export function interruptionsOf(
  counters: InterruptionCounters,
  taskIds: readonly string[],
): number {
  return counters.byCheck[checkKeyOf(taskIds)] ?? 0;
}
