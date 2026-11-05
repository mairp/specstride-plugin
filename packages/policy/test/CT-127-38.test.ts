/**
 * CT-127-38 (T056) — the characterization test of the EVENTS UNDER THE
 * ENVELOPE, NO CONTENT, and the PAIR `run.paused` / `run.resumed`
 * (F127-FR-040).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  FREE_TEXT_CAP_BYTES,
  FREE_TEXT_FIELDS,
  NO_CONTENT,
  PAIR_CLOSED,
  POLICY_EVENT_TYPES,
  PolicyEventError,
  emit,
  isPolicyEventType,
  pairFindings,
  preparePayload,
  runPaused,
  runResumed,
} from "../src/quota/events.ts";
import { LOGICAL_NAME, SCHEMA, SCHEMA_ID } from "@specstride/contracts/envelope/event";
import { validate } from "@specstride/contracts/records/compile";

/**
 * The envelope fields of annex X §X.1, transcribed from the record type
 * `specstride.event/1` (`packages/contracts/src/records/generated/
 * event-envelope.ts`). The payload of an event of this feature carries NONE of
 * them: the writer of feature 111 owns the envelope.
 */
const ENVELOPE_FIELDS = [
  "schema",
  "v",
  "seq",
  "ts",
  "type",
  "runId",
  "launchId",
  "engineStartId",
  "data",
] as const;
import { performSwitch } from "../src/budget/fallback-switch.ts";
import { restorePrimary } from "../src/budget/fallback-return.ts";
import { entryOf, walkFallback, type RolePlan } from "../src/budget/fallback.ts";
import { prepareTheKey } from "../src/budget/fallback-billing.ts";
import { testPorts } from "./support/index.ts";

/** A redactor that removes a key-looking token and cuts to the cap. */
const fakeRedact = (text: string, cap: number) => ({
  text: text.replace(/sk-[A-Za-z0-9]+/g, "[REDACTED]").slice(0, cap),
  replacements: 1,
  patternSetVersion: "test",
});

const PRIMARY = entryOf(0, { harness: "stub-harness", model: "b", billingMode: "subscription" });
const KEY_ENTRY = entryOf(1, {
  harness: "stub-api",
  model: "m",
  billingMode: "api",
  capUsd: 25,
});
const PLAN: RolePlan = {
  role: "proposer",
  primary: PRIMARY,
  entries: [KEY_ENTRY],
  resolvedHarnesses: ["stub-harness", "stub-api"],
};

test("CT-127-38: the ten event types of F127-FR-040, and no eleventh", () => {
  assert.deepEqual(
    [...POLICY_EVENT_TYPES],
    [
      "quota.signal",
      "harness.error",
      "run.paused",
      "run.resumed",
      "alert",
      "budget.exceeded",
      "fallback.switched",
      "fallback.restored",
      "fallback.skipped",
      "blocked",
    ],
  );
  assert.equal(POLICY_EVENT_TYPES.length, 10);
  assert.equal(isPolicyEventType("fallback.switched"), true);
  assert.equal(isPolicyEventType("fallback.vanished"), false);
});

test("CT-127-38: a type outside the ten is refused instead of written", () => {
  const ports = testPorts({ strictEvents: false });
  assert.throws(() => emit(ports.eventWriter, "fallback.vanished" as never, {}), PolicyEventError);
  assert.deepEqual([...ports.eventWriter.types()], []);
});

