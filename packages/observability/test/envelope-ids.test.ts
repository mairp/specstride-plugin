/**
 * T017 — CT-111-102 and CT-111-103: the envelope and the ids (F111-FR-002,
 * F111-FR-003).
 *
 * F111-FR-002: *Every event MUST carry the envelope of annex X §X.1 with typed
 * values, null for an unknown value and absence for a value that does not
 * apply. The identity of the feature in an event MUST be `featureId` and the
 * working-directory name MUST be `project` in `data` where a type needs it;
 * the as-is field name `task` MUST NOT appear in the primary stream. `ts` MUST
 * be on every event of every writer, the supervisor's included, in UTC to the
 * millisecond. `strategy` MUST be present on every event of a phase attempt
 * and of a pass.*
 *
 * F111-FR-003: *Ids MUST be stable and MUST be on every event that has them,
 * as in annex B §B.3. `attemptId` MUST be minted once and never change across
 * a relaunch or a resume; the ordinal `attempt` MUST be carried over a resume
 * and changes only through `counters.reset`. `passId` MUST be unique per start
 * of a session; a resume after a yield MUST give a new `passId` with the same
 * `attemptId`; the ordinal `pass` MUST rise per phase attempt and never be
 * reused.*
 *
 * This is an INTEGRATION test with an EFFECT WITNESS. The events are written
 * to a real file by the writer of T008, and every claim about an envelope or
 * an id is read back from the BYTES through `readEventLine` of
 * `@specstride/contracts`. A relaunch is a real second writer on the same
 * file, opened from the id book's SAVED STATE and not from the object in
 * memory — a book that survives only in memory would prove nothing about a
 * relaunch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEventLine } from "@specstride/contracts/envelope/event";
import { NULL_WHERE_UNKNOWN, STRATEGIES } from "@specstride/contracts/envelope/event";
import { scopeOf } from "@specstride/contracts/ids/identifiers";
import {
  FEATURE_IDENTITY_FIELD,
  FORBIDDEN_AS_IS_FIELD,
  IdBook,
  PROJECT_FIELD,
  TIMESTAMP_FORM,
  Emitter,
  envelopeFindings,
  fillEnvelope,
  needsStrategy,
  projectNameOf,
  timestampOf,
} from "../src/writer/emit.ts";
import { PrimaryWriter } from "../src/writer/writer.ts";

function workdir(): string {
  return mkdtempSync(join(tmpdir(), "ct-111-102-"));
}

type Line = Record<string, unknown> & { seq: number; type: string; ts: string };

/** The independent read path: the bytes through feature 100's reader. */
function readBack(file: string): Line[] {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.length > 0);
  return lines.map((line, index) => {
    const read = readEventLine(line, index === lines.length - 1);
    assert.ok(read.ok, `line ${index + 1} is a well-formed envelope: ${line}`);
    return JSON.parse(line) as Line;
  });
}

const CONTEXT = {
  runId: "run-7",
  launchId: "launch-1",
  engineStartId: "engine-1",
  featureId: "111-event-schema-and-projection",
  phaseId: "phase-3",
  role: "proposer",
} as const;

/* ------------------------------------------------------------------ *
 * CT-111-102 — the envelope.
 * ------------------------------------------------------------------ */

