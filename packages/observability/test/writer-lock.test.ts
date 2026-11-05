/**
 * T007 — CT-111-117: the primary writer, one per run (F111-FR-017).
 *
 * F111-FR-017: *The primary file writer MUST be part of the core and MUST NOT
 * be replaceable. At any moment exactly one process MUST write the event file
 * of a run, as in F100-FR-005. The writer MUST give `seq` at the append, under
 * the append lock of the run, and MUST write the event to the primary file
 * before it calls any sink.*
 *
 * The four claims of CT-111-117 and how each is observed:
 *
 *   1. ONE WRITER — a second `PrimaryWriter` on the same file cannot open while
 *      the first holds the run's append lock, and a second OS PROCESS cannot
 *      either (the child below is a real `node` process, so "exactly one
 *      process" is tested and not asserted).
 *   2. `seq` UNDER THE APPEND LOCK — at the moment `seq` is given, the test
 *      probes the lock from outside the writer with `tryAcquireAppendLock` and
 *      finds it held. The probe is an independent read path: it does not ask
 *      the writer whether it holds its own lock.
 *   3. PRIMARY BEFORE SINKS — the sink reads the bytes of the primary file when
 *      it receives an event and finds its own line already there, parsed back
 *      through `readEventLine` of `@specstride/contracts`.
 *   4. CONTENTION — two candidate writers race; exactly one wins; the loser
 *      takes the file only after the winner closes, and `seq` then continues
 *      without a gap across the two writers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readEventLine } from "@specstride/contracts/envelope/event";
import {
  AppendLockHeld,
  PrimaryWriter,
  THE_PRIMARY_WRITER_IS_PART_OF_THE_CORE,
  THE_PRIMARY_WRITER_IS_REPLACEABLE,
  acquireAppendLock,
  appendLockPathOf,
  readAppendLockHolder,
  tryAcquireAppendLock,
} from "../src/writer/writer.ts";

const WRITER_MODULE = pathToFileURL(
  join(fileURLToPath(new URL("../src/writer/writer.ts", import.meta.url))),
).href;

function workdir(): string {
  return mkdtempSync(join(tmpdir(), "ct-111-117-"));
}

/** The independent read path: the bytes of the file through feature 100's reader. */
function readBack(file: string): { type: string; seq: number }[] {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
  return lines.map((line, index) => {
    const read = readEventLine(line, index === lines.length - 1);
    assert.ok(read.ok, `line ${index + 1} is a well-formed event: ${line}`);
    return { type: read.event.type, seq: read.event.seq };
  });
}

function open(file: string, holder: string): PrimaryWriter {
  return PrimaryWriter.open({
    file,
    runId: "run-ct-111-117",
    launchId: "launch-ct-111-117",
    holder,
  });
}

/* ------------------------------------------------------------------ *
 * 1. One writer.
 * ------------------------------------------------------------------ */

test("CT-111-117 the primary writer is core and is not replaceable", () => {
  assert.equal(THE_PRIMARY_WRITER_IS_PART_OF_THE_CORE, true);
  assert.equal(THE_PRIMARY_WRITER_IS_REPLACEABLE, false);
});

test("CT-111-117 a second writer of the same run cannot open while the first holds the lock", () => {
  const dir = workdir();
  const file = join(dir, "events.jsonl");
  const first = open(file, "writer-a");
  try {
    assert.equal(
      PrimaryWriter.tryOpen({ file, runId: "r", launchId: "l", holder: "writer-b" }),
      null,
    );
    assert.throws(() => open(file, "writer-b"), AppendLockHeld);
    // The lock names its holder, read from the lock file and not from the writer.
    assert.equal(readAppendLockHolder(appendLockPathOf(file)), "writer-a");
  } finally {
    first.close();
  }
  // Once the first closes, the second opens.
  const second = open(file, "writer-b");
  assert.equal(readAppendLockHolder(appendLockPathOf(file)), "writer-b");
  second.close();
  assert.equal(existsSync(appendLockPathOf(file)), false);
});

