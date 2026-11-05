/**
 * T009 — CT-111-118: `seq` continuation and the torn last line (F111-FR-018),
 * and the measure F111-SC-007 (`seq` rises by one without a gap or a repeat in
 * 100 per cent of the event files, a relaunch included).
 *
 * F111-FR-018: *`seq` MUST rise by one, without gaps, from 1 for each run. A
 * writer that starts MUST read the last complete line of the file and continue
 * after it, whatever writer wrote it. Each event MUST be one line with a final
 * line end, written in one append. A reader MUST tolerate a torn last line. A
 * writer that finds a last line without a line end MUST begin its first event
 * on a new line.*
 *
 * Every claim is read back from the BYTES of a real file in a temporary
 * directory; the envelope of each complete line is parsed by `readEventLine` of
 * `@specstride/contracts`, which is feature 100's reader and knows nothing of
 * this package.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEventLine, seqIsWellFormed } from "@specstride/contracts/envelope/event";
import {
  FIRST_SEQ,
  LINE_END,
  continuationFor,
  continuationOf,
  encodeEventLine,
  readEvents,
  scanEventFile,
  scanEventText,
  seqIsGapless,
} from "../src/writer/seq.ts";
import { PrimaryWriter, appendLockPathOf } from "../src/writer/writer.ts";

function workdir(): string {
  return mkdtempSync(join(tmpdir(), "ct-111-118-"));
}

function line(seq: number, type = "commit.made"): string {
  return JSON.stringify({
    schema: "specstride.event",
    v: 1,
    seq,
    ts: "2026-10-01T00:00:00.000Z",
    type,
    runId: "run-ct-111-118",
    launchId: "launch-ct-111-118",
    data: {},
  });
}

/** The independent read path: the bytes, line by line, through feature 100's reader. */
function seqsOnDisk(file: string): number[] {
  const lines = readFileSync(file, "utf8")
    .split(LINE_END)
    .filter((l) => l.length > 0);
  const seqs: number[] = [];
  for (const [index, text] of lines.entries()) {
    const read = readEventLine(text, index === lines.length - 1);
    if (read.ok) seqs.push(read.event.seq);
  }
  return seqs;
}

function open(file: string, holder: string): PrimaryWriter {
  return PrimaryWriter.open({
    file,
    runId: "run-ct-111-118",
    launchId: "launch-ct-111-118",
    holder,
  });
}

/* ------------------------------------------------------------------ *
 * Gapless `seq` from 1 (F111-FR-018, F111-SC-007).
 * ------------------------------------------------------------------ */

test("CT-111-118 `seq` rises by one from 1, without a gap", () => {
  const file = join(workdir(), "events.jsonl");
  const writer = open(file, "writer-a");
  for (let i = 0; i < 5; i += 1) writer.append({ type: "commit.made", data: { phase: i } });
  writer.close();

  const seqs = seqsOnDisk(file);
  assert.deepEqual(seqs, [1, 2, 3, 4, 5]);
  assert.equal(seqs[0], FIRST_SEQ);
  assert.equal(seqIsGapless(seqs), true);
  // F111-SC-007 measured through feature 100's own oracle.
  assert.equal(
    seqIsWellFormed(seqs.map((seq) => ({ seq }))),
    true,
    "the event file is intact: `seq` rises by one without a gap or a repeat",
  );
  // Each event is one line with a final line end, written in one append.
  const bytes = readFileSync(file, "utf8");
  assert.equal(bytes.endsWith(LINE_END), true);
  assert.equal(bytes.split(LINE_END).filter((l) => l.length > 0).length, 5);
});

test("CT-111-118 a negative control: a file with a gap is not gapless", () => {
  assert.equal(seqIsGapless([1, 2, 4]), false, "a gap");
  assert.equal(seqIsGapless([1, 2, 2]), false, "a repeat");
  assert.equal(seqIsGapless([1, 3, 2]), false, "a fall");
  assert.equal(seqIsGapless([2, 3]), false, "`seq` starts at 1 for each run");
  assert.equal(seqIsGapless([]), true, "an empty file is intact");
});

/* ------------------------------------------------------------------ *
 * Continuation after a crash and after a relaunch.
 * ------------------------------------------------------------------ */

test("CT-111-118 a writer continues after the last complete line, whatever writer wrote it", () => {
  const file = join(workdir(), "events.jsonl");
  // Three lines written by a foreign writer: no writer of this package ran.
  writeFileSync(file, [line(1), line(2), line(3)].join(LINE_END) + LINE_END);
  assert.deepEqual(continuationFor(file), {
    nextSeq: 4,
    beginOnANewLine: false,
    tornLastLine: null,
  });
  const writer = open(file, "writer-a");
  writer.append({ type: "commit.made", data: { phase: 4 } });
  writer.close();
  assert.deepEqual(seqsOnDisk(file), [1, 2, 3, 4]);
});

test("CT-111-118 continuation after a RELAUNCH: the writer closed, a new one takes over", () => {
  const file = join(workdir(), "events.jsonl");
  const first = open(file, "launch-1");
  first.append({ type: "commit.made", data: { phase: 1 } });
  first.append({ type: "commit.made", data: { phase: 2 } });
  first.close();

  const second = open(file, "launch-2");
  assert.equal(
    second.nextSeq,
    3,
    "the relaunch read the last complete line and continues after it",
  );
  second.append({ type: "commit.made", data: { phase: 3 } });
  second.close();

  const seqs = seqsOnDisk(file);
  assert.deepEqual(seqs, [1, 2, 3]);
  assert.equal(seqIsWellFormed(seqs.map((seq) => ({ seq }))), true, "intact across a relaunch");
});

