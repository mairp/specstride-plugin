/**
 * T074 — the counters and the caps of a phase attempt (F115-FR-022; row 65
 * of the `parity` profile; annex X §X.6).
 *
 * The caps, each a configuration key of the class narrowing, with the
 * defaults of the spec (every default is a starting value for the
 * experiments):
 *
 * | Cap | Key | Default |
 * |---|---|---|
 * | Repairs per task id | `loop.micro.caps.repairs` | 2 |
 * | Time per proposal | `loop.micro.caps.proposalMin` | 20 min |
 * | Time per unit | `loop.micro.caps.unitMin` | 30 min |
 * | Cycles per attempt, extra | `loop.micro.caps.cyclesExtra` | 6 |
 * | Cycles per attempt, least | `loop.micro.caps.cyclesMin` | 12 |
 * | Unresolved units before the layer goes off | `loop.micro.caps.unresolvedUnits` | 2 |
 *
 * The repair count of a unit is the highest among its tasks, and a new
 * grouping of tasks never resets a count: the counters live per task id, so
 * a unit that regroups its tasks reads the counts that are already there.
 *
 * Purity: imports `@specstride/contracts` only; no `node:fs`, no process.
 */

/** The defaults of the caps (F115-FR-022; row 65). */
export const CAP_DEFAULTS = Object.freeze({
  /** `loop.micro.caps.repairs` */
  repairs: 2,
  /** `loop.micro.caps.proposalMin` */
  proposalMinutes: 20,
  /** `loop.micro.caps.unitMin` */
  unitMinutes: 30,
  /** `loop.micro.caps.cyclesExtra` */
  cyclesExtra: 6,
  /** `loop.micro.caps.cyclesMin` */
  cyclesMin: 12,
  /** `loop.micro.caps.unresolvedUnits` */
  unresolvedUnits: 2,
});

/** The caps of a phase attempt, as the configuration named them. */
export type Caps = {
  readonly repairs: number;
  readonly proposalMinutes: number;
  readonly unitMinutes: number;
  readonly cyclesExtra: number;
  readonly cyclesMin: number;
  readonly unresolvedUnits: number;
};

/** The caps with the defaults of the spec where the configuration is silent. */
export function capsFor(config: Partial<Record<keyof typeof CAP_DEFAULTS, number>> = {}): Caps {
  return {
    repairs: config.repairs ?? CAP_DEFAULTS.repairs,
    proposalMinutes: config.proposalMinutes ?? CAP_DEFAULTS.proposalMinutes,
    unitMinutes: config.unitMinutes ?? CAP_DEFAULTS.unitMinutes,
    cyclesExtra: config.cyclesExtra ?? CAP_DEFAULTS.cyclesExtra,
    cyclesMin: config.cyclesMin ?? CAP_DEFAULTS.cyclesMin,
    unresolvedUnits: config.unresolvedUnits ?? CAP_DEFAULTS.unresolvedUnits,
  };
}

/** The counters of one phase attempt, in the namespace `micro`. */
export type CapsCounters = {
  /** Repairs used, per task id (never reset by a regrouping of tasks). */
  readonly repairsByTask: Readonly<Record<string, number>>;
  /** Minutes spent on proposals of the phase attempt. */
  readonly proposalMinutesUsed: number;
  /**
   * Minutes spent on the unit: proposals, repairs and checks together.
   */
  readonly unitMinutesUsed: Readonly<Record<string, number>>;
  /** Cycles spent in the phase attempt. */
  readonly cyclesSpent: number;
  /** Units recorded unresolved in the phase attempt. */
  readonly unresolvedUnits: number;
};

/** Fresh counters of a phase attempt. */
export function newCapsCounters(): CapsCounters {
  return {
    repairsByTask: Object.freeze({}),
    proposalMinutesUsed: 0,
    unitMinutesUsed: Object.freeze({}),
    cyclesSpent: 0,
    unresolvedUnits: 0,
  };
}

/** F115-FR-022 — the repair count of a task id, 0 when it never repaired. */
export function repairsUsedFor(counters: CapsCounters, taskId: string): number {
  return counters.repairsByTask[taskId] ?? 0;
}

/**
 * F115-FR-022 — the repairs left for a unit: the highest left among its
 * tasks. A task the counters never saw has the whole cap.
 */
export function repairsLeftForUnit(
  counters: CapsCounters,
  taskIds: readonly string[],
  caps: Caps,
): number {
  if (taskIds.length === 0) return caps.repairs;
  return Math.max(...taskIds.map((taskId) => caps.repairs - repairsUsedFor(counters, taskId)));
}

/**
 * F115-FR-022 — spend one repair on every task of the unit. A new grouping
 * of tasks resets nothing: the count of each task id only grows.
 */
export function recordRepair(counters: CapsCounters, taskIds: readonly string[]): CapsCounters {
  const next: Record<string, number> = { ...counters.repairsByTask };
  for (const taskId of taskIds) next[taskId] = (next[taskId] ?? 0) + 1;
  return { ...counters, repairsByTask: Object.freeze(next) };
}

/** Record the minutes of one proposal on the counters. */
export function recordProposalMinutes(counters: CapsCounters, minutes: number): CapsCounters {
  return { ...counters, proposalMinutesUsed: counters.proposalMinutesUsed + minutes };
}

/**
 * F115-FR-022 — record the minutes of one unit: proposals, repairs and
 * checks together, per task id.
 */
export function recordUnitMinutes(
  counters: CapsCounters,
  taskIds: readonly string[],
  minutes: number,
): CapsCounters {
  const next: Record<string, number> = { ...counters.unitMinutesUsed };
  for (const taskId of taskIds) next[taskId] = (next[taskId] ?? 0) + minutes;
  return { ...counters, unitMinutesUsed: Object.freeze(next) };
}

/** F115-FR-022 — the time cap of a proposal is reached. */
export function proposalCapReached(counters: CapsCounters, caps: Caps): boolean {
  return counters.proposalMinutesUsed >= caps.proposalMinutes;
}

/** F115-FR-022 — the time cap of a unit is reached (proposals, repairs and checks together). */
export function unitCapReached(
  counters: CapsCounters,
  taskIds: readonly string[],
  caps: Caps,
): boolean {
  if (taskIds.length === 0) return false;
  return taskIds.every((taskId) => (counters.unitMinutesUsed[taskId] ?? 0) >= caps.unitMinutes);
}

/** F115-FR-022 — the cycle cap of a phase attempt: tasks plus extra, at least the least value. */
export function cycleCapFor(taskCount: number, caps: Caps = capsFor()): number {
  return Math.max(taskCount + caps.cyclesExtra, caps.cyclesMin);
}

/** F115-FR-022 — record a cycle on the counters. */
export function spendCycles(counters: CapsCounters, cycles: number): CapsCounters {
  return { ...counters, cyclesSpent: counters.cyclesSpent + cycles };
}

/** F115-FR-022 — the cycles left in the phase attempt. */
export function cyclesLeft(
  counters: CapsCounters,
  taskCount: number,
  caps: Caps = capsFor(),
): number {
  return Math.max(cycleCapFor(taskCount, caps) - counters.cyclesSpent, 0);
}

/** Record one unresolved unit on the counters; the new count is returned. */
export function recordUnresolved(counters: CapsCounters): CapsCounters {
  return { ...counters, unresolvedUnits: counters.unresolvedUnits + 1 };
}

/** F115-FR-022, F115-FR-025 — the cap of unresolved units is reached. */
export function unresolvedCapReached(counters: CapsCounters, caps: Caps): boolean {
  return counters.unresolvedUnits >= caps.unresolvedUnits;
}