test("CT-111-117 exactly one PROCESS writes the event file of a run", () => {
  const dir = workdir();
  const file = join(dir, "events.jsonl");
  const held = open(file, "writer-in-this-process");
  const probe = [
    `const m = await import(${JSON.stringify(WRITER_MODULE)});`,
    `const w = m.PrimaryWriter.tryOpen({ file: ${JSON.stringify(file)}, runId: "r", launchId: "l", holder: "child" });`,
    `process.stdout.write(JSON.stringify({ opened: w !== null, holder: m.readAppendLockHolder(m.appendLockPathOf(${JSON.stringify(file)})) }));`,
  ].join("\n");
  try {
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
      encoding: "utf8",
    });
    const result = JSON.parse(out) as { opened: boolean; holder: string | null };
    assert.equal(result.opened, false, "a second OS process does not get the writer of the run");
    assert.equal(result.holder, "writer-in-this-process");
  } finally {
    held.close();
  }
  // The same child, with the lock free, does get it.
  const freed = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      [
        `const m = await import(${JSON.stringify(WRITER_MODULE)});`,
        `const w = m.PrimaryWriter.tryOpen({ file: ${JSON.stringify(file)}, runId: "r", launchId: "l", holder: "child" });`,
        `if (w) { w.append({ type: "commit.made", data: { phase: 1 } }); w.close(); }`,
        `process.stdout.write(JSON.stringify({ opened: w !== null }));`,
      ].join("\n"),
    ],
    { encoding: "utf8" },
  );
  assert.deepEqual(JSON.parse(freed), { opened: true });
  // The durable effect of the child, read back from the bytes of the file.
  assert.deepEqual(readBack(file), [{ type: "commit.made", seq: 1 }]);
});

/* ------------------------------------------------------------------ *
 * 2. `seq` is given at the append, under the append lock.
 * ------------------------------------------------------------------ */

test("CT-111-117 `seq` is given at the append and the lock is held at that moment", () => {
  const dir = workdir();
  const file = join(dir, "events.jsonl");
  const lockPath = appendLockPathOf(file);
  const observed: { seq: number; lockHeldByAnother: boolean; bytesBefore: number }[] = [];
  const writer = PrimaryWriter.open({
    file,
    runId: "run-ct-111-117",
    launchId: "launch-ct-111-117",
    holder: "writer-a",
    onSeqGiven: (seq) => {
      // An INDEPENDENT probe: can anyone else take the run's append lock now?
      const stolen = tryAcquireAppendLock(lockPath, "probe");
      if (stolen !== null) stolen.release();
      observed.push({
        seq,
        lockHeldByAnother: stolen === null,
        bytesBefore: existsSync(file) ? statSync(file).size : 0,
      });
    },
  });
  writer.append({ type: "commit.made", data: { phase: 1 } });
  writer.append({ type: "commit.made", data: { phase: 2 } });
  writer.close();

  assert.equal(observed.length, 2);
  assert.deepEqual(
    observed.map((o) => o.seq),
    [1, 2],
    "`seq` is given at the append, rising from 1",
  );
  assert.ok(
    observed.every((o) => o.lockHeldByAnother),
    "the append lock of the run is held at the moment `seq` is given",
  );
  // The seq is given BEFORE the bytes are on disk: nothing of this event is in
  // the file yet when its number is taken.
  assert.equal(observed[0]?.bytesBefore, 0);
  assert.deepEqual(
    readBack(file).map((e) => e.seq),
    [1, 2],
  );
});

/* ------------------------------------------------------------------ *
 * 3. The primary file is written before any sink is called.
 * ------------------------------------------------------------------ */

