/**
 * T019 — CT-111-104 and CT-111-105: the pairs and the terminal event
 * (F111-FR-004, F111-FR-005), and the measure F111-SC-002 (every engine start
 * ends on record, those that end by a kill included).
 *
 * F111-FR-004: *Every event whose type opens something MUST have a partner
 * that closes it, as in the table "Pairs" of the catalogue. The span of an
 * exporter MUST be built from the pair at the moment of emission. Where a
 * process died before it wrote a closer, the next writer MUST write the
 * closers, marked `synthesized: true` with the cause of the death, innermost
 * first, before any new event.*
 *
 * F111-FR-005: *Every engine start MUST end on record... A `run.ended` that
 * the engine start wrote itself MUST carry as `endCause` the `cause` of its
 * terminal record, a member of `normal`, `crash`, `owner-lost` (annex X §X.6
 * row 5)... the next writer writes `run.ended` with `synthesized: true` and an
 * `endCause` of `crash`, `host_exit` or `operator_stop` (row 96)... The `data`
 * field is named `endCause` and not `cause`... Liveness MUST never be an
 * event: no heartbeat is written.*
 *
 * This is an INTEGRATION test with an EFFECT WITNESS. The crash is a real
 * writer that stops mid-stream and abandons its lock; the NEXT writer is a
 * second object that reads the file from disk, finds what is open and writes
 * the closers. Every claim is read back from the bytes through `readEventLine`
 * of `@specstride/contracts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEventLine } from "@specstride/contracts/envelope/event";
import { closedSet } from "@specstride/contracts/enums/all-sets";
import { CATALOGUE, PAIRS } from "../src/catalogue/index.ts";
import {
  CRASH,
  ENGINE_WRITTEN_END_CAUSES,
  LIVENESS_IS_AN_EVENT,
  PAIR_TABLE,
  RUN_ENDED,
  RUN_ENDED_CAUSE_FIELD,
  RUN_STARTED,
  SYNTHESIZED_END_CAUSES,
  SYNTHESIZED_FIELD,
  closeAllOpenSpans,
  closerOf,
  endCauseSetFor,
  engineStartsOnRecord,
  heartbeatTypes,
  openSpans,
  openerOf,
  pairFindings,
  synthesizedClosersFor,
} from "../src/writer/pairs.ts";
import { PrimaryWriter, appendLockPathOf } from "../src/writer/writer.ts";

/**
 * What a crash leaves behind: the writer stops mid-stream and its lock file
 * stays, naming a process that is gone. The next writer reclaims it as stale,
 * which is the only way a run survives the death of its engine.
 */
function died(writer: PrimaryWriter, file: string): void {
  writer.abandon();
  writeFileSync(
    appendLockPathOf(file),
    JSON.stringify({
      holder: "the dead engine",
      pid: 2_147_483_646,
      at: "2026-10-01T00:00:00.000Z",
    }),
  );
}

function workdir(): string {
  return mkdtempSync(join(tmpdir(), "ct-111-104-"));
}

type Line = Record<string, unknown> & { seq: number; type: string; data: Record<string, unknown> };

function readBack(file: string): Line[] {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.length > 0);
  return lines.map((line, index) => {
    const read = readEventLine(line, index === lines.length - 1);
    assert.ok(read.ok, `line ${index + 1} is a well-formed event: ${line}`);
    return JSON.parse(line) as Line;
  });
}

function open(file: string, holder: string, launchId: string): PrimaryWriter {
  return PrimaryWriter.open({
    file,
    runId: "run-ct-111-104",
    launchId,
    holder,
  });
}

/* ------------------------------------------------------------------ *
 * CT-111-104 — every opener has its closer.
 * ------------------------------------------------------------------ */

test("CT-111-104 the pair table is the catalogue's, and every opener has a closer", () => {
  assert.deepEqual([...PAIR_TABLE], [...PAIRS], "the table is read, not written twice");
  assert.ok(PAIR_TABLE.length >= 15);
  for (const pair of PAIR_TABLE) {
    assert.ok(pair.close.length > 0, `${pair.open} names its closer`);
    assert.equal(closerOf(pair.open), pair.close);
    assert.equal(openerOf(pair.close), pair.open);
  }
  // Every row of the catalogue that is an opener or a closer is in the table,
  // and no instant is.
  for (const entry of CATALOGUE) {
    if (entry.kind === "open") assert.equal(closerOf(entry.type), entry.partner);
    if (entry.kind === "close") assert.equal(openerOf(entry.type), entry.partner);
    if (entry.kind === "instant") {
      assert.equal(closerOf(entry.type), undefined);
      assert.equal(openerOf(entry.type), undefined);
    }
  }
  assert.equal(closerOf(RUN_STARTED), RUN_ENDED);
});