test("CT-111-118 continuation after a CRASH: the lock of a dead holder does not block the next writer", () => {
  const file = join(workdir(), "events.jsonl");
  const crashed = open(file, "engine-start-1");
  crashed.append({ type: "commit.made", data: { phase: 1 } });
  crashed.append({ type: "commit.made", data: { phase: 2 } });
  // The process died: the lock file stays behind, naming a pid that is gone.
  crashed.abandon();
  writeFileSync(
    appendLockPathOf(file),
    JSON.stringify({
      holder: "engine-start-1",
      pid: 2_147_483_646,
      at: "2026-10-01T00:00:00.000Z",
    }),
  );

  const next = open(file, "engine-start-2");
  assert.equal(next.nextSeq, 3, "the next writer continues after the last complete line");
  next.append({ type: "commit.made", data: { phase: 3 } });
  next.close();
  assert.deepEqual(seqsOnDisk(file), [1, 2, 3]);
});

/* ------------------------------------------------------------------ *
 * A torn last line, and the new line after it.
 * ------------------------------------------------------------------ */

test("CT-111-118 a reader tolerates a torn last line and skips it", () => {
  const file = join(workdir(), "events.jsonl");
  writeFileSync(file, [line(1), line(2)].join(LINE_END) + LINE_END);
  // The process died mid-append: half a line, no line end. It even LOOKS as
  // though it carries `seq` 99; the reader must not count it.
  appendFileSync(file, '{"schema":"specstride.event","v":1,"seq":99,"ts":"2026-');

  const scan = scanEventFile(file);
  assert.equal(scan.completeLines.length, 2);
  assert.equal(scan.endsWithLineEnd, false);
  assert.ok(scan.tornLastLine, "the torn tail is reported");
  assert.equal(scan.tornLastLine?.text.startsWith('{"schema"'), true);

  const read = readEvents(file);
  assert.deepEqual(
    read.events.map((e) => e.seq),
    [1, 2],
    "the torn last line is skipped, the run goes on",
  );
  assert.equal(read.lastCompleteSeq, 2);
  assert.deepEqual(
    read.skipped.map((s) => s.reason),
    ["torn"],
  );
  // The torn tail is TOLERATED: reading never throws and never fails the run.
  assert.doesNotThrow(() => readEvents(file));
});

test("CT-111-118 a writer that finds a last line without a line end begins on a NEW line", () => {
  const file = join(workdir(), "events.jsonl");
  writeFileSync(file, [line(1), line(2)].join(LINE_END) + LINE_END);
  const torn = '{"schema":"specstride.event","v":1,"seq":99,"ts":"2026-';
  appendFileSync(file, torn);

  const continuation = continuationFor(file);
  assert.equal(
    continuation.nextSeq,
    3,
    "`seq` continues after the last COMPLETE line, not after 99",
  );
  assert.equal(continuation.beginOnANewLine, true);

  const writer = open(file, "writer-after-the-tear");
  assert.equal(writer.nextSeq, 3);
  writer.append({ type: "commit.made", data: { phase: 3 } });
  writer.close();

  const bytes = readFileSync(file, "utf8");
  assert.equal(
    bytes.includes(`${torn}${LINE_END}{`),
    true,
    "the new event begins on a new line: a line end was written before it",
  );
  assert.equal(bytes.endsWith(LINE_END), true);
  // The torn remnant is still skipped; the new event is a complete line of its own.
  assert.deepEqual(seqsOnDisk(file), [1, 2, 3]);
  const after = readEvents(file);
  assert.deepEqual(
    after.events.map((e) => e.seq),
    [1, 2, 3],
  );
  assert.equal(after.tornLastLine, null, "the torn text is no longer the last line");
  assert.deepEqual(
    after.skipped.map((s) => s.reason),
    ["invalid"],
    "the remnant is now a line in the middle: it is skipped as unreadable, and the run goes on",
  );
});

test("CT-111-118 the scan of an empty and of a missing file starts at `seq` 1", () => {
  const dir = workdir();
  const missing = join(dir, "not-there.jsonl");
  assert.deepEqual(continuationFor(missing), {
    nextSeq: FIRST_SEQ,
    beginOnANewLine: false,
    tornLastLine: null,
  });
  const empty = join(dir, "empty.jsonl");
  writeFileSync(empty, "");
  assert.deepEqual(continuationFor(empty), {
    nextSeq: FIRST_SEQ,
    beginOnANewLine: false,
    tornLastLine: null,
  });
  assert.deepEqual(readEvents(missing).events, []);
});

test("CT-111-118 one event is one line with a final line end, in one append", () => {
  const encoded = encodeEventLine({ seq: 1, type: "commit.made" });
  assert.equal(encoded.endsWith(LINE_END), true);
  assert.equal(encoded.indexOf(LINE_END), encoded.length - 1, "exactly one line end, at the end");
  // A value that holds a line end is escaped by JSON, so one event stays one line.
  const risky = encodeEventLine({ seq: 2, type: "commit.made", data: { note: "a\nb" } });
  assert.equal(risky.indexOf(LINE_END), risky.length - 1);
  assert.equal(scanEventText(risky).completeLines.length, 1);
  assert.equal(continuationOf(scanEventText(risky)).nextSeq, 3);
});
