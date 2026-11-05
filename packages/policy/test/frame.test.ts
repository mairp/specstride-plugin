/**
 * T003 — the checkpoint test of phase 1: "the test frame runs a fake-clock
 * test". It exercises the five fakes of `support/` against the ports of
 * `../src/quota/ports.ts`, on the numbers of the pause that user story 1 uses,
 * so that the later phases can trust the frame they are written against.
 *
 * No module of feature 127 exists yet: this test drives the frame itself.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_START_MS,
  EVENT_TYPES,
  UnreadableFile,
  fakeClock,
  fakeEventWriter,
  fakeFileWriter,
  fixedRandom,
  testPorts,
} from "./support/index.ts";
import { PORTS } from "../src/quota/ports.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

test("the frame offers a fake for each of the five ports of the feature", () => {
  const ports = testPorts();
  assert.deepEqual([...PORTS], ["clock", "sleep", "random", "fileWriter", "eventWriter"]);
  for (const name of PORTS) {
    assert.notEqual(ports[name], undefined, `the frame has a fake for ${name}`);
  }
  // The clock and the sleep are one object: the fake sleep moves the clock the
  // test reads, so there is one timeline.
  assert.equal(ports.sleep, ports.clock);
});

test("the fake clock starts where the test says and reads both clocks apart", () => {
  const clock = fakeClock();
  assert.equal(clock.nowMs(), DEFAULT_START_MS);
  assert.equal(clock.nowIso(), "2026-01-01T00:00:00.000Z");

  const fromIso = fakeClock({ startMs: "2026-03-04T05:06:07.008Z" });
  assert.equal(fromIso.nowIso(), "2026-03-04T05:06:07.008Z");
  assert.throws(() => fakeClock({ startMs: "not a time" }), TypeError);
});

test("a five-hour pause is a fake-clock test: `advance` moves both readings", () => {
  const clock = fakeClock();
  const startedMs = clock.nowMs();
  const startedMonotonic = clock.monotonicMs();

  clock.advance(5 * HOUR);

  assert.equal(clock.nowMs() - startedMs, 5 * HOUR);
  assert.equal(clock.monotonicMs() - startedMonotonic, 5 * HOUR);
  assert.equal(clock.nowIso(), "2026-01-01T05:00:00.000Z");
  assert.throws(() => clock.advance(-1), RangeError);
  assert.throws(() => clock.advance(Number.POSITIVE_INFINITY), RangeError);
});

test("a clock change moves the wall reading only, which F127-FR-015 asks for", () => {
  const clock = fakeClock();
  const monotonicBefore = clock.monotonicMs();

  clock.jumpBy(24 * HOUR); // the machine woke with a different wall clock
  assert.equal(clock.nowIso(), "2026-01-02T00:00:00.000Z");
  assert.equal(
    clock.monotonicMs(),
    monotonicBefore,
    "a clock change never moves the monotonic reading",
  );

  clock.jumpTo("2026-01-01T00:00:00.000Z"); // and backwards
  assert.equal(clock.nowMs(), DEFAULT_START_MS);
  assert.equal(clock.monotonicMs(), monotonicBefore);
});

test("the fake sleep waits not at all, moves the clock, and records every call", async () => {
  const clock = fakeClock();
  const realStart = process.hrtime.bigint();

  await clock.sleep(5 * HOUR);
  await clock.sleep(0);
  await clock.sleep(-1);
  await clock.sleep(Number.NaN);

  const realElapsedMs = Number(process.hrtime.bigint() - realStart) / 1e6;
  assert.ok(realElapsedMs < 1_000, `a five-hour sleep took ${realElapsedMs} ms of real time`);

  assert.equal(
    clock.nowMs() - DEFAULT_START_MS,
    5 * HOUR,
    "only the positive sleep moved the clock",
  );
  assert.equal(clock.sleptMs(), 5 * HOUR);
  assert.deepEqual(
    clock.sleeps.map((call) => [call.askedMs, call.sleptMs]),
    [
      [5 * HOUR, 5 * HOUR],
      [0, 0],
      [-1, 0],
      [Number.NaN, 0],
    ],
  );
});

test("the fixed random source gives the jitter of `resumeAt` a test can assert", () => {
  // F127-FR-013: resumeAt = resetsAt + pause.marginMs + jitter of 0 to pause.jitterMs.
  const marginMs = 60_000;
  const jitterMs = 30_000;
  const resetsAtMs = DEFAULT_START_MS + 5 * HOUR;

  const halfway = fixedRandom(0.5);
  const resumeAt = resetsAtMs + marginMs + Math.floor(halfway.fraction() * jitterMs);
  assert.equal(resumeAt, resetsAtMs + 60_000 + 15_000);

  // Several fractions walk the list and then repeat it: one jitter per probe.
  const walking = fixedRandom(0, 0.25, 0.75);
  assert.deepEqual(
    [walking.fraction(), walking.fraction(), walking.fraction(), walking.fraction()],
    [0, 0.25, 0.75, 0],
  );
  assert.deepEqual([...walking.draws], [0, 0.25, 0.75, 0]);

  // The contract of the port is a fraction in [0, 1); a fake that broke it
  // would hide a bug in the module that scales it.
  assert.throws(() => fixedRandom(1), RangeError);
  assert.throws(() => fixedRandom(-0.1), RangeError);
});

test("the fake file writer keeps the order of writes and can be made unreadable", () => {
  const writer = fakeFileWriter({ "run:r1:spend.prev": "{}" });

  assert.equal(writer.exists("run:r1:spend"), false);
  writer.write("run:r1:spend.prev", '{"generation":1}');
  writer.write("run:r1:spend", '{"generation":2}');

  assert.deepEqual(
    writer.writes.map((call) => [call.path, call.replaced]),
    [
      ["run:r1:spend.prev", true],
      ["run:r1:spend", false],
    ],
    "the previous generation is written before the ledger",
  );
  assert.equal(writer.read("run:r1:spend"), '{"generation":2}');
  assert.deepEqual([...writer.paths()], ["run:r1:spend", "run:r1:spend.prev"]);

  // F127-FR-032: the unreadable ledger. The previous generation stays readable.
  writer.makeUnreadable("run:r1:spend");
  assert.throws(() => writer.read("run:r1:spend"), UnreadableFile);
  assert.equal(writer.exists("run:r1:spend"), true, "unreadable is not absent");
  assert.equal(writer.read("run:r1:spend.prev"), '{"generation":1}');
  writer.makeReadable("run:r1:spend");
  assert.equal(writer.read("run:r1:spend"), '{"generation":2}');

  // A write that fails leaves the store as it was.
  writer.failNextWrite("no space left on device");
  assert.throws(() => writer.write("run:r1:spend", '{"generation":3}'), /no space left/);
  assert.equal(writer.read("run:r1:spend"), '{"generation":2}');
  assert.throws(() => writer.read("run:r1:absent"), /no such file/);
});

test("the fake event writer keeps the order and refuses a type this feature does not emit", () => {
  const events = fakeEventWriter();

  events.emit({ type: "quota.signal", payload: { class: "quota_window" } });
  events.emit({ type: "run.paused", payload: { role: "proposer" } });
  events.emit({ type: "alert", payload: { kind: "billing-mode-change", level: "loud" } });
  events.emit({ type: "usage", payload: { usageId: "u1" } });

  assert.deepEqual([...events.types()], ["quota.signal", "run.paused", "alert", "usage"]);
  assert.equal(events.countOf("alert"), 1);
  assert.deepEqual(events.of("alert")[0].payload, { kind: "billing-mode-change", level: "loud" });

  assert.throws(
    () => events.emit({ type: "run.pasued", payload: {} }),
    /not an event type of feature 127/,
  );
  assert.ok((EVENT_TYPES as readonly string[]).includes("budget.exceeded"));

  const loose = fakeEventWriter({ strict: false });
  loose.emit({ type: "x.third.party", payload: {} });
  assert.deepEqual([...loose.types()], ["x.third.party"]);

  events.clear();
  assert.deepEqual([...events.types()], []);
});

test("the frame drives a pause end to end on the fake clock, spending no real time", async () => {
  // The shape of user story 1: a limit with a known reset time pauses, the
  // wait is a fake sleep, and the run resumes at resetsAt + margin + jitter.
  const ports = testPorts({ startMs: "2026-01-01T00:00:00.000Z", fractions: [0.5] });
  const marginMs = 60_000;
  const jitterMs = 30_000;
  const resetsAtMs = ports.clock.nowMs() + 5 * HOUR;

  const sinceMs = ports.clock.nowMs();
  const resumeAtMs = resetsAtMs + marginMs + Math.floor(ports.random.fraction() * jitterMs);
  ports.eventWriter.emit({
    type: "run.paused",
    payload: {
      role: "proposer",
      since: ports.clock.nowIso(),
      resumeAt: new Date(resumeAtMs).toISOString(),
    },
  });
  ports.fileWriter.write("run:r1:pause", JSON.stringify({ since: sinceMs, resumeAt: resumeAtMs }));

  await ports.sleep.sleep(resumeAtMs - ports.clock.nowMs());

  assert.equal(ports.clock.nowMs(), resumeAtMs);
  assert.equal(ports.clock.nowIso(), "2026-01-01T05:01:15.000Z");
  ports.eventWriter.emit({
    type: "run.resumed",
    payload: { pausedMs: ports.clock.nowMs() - sinceMs },
  });

  assert.deepEqual([...ports.eventWriter.types()], ["run.paused", "run.resumed"]);
  assert.equal(ports.eventWriter.of("run.resumed")[0].payload.pausedMs, 5 * HOUR + 75_000);
  assert.equal(ports.clock.sleptMs(), 5 * HOUR + 75_000);
  assert.equal(ports.fileWriter.exists("run:r1:pause"), true);
});