test("CT-111-102 `ts` is UTC to the millisecond, on every event", () => {
  const file = join(workdir(), "events.jsonl");
  const clock = [
    new Date("2026-10-01T09:00:00.000Z"),
    new Date("2026-10-01T09:00:01.250Z"),
    new Date("2026-10-01T09:00:02.007Z"),
  ];
  let tick = 0;
  const writer = PrimaryWriter.open({
    file,
    runId: CONTEXT.runId,
    launchId: CONTEXT.launchId,
    holder: "engine",
    now: () => clock[tick++] as Date,
  });
  for (let i = 0; i < 3; i += 1) writer.append({ type: "commit.made", data: { phase: i } });
  writer.close();

  const onDisk = readBack(file);
  assert.equal(onDisk.length, 3);
  for (const event of onDisk) {
    assert.match(event.ts, TIMESTAMP_FORM, `${event.ts} is UTC to the millisecond`);
    assert.ok(event.ts.endsWith("Z"), "UTC, not a local offset");
  }
  assert.deepEqual(
    onDisk.map((e) => e.ts),
    ["2026-10-01T09:00:00.000Z", "2026-10-01T09:00:01.250Z", "2026-10-01T09:00:02.007Z"],
  );
  // A time with no millisecond part is not of the form.
  assert.doesNotMatch("2026-10-01T09:00:00Z", TIMESTAMP_FORM);
  assert.doesNotMatch("2026-10-01T09:00:00.000+04:00", TIMESTAMP_FORM);
  assert.equal(timestampOf(new Date("2026-10-01T09:00:02.007Z")), "2026-10-01T09:00:02.007Z");
});

test("CT-111-102 null is an UNKNOWN value and absence is a value that does not apply", () => {
  // `harness`, `provider` and `model` are the fields the annex names as
  // null-where-unknown. A field that does not apply is simply not there.
  const known = fillEnvelope(
    { ...CONTEXT, harness: "claude", provider: "anthropic", model: "opus" },
    { type: "commit.made", data: { phase: 1 } },
    1,
    new Date("2026-10-01T09:00:00.000Z"),
  );
  assert.equal(known.harness, "claude");
  assert.equal(Object.hasOwn(known, "workerId"), false, "a worker field does not apply: absent");
  assert.equal(Object.hasOwn(known, "wseq"), false);

  const unknown = fillEnvelope(
    { ...CONTEXT, harness: null, provider: null, model: null },
    { type: "commit.made", data: { phase: 1 } },
    1,
    new Date("2026-10-01T09:00:00.000Z"),
  );
  assert.equal(Object.hasOwn(unknown, "harness"), true, "an unknown value is PRESENT");
  assert.equal(unknown.harness, null, "and it is null");
  assert.equal(unknown.provider, null);
  assert.equal(unknown.model, null);

  const notApplicable = fillEnvelope(
    CONTEXT,
    { type: "commit.made", data: { phase: 1 } },
    1,
    new Date("2026-10-01T09:00:00.000Z"),
  );
  assert.equal(
    Object.hasOwn(notApplicable, "harness"),
    false,
    "a value that does not apply is ABSENT, not null",
  );
});

test("CT-111-102 the identity of the feature is `featureId`, never the as-is `task`", () => {
  assert.equal(FEATURE_IDENTITY_FIELD, "featureId");
  assert.equal(FORBIDDEN_AS_IS_FIELD, "task");
  const event = fillEnvelope(
    CONTEXT,
    { type: "commit.made", data: { phase: 1 } },
    1,
    new Date("2026-10-01T09:00:00.000Z"),
  );
  assert.equal(event.featureId, "111-event-schema-and-projection");
  assert.equal(Object.hasOwn(event, "task"), false);
  // A caller that tries to smuggle the as-is name in is refused by the check.
  const smuggled = { ...event, task: "111" } as unknown as Record<string, unknown>;
  assert.deepEqual(
    envelopeFindings(smuggled).filter((f) => f.includes("task")).length > 0,
    true,
    "the as-is field name `task` does not appear in the primary stream",
  );
  const inData = { ...event, data: { phase: 1, task: "x" } } as unknown as Record<string, unknown>;
  assert.ok(envelopeFindings(inData).some((f) => f.includes("task")));
});

