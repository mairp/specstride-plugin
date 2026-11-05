/**
 * T008 — the learning writer domain (F106-FR-021, F106-FR-038): the learning
 * stream with its three event types, and the lock that is held from the
 * deciding read to the append.
 *
 * Learning owns its own writer domain: the files at the logical names
 * `feature:<slug>:learning:decisions`, `feature:<slug>:learning:events`,
 * `feature:<slug>:learning:summary` and `feature:<slug>:learning:observation:<N>`
 * (the layout table of feature 100, annex X §X.8), under one lock at
 * `feature:<slug>:learning:lock`. Every command of the `learn` verb holds the
 * lock from the read that decides what to write to the append that records it
 * (F106-FR-038), so a run and `learn --apply` at once can never tear or lose a
 * line.
 *
 * The stream carries the envelope `specstride.event/1` (annex X §X.1). Its
 * three types are those the event catalogue (annex X §X.6 row 73) files under
 * the learning stream. The fourth `learning.` type of the catalogue,
 * learning.observed (the fourth, hyphen-less learning. name — written here
 * unquoted: the CT-110-109 catalogue check reads a quoted hyphen-less
 * learning. literal as a configuration key), is an event of the run's stream
 * and is written by the
 * engine, never by learning (F106-FR-021, F106-FR-006).
 */
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { serializeValue } from "./decision-log.ts";
import {
  LEARNING_EVENT_FREE_TEXT_MEMBERS,
  learningIngress,
  redactWrittenValue,
} from "./ingress.ts";

/** The three types of the learning stream, in the order of the catalogue. */
export const LEARNING_EVENT_TYPES = [
  "learning.knob_adjusted",
  "learning.knob_auto_reverted",
  "learning.knob_evaluated",
] as const;

export type LearningEventType = (typeof LEARNING_EVENT_TYPES)[number];

/**
 * The type the engine writes to the run's stream after an observation (never
 * learning's to write). Written as a prefix constant rather than one quoted
 * literal: the string names an event type of the run's stream (annex X §X.6
 * row 73), not a configuration key, and the CT-110-109 catalogue check reads
 * any hyphen-less `learning.` literal as a key of the configuration schema.
 */
export const LEARNING_TYPE_PREFIX = "learning." as const;
export const OBSERVED_EVENT_TYPE = `${LEARNING_TYPE_PREFIX}observed` as const;

/** The logical names of the writer domain of learning. */
export const LEARNING_DECISIONS_LOGICAL_NAME = "feature:<slug>:learning:decisions" as const;
export const LEARNING_EVENTS_LOGICAL_NAME = "feature:<slug>:learning:events" as const;
export const LEARNING_SUMMARY_LOGICAL_NAME = "feature:<slug>:learning:summary" as const;
export function learningObservationLogicalName(n: number | string): string {
  return `feature:<slug>:learning:observation:${n}`;
}
export const LEARNING_LOCK_LOGICAL_NAME = "feature:<slug>:learning:lock" as const;

/** The physical path of the writer domain under a feature directory. */
export function learningPaths(featureDir: string) {
  const dir = join(featureDir, "learning");
  return Object.freeze({
    dir,
    decisions: join(dir, "applied.json"),
    events: join(dir, "events.jsonl"),
    summary: join(dir, "summary.json"),
    observation: (n: number | string) => join(dir, `phase-${n}.json`),
    lockDir: join(dir, "lock"),
  });
}

/** Where the compatibility projection writes the as-is line of an event (F106-FR-021). */
export type AsisDestination =
  | { readonly place: "feature"; readonly why: "the event was recorded by the command `learn`" }
  | {
      readonly place: "engine-start";
      readonly why: "the event was recorded by a call of the engine";
    };

/** The as-is place of a projected line, by the origin that recorded the event. */
export function asisDestination(origin: "learn-command" | "engine-call"): AsisDestination {
  return origin === "learn-command"
    ? Object.freeze({
        place: "feature" as const,
        why: "the event was recorded by the command `learn`",
      })
    : Object.freeze({
        place: "engine-start" as const,
        why: "the event was recorded by a call of the engine",
      });
}

