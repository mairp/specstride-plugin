/**
 * T051 — the fingerprint pair of a BATCH and the lowered parallelism
 * (F148-FR-014; CQ-180; proposal P2 of `analyze-report.md`).
 *
 * F148-FR-014 is four claims, and each is code here:
 *
 *  1. **One pair of fingerprints brackets a batch.** Not one pair per member:
 *     the members run side by side, so a single reading before the batch and
 *     a single reading after it is all that can be attributed. The declared
 *     writes left out of the comparison are the UNION of the declared writes
 *     of the members (`Batch.declaredWrites`).
 *  2. **A path changed outside that union taints EVERY member.** The change
 *     cannot be attributed to one command (`research.md` D-6), so every
 *     result of the batch carries `tainted` with the reason
 *     `changed-during-check`.
 *  3. **The parallelism is 1 for the rest of the run**, with an event of the
 *     type `check.parallelism_lowered` carrying `from`, `to`, `batch`,
 *     `phase`, `attempt` and `reason`. "The rest of the run" is the LOGICAL
 *     run, which survives a resume and a relaunch: `RunParallelism` holds the
 *     value and never raises it again.
 *  4. **The lowered value is kept with the run and read at every engine
 *     start** — in the field `verificationParallelism` of the run record
 *     (feature 100, annex E §E.2). An engine in start mode `child` does not
 *     write the run record, so it puts the value into the field
 *     `verificationParallelism` of its TERMINAL record (annex B §B.15,
 *     proposal P2), which the runtime root copies. Where the terminal record
 *     was SYNTHESIZED by the root, the value is derived from the last
 *     `check.parallelism_lowered` of the run (CQ-180).
 *     `parallelismAtAnEngineStart` is those three paths in their order.
 */
import type { TaintedReason } from "../result/closed-sets.ts";
import { statedAsPass, type RunnerResult } from "../result/result.ts";
import {
  NO_DIFFERENCE,
  bracketIsTaken,
  compareReadings,
  pathsOfADifference,
  takeReading,
  taintOfABracket,
  type BracketDifference,
  type ProtectedSetPort,
  type ProtectedSetReading,
} from "../bracket/fingerprint.ts";
import type { Batch } from "./admission.ts";

/* ------------------------------------------------------------------ *
 * The event of the lowering.
 * ------------------------------------------------------------------ */

/** F148-FR-014 — the event written when the parallelism of a run is lowered. */
export const CHECK_PARALLELISM_LOWERED = "check.parallelism_lowered" as const;

/** The `data` fields of that event, as the catalogue spells them. */
export const PARALLELISM_LOWERED_FIELDS = Object.freeze([
  "from",
  "to",
  "batch",
  "phase",
  "attempt",
  "reason",
] as const);

/** F148-FR-014 — the value the parallelism is lowered TO, and never below. */
export const PARALLELISM_AFTER_A_TAINT = 1 as const;

/** F148-FR-014 — the reason of the lowering: a reason of `tainted` (row 53). */
export const REASON_OF_THE_LOWERING: TaintedReason = "changed-during-check";

/** One lowering of the parallelism of a run. */
export type ParallelismLowering = {
  readonly from: number;
  readonly to: typeof PARALLELISM_AFTER_A_TAINT;
  readonly batch: number;
  readonly phase: number;
  readonly attempt: number;
  readonly reason: TaintedReason;
};

/** F148-FR-014 — the `data` of one `check.parallelism_lowered`. */
export function parallelismLoweredData(
  lowering: ParallelismLowering,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    from: lowering.from,
    to: lowering.to,
    batch: lowering.batch,
    phase: lowering.phase,
    attempt: lowering.attempt,
    reason: lowering.reason,
  });
}

/** One event of a lowering, ready for the one event writer. */
export type ParallelismLoweredEvent = {
  readonly type: typeof CHECK_PARALLELISM_LOWERED;
  readonly data: Readonly<Record<string, unknown>>;
};