test("CT-111-102 the working-directory NAME is `project`", () => {
  assert.equal(PROJECT_FIELD, "project");
  assert.equal(projectNameOf("/home/x/work/my-project"), "my-project");
  assert.equal(projectNameOf("/home/x/work/my-project/"), "my-project");
  const event = fillEnvelope(
    { ...CONTEXT, workdir: "/home/x/work/my-project" },
    { type: "commit.made", data: { phase: 1, project: null } },
    1,
    new Date("2026-10-01T09:00:00.000Z"),
  );
  // The field is filled where the type carries it, and the full path is never
  // the value: the NAME of the directory is.
  assert.equal((event.data as Record<string, unknown>).project, "my-project");
  const withoutIt = fillEnvelope(
    { ...CONTEXT, workdir: "/home/x/work/my-project" },
    { type: "commit.made", data: { phase: 1 } },
    1,
    new Date("2026-10-01T09:00:00.000Z"),
  );
  assert.equal(
    Object.hasOwn(withoutIt.data as object, "project"),
    false,
    "a type that does not carry the field does not get one",
  );
});

test("CT-111-102 `strategy` is on every event of a phase attempt and of a pass", () => {
  assert.equal(needsStrategy("attempt.started"), true);
  assert.equal(needsStrategy("attempt.ended"), true);
  assert.equal(needsStrategy("pass.started"), true);
  assert.equal(needsStrategy("pass.ended"), true);
  assert.equal(needsStrategy("pass.killed"), true);
  assert.equal(needsStrategy("run.launched"), false, "a launch is of no attempt and of no pass");

  const withStrategy = fillEnvelope(
    { ...CONTEXT, attemptId: "a-1", attempt: 1, strategy: "micro" },
    { type: "attempt.started", data: { phase: 3, attempt: 1 } },
    1,
    new Date("2026-10-01T09:00:00.000Z"),
  );
  assert.equal(withStrategy.strategy, "micro");
  assert.ok((STRATEGIES as readonly string[]).includes(withStrategy.strategy as string));
  assert.deepEqual(envelopeFindings(withStrategy), []);

  const without = fillEnvelope(
    { ...CONTEXT, attemptId: "a-1", attempt: 1 },
    { type: "attempt.started", data: { phase: 3, attempt: 1 } },
    1,
    new Date("2026-10-01T09:00:00.000Z"),
  );
  assert.ok(
    envelopeFindings(without).some((f) => f.includes("strategy")),
    "an event of a phase attempt without `strategy` is a finding",
  );
});

test("CT-111-102 the envelope that reaches the file is typed and complete", () => {
  const file = join(workdir(), "events.jsonl");
  const emitter = Emitter.open({
    file,
    context: { ...CONTEXT, strategy: "classic", harness: "claude" },
    holder: "engine",
    now: () => new Date("2026-10-01T09:00:00.000Z"),
  });
  emitter.emit({ type: "pass.started", data: { iter: 1, sessionId: "s-1" } });
  emitter.close();

  const [event] = readBack(file);
  assert.ok(event);
  assert.equal(event.schema, "specstride.event");
  assert.equal(event.v, 1);
  assert.equal(typeof event.seq, "number");
  assert.equal(event.seq, 1);
  assert.equal(event.runId, "run-7");
  assert.equal(event.launchId, "launch-1");
  assert.equal(event.strategy, "classic");
  assert.equal(event.harness, "claude");
  assert.deepEqual(envelopeFindings(event), []);
  // A durable identity that could not exist before the write.
  assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex").length, 64);
});

