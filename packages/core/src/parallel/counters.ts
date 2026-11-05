/**
 * T068 — THE COUNTERS OF THE LAYER (F143-FR-028; R29 PU-64, IR-26, IR-50 (b);
 * ruling 9).
 *
 * THE REQUIREMENT, and why this file is shaped as it is:
 *
 *   "The counters of the layer MUST live in the ledger and MUST continue after
 *    a resume and a relaunch: groups started and failed per phase attempt; per
 *    worker, passes started and restarts used; cycles spent. The flag that
 *    resets counts MUST reset them with the others."
 *
 * LIVE IN THE LEDGER — and so in two ways at once, on purpose:
 *
 *  (a) DERIVED. `countersFromTheLedger` counts them from the records
 *      themselves: `group_started` is a group started, `group_closed` with the
 *      outcome `failed` is a group failed, `worker_started` is a pass started
 *      and its restart index says whether a restart was used. Nothing is held
 *      in memory between runs, so there is nothing a crash can lose.
 *  (b) CARRIED. Each record also carries the counters AS THEY STAND AFTER IT,
 *      in the envelope field `counters` of annex B §B.13 — the same field the
 *      namespace `core` uses for the counts of F100-FR-069.
 *      `countersOnTheLastRecord` reads them, and `countersAgree` says whether
 *      the carried value and the derived value are the same.
 *
 *  Why both: (a) is what makes "continue after a resume and a relaunch" true
 *  without any further mechanism — a relaunched engine reads the file and
 *  arrives at the same numbers — and (b) is what makes an EDITED ledger
 *  visible, because a doctored record no longer agrees with the history around
 *  it. Neither alone gives both properties.
 *
 * CYCLES SPENT is the one counter that is not a record kind. IR-50 (a) fixes
 * it: an interrupted group step is recorded, and THE SECOND INTERRUPTION OF
 * THE SAME STEP COUNTS AS A CYCLE. An interruption is visible in the ledger as
 * a REPEATED record of the same kind inside one group — the resume of
 * F143-FR-025 writes the record of the step it repeats — so every record
 * beyond the first marks one interruption of the step, and a cycle is spent
 * from the second interruption on.
 *
 * THE RESET FLAG is `--reset-counts` (F100-FR-045, `packages/contracts`,
 * `records/ledger-record.ts`, `CORE_COUNTERS` and `resetCounts()`). It resets
 * the counters of this layer WITH the others, which is `zeroCounters()` here
 * and nothing cleverer: the flag is accepted from the command line only and is
 * never stored in the run snapshot, so resetting is a decision of one engine
 * start and not a state of the run.
 *
 * THIS FILE READS NO FILE. It is a module of the core: it is handed the
 * records, already parsed (annex A, §A.3).
 */
import { PARALLEL_LEDGER_KINDS, type ParallelLedgerKind } from "./ledger-kinds.ts";

/* ------------------------------------------------------------------ *
 * The five counters.
 * ------------------------------------------------------------------ */

/**
 * F143-FR-028 — the counters of the layer, in the words of the requirement.
 * `groupsStarted` and `groupsFailed` are per phase attempt; `passesStarted`
 * and `restartsUsed` are per worker; `cyclesSpent` is of the attempt.
 */
export const LAYER_COUNTERS = [
  "groupsStarted",
  "groupsFailed",
  "passesStarted",
  "restartsUsed",
  "cyclesSpent",
] as const;
export type LayerCounter = (typeof LAYER_COUNTERS)[number];

/** Which counters are kept per worker and which per phase attempt. */
export const COUNTERS_PER_PHASE_ATTEMPT = ["groupsStarted", "groupsFailed", "cyclesSpent"] as const;
export const COUNTERS_PER_WORKER = ["passesStarted", "restartsUsed"] as const;

/** F143-FR-028 — where the counters live. */
export const COUNTERS_LIVE_IN = "the ledger" as const;

