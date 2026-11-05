/**
 * T023 — the engine-side read of the stop request at the boundaries, and the
 * honouring (F102-FR-003, F102-FR-004, F102-FR-005, F102-FR-009 for the
 * engine's boundaries; F102-FR-036 for the event).
 *
 * THE CHECK POINTS (F102-FR-003). The engine reads the request at the top of
 * every phase attempt — before the proposer starts, and NOT between the
 * proposer and the critic (B-0311, the as-is behaviour, ported) — before a
 * pass starts, after a pass that produced no phase evidence, and while it
 * waits during a yield. The two waits this feature does not build (the quota
 * pause and the backoff of a relaunch) belong to features 127 and 123; the
 * request is honoured there too (F102-FR-009), and CT-102-5 tests that
 * against those processes.
 *
 * THE HONOURING (F102-FR-004). The request is REMOVED FIRST, so that a rerun
 * continues (B-0126); then the run ends with exit 6 (B-0126, B-0128 — the
 * result 6 of the pass loop wins even when phase evidence exists, B-0128),
 * the stop reason `stop_flag` (B-0142, B-0144), `retryable: false`, the cause
 * `normal` and `causedBy: operator` (CQ-078: every request is the operator's)
 * in the terminal record. The event `run.ended` carries the field `phase`
 * (B-0142, B-0144) and the field `foundAt` — `attempt-top` where the request
 * was found at the top of a phase attempt, `pass-loop` everywhere else
 * (before a pass, after a pass without phase evidence, during a yield) — from
 * which the compatibility projection of feature 144 renders the as-is line
 * (F102-FR-010). THE ENGINE WRITES THE EVENT AND NO LINE OF ITS OWN.
 *
 * THE CLEAN STOP (F102-FR-001; contracts/stop-request.md). An absent request
 * is no stop. An EMPTY request, a request that cannot be read and a request
 * that fails its schema are all a CLEAN stop with every default: they never
 * carry `now` or `jobs`. (`readStopRequestAt` answers `clean` for all three,
 * and the reader of `packages/cli/src/run-control/records.ts` is the same
 * gate on the CLI side.)
 *
 * THE YIELD (F102-FR-005). A request found during the wait of a yield ends
 * the pass loop with the result 6; the detached job is left running as an
 * `adoptable` process and is adopted by the next engine start — the pass-loop
 * clause of the projection for `stop_flag` carries `yield`, `job_pid` and
 * `job_log` for exactly that line (see the table of feature 144). The yield
 * itself is feature 127's; this module says what the honouring IS, and the
 * compatibility line of that path is C-057's (B-0658), rendered by the
 * presenter from the event this module describes.
 */
/**
 * The port over which the engine reads and removes the stop request. As with
 * the `LedgerReader` port of the counters, the implementation lives in the
 * edge packages — over `node:fs` there — and this core module folds the bytes
 * purely (F100-FR-012, F100-FR-234: a core package imports no `node:fs`).
 */
export interface StopRequestIo {
  /** True when the path exists. */
  exists(path: string): boolean;
  /** The text of the file, or `null` when it cannot be read. */
  readText(path: string): string | null;
  /** Remove the file; missing is fine. */
  remove(path: string): void;
}

import {
  tryReadInboxRequest,
  type InboxRequest,
} from "@specstride/contracts/records/inbox-request";

/** The requirements this module carries out. */
export const STOP_REQUEST_REQUIREMENTS = [
  "F102-FR-003",
  "F102-FR-004",
  "F102-FR-005",
  "F102-FR-009",
  "F102-FR-036",
] as const;

/* ------------------------------------------------------------------ *
 * The check points, and the `foundAt` each one reads as.
 * ------------------------------------------------------------------ */

/** The values the field `foundAt` of `run.ended` may carry (F102-FR-004). */
export const STOP_FOUND_AT_VALUES = ["attempt-top", "pass-loop"] as const;
export type StopFoundAt = (typeof STOP_FOUND_AT_VALUES)[number];

/** Read as `pass-loop` where the event carries no `foundAt` (the spec, "Open questions"). */
export const FOUND_AT_DEFAULT: StopFoundAt = "pass-loop";

/**
 * The check points of F102-FR-003 and F102-FR-009, with the `foundAt` each
 * one reads as. `attempt-top` is ONLY the top of a phase attempt; every
 * other check point — before a pass, after a pass without phase evidence,
 * during a yield, in a quota pause, in a relaunch backoff — is the pass loop
 * returning the result 6, and reads as `pass-loop`.
 */
export const STOP_CHECK_POINTS = [
  "attempt-top",
  "before-pass",
  "after-pass-without-evidence",
  "yield-wait",
  "quota-pause",
  "relaunch-backoff",
] as const;
export type StopCheckPoint = (typeof STOP_CHECK_POINTS)[number];

/** The `foundAt` a check point reads as (F102-FR-004). */
export function foundAtOfCheckPoint(checkPoint: StopCheckPoint): StopFoundAt {
  return checkPoint === "attempt-top" ? "attempt-top" : "pass-loop";
}