/** The event of one lowering. */
export function parallelismLoweredEvent(lowering: ParallelismLowering): ParallelismLoweredEvent {
  return Object.freeze({
    type: CHECK_PARALLELISM_LOWERED,
    data: parallelismLoweredData(lowering),
  });
}

/* ------------------------------------------------------------------ *
 * The parallelism of a logical run.
 * ------------------------------------------------------------------ */

/**
 * F148-FR-014 — the parallelism of ONE LOGICAL RUN. It starts at the
 * configured value and is lowered to 1 by a taint of a batch; it is never
 * raised again, in this engine start or in a later one, because the run is
 * the logical run and survives a resume and a relaunch.
 */
export class RunParallelism {
  private readonly configuredValue: number;
  private current: number;
  private readonly loweringsSoFar: ParallelismLowering[] = [];

  constructor(configured: number, alreadyLowered = false) {
    this.configuredValue = configured;
    this.current = alreadyLowered ? PARALLELISM_AFTER_A_TAINT : configured;
  }

  /** The value in force now. */
  value(): number {
    return this.current;
  }

  /** The value the run was configured with. */
  configured(): number {
    return this.configuredValue;
  }

  /** True where a taint lowered the value below the configured one. */
  lowered(): boolean {
    return this.current < this.configuredValue || this.loweringsSoFar.length > 0;
  }

  /** Every lowering of this run, in the order they happened. */
  lowerings(): readonly ParallelismLowering[] {
    return Object.freeze([...this.loweringsSoFar]);
  }

  /**
   * F148-FR-014 — lower the parallelism to 1 for the rest of the run. A run
   * already at 1 is not lowered twice and writes no second event.
   */
  lower(where: {
    readonly batch: number;
    readonly phase: number;
    readonly attempt: number;
    readonly reason?: TaintedReason;
  }): ParallelismLowering | null {
    if (this.current <= PARALLELISM_AFTER_A_TAINT) return null;
    const lowering: ParallelismLowering = Object.freeze({
      from: this.current,
      to: PARALLELISM_AFTER_A_TAINT,
      batch: where.batch,
      phase: where.phase,
      attempt: where.attempt,
      reason: where.reason ?? REASON_OF_THE_LOWERING,
    });
    this.current = PARALLELISM_AFTER_A_TAINT;
    this.loweringsSoFar.push(lowering);
    return lowering;
  }

  /** The value a later engine start must read, or null where none was lowered. */
  valueForTheRunRecord(): number | null {
    return this.lowered() ? this.current : null;
  }
}

/* ------------------------------------------------------------------ *
 * Where the lowered value is kept (CQ-180, proposal P2).
 * ------------------------------------------------------------------ */

/**
 * CQ-180 — the field of the run record (feature 100, annex E §E.2) and of the
 * terminal record (annex B §B.15) that keeps the lowered parallelism. The two
 * carry the SAME name, which is what lets the runtime root copy one into the
 * other without a mapping.
 */
export const VERIFICATION_PARALLELISM_FIELD = "verificationParallelism" as const;

/** The start modes of an engine (feature 100, annex B §B.15). */
export const START_MODES = Object.freeze(["standalone", "child"] as const);
export type StartMode = (typeof START_MODES)[number];

/** CQ-180 — the start mode in which the engine does NOT write the run record. */
export const START_MODE_THAT_WRITES_NO_RUN_RECORD: StartMode = "child";