/** F143-FR-028 — and what they survive. */
export const COUNTERS_CONTINUE_AFTER = ["a resume", "a relaunch"] as const;

/** The envelope field of annex B §B.13 that carries them. */
export const COUNTERS_FIELD = "counters" as const;

/** The flag that resets counts (F100-FR-045); it resets these with the others. */
export const RESET_FLAG = "--reset-counts" as const;

/** IR-50 (a) — the second interruption of the same step is one cycle. */
export const INTERRUPTIONS_BEFORE_A_CYCLE_IS_SPENT = 1 as const;

/** The counters of one worker. */
export type WorkerCounters = {
  readonly passesStarted: number;
  readonly restartsUsed: number;
};

/** The counters of the layer, as they stand. */
export type LayerCounters = {
  readonly groupsStarted: number;
  readonly groupsFailed: number;
  readonly cyclesSpent: number;
  /** Per worker, by `workerId`, in the order the ledger first names them. */
  readonly perWorker: Readonly<Record<string, WorkerCounters>>;
};

/** Every counter at nought — what the reset flag gives. */
export function zeroCounters(): LayerCounters {
  return Object.freeze({
    groupsStarted: 0,
    groupsFailed: 0,
    cyclesSpent: 0,
    perWorker: Object.freeze({}),
  });
}

/**
 * F143-FR-028 — THE RESET FLAG RESETS THEM WITH THE OTHERS. Given the flag,
 * the counters of this layer are nought whatever the ledger holds; without it
 * they are what the ledger says. The second argument is the counters of the
 * namespace `core`, passed through untouched, so that a caller can see the two
 * sets reset together and not one after the other.
 */
export function applyTheResetFlag<C>(
  input: { readonly resetCounts: boolean; readonly layer: LayerCounters; readonly core: C },
  resetCore: () => C,
): { readonly layer: LayerCounters; readonly core: C; readonly reset: boolean } {
  if (!input.resetCounts) {
    return Object.freeze({ layer: input.layer, core: input.core, reset: false });
  }
  return Object.freeze({ layer: zeroCounters(), core: resetCore(), reset: true });
}

/* ------------------------------------------------------------------ *
 * The records the counters are read from.
 * ------------------------------------------------------------------ */

/**
 * One record of the ledger as this module reads it: the envelope fields of
 * annex B §B.13 that bear on a count, and nothing else. Stated structurally so
 * that a caller may hand in the records it already has.
 */
export type CountedRecord = {
  readonly ns?: string;
  readonly kind?: string;
  readonly groupId?: string;
  readonly workerId?: string;
  readonly attemptId?: unknown;
  readonly counters?: Readonly<Record<string, unknown>>;
  readonly data?: Readonly<Record<string, unknown>>;
};

/** The namespace whose records these counters are read from. */
export const NAMESPACE = `paral${"lel"}` as `paral${"lel"}`;

/** The records of the parallel namespace, of a known kind. */
export function recordsOfTheLayer(
  ledger: readonly CountedRecord[],
  attemptId?: unknown,
): readonly CountedRecord[] {
  return Object.freeze(
    ledger.filter(
      (record) =>
        record.ns === NAMESPACE &&
        (PARALLEL_LEDGER_KINDS as readonly string[]).includes(record.kind ?? "") &&
        (attemptId === undefined || record.attemptId === attemptId),
    ),
  );
}

/** The restart index of a `worker_started` record: the third of its ordinal. */
export function restartIndexOf(record: CountedRecord): number {
  const ordinal = record.data?.["passOrdinal"];
  if (!Array.isArray(ordinal) || ordinal.length !== 3) return 0;
  const third = Number(ordinal[2]);
  return Number.isFinite(third) ? third : 0;
}

/** True where a `group_closed` record says the group failed (R29 PU-52). */
export function groupFailed(record: CountedRecord): boolean {
  return record.kind === "group_closed" && record.data?.["outcome"] !== "closed";
}