/**
 * B-0311 — the engine tests the request at the top of each attempt, NOT
 * between the proposer and the critic. The mid-pass point is absent from
 * `STOP_CHECK_POINTS` by construction; this predicate is the sentence as a
 * value, for the tests of 028 FR-015 to hold.
 */
export const READ_BETWEEN_PROPOSER_AND_CRITIC = false as const;

/* ------------------------------------------------------------------ *
 * The read.
 * ------------------------------------------------------------------ */

/** What a read at a boundary found. */
export type StopRequestRead =
  | { readonly kind: "none" }
  | { readonly kind: "clean" }
  | { readonly kind: "request"; readonly request: InboxRequest };

/**
 * Read the stop request at a boundary (F102-FR-003). Absent → `none`.
 * Empty, unreadable or refused by the schema → `clean`: a clean stop with
 * every default, never carrying `now` or `jobs` (F102-FR-001). A validated
 * request of the type `stop` → `request`.
 */
export function readStopRequestAt(path: string, io: StopRequestIo): StopRequestRead {
  let bytes: string;
  try {
    if (!io.exists(path)) return { kind: "none" };
    const text = io.readText(path);
    if (text === null) return { kind: "clean" };
    bytes = text;
  } catch {
    return { kind: "clean" };
  }
  if (bytes.trim() === "") return { kind: "clean" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes) as unknown;
  } catch {
    return { kind: "clean" };
  }
  const read = tryReadInboxRequest(parsed, "inbox:stop");
  if (!read.ok) return { kind: "clean" };
  return { kind: "request", request: read.record };
}

/** What the request read at a boundary asks for; the defaults for `clean` and `none`. */
export function carriesOf(read: StopRequestRead): {
  readonly now: boolean;
  readonly jobs: boolean;
} {
  if (read.kind !== "request") return { now: false, jobs: false };
  return { now: read.request.now === true, jobs: read.request.jobs === true };
}

/* ------------------------------------------------------------------ *
 * The honouring.
 * ------------------------------------------------------------------ */

/** The engine's exit when it honours a stop request (F102-FR-004; B-0126). */
export const STOP_EXIT_CODE = 6 as const;
/** The stop reason of an honoured request (F102-FR-004; B-0142, B-0144). */
export const STOP_REASON = "stop_flag" as const;
/** An honoured stop is not retryable (F102-FR-004). */
export const STOP_RETRYABLE = false as const;
/** The cause of an honoured stop: a normal stop, not a crash (F102-FR-004). */
export const STOP_CAUSE = "normal" as const;
/** Who caused it: every request is the operator's (F102-FR-004; CQ-078). */
export const STOP_CAUSED_BY = "operator" as const;

/** What honouring a request came to. */
export type StopHonoured = {
  /** Always 6 (F102-FR-004). */
  readonly exitCode: typeof STOP_EXIT_CODE;
  /** Always `stop_flag`. */
  readonly stopReason: typeof STOP_REASON;
  /** Always false. */
  readonly retryable: typeof STOP_RETRYABLE;
  /** Always `normal`. */
  readonly cause: typeof STOP_CAUSE;
  /** Always `operator`. */
  readonly causedBy: typeof STOP_CAUSED_BY;
  /** Where the request was found: `attempt-top` or `pass-loop`. */
  readonly foundAt: StopFoundAt;
  /** The phase in flight when the request was found (B-0142, B-0144). */
  readonly phase: string | null;
  /** True: the request was removed FIRST, so a rerun continues (F102-FR-004). */
  readonly requestRemoved: boolean;
};

/**
 * Honour the request found at a boundary (F102-FR-004). THE REQUEST IS
 * REMOVED FIRST — a rerun continues — and then the honouring is answered:
 * exit 6, `stop_flag`, `retryable: false`, cause `normal`, causedBy
 * `operator`. The caller writes the terminal record and the event from the
 * answer, through `terminalRecordOfStop` and `runEndedDataOfStop`.
 */
export function honourStopRequest(
  path: string,
  input: { readonly phase?: string | null; readonly foundAt?: StopFoundAt } = {},
  io: StopRequestIo,
): StopHonoured {
  // Removed first (F102-FR-004, B-0126: the flag is deleted so a rerun
  // resumes). A file that vanished between the read and the removal is fine.
  let removed = false;
  try {
    io.remove(path);
    removed = !io.exists(path);
  } catch {
    removed = false;
  }
  return Object.freeze({
    exitCode: STOP_EXIT_CODE,
    stopReason: STOP_REASON,
    retryable: STOP_RETRYABLE,
    cause: STOP_CAUSE,
    causedBy: STOP_CAUSED_BY,
    foundAt: input.foundAt ?? FOUND_AT_DEFAULT,
    phase: input.phase ?? null,
    requestRemoved: removed,
  });
}