/** Read the field `verificationParallelism` of a record, or null. */
export function verificationParallelismOf(record: unknown): number | null {
  if (record === null || typeof record !== "object") return null;
  const value = (record as Record<string, unknown>)[VERIFICATION_PARALLELISM_FIELD];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/** Put the lowered value into the field `verificationParallelism` of a record. */
export function withVerificationParallelism<T extends object>(
  record: T,
  value: number | null,
): T & Readonly<Record<string, unknown>> {
  if (value === null) return Object.freeze({ ...record });
  return Object.freeze({ ...record, [VERIFICATION_PARALLELISM_FIELD]: value });
}

/**
 * CQ-180, proposal P2 — the terminal record an engine writes at its exit. In
 * start mode `child` the engine cannot write the run record, so the lowered
 * value goes into the field `verificationParallelism` of the terminal record,
 * from which the runtime root copies it into the run record before the next
 * engine start. In start mode `standalone` the engine writes the run record
 * itself and the terminal record carries no value.
 */
export function terminalRecordOfAnEngine<T extends object>(input: {
  readonly record: T;
  readonly startMode: StartMode;
  readonly parallelism: RunParallelism;
}): T & Readonly<Record<string, unknown>> {
  if (input.startMode !== START_MODE_THAT_WRITES_NO_RUN_RECORD) {
    return Object.freeze({ ...input.record });
  }
  return withVerificationParallelism(input.record, input.parallelism.valueForTheRunRecord());
}

/**
 * CQ-180, proposal P2 — the runtime root copies the value of the terminal
 * record into the run record before the next engine start.
 */
export function copyIntoTheRunRecord<T extends object>(
  runRecord: T,
  terminalRecord: unknown,
): T & Readonly<Record<string, unknown>> {
  const value = verificationParallelismOf(terminalRecord);
  return value === null
    ? Object.freeze({ ...runRecord })
    : withVerificationParallelism(runRecord, value);
}

/**
 * CQ-180 — the last `check.parallelism_lowered` of a run, from the events of
 * the run. The value a synthesized terminal record is derived from.
 */
export function lastLoweringEvent(
  events: readonly { readonly type: string; readonly data?: Readonly<Record<string, unknown>> }[],
): Readonly<Record<string, unknown>> | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event !== undefined && event.type === CHECK_PARALLELISM_LOWERED) {
      return event.data ?? null;
    }
  }
  return null;
}

/** Where the value a later engine start reads came from. */
export const PARALLELISM_SOURCES = Object.freeze([
  "run-record",
  "terminal-record",
  "event",
  "configured",
] as const);
export type ParallelismSource = (typeof PARALLELISM_SOURCES)[number];

/** What `parallelismAtAnEngineStart` decided, and from where. */
export type ParallelismAtAStart = {
  readonly value: number;
  readonly source: ParallelismSource;
  readonly lowered: boolean;
};

/**
 * F148-FR-014, CQ-180 — the parallelism a LATER ENGINE START reads. The three
 * paths of the reading, in their order:
 *
 *  1. the field `verificationParallelism` of the run record;
 *  2. where the run record carries none, the field of the same name of the
 *     terminal record of the previous engine, which the root copies (an
 *     engine in start mode `child` put it there);
 *  3. where the terminal record was SYNTHESIZED by the runtime root, the
 *     value `to` of the last `check.parallelism_lowered` of the run.
 *
 * Where none of the three says anything, the configured value stands.
 */
export function parallelismAtAnEngineStart(input: {
  readonly runRecord?: unknown;
  readonly terminalRecord?: unknown;
  readonly events?: readonly {
    readonly type: string;
    readonly data?: Readonly<Record<string, unknown>>;
  }[];
  readonly configured?: number;
}): ParallelismAtAStart {
  const configured = input.configured ?? 1;
  const fromTheRunRecord = verificationParallelismOf(input.runRecord);
  if (fromTheRunRecord !== null) {
    return Object.freeze({
      value: fromTheRunRecord,
      source: "run-record" as const,
      lowered: fromTheRunRecord < configured,
    });
  }
  const terminal = input.terminalRecord;
  const synthesized =
    terminal !== null &&
    typeof terminal === "object" &&
    (terminal as Record<string, unknown>)["synthesized"] === true;
  const fromTheTerminalRecord = verificationParallelismOf(terminal);
  if (fromTheTerminalRecord !== null && !synthesized) {
    return Object.freeze({
      value: fromTheTerminalRecord,
      source: "terminal-record" as const,
      lowered: fromTheTerminalRecord < configured,
    });
  }
  const last = lastLoweringEvent(input.events ?? []);
  const fromTheEvent = last === null ? null : last["to"];
  if (typeof fromTheEvent === "number") {
    return Object.freeze({
      value: fromTheEvent,
      source: "event" as const,
      lowered: fromTheEvent < configured,
    });
  }
  return Object.freeze({ value: configured, source: "configured" as const, lowered: false });
}

