/**
 * T029 — CT-111-134: the sink interface contract of annex C §C.10
 * (F111-FR-034).
 *
 * F111-FR-034: *The core MUST offer the sink interface contract of annex C
 * §C.10: `open` with the context of the run and the content accessor, `write`
 * with one event in the order of `seq`, `flush` and `close`. A sink MUST
 * declare the range of event majors it accepts. The core MUST call a sink only
 * after the primary write, only with the redacted event, which is the envelope
 * of annex X §X.1 whole with its `data`, and MUST refuse a sink whose range
 * does not hold the current major, with a doctor finding.*
 *
 * The four parts, each with a negative control:
 *
 *   1. ORDER. `write` receives one event at a time in the order of `seq`, and
 *      only after the bytes of that event are in the primary file. The proof
 *      is not the dispatcher's return value: inside `write` the sink reads the
 *      primary file itself and the test asserts the line of its own event is
 *      already there. Negative control: a dispatcher asked to deliver an event
 *      whose `seq` is behind the last delivered one refuses it.
 *   2. REDACTED EVENT. What reaches `write` is the envelope whole, with its
 *      `data`, and it is the event the ingress already passed. Negative
 *      control: an event that did not pass the ingress is not delivered.
 *   3. DECLARED MAJORS. A sink that declares no range is refused at
 *      registration; a sink whose range holds the current major is accepted.
 *   4. REFUSAL OUTSIDE RANGE. A sink whose range does not hold the current
 *      major is refused WITH a doctor finding, severity from the set of
 *      feature 100, and the run is not stopped.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAJOR, SCHEMA } from "@specstride/contracts/envelope/event";
import type { EventEnvelope } from "@specstride/contracts/envelope/event";
import { DOCTOR_SEVERITIES } from "@specstride/contracts/codes/doctor-and-collisions";
import {
  OPERATIONS as EP08_OPERATIONS,
  POINT_ID as EP08_POINT_ID,
} from "@specstride/contracts/ep/event-sink";
import {
  CONTENT_ACCESSOR_HOOK_NAME,
  DISPATCHER_CALLS_A_SINK_ONLY_AFTER_THE_PRIMARY_WRITE,
  DISPATCHER_OPERATIONS,
  DOCTOR_FINDING_SINK_RANGE,
  DOCTOR_SEVERITY_SINK_RANGE,
  EventDispatcher,
  REFUSAL_STOPS_THE_RUN,
  contentAccessorHook,
  currentEventMajor,
  rangeHoldsTheCurrentMajor,
  registryCheck,
  sinkContextOf,
} from "../src/dispatcher/dispatcher.ts";
import { PrimaryWriter } from "../src/writer/writer.ts";

function workdir(): string {
  return mkdtempSync(join(tmpdir(), "ct-111-134-"));
}

/** A recording sink of the EP-08 shape, with its declared range of majors. */
function recorder(
  label: string,
  acceptsMajors: { from: number; to: number } = { from: MAJOR, to: MAJOR },
  onWrite?: (event: EventEnvelope) => void,
) {
  const seen: EventEnvelope[] = [];
  const opened: unknown[] = [];
  const calls: string[] = [];
  return {
    seen,
    opened,
    calls,
    sink: {
      label,
      acceptsMajors,
      open(context: unknown) {
        calls.push("open");
        opened.push(context);
        return Promise.resolve();
      },
      write(event: EventEnvelope) {
        calls.push("write");
        seen.push(event);
        onWrite?.(event);
        return Promise.resolve();
      },
      flush() {
        calls.push("flush");
        return Promise.resolve();
      },
      close() {
        calls.push("close");
        return Promise.resolve();
      },
      status() {
        return {
          line: `sink=${label}`,
          record: {
            sinkLabel: label,
            receiverState: "open",
            lastDeliveryStatus: "accepted",
            reason: null,
          },
        };
      },
    },
  };
}