test("CT-111-117 the event is in the primary file before any sink is called", () => {
  const dir = workdir();
  const file = join(dir, "events.jsonl");
  const order: string[] = [];
  const seenByTheSink: { seq: number; inTheFile: boolean; fileSeqs: number[] }[] = [];
  const writer = PrimaryWriter.open({
    file,
    runId: "run-ct-111-117",
    launchId: "launch-ct-111-117",
    holder: "writer-a",
    onSeqGiven: (seq) => order.push(`seq:${seq}`),
  });
  writer.addSink({
    id: "sink-one",
    receive(event) {
      order.push(`sink-one:${event.seq}`);
      const inTheFile = readBack(file);
      seenByTheSink.push({
        seq: event.seq,
        inTheFile: inTheFile.some((e) => e.seq === event.seq),
        fileSeqs: inTheFile.map((e) => e.seq),
      });
    },
  });
  writer.addSink({
    id: "sink-two",
    receive(event) {
      order.push(`sink-two:${event.seq}`);
    },
  });
  writer.append({ type: "commit.made", data: { phase: 1 } });
  writer.append({ type: "commit.made", data: { phase: 2 } });
  writer.close();

  assert.deepEqual(order, [
    "seq:1",
    "sink-one:1",
    "sink-two:1",
    "seq:2",
    "sink-one:2",
    "sink-two:2",
  ]);
  assert.ok(
    seenByTheSink.every((s) => s.inTheFile),
    `every sink call saw its own event already in the primary file: ${JSON.stringify(seenByTheSink)}`,
  );
  assert.deepEqual(seenByTheSink[0]?.fileSeqs, [1]);
  assert.deepEqual(seenByTheSink[1]?.fileSeqs, [1, 2]);
});

test("CT-111-117 a sink that throws does not stop the primary file or the other sinks", () => {
  const dir = workdir();
  const file = join(dir, "events.jsonl");
  const reached: string[] = [];
  const writer = open(file, "writer-a");
  writer.addSink({
    id: "angry",
    receive() {
      reached.push("angry");
      throw new Error("the sink is down");
    },
  });
  writer.addSink({
    id: "calm",
    receive() {
      reached.push("calm");
    },
  });
  assert.doesNotThrow(() => writer.append({ type: "commit.made", data: { phase: 1 } }));
  writer.close();
  assert.deepEqual(reached, ["angry", "calm"]);
  assert.deepEqual(readBack(file), [{ type: "commit.made", seq: 1 }]);
});

/* ------------------------------------------------------------------ *
 * 4. Contention with two candidate writers.
 * ------------------------------------------------------------------ */

test("CT-111-117 two candidate writers contend: exactly one wins", () => {
  const dir = workdir();
  const file = join(dir, "events.jsonl");
  const lockPath = appendLockPathOf(file);
  const candidates = ["candidate-a", "candidate-b"];
  const won = candidates
    .map((holder) => ({ holder, lock: tryAcquireAppendLock(lockPath, holder) }))
    .filter((c) => c.lock !== null);
  assert.equal(won.length, 1, "exactly one candidate holds the append lock");
  assert.equal(readAppendLockHolder(lockPath), won[0]?.holder);
  // The winner is the one that may write; the loser waits and gets a refusal
  // rather than a second stream.
  assert.throws(
    () => acquireAppendLock(lockPath, "candidate-loser", { attempts: 2, waitMs: 1 }),
    AppendLockHeld,
  );
  won[0]?.lock?.release();
  const later = acquireAppendLock(lockPath, "candidate-loser", { attempts: 2, waitMs: 1 });
  assert.equal(readAppendLockHolder(lockPath), "candidate-loser");
  later.release();
});

test("CT-111-117 `seq` continues without a gap when the second candidate takes over", () => {
  const dir = workdir();
  const file = join(dir, "events.jsonl");
  const first = open(file, "candidate-a");
  first.append({ type: "commit.made", data: { phase: 1 } });
  first.append({ type: "commit.made", data: { phase: 2 } });
  assert.throws(() => open(file, "candidate-b"), AppendLockHeld);
  first.close();

  const second = open(file, "candidate-b");
  second.append({ type: "commit.made", data: { phase: 3 } });
  second.close();

  const events = readBack(file);
  assert.deepEqual(
    events.map((e) => e.seq),
    [1, 2, 3],
    "the second writer continued after the last complete line of the first",
  );
});