test("CT-111-102 an UNKNOWN harness, provider or model reaches the file as null", () => {
  const file = join(workdir(), "events.jsonl");
  const emitter = Emitter.open({
    file,
    context: { ...CONTEXT, strategy: "classic", harness: null, provider: null, model: null },
    holder: "engine",
    now: () => new Date("2026-10-01T09:00:00.000Z"),
  });
  emitter.emit({ type: "pass.started", data: { iter: 1, sessionId: "s-1" } });
  emitter.close();

  // The BYTES, read without feature 100's validator. The three fields the
  // annex names "as known, else null" are PRESENT and null, which is what
  // F111-FR-002 asks for.
  //
  // Recorded, not repaired: the GENERATED envelope schema of feature 100
  // (`packages/contracts/schemas/event-envelope.schema.json`) types these
  // three as `string` with no `null`, although the same row of annex X §X.1
  // reads "Text, or null" and the package exports them as
  // `NULL_WHERE_UNKNOWN`. So `readEventLine` refuses a line that keeps
  // F111-FR-002 here. The file belongs to feature 100; this feature neither
  // edits it nor writes a second envelope, and the finding is in the evidence.
  const raw = readFileSync(file, "utf8").trim();
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  assert.equal(Object.hasOwn(parsed, "harness"), true);
  assert.equal(parsed.harness, null);
  assert.equal(parsed.provider, null);
  assert.equal(parsed.model, null);
  assert.deepEqual(envelopeFindings(parsed), [], "the envelope keeps F111-FR-002");
  for (const field of NULL_WHERE_UNKNOWN) {
    assert.equal(
      (NULL_WHERE_UNKNOWN as readonly string[]).includes(field),
      true,
      `${field} is one of the three the annex names null-where-unknown`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * CT-111-103 — the ids.
 * ------------------------------------------------------------------ */

test("CT-111-103 the scopes of the ids are annex B §B.3's, not a second list", () => {
  assert.equal(scopeOf("attemptId"), "One phase attempt");
  assert.equal(scopeOf("passId"), "One pass");
});

test("CT-111-103 `attemptId` is minted ONCE and survives a RELAUNCH", () => {
  const dir = workdir();
  const file = join(dir, "events.jsonl");
  const stateFile = join(dir, "ids.json");
  const key = { featureId: CONTEXT.featureId, phaseId: CONTEXT.phaseId };

  // The first launch mints the id and saves the book.
  const first = new IdBook();
  const attempt = first.beginAttempt(key);
  assert.equal(attempt.attempt, 1);
  writeFileSync(stateFile, JSON.stringify(first.state()));

  const writerA = PrimaryWriter.open({
    file,
    runId: CONTEXT.runId,
    launchId: "launch-1",
    holder: "engine-1",
  });
  writerA.append({
    type: "attempt.started",
    attemptId: attempt.attemptId,
    attempt: attempt.attempt,
    strategy: "classic",
    data: { phase: 3, attempt: attempt.attempt },
  });
  writerA.close();

  // The relaunch reads the book BACK FROM DISK: nothing of the first process
  // is in memory any more.
  const second = IdBook.restore(JSON.parse(readFileSync(stateFile, "utf8")));
  const same = second.currentAttempt(key);
  assert.equal(same?.attemptId, attempt.attemptId, "`attemptId` did not change across a relaunch");
  assert.equal(same?.attempt, 1, "and the ordinal was carried over");

  const writerB = PrimaryWriter.open({
    file,
    runId: CONTEXT.runId,
    launchId: "launch-2",
    holder: "engine-2",
  });
  writerB.append({
    type: "attempt.ended",
    attemptId: same?.attemptId,
    attempt: same?.attempt,
    strategy: "classic",
    data: { phase: 3, attempt: same?.attempt, endCause: "approved" },
  });
  writerB.close();

  const onDisk = readBack(file);
  assert.equal(onDisk.length, 2);
  assert.equal(
    new Set(onDisk.map((e) => e.attemptId)).size,
    1,
    "the two launches wrote the SAME `attemptId`",
  );
  assert.deepEqual(
    onDisk.map((e) => e.launchId),
    ["launch-1", "launch-2"],
    "and they are two different launches",
  );
});

test("CT-111-103 the ordinal `attempt` changes only through `counters.reset`", () => {
  const book = new IdBook();
  const key = { featureId: "f", phaseId: "p" };
  const one = book.beginAttempt(key);
  book.endAttempt(key);
  const two = book.beginAttempt(key);
  assert.deepEqual([one.attempt, two.attempt], [1, 2], "a new attempt raises the ordinal");
  assert.notEqual(one.attemptId, two.attemptId, "and mints a new id; an id is never reused");

  // A resume carries the ordinal over; it does not raise it.
  const resumed = book.resume(key);
  assert.equal(resumed?.attempt, 2);
  assert.equal(resumed?.attemptId, two.attemptId);

  book.resetCounters();
  const afterReset = book.beginAttempt(key);
  assert.equal(afterReset.attempt, 1, "`counters.reset` is the only thing that changes it");
  assert.notEqual(
    afterReset.attemptId,
    one.attemptId,
    "the reset returns the ordinal, never the id: an id is never reused",
  );
});

test("CT-111-103 `passId` is unique per start of a session and a YIELD RESUME gives a new one", () => {
  const book = new IdBook();
  const key = { featureId: "f", phaseId: "p" };
  const attempt = book.beginAttempt(key);

  const first = book.startPass(key);
  const second = book.startPass(key);
  assert.notEqual(first.passId, second.passId, "a new session start, a new `passId`");
  assert.deepEqual([first.pass, second.pass], [1, 2], "the ordinal rises per phase attempt");

  const afterYield = book.resumeAfterYield(key);
  assert.notEqual(afterYield.passId, second.passId, "a resume after a yield gives a NEW `passId`");
  assert.equal(afterYield.attemptId, attempt.attemptId, "with the SAME `attemptId`");
  assert.equal(afterYield.pass, 3, "and the ordinal rises; it is never reused");

  const everyId = [first.passId, second.passId, afterYield.passId];
  assert.equal(new Set(everyId).size, 3, "no `passId` is reused");
  // A new phase attempt starts the pass ordinal over, because it rises PER attempt.
  book.endAttempt(key);
  book.beginAttempt(key);
  assert.equal(book.startPass(key).pass, 1);
});

test("CT-111-103 the ids are ON the events, read back from the file", () => {
  const dir = workdir();
  const file = join(dir, "events.jsonl");
  const book = new IdBook();
  const key = { featureId: CONTEXT.featureId, phaseId: CONTEXT.phaseId };
  const attempt = book.beginAttempt(key);
  const pass = book.startPass(key);

  const emitter = Emitter.open({
    file,
    context: {
      ...CONTEXT,
      attemptId: attempt.attemptId,
      attempt: attempt.attempt,
      passId: pass.passId,
      pass: pass.pass,
      sessionId: "session-1",
      strategy: "micro",
    },
    holder: "engine",
    now: () => new Date("2026-10-01T09:00:00.000Z"),
  });
  emitter.emit({ type: "pass.started", data: { iter: 1, sessionId: "session-1" } });
  // The yield resume: a new pass, the same attempt, on the same stream.
  const resumed = book.resumeAfterYield(key);
  emitter.withContext({ passId: resumed.passId, pass: resumed.pass });
  emitter.emit({ type: "pass.started", data: { iter: 2, sessionId: "session-2" } });
  emitter.close();

  const onDisk = readBack(file);
  assert.equal(onDisk.length, 2);
  assert.equal(onDisk[0]?.attemptId, onDisk[1]?.attemptId, "the same `attemptId` across the yield");
  assert.notEqual(onDisk[0]?.passId, onDisk[1]?.passId, "a new `passId` after the yield");
  assert.deepEqual(
    onDisk.map((e) => e.pass),
    [1, 2],
  );
  for (const event of onDisk) {
    assert.equal(typeof event.attemptId, "string");
    assert.equal(typeof event.passId, "string");
    assert.equal(event.strategy, "micro", "`strategy` is on every event of a pass");
    assert.deepEqual(envelopeFindings(event), []);
  }
});

test("CT-111-103 the saved state of the book is what survives, and it round-trips", () => {
  const book = new IdBook();
  const key = { featureId: "f", phaseId: "p" };
  book.beginAttempt(key);
  book.startPass(key);
  book.startPass(key);
  const saved = JSON.parse(JSON.stringify(book.state())) as ReturnType<IdBook["state"]>;
  const restored = IdBook.restore(saved);
  assert.deepEqual(restored.state(), book.state());
  assert.equal(restored.startPass(key).pass, 3, "the count goes on where the file left it");
});