/** The context of `open`, as `sinkContextOf` builds it for a run. */
function context(dir: string) {
  return sinkContextOf({
    runId: "run-ct134",
    launchId: "launch-ct134",
    engineStartId: "start-ct134",
    feature: "111-event-schema-and-projection",
    workspaceId: `ws-${dir.length}`,
    labels: { job: "j", "service.name": "s", task: "t", backend: "b" },
    profile: "default",
    switches: {},
    content: contentAccessorHook({
      captureIsOn: false,
      read: () => Promise.resolve("never reached while capture is off"),
      asIsSnippet: () => Promise.resolve("as-is"),
    }),
    compatibilityProjection: { asIsNameOf: () => null },
  });
}

/* ------------------------------------------------------------------ *
 * 1. The four operations, and the context of `open`.
 * ------------------------------------------------------------------ */

test("CT-111-134/a: the dispatcher offers `open`, `write`, `flush` and `close` of §C.10", () => {
  assert.deepEqual([...DISPATCHER_OPERATIONS], ["open", "write", "flush", "close"]);
  // The four this requirement names are the operations of EP-08 without
  // `status`, which F111-FR-034 does not name and which the contract of
  // feature 100 adds for the telemetry section of `status`.
  for (const operation of DISPATCHER_OPERATIONS) {
    assert.ok(EP08_OPERATIONS.includes(operation), `${operation} is an operation of EP-08`);
  }
  assert.equal(EP08_POINT_ID, "specstride.event-sink/1");
});

test("CT-111-134/b: `open` carries the context of the run and the content accessor", async () => {
  const dir = workdir();
  const writer = PrimaryWriter.open({
    file: join(dir, "events.jsonl"),
    runId: "run-ct134",
    launchId: "launch-ct134",
  });
  const one = recorder("ctx");
  const dispatcher = new EventDispatcher({ writer });
  assert.equal(dispatcher.register(one.sink).accepted, true);
  const ctx = context(dir);
  await dispatcher.open(ctx);
  writer.close();

  assert.equal(one.calls[0], "open", "`open` is the first call a sink receives");
  assert.equal(one.opened.length, 1);
  const got = one.opened[0] as typeof ctx;
  assert.equal(got.runId, "run-ct134");
  assert.equal(got.launchId, "launch-ct134");
  assert.equal(got.engineStartId, "start-ct134");
  assert.equal(typeof got.content.byReference, "function");
  assert.equal(
    typeof got.content.asIsSnippetForTheCompatibilityProjection,
    "function",
    "the content accessor is part of the context of `open`",
  );
  assert.equal(CONTENT_ACCESSOR_HOOK_NAME, "content");
  // Negative control: with capture off the accessor gives nothing back, so a
  // sink cannot reach content through the hook.
  assert.equal(
    await got.content.byReference({ logicalName: "n", hash: "h", size: 1 }),
    undefined,
    "the hook returns nothing while content capture is off",
  );
});

/* ------------------------------------------------------------------ *
 * 2. Order: one event at a time, by `seq`, after the primary write.
 * ------------------------------------------------------------------ */

test("CT-111-134/c: `write` receives one event at a time in the order of `seq`", async () => {
  const dir = workdir();
  const file = join(dir, "events.jsonl");
  const writer = PrimaryWriter.open({ file, runId: "run-ct134", launchId: "launch-ct134" });
  const one = recorder("order");
  const dispatcher = new EventDispatcher({ writer });
  dispatcher.register(one.sink);
  await dispatcher.open(context(dir));

  for (const type of ["pass.started", "tool.call", "pass.ended"]) {
    await dispatcher.append({ type, data: {} });
  }
  await dispatcher.flush();
  await dispatcher.close();
  writer.close();

  assert.deepEqual(
    one.seen.map((e) => e.seq),
    [1, 2, 3],
    "the sink saw every event once, in the order of `seq`",
  );
  assert.deepEqual(
    one.seen.map((e) => e.type),
    ["pass.started", "tool.call", "pass.ended"],
  );
  assert.deepEqual(one.calls, ["open", "write", "write", "write", "flush", "close"]);
});