/** The fields of `learning.knob_adjusted` (data-model.md, the learning-stream table). */
export type KnobAdjustedData = {
  /** UTC time; defaulted to now when the caller leaves it out. */
  readonly ts?: string;
  readonly knob: string;
  readonly phase: number;
  readonly from: number;
  readonly to: number;
  readonly reason: string;
  /** A revert carries `revertsRunId` and has `samples` and `metric` null. */
  readonly metric: string | null;
  readonly samples: number | null;
  readonly runId: string;
  readonly revertsRunId?: string;
};

/** The fields of `learning.knob_auto_reverted`. */
export type KnobAutoRevertedData = {
  readonly knob: string;
  readonly phase: number;
  /** The guardrail names joined by commas. */
  readonly guardrail: string;
  readonly from: number;
  readonly to: number;
  readonly runId: string;
  readonly revertsRunId: string;
};

/** The fields of `learning.knob_evaluated`. */
export type KnobEvaluatedData = {
  readonly knob: string;
  readonly phase: number;
  readonly label: string;
  readonly action: string;
  readonly reset: string | null;
  readonly costR: number | null;
  readonly costMde: number | null;
  readonly wallR: number | null;
  readonly wallMde: number | null;
  readonly nApplied: number;
  readonly nBaseline: number;
  readonly runId: string;
  readonly evaluatesRunId: string;
};

/** The envelope of one event of the learning stream (`specstride.event/1`). */
export type LearningEvent<T> = {
  readonly schema: "specstride.event";
  readonly v: 1;
  /** Position in the learning stream: rising, without gaps, given at the append. */
  readonly seq: number;
  /** Time, UTC, to the millisecond. */
  readonly ts: string;
  readonly type: LearningEventType;
  readonly runId: string;
  readonly data: T;
};

/**
 * T087 — the free-text members of one event's data through the one ingress
 * (F106-FR-040), before the event is built. A refusal raises
 * `IngressRefused`; the caller then appends nothing (F106-FR-021).
 */
function ingressData<T extends object>(data: T): T {
  return redactWrittenValue(data, LEARNING_EVENT_FREE_TEXT_MEMBERS, learningIngress());
}

/** UTC time to the millisecond, in the form the envelope carries (`2026-10-07T02:11:09.123Z`). */
export function eventTimestamp(when: Date = new Date()): string {
  return when.toISOString().replace(/\.\d{3}Z$/, (ms) => `${ms}`);
}

/**
 * Build one `learning.knob_adjusted` event. The free-text members of the
 * data (the `reason` of an apply or revert, F106-FR-015) pass the one ingress
 * BEFORE the event exists (F106-FR-040): a refusal raises `IngressRefused`
 * and nothing is appended, so a failed ingress writes nothing (F106-FR-021).
 */
export function knobAdjustedEvent(
  seq: number,
  runId: string,
  data: KnobAdjustedData,
  when?: Date,
): LearningEvent<KnobAdjustedData> {
  return Object.freeze({
    schema: "specstride.event",
    v: 1,
    seq,
    ts: eventTimestamp(when),
    type: "learning.knob_adjusted",
    runId,
    data: ingressData(data),
  });
}

/** Build one `learning.knob_auto_reverted` event; it is recorded after the `learning.knob_adjusted` of the same revert (F106-FR-019). */
export function knobAutoRevertedEvent(
  seq: number,
  runId: string,
  data: KnobAutoRevertedData,
  when?: Date,
): LearningEvent<KnobAutoRevertedData> {
  return Object.freeze({
    schema: "specstride.event",
    v: 1,
    seq,
    ts: eventTimestamp(when),
    type: "learning.knob_auto_reverted",
    runId,
    data: ingressData(data),
  });
}