test("CT-127-38: the events of US2 go out under the ENVELOPE of annex X §X.1", () => {
  // The envelope fields belong to the writer of feature 111; this feature
  // hands over a type and a payload, and the type is one the envelope's
  // catalogue holds.
  assert.equal(SCHEMA_ID, "specstride.event/1");
  assert.equal(SCHEMA, "specstride.event");
  assert.equal(LOGICAL_NAME, "run:<runId>:events");
  const ports = testPorts();
  prepareTheKey(ports.eventWriter, KEY_ENTRY, { role: "proposer", from: "subscription" });
  performSwitch(ports.eventWriter, {
    role: "proposer",
    from: PRIMARY,
    to: KEY_ENTRY,
    reason: "quota_window",
    phaseAttempt: "phase-3/attempt-1",
    boundaryAvailable: true,
  });
  restorePrimary(ports.eventWriter, {
    role: "proposer",
    from: KEY_ENTRY,
    to: PRIMARY,
    phaseAttempt: "phase-4/attempt-1",
  });
  walkFallback({ ...PLAN, resolvedHarnesses: [] }, [], { writer: ports.eventWriter });

  assert.deepEqual(
    [...ports.eventWriter.types()],
    ["alert", "fallback.switched", "fallback.restored", "fallback.skipped"],
  );
  for (const event of ports.eventWriter.events) {
    assert.ok(isPolicyEventType(event.type), event.type);
    for (const field of ENVELOPE_FIELDS) {
      if (field === "type") continue; // the type is handed over beside the payload
      assert.ok(
        !(field in event.payload),
        `the payload does not carry the envelope field ${field}`,
      );
    }
    // And the event, placed in the envelope of annex X §X.1, VALIDATES against
    // feature 100's own schema.
    const envelope = validate(SCHEMA_ID, {
      schema: SCHEMA,
      v: 1,
      seq: 1,
      ts: "2026-01-01T00:00:00.000Z",
      type: event.type,
      runId: "run-1",
      launchId: "launch-1",
      data: event.payload,
    });
    assert.equal(envelope.ok, true, `${event.type} validates under the envelope`);
  }
});

test("CT-127-38: NO CONTENT — a payload that carries content is refused", () => {
  assert.deepEqual(
    [...NO_CONTENT],
    ["content", "text", "body", "prompt", "reply", "stdout", "stderr", "transcript"],
  );
  const ports = testPorts();
  for (const forbidden of NO_CONTENT) {
    assert.throws(
      () => emit(ports.eventWriter, "fallback.switched", { [forbidden]: "whatever" }),
      PolicyEventError,
      forbidden,
    );
    assert.throws(
      () => emit(ports.eventWriter, "fallback.switched", { [forbidden]: "whatever" }),
      /carry\s+no content/,
      forbidden,
    );
  }
  assert.deepEqual([...ports.eventWriter.types()], [], "nothing was written");
});

test("CT-127-38: no event of US2 carries content, and its free-text field is redacted and cut", () => {
  const ports = testPorts();
  performSwitch(
    ports.eventWriter,
    {
      role: "proposer",
      from: PRIMARY,
      to: KEY_ENTRY,
      reason: "quota_window",
      phaseAttempt: "phase-3/attempt-1",
      boundaryAvailable: true,
      note: `switched after the window ran out for sk-ABCDEF1234567890 ${"x".repeat(900)}`,
    },
    { redact: fakeRedact },
  );
  const payload = ports.eventWriter.of("fallback.switched")[0].payload;
  const note = String(payload.note);
  assert.ok(!note.includes("sk-ABCDEF1234567890"), "redacted");
  assert.ok(note.length <= FREE_TEXT_CAP_BYTES, `cut to ${FREE_TEXT_CAP_BYTES}: ${note.length}`);
  for (const forbidden of NO_CONTENT) assert.ok(!(forbidden in payload), forbidden);
  assert.deepEqual([...FREE_TEXT_FIELDS["fallback.switched"]], ["note"]);
  assert.deepEqual([...FREE_TEXT_FIELDS["fallback.skipped"]], ["note"]);
  assert.deepEqual([...FREE_TEXT_FIELDS["fallback.restored"]], ["note"]);
  assert.deepEqual([...FREE_TEXT_FIELDS.alert], ["message"]);
});

test("CT-127-38: a typed field of a US2 event is never sent through the redactor", () => {
  const ports = testPorts();
  const event = emit(
    ports.eventWriter,
    "fallback.skipped",
    { entry: 1, entryHarness: "stub-api", reason: "no-cap" },
    { redact: () => ({ text: "MANGLED", replacements: 0, patternSetVersion: "t" }) },
  );
  assert.equal(event.payload.entry, 1);
  assert.equal(event.payload.entryHarness, "stub-api");
  assert.equal(event.payload.reason, "no-cap");
});

