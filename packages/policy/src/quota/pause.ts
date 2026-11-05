/**
 * T024 — the quota pause as a STATE OF THE RUN (F127-FR-010, F127-FR-011).
 *
 * Today a quota failure is a provider error: the proposer counts it, the
 * engine exits 4 and a supervisor relaunches at once, so a window of five
 * hours burns the relaunch budget in minutes (R14 A6). This module replaces
 * that path with transition T6 of the run-state machine, `running` to
 * `paused-quota`:
 *
 *  1. the PAUSE RECORD is written (`run:<runId>:pause`, `specstride.pause/1`,
 *     annex B §B.17) with the role, the harness, the class, the confidence,
 *     `since`, `resetsAt`, `resumeAt`, `probeIndex` and `ceilingAt`;
 *  2. the EVENTS `quota.signal` and `run.paused` are written, `run.paused`
 *     with the resume time;
 *  3. the PASS IN FLIGHT ends with `pass.ended` whose `endCause` is
 *     `quota_pause`, a member of the closed set of row 271 of annex X §X.6;
 *  4. the WORKING TREE is kept and the PHASE ATTEMPT stays open;
 *  5. ONE record and ONE event cover the run, whatever the number of live
 *     harness processes (F100-FR-073: one pause record per run).
 *
 * And F127-FR-011: a pause spends NOTHING — no reject, no pass, no MALFORMED
 * count, no error count, no wall-clock budget, no relaunch budget — and the
 * phase attempt is not counted as a rejection. A quota pause on the CRITIC is
 * the same state: the critic call ends with the outcome `quota_pause`, the
 * MALFORMED streak and `critic_unavailable` are unchanged, and the call is
 * made again with a NEW NONCE after the resume.
 *
 * The record is written through the `fileWriter` port and validated against
 * feature 100's own schema before it is written, so a field the annex requires
 * cannot be forgotten here. The module reads no clock: the instants are
 * arguments, which is what makes the fake-clock tests of `./resume.ts` and
 * `./ceiling.ts` possible.
 */
import { validate } from "@specstride/contracts/records/compile";
import { A_QUOTA_CLASS_SPENDS } from "@specstride/contracts/ep/quota-classifier";
import type { Confidence, QuotaClass } from "@specstride/contracts/ep/quota-classifier";
import type { EventWriter, PauseStore, PolicyEvent } from "./ports.ts";
import { type PairState, PAIR_CLOSED, quotaSignal, runPaused, type EmitOptions } from "./events.ts";
import type { QuotaClassification } from "./classify.ts";

/* ------------------------------------------------------------------ *
 * The state, the record and the closed-set members this module uses.
 * ------------------------------------------------------------------ */

/** The run state a quota pause is (annex E §E.1; transition T6). */
export const PAUSE_STATE = "paused-quota" as const;

/** The transition of the run-state machine this module performs. */
export const PAUSE_TRANSITION = "T6" as const;

/** The schema id of the pause record (annex B §B.17). */
export const PAUSE_SCHEMA_ID = "specstride.pause/1" as const;

/** The logical name of the pause record (annex B §B.5). */
export const PAUSE_LOGICAL_NAME = "run:<runId>:pause" as const;

/** F100-FR-073 — ONE pause record per run, whatever the number of workers. */
export const PAUSE_RECORDS_PER_RUN = 1 as const;

/** The `endCause` of the pass in flight (row 271 of annex X §X.6). */
export const PASS_END_CAUSE = "quota_pause" as const;

/** The `outcome` of a critic call that was limited (field `outcome` of `critic.call`). */
export const CRITIC_CALL_OUTCOME = "quota_pause" as const;

/**
 * The pause record of annex B §B.17, in the fields the annex lists. Feature
 * 100's own module for it is not in the export map of `@specstride/contracts`,
 * so the shape is declared here and every record is validated against feature
 * 100's SCHEMA (`validate` of `records/compile`) before it is written.
 */