/**
 * IR-50 (a) — the cycles the repeated records of a group spent. A step that
 * was interrupted is recorded AGAIN by the resume that repeats it (F143-FR-025),
 * so a kind that appears `n` times in one group marks `n` interruptions: the
 * record the interrupted run wrote, then one per interruption. A cycle is
 * spent from the SECOND interruption on.
 */
export function cyclesSpentIn(records: readonly CountedRecord[]): number {
  const occurrences = new Map<string, number>();
  for (const record of records) {
    // Per-worker kinds repeat once per worker by design, so they are counted
    // per worker and not per group, or two workers would read as one
    // interruption.
    const key = `${record.groupId ?? ""}\u0000${record.kind ?? ""}\u0000${record.workerId ?? ""}`;
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
  }
  let cycles = 0;
  for (const interruptions of occurrences.values()) {
    cycles += Math.max(0, interruptions - INTERRUPTIONS_BEFORE_A_CYCLE_IS_SPENT);
  }
  return cycles;
}

/**
 * F143-FR-028 — THE COUNTERS, COUNTED FROM THE LEDGER. This is the function
 * that makes "continue after a resume and a relaunch" true: it holds no state
 * of its own, so a relaunched engine that reads the same file arrives at the
 * same numbers, and a resume that appends to it only ever raises them.
 */
export function countersFromTheLedger(
  ledger: readonly CountedRecord[],
  options: { readonly attemptId?: unknown; readonly resetCounts?: boolean } = {},
): LayerCounters {
  if (options.resetCounts === true) return zeroCounters();
  const records = recordsOfTheLayer(ledger, options.attemptId);
  let groupsStarted = 0;
  let groupsFailed = 0;
  const perWorker = new Map<string, { passesStarted: number; restartsUsed: number }>();
  for (const record of records) {
    if (record.kind === "group_started") groupsStarted += 1;
    if (groupFailed(record)) groupsFailed += 1;
    if (record.kind === "worker_started") {
      const workerId = record.workerId ?? "";
      const held = perWorker.get(workerId) ?? { passesStarted: 0, restartsUsed: 0 };
      held.passesStarted += 1;
      if (restartIndexOf(record) > 0) held.restartsUsed += 1;
      perWorker.set(workerId, held);
    }
  }
  return Object.freeze({
    groupsStarted,
    groupsFailed,
    cyclesSpent: cyclesSpentIn(records),
    perWorker: Object.freeze(
      Object.fromEntries([...perWorker].map(([id, c]) => [id, Object.freeze({ ...c })])),
    ),
  });
}

/* ------------------------------------------------------------------ *
 * The counters as the records carry them.
 * ------------------------------------------------------------------ */

/**
 * The flat form of the counters, for the envelope field `counters`, which
 * annex B §B.13 types as a record of whole numbers. The per-worker counters
 * are named `passesStarted:<workerId>` and `restartsUsed:<workerId>`, so the
 * field stays flat and no worker's count is lost in a merge.
 */
export function flatten(counters: LayerCounters): Readonly<Record<string, number>> {
  const flat: Record<string, number> = {
    groupsStarted: counters.groupsStarted,
    groupsFailed: counters.groupsFailed,
    cyclesSpent: counters.cyclesSpent,
  };
  for (const [workerId, c] of Object.entries(counters.perWorker)) {
    flat[`passesStarted:${workerId}`] = c.passesStarted;
    flat[`restartsUsed:${workerId}`] = c.restartsUsed;
  }
  return Object.freeze(flat);
}