test("CT-111-104 a sound, nested stream has no open span", () => {
  const events = [
    { type: "run.started", seq: 1 },
    { type: "phase.started", seq: 2 },
    { type: "attempt.started", seq: 3 },
    { type: "pass.started", seq: 4 },
    { type: "pass.ended", seq: 5 },
    { type: "attempt.ended", seq: 6 },
    { type: "phase.ended", seq: 7 },
    { type: "run.ended", seq: 8 },
  ];
  assert.deepEqual(openSpans(events), []);
  assert.deepEqual(pairFindings(events), []);
});

test("CT-111-104 a closer without its opener is a finding", () => {
  const findings = pairFindings([
    { type: "pass.started", seq: 1 },
    { type: "attempt.ended", seq: 2 },
  ]);
  assert.ok(findings.some((f) => f.includes("attempt.ended")));
});

test("CT-111-104 the synthesized closers are INNERMOST FIRST", () => {
  const events = [
    { type: "run.started", seq: 1 },
    { type: "phase.started", seq: 2 },
    { type: "attempt.started", seq: 3 },
    { type: "pass.started", seq: 4 },
  ];
  // Open, outermost first: that is the order a reader sees them opened in.
  assert.deepEqual(
    openSpans(events).map((s) => s.type),
    ["run.started", "phase.started", "attempt.started", "pass.started"],
  );
  // Closed, innermost first: the reverse.
  const closers = synthesizedClosersFor(events, { cause: CRASH });
  assert.deepEqual(
    closers.map((c) => c.type),
    ["pass.ended", "attempt.ended", "phase.ended", "run.ended"],
    "the open pass is closed first and the engine start last",
  );
  for (const closer of closers) {
    assert.equal(
      (closer.data as Record<string, unknown>)[SYNTHESIZED_FIELD],
      true,
      `${closer.type} is marked synthesized`,
    );
    assert.equal(closer.cause, undefined, "the ENVELOPE `cause` is the link, not the reason");
  }
  // Each closer names the `seq` of the opener it closes, through the envelope
  // field `cause`, which is exactly what that field is for.
  assert.deepEqual(
    closers.map((c) => c.closes),
    [4, 3, 2, 1],
  );
});