test("CT-127-38: `run.paused` and `run.resumed` OPEN AND CLOSE A PAIR", () => {
  const ports = testPorts();
  assert.equal(PAIR_CLOSED.open, false);
  const opened = runPaused(ports.eventWriter, PAIR_CLOSED, {
    class: "quota_window",
    resetsAt: "2026-01-01T05:00:00.000Z",
    resumeAt: "2026-01-01T05:01:00.000Z",
    role: "proposer",
  });
  assert.equal(opened.pair.open, true);
  const closed = runResumed(ports.eventWriter, opened.pair, {
    pausedMs: 5 * 60 * 60 * 1000,
    role: "proposer",
    resumedBy: "resume-time",
  });
  assert.equal(closed.pair.open, false);
  assert.deepEqual([...ports.eventWriter.types()], ["run.paused", "run.resumed"]);
  assert.equal(ports.eventWriter.of("run.resumed")[0].payload.pausedMs, 5 * 60 * 60 * 1000);
});

test("CT-127-38: a second `run.paused` while one is open is refused", () => {
  const ports = testPorts();
  const opened = runPaused(ports.eventWriter, PAIR_CLOSED, { class: "quota_window" });
  assert.throws(
    () => runPaused(ports.eventWriter, opened.pair, { class: "quota_credit" }),
    PolicyEventError,
  );
  assert.equal(ports.eventWriter.countOf("run.paused"), 1);
});

test("CT-127-38: a `run.resumed` with no pause open is refused", () => {
  const ports = testPorts();
  assert.throws(
    () => runResumed(ports.eventWriter, PAIR_CLOSED, { pausedMs: 0 }),
    PolicyEventError,
  );
  assert.deepEqual([...ports.eventWriter.types()], []);
});

test("CT-127-38: a stream of this feature's events is checked for an unclosed pair", () => {
  assert.deepEqual([...pairFindings([])], []);
  assert.deepEqual([...pairFindings(["run.paused", "run.resumed"])], []);
  assert.deepEqual(
    [
      ...pairFindings([
        "alert",
        "run.paused",
        "fallback.switched",
        "run.resumed",
        "fallback.restored",
      ]),
    ],
    [],
    "the events of US2 between the pair change nothing",
  );
  assert.equal(pairFindings(["run.paused"]).length, 1);
  assert.match(pairFindings(["run.paused"])[0], /no `run.resumed` closed/);
  assert.match(pairFindings(["run.resumed"])[0], /with no `run.paused` open/);
  assert.match(pairFindings(["run.paused", "run.paused"])[0], /a second `run.paused`/);
});

test("CT-127-38: the exhaustion pause of US2 opens and closes its own pair", () => {
  const ports = testPorts();
  // Every entry limited: the role pauses, and resumes at the earliest reset.
  const walk = walkFallback(PLAN, [() => "limited"], { writer: ports.eventWriter });
  assert.equal(walk.exhausted, true);
  const opened = runPaused(ports.eventWriter, PAIR_CLOSED, {
    class: "quota_window",
    resetsAt: "2026-01-01T02:00:00.000Z",
    role: "proposer",
  });
  runResumed(ports.eventWriter, opened.pair, { pausedMs: 2 * 60 * 60 * 1000, role: "proposer" });
  assert.deepEqual(
    [...ports.eventWriter.types()],
    ["fallback.skipped", "run.paused", "run.resumed"],
  );
  assert.deepEqual([...pairFindings(ports.eventWriter.types())], []);
});

test("CT-127-38: `preparePayload` is where both rules are applied, for every type", () => {
  for (const type of POLICY_EVENT_TYPES) {
    const prepared = preparePayload(type, { role: "proposer" });
    assert.equal(prepared.role, "proposer");
    assert.throws(() => preparePayload(type, { content: "x" }), PolicyEventError, type);
  }
});