/* ------------------------------------------------------------------ *
 * The fingerprint pair of a batch.
 * ------------------------------------------------------------------ */

/** What one bracketed batch gives back. */
export type BracketedBatch = {
  /** The results of the members, with the taint where the readings differ. */
  readonly results: readonly RunnerResult[];
  /** True where the bracket was taken at all (row 31 of annex X §X.7). */
  readonly taken: boolean;
  readonly before: ProtectedSetReading | null;
  readonly after: ProtectedSetReading | null;
  readonly difference: BracketDifference;
  /** The lowering the taint caused, or null where nothing changed. */
  readonly lowering: ParallelismLowering | null;
  /** The paths that changed outside the union of the declared writes. */
  readonly changed: readonly string[];
  /** False for every member once the batch is tainted. */
  readonly statedAsPass: readonly boolean[];
};

/** What `bracketABatch` is given. */
export type BatchBracketInput = {
  readonly batch: Batch;
  /** The reading of one end, taken through EP-16 (feature 116). */
  readonly reading: ProtectedSetPort;
  readonly profile?: string;
  readonly gateFingerprint?: boolean;
  readonly phase?: number;
  readonly attempt?: number;
  /** The parallelism of the logical run, which a taint lowers. */
  readonly parallelism: RunParallelism;
  /** The batch itself: every member runs, and none is held back. */
  readonly run: () => Promise<readonly RunnerResult[]>;
};

/**
 * F148-FR-014 — ONE pair of fingerprints around a batch. A path that changed
 * outside the union of the declared writes of the members taints EVERY member
 * with `changed-during-check` and lowers the parallelism of the run to 1.
 */
export async function bracketABatch(input: BatchBracketInput): Promise<BracketedBatch> {
  const taken = bracketIsTaken(input.profile ?? "", input.gateFingerprint);
  if (!taken) {
    const plain = await input.run();
    return Object.freeze({
      results: Object.freeze([...plain]),
      taken: false,
      before: null,
      after: null,
      difference: NO_DIFFERENCE,
      lowering: null,
      changed: Object.freeze([]),
      statedAsPass: Object.freeze(plain.map(statedAsPass)),
    });
  }

  const before = await takeReading(input.reading, "before");
  const results = await input.run();
  const after = await takeReading(input.reading, "after");
  const difference = compareReadings(before, after, input.batch.declaredWrites);

  if (!difference.differs) {
    return Object.freeze({
      results: Object.freeze([...results]),
      taken: true,
      before,
      after,
      difference,
      lowering: null,
      changed: Object.freeze([]),
      statedAsPass: Object.freeze(results.map(statedAsPass)),
    });
  }

  // The change cannot be attributed to one command of the batch
  // (`research.md` D-6), so EVERY member is tainted and the parallelism of
  // the run is 1 from here on.
  const tainted = results.map((result) => taintOfABracket(result, difference));
  const lowering = input.parallelism.lower({
    batch: input.batch.batch,
    phase: input.phase ?? 0,
    attempt: input.attempt ?? 0,
    reason: REASON_OF_THE_LOWERING,
  });
  return Object.freeze({
    results: Object.freeze(tainted),
    taken: true,
    before,
    after,
    difference,
    lowering,
    changed: pathsOfADifference(difference),
    statedAsPass: Object.freeze(tainted.map(statedAsPass)),
  });
}