test("CT-111-134/d: an event reaches a sink only after its bytes are in the primary file", async () => {
  const dir = workdir();
  const file = join(dir, "events.jsonl");
  const writer = PrimaryWriter.open({ file, runId: "run-ct134", launchId: "launch-ct134" });

  // The witness is read inside `write`, through an independent read path: the
  // sink reads the primary file from disk and keeps what it found.
  const onDiskWhenCalled: { seq: number; found: boolean }[] = [];
  const one = recorder("after-write", { from: MAJOR, to: MAJOR }, (event) => {
    const text = readFileSync(file, "utf8");
    const seqs = text
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => (JSON.parse(line) as { seq: number }).seq);
    onDiskWhenCalled.push({ seq: event.seq, found: seqs.includes(event.seq) });
  });

  const dispatcher = new EventDispatcher({ writer });
  dispatcher.register(one.sink);
  await dispatcher.open(context(dir));
  await dispatcher.append({ type: "pass.started", data: {} });
  await dispatcher.append({ type: "pass.ended", data: { endCause: "completed" } });
  await dispatcher.close();
  writer.close();

  assert.equal(DISPATCHER_CALLS_A_SINK_ONLY_AFTER_THE_PRIMARY_WRITE, true);
  assert.deepEqual(onDiskWhenCalled, [
    { seq: 1, found: true },
    { seq: 2, found: true },
  ]);
});

test("CT-111-134/e: negative control — an event behind the last delivered `seq` is refused", async () => {
  const dir = workdir();
  const writer = PrimaryWriter.open({
    file: join(dir, "events.jsonl"),
    runId: "run-ct134",
    launchId: "launch-ct134",
  });
  const one = recorder("out-of-order");
  const dispatcher = new EventDispatcher({ writer });
  dispatcher.register(one.sink);
  await dispatcher.open(context(dir));
  await dispatcher.append({ type: "pass.started", data: {} });

  const behind: EventEnvelope = {
    schema: SCHEMA,
    v: MAJOR,
    seq: 1,
    ts: "2026-10-01T00:00:00.000Z",
    type: "tool.call",
    runId: "run-ct134",
    launchId: "launch-ct134",
    data: {},
  } as EventEnvelope;
  const refused = await dispatcher.deliver(behind);
  await dispatcher.close();
  writer.close();

  assert.equal(refused.delivered, false);
  assert.equal(refused.reason, "out-of-order");
  assert.equal(one.seen.length, 1, "the sink saw only the event the writer wrote");
});

/* ------------------------------------------------------------------ *
 * 3. The redacted event, whole, with its `data`.
 * ------------------------------------------------------------------ */

test("CT-111-134/f: the sink receives the envelope whole, with its `data`", async () => {
  const dir = workdir();
  const file = join(dir, "events.jsonl");
  const writer = PrimaryWriter.open({ file, runId: "run-ct134", launchId: "launch-ct134" });
  const one = recorder("whole");
  const dispatcher = new EventDispatcher({ writer });
  dispatcher.register(one.sink);
  await dispatcher.open(context(dir));
  await dispatcher.append({
    type: "tool.call",
    role: "proposer",
    data: { tool: "Edit", argsRef: null, resultRef: null },
  });
  await dispatcher.close();
  writer.close();

  const seen = one.seen[0];
  assert.ok(seen !== undefined);
  const written = JSON.parse(
    readFileSync(file, "utf8").split("\n").filter(Boolean)[0] as string,
  ) as Record<string, unknown>;
  assert.deepEqual(
    { ...seen },
    written,
    "what the sink got equals the line of the primary file, field for field",
  );
  assert.equal(seen.role, "proposer", "an envelope field reaches the sink");
  assert.deepEqual(seen.data, { tool: "Edit", argsRef: null, resultRef: null });
});