export type PauseRecord = {
  readonly schema: typeof PAUSE_SCHEMA_ID;
  readonly runId: string;
  readonly attemptId: string;
  /** The role that waits (text, from the role registry). */
  readonly role: string;
  /** The harness of the role. */
  readonly harness: string;
  /** The class that caused the pause (member of the closed set of §C.13). */
  readonly class: string;
  /** The confidence of the classification (member of the closed set of §C.13). */
  readonly confidence: string;
  /** The start of the pause (timestamp, UTC). */
  readonly since: string;
  /** When the provider's window resets, or null. */
  readonly resetsAt: string | null;
  /** When the run will try again, or null. */
  readonly resumeAt: string | null;
  /** The position in the probe schedule (§Q.2). */
  readonly probeIndex: number;
  /** When the wait ceiling is reached (F127-FR-014). */
  readonly ceilingAt: string;
};

/** The twelve fields of §B.17, for a test that asserts the record is whole. */
export const PAUSE_RECORD_FIELDS = Object.freeze([
  "schema",
  "runId",
  "attemptId",
  "role",
  "harness",
  "class",
  "confidence",
  "since",
  "resetsAt",
  "resumeAt",
  "probeIndex",
  "ceilingAt",
] as const);

/** A record this module refuses to write. */
export class PauseRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PauseRecordError";
  }
}

/* ------------------------------------------------------------------ *
 * F127-FR-011 — the six counts, and what a pause does to them.
 * ------------------------------------------------------------------ */

/** The six counts of F127-FR-005 and F127-FR-011, as a run holds them. */
export type RunCounts = {
  /** The reject count of the phase attempt. */
  readonly rejects: number;
  /** The pass count. */
  readonly passes: number;
  /** The MALFORMED streak of the critic. */
  readonly malformedStreak: number;
  /** The counter of consecutive errors. */
  readonly errors: number;
  /** The milliseconds of the wall-clock budget already spent. */
  readonly wallClockMs: number;
  /** The relaunches already spent of the relaunch budget. */
  readonly relaunches: number;
};

/** What a pause spends of the six: nothing, which EP-12 states as data. */
export const A_PAUSE_SPENDS = A_QUOTA_CLASS_SPENDS;

/**
 * F127-FR-011 — the counts after a pause are the counts before it. The
 * function is the identity, and that is the requirement: it exists so that a
 * caller cannot reach for `errors + 1` by habit, and so that a test can assert
 * the identity on a real object.
 */
export function countsAfterAPause(before: RunCounts): RunCounts {
  return Object.freeze({
    rejects: before.rejects,
    passes: before.passes,
    malformedStreak: before.malformedStreak,
    errors: before.errors,
    wallClockMs: before.wallClockMs,
    relaunches: before.relaunches,
  });
}

/** The names of the six counts, in the order F127-FR-011 lists them. */
export const THE_SIX_COUNTS_OF_A_RUN = Object.freeze([
  "rejects",
  "passes",
  "malformedStreak",
  "errors",
  "wallClockMs",
  "relaunches",
] as const);

/* ------------------------------------------------------------------ *
 * Entering the pause.
 * ------------------------------------------------------------------ */

/** What the engine hands `enterPause`. */
export type EnterPauseInput = {
  readonly runId: string;
  readonly attemptId: string;
  readonly role: string;
  readonly harness: string;
  /** The classification that caused the pause (§Q.1 `quota_window`). */
  readonly classification: QuotaClassification;
  /** The start of the pause; the caller reads its clock port. */
  readonly since: string;
  /** The resume time of `./resume.ts`, or null with no reset time known. */
  readonly resumeAt: string | null;
  /** The ceiling of `./ceiling.ts` (F127-FR-014). */
  readonly ceilingAt: string;
  /** The position in the probe schedule; 0 at the first pause. */
  readonly probeIndex?: number | undefined;
  /** The physical path of `run:<runId>:pause`, from the layout table. */
  readonly recordPath: string;
  /** The counts before the pause, so the result can carry them unchanged. */
  readonly counts?: RunCounts | undefined;
};

/** The ports `enterPause` needs. */
export type PausePorts = {
  readonly fileWriter: PauseStore;
  readonly eventWriter: EventWriter;
};

/** The end of the pass in flight (F127-FR-010). */
export type PassEnded = {
  /** The member of row 271 the field `endCause` carries. */
  readonly endCause: typeof PASS_END_CAUSE;
  /** The working tree is KEPT (F127-FR-010). */
  readonly treeKept: true;
  /** The phase attempt stays OPEN (F127-FR-010). */
  readonly attemptStaysOpen: true;
  /** The phase attempt is NOT counted as a rejection (F127-FR-011). */
  readonly countedAsARejection: false;
};