test("CT-111-104 the next writer writes the closers BEFORE any new event", () => {
  const dir = workdir();
  const file = join(dir, "events.jsonl");

  // The engine start that dies: it opens four spans and never closes them.
  const dying = open(file, "engine-1", "launch-1");
  dying.append({ type: "run.started", data: { workdir: "/w", phases: 3 } });
  dying.append({ type: "phase.started", data: { phase: 3, title: "US1" } });
  dying.append({
    type: "attempt.started",
    strategy: "classic",
    data: { phase: 3, attempt: 1, kind: "plain" },
  });
  dying.append({ type: "pass.started", strategy: "classic", data: { iter: 1, sessionId: "s" } });
  died(dying, file); // the process died: no closer, and the lock is left behind

  // The NEXT writer: a second object that reads the file from disk.
  const next = open(file, "engine-2", "launch-2");
  const written = closeAllOpenSpans(next, { cause: CRASH, exitCode: 137, stopReason: "killed" });
  assert.equal(written.length, 4);
  // Only after the closers does the new launch write anything of its own.
  next.append({ type: "run.launched", data: { reason: "relaunch", countsCarried: true } });
  next.close();

  const onDisk = readBack(file);
  assert.deepEqual(
    onDisk.map((e) => e.type),
    [
      "run.started",
      "phase.started",
      "attempt.started",
      "pass.started",
      "pass.ended",
      "attempt.ended",
      "phase.ended",
      "run.ended",
      "run.launched",
    ],
    "innermost first, and all four before the first new event",
  );
  assert.deepEqual(
    onDisk.map((e) => e.seq),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  for (const event of onDisk.slice(4, 8)) {
    assert.equal(event.data[SYNTHESIZED_FIELD], true);
  }
  assert.equal(
    onDisk[8]?.data[SYNTHESIZED_FIELD],
    undefined,
    "the new event of the new launch is not synthesized",
  );
  // The stream is sound again: nothing is left open.
  assert.deepEqual(openSpans(onDisk), []);
  assert.deepEqual(pairFindings(onDisk), []);
});

/* ------------------------------------------------------------------ *
 * CT-111-105 — every engine start ends on record (F111-SC-002).
 * ------------------------------------------------------------------ */

test("CT-111-105 the two end-cause sets are rows 5 and 96, and the flag says which", () => {
  assert.deepEqual([...ENGINE_WRITTEN_END_CAUSES], ["normal", "crash", "owner-lost"]);
  assert.deepEqual([...SYNTHESIZED_END_CAUSES], [...(closedSet(96)?.members ?? [])]);
  assert.deepEqual([...SYNTHESIZED_END_CAUSES], ["crash", "host_exit", "operator_stop"]);
  // The members of row 5 that an engine says of its own end are a subset of
  // the row; the sets do not compete, and `crash` means the same in both.
  for (const member of ENGINE_WRITTEN_END_CAUSES) {
    assert.ok((closedSet(5)?.members ?? []).includes(member), `${member} is of row 5`);
  }
  assert.ok(ENGINE_WRITTEN_END_CAUSES.includes("crash"));
  assert.ok(SYNTHESIZED_END_CAUSES.includes("crash"));
  assert.deepEqual([...endCauseSetFor(false)], [...ENGINE_WRITTEN_END_CAUSES]);
  assert.deepEqual([...endCauseSetFor(true)], [...SYNTHESIZED_END_CAUSES]);
});

test("CT-111-105 the `data` field is `endCause`, and no type has a `data` field `cause`", () => {
  assert.equal(RUN_ENDED_CAUSE_FIELD, "endCause");
  const entry = CATALOGUE.find((e) => e.type === RUN_ENDED);
  assert.ok(entry);
  assert.ok(entry.dataFields.includes("endCause"));
  for (const row of CATALOGUE) {
    assert.equal(
      row.dataFields.includes("cause"),
      false,
      `${row.type} has no \`data\` field named cause: the envelope field means the link`,
    );
  }
});

test("CT-111-105 a `run.ended` the ENGINE wrote carries an `endCause` of row 5", () => {
  const file = join(workdir(), "events.jsonl");
  const writer = open(file, "engine-1", "launch-1");
  writer.append({ type: "run.started", data: { workdir: "/w", phases: 1 } });
  writer.append({
    type: RUN_ENDED,
    data: {
      outcome: "approved",
      endCause: "normal",
      stopReason: "all-approved",
      exitCode: 0,
    },
  });
  writer.close();

  const onDisk = readBack(file);
  const ended = onDisk.at(-1);
  assert.ok(ended);
  assert.equal(ended.type, RUN_ENDED);
  assert.equal(ended.data[SYNTHESIZED_FIELD], undefined, "the engine wrote it itself");
  assert.ok(
    ENGINE_WRITTEN_END_CAUSES.includes(ended.data.endCause as string),
    "the `endCause` is a member of row 5",
  );
  // It carries the stop reason and the exit code of the terminal record.
  assert.equal(ended.data.stopReason, "all-approved");
  assert.equal(ended.data.exitCode, 0);
  assert.deepEqual(engineStartsOnRecord(onDisk), { starts: 1, onRecord: 1, missing: [] });
});

test("CT-111-105 a SYNTHESIZED `run.ended` carries an `endCause` of row 96", () => {
  const file = join(workdir(), "events.jsonl");
  const dying = open(file, "engine-1", "launch-1");
  dying.append({ type: "run.started", data: { workdir: "/w", phases: 1 } });
  died(dying, file);

  const next = open(file, "engine-2", "launch-2");
  closeAllOpenSpans(next, { cause: CRASH, exitCode: 137, stopReason: "killed" });
  next.close();

  const ended = readBack(file).at(-1);
  assert.ok(ended);
  assert.equal(ended.type, RUN_ENDED);
  assert.equal(ended.data[SYNTHESIZED_FIELD], true);
  assert.equal(ended.data.endCause, "crash");
  assert.ok(
    SYNTHESIZED_END_CAUSES.includes(ended.data.endCause as string),
    "the `endCause` is a member of row 96",
  );
  assert.equal(ended.data.stopReason, "killed");
  assert.equal(ended.data.exitCode, 137);
});

test("CT-111-105 a cause that is of no set is refused, each way round", () => {
  assert.throws(
    () => synthesizedClosersFor([{ type: "run.started", seq: 1 }], { cause: "normal" }),
    /row 96/,
    "`normal` is what an engine says of its own end; a synthesis cannot claim it",
  );
  assert.throws(
    () => synthesizedClosersFor([{ type: "run.started", seq: 1 }], { cause: "made-up" }),
    /row 96/,
  );
  for (const cause of SYNTHESIZED_END_CAUSES) {
    assert.doesNotThrow(() => synthesizedClosersFor([{ type: "run.started", seq: 1 }], { cause }));
  }
});

test("CT-111-105 F111-SC-002: every engine start ends on record, the killed one included", () => {
  const file = join(workdir(), "events.jsonl");

  // Engine start 1: ends normally.
  const first = open(file, "engine-1", "launch-1");
  first.append({ type: "run.started", engineStartId: "e-1", data: { workdir: "/w", phases: 1 } });
  first.append({
    type: RUN_ENDED,
    engineStartId: "e-1",
    data: { outcome: "approved", endCause: "normal", stopReason: "all-approved", exitCode: 0 },
  });
  first.close();

  // Engine start 2: killed in the middle of a pass.
  const killed = open(file, "engine-2", "launch-2");
  killed.append({ type: "run.started", engineStartId: "e-2", data: { workdir: "/w", phases: 1 } });
  killed.append({
    type: "pass.started",
    engineStartId: "e-2",
    strategy: "classic",
    data: { iter: 1 },
  });
  died(killed, file);

  // Engine start 3 finds the dead one and closes it before anything of its own.
  const third = open(file, "engine-3", "launch-3");
  closeAllOpenSpans(third, { cause: CRASH, exitCode: 137, stopReason: "killed" });
  third.append({ type: "run.started", engineStartId: "e-3", data: { workdir: "/w", phases: 1 } });
  third.append({
    type: RUN_ENDED,
    engineStartId: "e-3",
    data: { outcome: "approved", endCause: "normal", stopReason: "all-approved", exitCode: 0 },
  });
  third.close();

  const onDisk = readBack(file);
  const measure = engineStartsOnRecord(onDisk);
  assert.deepEqual(measure, { starts: 3, onRecord: 3, missing: [] });
  assert.equal(
    (measure.onRecord / measure.starts) * 100,
    100,
    "F111-SC-002: 100 per cent of the engine starts have a terminal event",
  );
  // And the one that was killed has it by synthesis.
  const forTheKilled = onDisk.filter((e) => e.type === RUN_ENDED && e.engineStartId === "e-2");
  assert.equal(forTheKilled.length, 1);
  assert.equal(forTheKilled[0]?.data[SYNTHESIZED_FIELD], true);
});

test("CT-111-105 an engine start with no terminal event is reported as missing", () => {
  const measure = engineStartsOnRecord([
    { type: "run.started", seq: 1, engineStartId: "e-1" },
    { type: "run.ended", seq: 2, engineStartId: "e-1" },
    { type: "run.started", seq: 3, engineStartId: "e-2" },
  ]);
  assert.deepEqual(measure, { starts: 2, onRecord: 1, missing: ["e-2"] });
});

/* ------------------------------------------------------------------ *
 * CT-111-105 — liveness is never an event.
 * ------------------------------------------------------------------ */

test("CT-111-105 no heartbeat: liveness is never an event", () => {
  assert.equal(LIVENESS_IS_AN_EVENT, false);
  assert.deepEqual(
    [...heartbeatTypes()],
    [],
    "the catalogue holds no heartbeat, ping, alive or liveness type",
  );
  // The whole catalogue, checked by name: nothing that would be a heartbeat.
  for (const entry of CATALOGUE) {
    assert.doesNotMatch(entry.type, /heartbeat|liveness|\bping\b|keepalive|alive/);
  }
});
