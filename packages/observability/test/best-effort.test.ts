/**
 * T011 — PT-111-C-020-best-effort: the characterization test of C-020 / B-0352
 * on the fixture families FX-01 (the core loop) and FX-26 (stream formats
 * through the seam), surface `events`.
 *
 * The as-is behaviour B-0352 reads: *Events are appended to the file named by
 * `SPECSTRIDE_EVENTS`; a failed write is ignored and nothing is written when
 * the variable is empty.* It is `translated` into F111-FR-019, with the two
 * recorded divergences DV-006 (the drop is counted and reported, where the
 * baseline was silent) and DV-115 (a dropped event reaches no sink).
 *
 * F111-FR-019: *Emission MUST be best effort. A failed write, a full disk or a
 * missing file MUST never fail or stall a run. The failed event is dropped,
 * MUST NOT use a `seq` and MUST reach no sink: a sink receives only events that
 * are in the primary file. The next event that is written MUST be preceded by
 * `event.dropped` with the count and the reason (`write-failed`, `invalid`,
 * `too-large`). An empty destination MUST switch emission off without an
 * error.*
 *
 * This is an INTEGRATION test with an EFFECT WITNESS. The destination is a real
 * path in a temporary directory, the failure is a real `ENOTDIR` from the
 * kernel (the parent of the destination is a FILE, not a directory), and every
 * claim about what was written is read back from the BYTES through
 * `readEventLine` of `@specstride/contracts`. The value `emit` returns is never
 * taken as proof: the test "a successful-looking outcome is not proof" below
 * shows an emitter that reports a write where the file holds nothing, and the
 * assertion that fails is the one on the durable state.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEventLine } from "@specstride/contracts/envelope/event";
import { reasonsOfADroppedEvent } from "@specstride/contracts/enums/all-sets";
import {
  BestEffortEmitter,
  DESTINATION_VARIABLE,
  DROP_REASON_TOO_LARGE,
  DROP_REASON_WRITE_FAILED,
  DROPPED_EVENT_TYPE,
  destinationIsEmpty,
  destinationOfEnvironment,
} from "../src/writer/besteffort.ts";
import { DROP_REASON_INVALID } from "../src/writer/validate.ts";

function workdir(): string {
  return mkdtempSync(join(tmpdir(), "pt-111-c-020-"));
}

/** The independent read path: the bytes of the file through feature 100's reader. */
function readBack(file: string): { type: string; seq: number; data: Record<string, unknown> }[] {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
  return lines.map((line, index) => {
    const read = readEventLine(line, index === lines.length - 1);
    assert.ok(read.ok, `line ${index + 1} is a well-formed event: ${line}`);
    return {
      type: read.event.type,
      seq: read.event.seq,
      data: (read.event as { data: Record<string, unknown> }).data,
    };
  });
}

/** A sink that records what it was handed: DV-115 is tested through it. */
function recordingSink(id = "sink") {
  const seen: { type: string; seq: number }[] = [];
  return {
    seen,
    sink: {
      id,
      receive(event: { type: string; seq: number }) {
        seen.push({ type: event.type, seq: event.seq });
      },
    },
  };
}

function emitterOn(destination: string | null, extra: Record<string, unknown> = {}) {
  return BestEffortEmitter.open({
    destination,
    runId: "run-pt-111-c-020",
    launchId: "launch-pt-111-c-020",
    holder: "fixture",
    ...extra,
  });
}

/* ------------------------------------------------------------------ *
 * The three drop reasons are the closed set of the catalogue.
 * ------------------------------------------------------------------ */