/** The end of the pass in flight, as every pause writes it. */
export const PASS_ENDED_BY_A_PAUSE: PassEnded = Object.freeze({
  endCause: PASS_END_CAUSE,
  treeKept: true,
  attemptStaysOpen: true,
  countedAsARejection: false,
});

/** What `enterPause` answers. */
export type PauseEntry = {
  /** The state the run is in: `paused-quota`. */
  readonly state: typeof PAUSE_STATE;
  /** The transition performed: T6. */
  readonly transition: typeof PAUSE_TRANSITION;
  /** The record that was written. */
  readonly record: PauseRecord;
  /** Where it was written. */
  readonly recordPath: string;
  /** The events that were emitted, in order. */
  readonly events: readonly PolicyEvent[];
  /** The pair state after `run.paused`: open until the resume closes it. */
  readonly pair: PairState;
  /** The end of the pass in flight. */
  readonly passEnded: PassEnded;
  /** The six counts, unchanged (F127-FR-011). */
  readonly counts: RunCounts | null;
  /**
   * True where a pause record already existed: the run is already paused, so
   * nothing was written and no second event was emitted (F127-FR-010, one
   * record and one event for the run whatever the number of live processes).
   */
  readonly alreadyPaused: boolean;
};

/** The counts a pause starts from where the caller named none. */
const NO_COUNTS: RunCounts = Object.freeze({
  rejects: 0,
  passes: 0,
  malformedStreak: 0,
  errors: 0,
  wallClockMs: 0,
  relaunches: 0,
});

/**
 * Build the pause record of §B.17 and validate it against feature 100's
 * schema. Throws `PauseRecordError` where the record the engine asked for is
 * not a `specstride.pause/1`.
 */
export function buildPauseRecord(input: EnterPauseInput): PauseRecord {
  const record: PauseRecord = Object.freeze({
    schema: PAUSE_SCHEMA_ID,
    runId: input.runId,
    attemptId: input.attemptId,
    role: input.role,
    harness: input.harness,
    class: input.classification.quotaClass,
    confidence: input.classification.confidence,
    since: input.since,
    resetsAt: input.classification.resetsAt,
    resumeAt: input.resumeAt,
    probeIndex: input.probeIndex ?? 0,
    ceilingAt: input.ceilingAt,
  });
  const read = validate<PauseRecord>(PAUSE_SCHEMA_ID, record);
  if (!read.ok) {
    throw new PauseRecordError(
      `the pause record of the run ${input.runId} is not a ${PAUSE_SCHEMA_ID} ` +
        `(annex B §B.17): ${read.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`,
    );
  }
  return record;
}

/** The record as it is written: one line of canonical JSON. */
export function serializePauseRecord(record: PauseRecord): string {
  return `${JSON.stringify(record, PAUSE_RECORD_FIELDS as unknown as string[], 2)}\n`;
}