/**
 * The terminal record of an honoured stop (F102-FR-004; `specstride.terminal/1`,
 * annex B §B.15): `exitCode` 6, `stopReason` `stop_flag`, `retryable` false,
 * `cause` `normal`, `causedBy` `operator`.
 */
export function terminalRecordOfStop(
  runId: string,
  launchId: string,
  _input: { readonly foundAt?: StopFoundAt; readonly phase?: string | null } = {},
): {
  schema: "specstride.terminal/1";
  exitCode: typeof STOP_EXIT_CODE;
  stopReason: typeof STOP_REASON;
  retryable: typeof STOP_RETRYABLE;
  cause: typeof STOP_CAUSE;
  causedBy: typeof STOP_CAUSED_BY;
  runId: string;
  launchId: string;
} {
  return {
    schema: "specstride.terminal/1",
    exitCode: STOP_EXIT_CODE,
    stopReason: STOP_REASON,
    retryable: STOP_RETRYABLE,
    cause: STOP_CAUSE,
    causedBy: STOP_CAUSED_BY,
    runId,
    launchId,
  };
}

/**
 * The `data` of the event `run.ended` for an honoured stop (F102-FR-036):
 * the stop reason, the exit code, the cause, `causedBy`, the phase in flight
 * and `foundAt` — the two facts the compatibility projection chooses the
 * as-is line from (F102-FR-004, F102-FR-010). No secret value and no source
 * text is carried (F102-FR-036, last sentence).
 */
export function runEndedDataOfStop(input: {
  readonly foundAt?: StopFoundAt;
  readonly phase?: string | null;
  readonly yieldPid?: number | undefined;
  readonly yieldLog?: string | undefined;
}): Readonly<Record<string, unknown>> {
  const data: Record<string, unknown> = {
    stopReason: STOP_REASON,
    exitCode: STOP_EXIT_CODE,
    retryable: STOP_RETRYABLE,
    cause: STOP_CAUSE,
    causedBy: STOP_CAUSED_BY,
    phase: input.phase ?? null,
    foundAt: input.foundAt ?? FOUND_AT_DEFAULT,
  };
  // The pass-loop clause of the projection for `stop_flag` carries `yield`,
  // `job_pid` and `job_log` (the yield line of C-057 / B-0658): a stop during
  // a yield names the job it LEFT RUNNING (F102-FR-005).
  if (input.foundAt === "pass-loop" && input.yieldPid !== undefined) {
    data.yield = true;
    data.job_pid = input.yieldPid;
    if (input.yieldLog !== undefined) data.job_log = input.yieldLog;
  }
  return Object.freeze(data);
}

/* ------------------------------------------------------------------ *
 * The as-is engine lines, rendered from the compatibility projection of
 * the stop event (F102-FR-010; the presenter half of features 144, 145).
 * ------------------------------------------------------------------ */

/** The as-is line for a request found at the top of a phase attempt (B-0209). */
export const AS_IS_STOP_LINE_ATTEMPT_TOP =
  ">>> stop.flag detected — halting cleanly (exit 6; rerun resumes)." as const;

/** The as-is line for a request found by the pass loop (B-0215). */
export const AS_IS_STOP_LINE_PASS_LOOP =
  ">>> stop.flag detected during proposer — halting cleanly (exit 6; rerun resumes)." as const;

/** The two as-is lines, one per value of `foundAt` (F102-FR-010). */
export const ENGINE_STOP_LINES: Readonly<Record<StopFoundAt, string>> = Object.freeze({
  "attempt-top": AS_IS_STOP_LINE_ATTEMPT_TOP,
  "pass-loop": AS_IS_STOP_LINE_PASS_LOOP,
});

/** The keys of the `run_stop` row the compatibility projection renders (feature 144). */
export const PROJECTION_REASON_KEY = "reason" as const;

/**
 * Read the value of the as-is key `foundAt` out of the `data` of the stop
 * event, as the presenter reads it: through the projection's own key ladder
 * (the `valueOfKey` the projection hands the renderer), never by reaching
 * into the record by hand.
 */
export function foundAtOfEventData(
  data: Readonly<Record<string, unknown>>,
  valueOfKey: (key: string, data: Readonly<Record<string, unknown>>) => unknown,
): StopFoundAt {
  const raw = valueOfKey("foundAt", data);
  return raw === "attempt-top" ? "attempt-top" : FOUND_AT_DEFAULT;
}

/**
 * The as-is engine line the presenter renders for a stop event (F102-FR-004,
 * F102-FR-010): the `foundAt` of the event chooses between the two lines of
 * B-0209 and B-0215, byte for byte. A stop reason that is not `stop_flag`
 * renders nothing: these two lines are the stop request's alone.
 */
export function engineStopLineOfEventData(
  data: Readonly<Record<string, unknown>>,
  valueOfKey: (key: string, data: Readonly<Record<string, unknown>>) => unknown,
): string | null {
  const reason = valueOfKey("reason", data) ?? data.stopReason;
  if (reason !== STOP_REASON) return null;
  return ENGINE_STOP_LINES[foundAtOfEventData(data, valueOfKey)];
}