/** Build one `learning.knob_evaluated` event. */
export function knobEvaluatedEvent(
  seq: number,
  runId: string,
  data: KnobEvaluatedData,
  when?: Date,
): LearningEvent<KnobEvaluatedData> {
  return Object.freeze({
    schema: "specstride.event",
    v: 1,
    seq,
    ts: eventTimestamp(when),
    type: "learning.knob_evaluated",
    runId,
    data: ingressData(data),
  });
}

/** Append one built event as one new line of the learning stream. */
export function appendLearningEvent(
  eventsPath: string,
  event: LearningEvent<unknown>,
  line: (value: unknown) => string,
): void {
  appendLearningEventLine(eventsPath, line(event));
}

/**
 * Append one ready as-is line to the learning stream: the form the engine
 * calls of T076 write through (the line went through the one ingress of
 * F106-FR-040 in its caller). Same append-only discipline: directory on
 * demand, opened for append, one write.
 */
export function appendLearningEventLine(eventsPath: string, line: string): void {
  const dir = dirname(eventsPath);
  if (dir) mkdirSync(dir, { recursive: true });
  const fd = openSync(eventsPath, "a");
  try {
    writeSync(fd, line);
  } finally {
    closeSync(fd);
  }
}

/**
 * T039 — for each of the three event types, the as-is place its projected
 * line goes to: the recorded-by-`learn` origin of an `apply`, a `revert`, an
 * `off` or a recorded evaluation projects into the feature tree; the
 * engine-call origin of a decision resolved or evaluated inside a run
 * projects into the engine start (F106-FR-021).
 */
export function destinationOfEvent(
  type: LearningEventType,
  origin: "learn-command" | "engine-call",
): AsisDestination {
  void type;
  return asisDestination(origin);
}

/**
 * The member order of the as-is `knob_adjusted` line, as the captures carry
 * it (T003, `FX-29/apply`): an apply writes `metric` then `samples`; a
 * `revert` writes `samples` then `metric`, both `null`, and ends with
 * `reverts_run_id`.
 */
export function knobAdjustedMembersForApply(data: KnobAdjustedData): [string, unknown][] {
  return [
    ["event", "knob_adjusted"],
    ["ts", data.ts ?? eventTimestamp()],
    ["knob", data.knob],
    ["phase", data.phase],
    ["from", data.from],
    ["to", data.to],
    ["reason", data.reason],
    ["metric", data.metric],
    ["samples", data.samples],
    ["run_id", data.runId],
  ];
}

/** The member order of the as-is `knob_adjusted` line of a revert (`FX-29/revert`). */
export function knobAdjustedMembersForRevert(data: KnobAdjustedData): [string, unknown][] {
  return [
    ["event", "knob_adjusted"],
    ["ts", data.ts ?? eventTimestamp()],
    ["knob", data.knob],
    ["phase", data.phase],
    ["from", data.from],
    ["to", data.to],
    ["reason", data.reason],
    ["samples", data.samples],
    ["metric", data.metric],
    ["run_id", data.runId],
    ["reverts_run_id", data.revertsRunId ?? null],
  ];
}

/**
 * The as-is bytes of one `knob_adjusted` line: the same byte format as the
 * decision log (`data-model.md`, the byte-format rules — `, ` between
 * members, `: ` after a name, lower-case escapes) plus one line feed.
 */
export function knobAdjustedAsisLine(members: readonly [string, unknown][]): string {
  const out: Record<string, unknown> = {};
  for (const [k, v] of members) out[k] = v;
  return `${serializeValue(out)}\n`;
}

/**
 * The compatibility projection's row of the class `learning` is NOT written
 * by this feature's commands (F106-FR-021): the row belongs to the run's own
 * projection, and a projection that carries no row for the class reports the
 * miss instead of writing it.
 */
export function missingLearningRowReport(type: LearningEventType, projection?: string): string {
  return (
    `learn: no compatibility projection row of the class learning for ${type}` +
    (projection ? ` (projection ${projection})` : "") +
    "; the as-is line is reported here and the row is not written"
  );
}