/** Read a pause record a run already wrote, or null where the path holds none. */
export function readPauseRecord(store: PauseStore, path: string): PauseRecord | null {
  if (!store.exists(path)) return null;
  let text: string;
  try {
    text = store.read(path);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const read = validate<PauseRecord>(PAUSE_SCHEMA_ID, parsed);
  return read.ok ? read.record : null;
}

/**
 * Enter the state `paused-quota` (F127-FR-010, F127-FR-011; transition T6).
 *
 * Writes the record, emits `quota.signal` and `run.paused`, ends the pass in
 * flight with `quota_pause`, keeps the tree, keeps the attempt open and leaves
 * the six counts where they were. A run that is ALREADY paused gets nothing: a
 * second live harness process that sees the same limit finds the record in
 * place and the pair already open, which is how one record and one event cover
 * the run.
 */
export function enterPause(
  ports: PausePorts,
  input: EnterPauseInput,
  pair: PairState = PAIR_CLOSED,
  options: EmitOptions = {},
): PauseEntry {
  const existing = readPauseRecord(ports.fileWriter, input.recordPath);
  if (existing !== null) {
    return Object.freeze({
      state: PAUSE_STATE,
      transition: PAUSE_TRANSITION,
      record: existing,
      recordPath: input.recordPath,
      events: Object.freeze([]),
      pair: Object.freeze({ open: true }),
      passEnded: PASS_ENDED_BY_A_PAUSE,
      counts: input.counts === undefined ? null : countsAfterAPause(input.counts),
      alreadyPaused: true,
    });
  }

  const record = buildPauseRecord(input);
  ports.fileWriter.write(input.recordPath, serializePauseRecord(record));

  const events: PolicyEvent[] = [];
  events.push(
    quotaSignal(
      ports.eventWriter,
      {
        class: record.class,
        confidence: record.confidence,
        rateLimitType: input.classification.rateLimitType,
        utilization: input.classification.utilization,
        resetsAt: record.resetsAt,
        resetsAtSource: input.classification.resetsAtSource,
        status: String(input.classification.signals.httpStatus ?? ""),
        evidence: input.classification.evidence,
        ruleId: input.classification.ruleId,
        tableVersion: input.classification.tableVersion,
        role: record.role,
        harness: record.harness,
      },
      options,
    ),
  );
  const paused = runPaused(
    ports.eventWriter,
    pair,
    {
      class: record.class,
      confidence: record.confidence,
      resetsAt: record.resetsAt,
      resumeAt: record.resumeAt,
      role: record.role,
    },
    options,
  );
  events.push(paused.event);

  return Object.freeze({
    state: PAUSE_STATE,
    transition: PAUSE_TRANSITION,
    record,
    recordPath: input.recordPath,
    events: Object.freeze(events),
    pair: paused.pair,
    passEnded: PASS_ENDED_BY_A_PAUSE,
    counts: countsAfterAPause(input.counts ?? NO_COUNTS),
    alreadyPaused: false,
  });
}

/* ------------------------------------------------------------------ *
 * F127-FR-011 — the same state on the critic.
 * ------------------------------------------------------------------ */

/** What a limited critic call ends with (F127-FR-011). */
export type CriticPause = {
  /** The field `outcome` of `critic.call`: `quota_pause`. */
  readonly outcome: typeof CRITIC_CALL_OUTCOME;
  /** The MALFORMED streak, unchanged. */
  readonly malformedStreak: number;
  /** The counter behind `critic_unavailable`, unchanged. */
  readonly criticUnavailable: number;
  /** True: the call is made again after the resume. */
  readonly callMadeAgainAfterTheResume: true;
  /** The nonce of the call after the resume: a NEW one (F127-FR-011). */
  readonly nextNonce: string;
  /** False: a limited critic is not a MALFORMED verdict. */
  readonly countsAsMalformed: false;
  readonly note: string;
};

/**
 * F127-FR-011 — a quota pause on the critic is the same state. The critic call
 * ends with the outcome `quota_pause`; the MALFORMED streak and the counter
 * behind `critic_unavailable` are unchanged; the call is made again with a new
 * nonce after the resume.
 *
 * The new nonce is produced by the caller (the engine owns the nonce
 * grammar); this module takes it and records that it differs from the nonce of
 * the call that was limited.
 */
export function criticCallPaused(
  before: { readonly malformedStreak: number; readonly criticUnavailable: number },
  nonces: { readonly limitedCallNonce: string; readonly nextNonce: string },
): CriticPause {
  if (nonces.nextNonce === nonces.limitedCallNonce) {
    throw new PauseRecordError(
      `the critic call after a quota pause takes a NEW nonce; the nonce ` +
        `${nonces.limitedCallNonce} is the one of the call that was limited (F127-FR-011)`,
    );
  }
  return Object.freeze({
    outcome: CRITIC_CALL_OUTCOME,
    malformedStreak: before.malformedStreak,
    criticUnavailable: before.criticUnavailable,
    callMadeAgainAfterTheResume: true as const,
    nextNonce: nonces.nextNonce,
    countsAsMalformed: false as const,
    note:
      `the critic was limited before it returned a parseable verdict: the call ends with the ` +
      `outcome ${CRITIC_CALL_OUTCOME}, the MALFORMED streak stays at ` +
      `${before.malformedStreak} and the call is made again with the nonce ` +
      `${nonces.nextNonce} after the resume (F127-FR-011)`,
  });
}

/** True where the class and the confidence are enough to pause at once (§Q.2). */
export function pausesWithoutAProbe(quotaClass: QuotaClass, confidence: Confidence): boolean {
  return quotaClass === "quota_window" && (confidence === "structured" || confidence === "status");
}