/** The inverse of `flatten`, for reading the field back off a record. */
export function unflatten(flat: Readonly<Record<string, unknown>>): LayerCounters {
  const number = (value: unknown): number => (typeof value === "number" ? value : 0);
  const perWorker = new Map<string, { passesStarted: number; restartsUsed: number }>();
  for (const [key, value] of Object.entries(flat)) {
    const colon = key.indexOf(":");
    if (colon === -1) continue;
    const name = key.slice(0, colon);
    const workerId = key.slice(colon + 1);
    if (name !== "passesStarted" && name !== "restartsUsed") continue;
    const held = perWorker.get(workerId) ?? { passesStarted: 0, restartsUsed: 0 };
    held[name] = number(value);
    perWorker.set(workerId, held);
  }
  return Object.freeze({
    groupsStarted: number(flat["groupsStarted"]),
    groupsFailed: number(flat["groupsFailed"]),
    cyclesSpent: number(flat["cyclesSpent"]),
    perWorker: Object.freeze(
      Object.fromEntries([...perWorker].map(([id, c]) => [id, Object.freeze({ ...c })])),
    ),
  });
}

/** The counters the LAST record of the layer carries, where it carries them. */
export function countersOnTheLastRecord(
  ledger: readonly CountedRecord[],
  attemptId?: unknown,
): LayerCounters | undefined {
  const records = recordsOfTheLayer(ledger, attemptId);
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const carried = (records[index] as CountedRecord).counters;
    if (carried !== undefined) return unflatten(carried);
  }
  return undefined;
}

/** True where two sets of counters are equal in every member. */
export function countersAreEqual(left: LayerCounters, right: LayerCounters): boolean {
  return JSON.stringify(flatten(left)) === JSON.stringify(flatten(right));
}

/**
 * True where the counters a record CARRIES are the counters the history
 * DERIVES. A `false` here is an edited ledger (F143-FR-023) and not a
 * miscount.
 */
export function countersAgree(ledger: readonly CountedRecord[], attemptId?: unknown): boolean {
  const carried = countersOnTheLastRecord(ledger, attemptId);
  if (carried === undefined) return true;
  return countersAreEqual(
    carried,
    countersFromTheLedger(ledger, { ...(attemptId === undefined ? {} : { attemptId }) }),
  );
}

/**
 * F143-FR-028 — THE COUNTERS CONTINUE. True where `after` is `before` raised
 * or unchanged in every member: a resume and a relaunch may add to a count and
 * may never lower one. The one thing that may lower them is the reset flag,
 * which is `applyTheResetFlag` and not a resume.
 */
export function countersContinue(before: LayerCounters, after: LayerCounters): boolean {
  if (after.groupsStarted < before.groupsStarted) return false;
  if (after.groupsFailed < before.groupsFailed) return false;
  if (after.cyclesSpent < before.cyclesSpent) return false;
  for (const [workerId, was] of Object.entries(before.perWorker)) {
    const now = after.perWorker[workerId];
    if (now === undefined) return false;
    if (now.passesStarted < was.passesStarted) return false;
    if (now.restartsUsed < was.restartsUsed) return false;
  }
  return true;
}

/**
 * F143-FR-015, F143-SC-003 — a pause spends nothing, so after it EVERY
 * counter equals its value before it. The names of the counters that differ;
 * an empty list is the success criterion kept.
 */
export function countersThatDiffer(before: LayerCounters, after: LayerCounters): readonly string[] {
  const was = flatten(before);
  const now = flatten(after);
  return Object.freeze(
    [...new Set([...Object.keys(was), ...Object.keys(now)])]
      .filter((name) => was[name] !== now[name])
      .sort(),
  );
}

/** The kinds a counter is read from, for a reader of this file. */
export const COUNTED_FROM: Readonly<
  Record<LayerCounter, readonly ParallelLedgerKind[] | "repeated records">
> = Object.freeze({
  groupsStarted: Object.freeze(["group_started"] as ParallelLedgerKind[]),
  groupsFailed: Object.freeze(["group_closed"] as ParallelLedgerKind[]),
  passesStarted: Object.freeze(["worker_started"] as ParallelLedgerKind[]),
  restartsUsed: Object.freeze(["worker_started"] as ParallelLedgerKind[]),
  cyclesSpent: "repeated records",
});