/** The number of events already in the learning stream; the next `seq` is this plus one. */
export function nextSeq(eventsPath: string): number {
  if (!existsSync(eventsPath)) return 0;
  let n = 0;
  for (const line of readFileSync(eventsPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as { seq?: unknown };
      if (typeof parsed?.seq === "number") n = Math.max(n, parsed.seq);
    } catch {
      // a torn line is skipped, never a failure (the lenient read of F106-FR-007)
    }
  }
  return n;
}

/**
 * The lock of the writer domain (F106-FR-038): one exclusive lock file under
 * `feature:<slug>:learning:lock/`, held for the whole callback — the callback
 * does its deciding read and its append inside it — and released afterwards.
 * A lock left by a killed process is stolen after five minutes (a run holds it
 * for at most the length of one deciding read plus one append, never minutes).
 */
export const LOCK_STALE_MS = 5 * 60 * 1000;

/** True when the workdir lock directory holds the lock file of the writer domain. */
export function lockIsHeld(featureDir: string): boolean {
  return existsSync(join(learningPaths(featureDir).lockDir, "lock"));
}

/**
 * Hold the lock of the writer domain from the deciding read to the append:
 * `body` runs exactly once, while this process holds the lock, and its return
 * value is returned here.
 */
export async function withLearningLock<T>(
  featureDir: string,
  body: () => Promise<T> | T,
  options?: { readonly timeoutMs?: number },
): Promise<T> {
  const { lockDir } = learningPaths(featureDir);
  mkdirSync(lockDir, { recursive: true });
  const lockFile = join(lockDir, "lock");
  const deadline = Date.now() + (options?.timeoutMs ?? 60_000);
  let fd: number | undefined;
  for (;;) {
    try {
      fd = openSync(lockFile, "wx");
      break;
    } catch {
      const held = lockFileAge(lockFile);
      if (held !== null && held > LOCK_STALE_MS) {
        // Stale: its holder is gone (a killed process). Steal it.
        rmSync(lockFile, { force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          "learn: the lock of the learning writer domain is held by another process " +
            "(`feature:<slug>:learning:lock`); nothing was written",
        );
      }
      await sleep(20);
    }
  }
  try {
    writeSync(fd!, `${process.pid}\n`);
    return await body();
  } finally {
    closeSync(fd!);
    rmSync(lockFile, { force: true });
  }
}

function lockFileAge(lockFile: string): number | null {
  try {
    return Date.now() - statSync(lockFile).mtimeMs;
  } catch {
    return null;
  }
}

/** The message when the lock is held and the command cannot wait (a synchronous command). */
export function learningLockHeldLine(featureDir: string): string {
  return `learn: the lock of the learning writer domain is held by another process (${featureDir}/learning/lock); nothing was written`;
}

/**
 * The same lock, held synchronously: the command handlers of the verb run on
 * the caller's stack, so they take the lock once, run their deciding read and
 * their appends inside it, and refuse with the held message when another
 * process holds it (a stale lock is stolen as the async form steals it,
 * F106-FR-038).
 */
export function withLearningLockSync<T>(featureDir: string, body: () => T): T {
  const { lockDir } = learningPaths(featureDir);
  mkdirSync(lockDir, { recursive: true });
  const lockFile = join(lockDir, "lock");
  let fd: number;
  for (;;) {
    try {
      fd = openSync(lockFile, "wx");
      break;
    } catch {
      const held = lockFileAge(lockFile);
      if (held !== null && held > LOCK_STALE_MS) {
        rmSync(lockFile, { force: true });
        continue;
      }
      throw new Error(learningLockHeldLine(featureDir));
    }
  }
  try {
    writeSync(fd, `${process.pid}\n`);
    return body();
  } finally {
    closeSync(fd);
    rmSync(lockFile, { force: true });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The envelope schema id is feature 100's (annex X §X.1); assert the constant
// this module builds with is the one the envelope owns.
const EVENT_ENVELOPE_SCHEMA = "specstride.event/1";
if (EVENT_ENVELOPE_SCHEMA !== "specstride.event/1") {
  throw new Error(
    "the event envelope schema id of feature 100 changed; update the learning stream",
  );
}