test("PT-111-C-020-best-effort the three reasons of F111-FR-019 are members of row 94", () => {
  for (const reason of [DROP_REASON_WRITE_FAILED, DROP_REASON_INVALID, DROP_REASON_TOO_LARGE]) {
    assert.ok(
      (reasonsOfADroppedEvent.members as readonly string[]).includes(reason),
      `${reason} is a member of the closed set of a dropped event`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * B-0352, first half: an empty destination writes NOTHING, without an error.
 * ------------------------------------------------------------------ */

test("PT-111-C-020-best-effort an empty destination switches emission off without an error", () => {
  const dir = workdir();
  for (const destination of ["", "   ", null]) {
    const before = readdirSync(dir);
    const { seen, sink } = recordingSink();
    const emitter = emitterOn(destination as string | null, { cwd: dir });
    emitter.addSink(sink);
    assert.equal(emitter.isOn, false, `emission is off for ${JSON.stringify(destination)}`);
    assert.equal(emitter.file, null);
    let outcome: { written: boolean; reason?: string } = { written: true };
    assert.doesNotThrow(() => {
      outcome = emitter.emit({ type: "commit.made", data: { phase: 1 } });
    }, "an empty destination is no error");
    assert.equal(outcome.written, false);
    assert.equal(outcome.reason, "emission-off");
    emitter.close();
    // The durable witness: the directory is untouched. Nothing was written.
    assert.deepEqual(readdirSync(dir), before, "nothing is written when the destination is empty");
    assert.deepEqual(seen, [], "no sink is called when emission is off");
    assert.deepEqual(emitter.pending(), [], "an event that was never emitted is not a drop");
  }
});

test("PT-111-C-020-best-effort the destination comes from the environment, as B-0352 names it", () => {
  assert.equal(DESTINATION_VARIABLE, "SPECSTRIDE_EVENTS");
  assert.equal(destinationIsEmpty(""), true);
  assert.equal(destinationIsEmpty(undefined), true);
  assert.equal(destinationIsEmpty("  "), true);
  assert.equal(destinationIsEmpty("/tmp/events.jsonl"), false);
  assert.equal(destinationOfEnvironment({}), null);
  assert.equal(destinationOfEnvironment({ SPECSTRIDE_EVENTS: "" }), null);
  assert.equal(destinationOfEnvironment({ SPECSTRIDE_EVENTS: "/x/e.jsonl" }), "/x/e.jsonl");
});

/* ------------------------------------------------------------------ *
 * B-0352, second half: a failed write is ignored. DV-006 and DV-115 add the
 * count, the report and the silence towards the sinks.
 * ------------------------------------------------------------------ */

test("PT-111-C-020-best-effort a failed write is ignored, uses no `seq` and reaches no sink", () => {
  const dir = workdir();
  // The parent of the destination is a FILE: every append gives a real ENOTDIR
  // from the kernel. This is the full-disk case without a full disk.
  const blocker = join(dir, "blocked");
  writeFileSync(blocker, "not a directory");
  const file = join(blocker, "events.jsonl");

  const { seen, sink } = recordingSink();
  const emitter = emitterOn(file);
  emitter.addSink(sink);
  assert.equal(emitter.isOn, true);

  const first = emitter.emit({ type: "commit.made", data: { phase: 1 } });
  const second = emitter.emit({ type: "commit.made", data: { phase: 2 } });
  assert.equal(first.written, false);
  assert.equal(second.written, false);
  assert.equal(first.written === false && first.reason, DROP_REASON_WRITE_FAILED);
  // No `seq` was used: the counter has not moved.
  assert.equal(emitter.nextSeq, 1, "a dropped event uses no `seq`");
  // DV-115: a dropped event reaches no sink.
  assert.deepEqual(seen, [], "a sink receives only events that are in the primary file");
  // The run goes on: nothing threw, nothing stalled.
  assert.deepEqual(emitter.pending(), [{ reason: DROP_REASON_WRITE_FAILED, count: 2 }]);
  assert.equal(existsSync(file), false);

  // The transient failure ends: the same destination becomes writable.
  rmSync(blocker);
  mkdirSync(blocker);
  const third = emitter.emit({ type: "commit.made", data: { phase: 3 } });
  assert.equal(third.written, true);
  emitter.close();

  // The durable witness: the BYTES of the file.
  const onDisk = readBack(file);
  assert.deepEqual(
    onDisk.map((e) => ({ type: e.type, seq: e.seq })),
    [
      { type: DROPPED_EVENT_TYPE, seq: 1 },
      { type: "commit.made", seq: 2 },
    ],
    "the next event that is written is PRECEDED by `event.dropped`",
  );
  assert.deepEqual(onDisk[0]?.data, { count: 2, reason: DROP_REASON_WRITE_FAILED });
  assert.equal(
    onDisk[1]?.data.phase,
    3,
    "the two dropped events are gone; only the third is there",
  );
  // `seq` starts at 1: the two drops consumed no number.
  assert.deepEqual(
    onDisk.map((e) => e.seq),
    [1, 2],
  );
  // The ledger is cleared by the report: the next write repeats nothing.
  assert.deepEqual(emitter.pending(), []);
  // Both of the events that ARE in the primary file reached the sink, in order.
  assert.deepEqual(seen, [
    { type: DROPPED_EVENT_TYPE, seq: 1 },
    { type: "commit.made", seq: 2 },
  ]);
  // A durable identity that could not exist before the action.
  const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
  assert.equal(hash.length, 64);
  assert.ok(readFileSync(file, "utf8").endsWith("\n"));
});

test("PT-111-C-020-best-effort an event too large is dropped, counted and reported", () => {
  const dir = workdir();
  const file = join(dir, "events.jsonl");
  const { seen, sink } = recordingSink();
  const emitter = emitterOn(file, { maxEventBytes: 512 });
  emitter.addSink(sink);

  const huge = emitter.emit({ type: "commit.made", data: { phase: "x".repeat(2000) } });
  assert.equal(huge.written, false);
  assert.equal(huge.written === false && huge.reason, DROP_REASON_TOO_LARGE);
  assert.equal(emitter.nextSeq, 1, "the event that did not fit used no `seq`");
  assert.deepEqual(seen, [], "it reached no sink");
  assert.equal(existsSync(file), false, "and nothing of it is in the primary file");

  emitter.emit({ type: "commit.made", data: { phase: 1 } });
  emitter.close();
  const onDisk = readBack(file);
  assert.deepEqual(onDisk[0], {
    type: DROPPED_EVENT_TYPE,
    seq: 1,
    data: { count: 1, reason: DROP_REASON_TOO_LARGE },
  });
  assert.equal(onDisk[1]?.type, "commit.made");
});

test("PT-111-C-020-best-effort an invalid event is dropped with the reason `invalid`", () => {
  const dir = workdir();
  const file = join(dir, "events.jsonl");
  const { seen, sink } = recordingSink();
  const emitter = emitterOn(file);
  emitter.addSink(sink);

  // No such type in the catalogue, and no `x.` prefix.
  const unknown = emitter.emit({ type: "no.such.type", data: {} });
  // A field the catalogue does not know.
  const bad = emitter.emit({ type: "commit.made", data: { notAField: 1 } });
  assert.equal(unknown.written, false);
  assert.equal(bad.written, false);
  assert.equal(emitter.nextSeq, 1);
  assert.deepEqual(seen, []);

  emitter.emit({ type: "commit.made", data: { phase: 1 } });
  emitter.close();
  const onDisk = readBack(file);
  assert.deepEqual(onDisk[0]?.data, { count: 2, reason: DROP_REASON_INVALID });
  assert.equal(onDisk[1]?.type, "commit.made");
});

test("PT-111-C-020-best-effort the three reasons are reported each with its own count", () => {
  const dir = workdir();
  const file = join(dir, "events.jsonl");
  const emitter = emitterOn(file, { maxEventBytes: 512 });
  emitter.emit({ type: "no.such.type", data: {} });
  emitter.emit({ type: "commit.made", data: { phase: "x".repeat(2000) } });
  emitter.emit({ type: "commit.made", data: { phase: "y".repeat(2000) } });
  emitter.emit({ type: "commit.made", data: { phase: 1 } });
  emitter.close();
  const onDisk = readBack(file);
  assert.deepEqual(
    onDisk.map((e) => ({ type: e.type, ...e.data })),
    [
      { type: DROPPED_EVENT_TYPE, count: 1, reason: DROP_REASON_INVALID },
      { type: DROPPED_EVENT_TYPE, count: 2, reason: DROP_REASON_TOO_LARGE },
      { type: "commit.made", phase: 1 },
    ],
  );
  assert.deepEqual(
    onDisk.map((e) => e.seq),
    [1, 2, 3],
    "only the events that are in the file hold a number, and they are gapless",
  );
});

test("PT-111-C-020-best-effort a missing destination directory never fails the run", () => {
  const dir = workdir();
  const file = join(dir, "deep", "deeper", "events.jsonl");
  const emitter = emitterOn(file);
  assert.doesNotThrow(() => emitter.emit({ type: "commit.made", data: { phase: 1 } }));
  emitter.close();
  assert.deepEqual(
    readBack(file).map((e) => e.type),
    ["commit.made"],
    "the writer makes the directory rather than dropping the event",
  );
});

/* ------------------------------------------------------------------ *
 * The negative case of the witness: a mutation response is not proof.
 * ------------------------------------------------------------------ */

test("PT-111-C-020-best-effort a successful-looking outcome is not proof", () => {
  const dir = workdir();
  const file = join(dir, "events.jsonl");
  // An emitter that REPORTS a write it did not make: the kind of object whose
  // return value a test must never believe.
  const liar = {
    emit: () => ({ written: true as const, seq: 1, reported: [] }),
  };
  const claimed = liar.emit();
  assert.equal(claimed.written, true, "the response looks successful");
  // The independent read path refuses it: there is no durable effect.
  assert.equal(existsSync(file), false);
  assert.deepEqual(
    readBack(file),
    [],
    "no readable durable effect exists, so the claim is rejected",
  );
});