test("CT-111-134/g: negative control — an event the ingress did not pass is not delivered", async () => {
  const dir = workdir();
  const writer = PrimaryWriter.open({
    file: join(dir, "events.jsonl"),
    runId: "run-ct134",
    launchId: "launch-ct134",
  });
  const one = recorder("unredacted");
  const dispatcher = new EventDispatcher({ writer });
  dispatcher.register(one.sink);
  await dispatcher.open(context(dir));

  const notRedacted = {
    schema: SCHEMA,
    v: MAJOR,
    seq: 1,
    ts: "2026-10-01T00:00:00.000Z",
    type: "tool.call",
    runId: "run-ct134",
    launchId: "launch-ct134",
    data: {},
  } as EventEnvelope;
  const outcome = await dispatcher.deliver(notRedacted, { passedTheIngress: false });
  await dispatcher.close();
  writer.close();

  assert.equal(outcome.delivered, false);
  assert.equal(outcome.reason, "not-redacted");
  assert.equal(one.seen.length, 0);
});

/* ------------------------------------------------------------------ *
 * 4. Declared majors, and the refusal outside the range.
 * ------------------------------------------------------------------ */

test("CT-111-134/h: a sink declares the range of majors it accepts", () => {
  assert.equal(currentEventMajor(), MAJOR);
  assert.equal(rangeHoldsTheCurrentMajor({ from: MAJOR, to: MAJOR }), true);
  assert.equal(rangeHoldsTheCurrentMajor({ from: MAJOR + 1, to: MAJOR + 2 }), false);
  assert.equal(rangeHoldsTheCurrentMajor(undefined), false);

  const accepted = registryCheck({ label: "in-range", acceptsMajors: { from: MAJOR, to: MAJOR } });
  assert.equal(accepted.accepted, true);
  assert.deepEqual([...accepted.findings], []);

  const undeclared = registryCheck({ label: "undeclared" });
  assert.equal(undeclared.accepted, false, "a sink that declares no range is refused");
  assert.equal(undeclared.findings[0]?.id, DOCTOR_FINDING_SINK_RANGE);
});

test("CT-111-134/i: a sink whose range does not hold the current major is refused with a doctor finding", async () => {
  const dir = workdir();
  const writer = PrimaryWriter.open({
    file: join(dir, "events.jsonl"),
    runId: "run-ct134",
    launchId: "launch-ct134",
  });
  const good = recorder("in-range");
  const bad = recorder("out-of-range", { from: MAJOR + 1, to: MAJOR + 1 });
  const dispatcher = new EventDispatcher({ writer });
  assert.equal(dispatcher.register(good.sink).accepted, true);
  const refusal = dispatcher.register(bad.sink);
  assert.equal(refusal.accepted, false);

  const finding = refusal.findings[0];
  assert.ok(finding !== undefined, "the refusal carries a doctor finding");
  assert.equal(finding.id, DOCTOR_FINDING_SINK_RANGE);
  assert.equal(finding.severity, DOCTOR_SEVERITY_SINK_RANGE);
  assert.ok(
    DOCTOR_SEVERITIES.includes(finding.severity),
    "the severity is a member of the closed set of feature 100",
  );
  assert.match(finding.message, /out-of-range/);
  assert.equal(REFUSAL_STOPS_THE_RUN, false);

  await dispatcher.open(context(dir));
  await dispatcher.append({ type: "pass.started", data: {} });
  await dispatcher.close();
  writer.close();

  assert.deepEqual(
    dispatcher.sinks.map((s) => s.label),
    ["in-range"],
    "the refused sink is not in the registry",
  );
  assert.equal(good.seen.length, 1);
  assert.equal(bad.seen.length, 0, "a refused sink receives no event");
  assert.deepEqual(
    dispatcher.doctorFindings.map((f) => f.id),
    [DOCTOR_FINDING_SINK_RANGE],
    "the finding is kept for the doctor and the run went on",
  );
});
