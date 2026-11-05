/**
 * T015 — CT-111-122: learning has its own file, its own `seq` and its own lock
 * (F111-FR-022).
 *
 * F111-FR-022: *Learning MUST have its own writer domain, its own `seq` and
 * its own event file, `feature:<slug>:learning:events`, written by the learning
 * feature under the same envelope and the same ingress. The projection MUST
 * read that file as its own writer class.*
 *
 * "Its own domain" is tested as three independent things and not as one word:
 *
 *   - its own FILE: a different logical name, a different path, and the two
 *     streams hold disjoint events;
 *   - its own `seq`: the learning stream counts from 1 whatever the run stream
 *     has reached, and neither moves the other;
 *   - its own LOCK: the run's append lock does not block the learning writer,
 *     and the learning lock does not block the run — but a second learning
 *     writer on the same file IS blocked, so the domain has one writer too.
 *
 * "The same envelope and the same ingress" is tested by reading every learning
 * line back through `readEventLine` of `@specstride/contracts` and by sending
 * an invalid learning event through the same gate of T006.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOGICAL_NAME, readEventLine } from "@specstride/contracts/envelope/event";
import { CATALOGUE } from "../src/catalogue/index.ts";
import {
  LEARNING_LOGICAL_NAME,
  LEARNING_TYPES,
  LEARNING_TYPE_PREFIX,
  LEARNING_WRITER_CLASS,
  LearningWriter,
  MAIN_WRITER_CLASS,
  WRITER_CLASSES,
  isLearningType,
  learningEventsLogicalNameOf,
} from "../src/writer/learning.ts";
import { AppendLockHeld, PrimaryWriter, appendLockPathOf } from "../src/writer/writer.ts";

function workdir(): string {
  return mkdtempSync(join(tmpdir(), "ct-111-122-"));
}

function readBack(file: string): { type: string; seq: number }[] {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.length > 0);
  return lines.map((line, index) => {
    const read = readEventLine(line, index === lines.length - 1);
    assert.ok(read.ok, `line ${index + 1} carries the same envelope: ${line}`);
    return { type: read.event.type, seq: read.event.seq };
  });
}

/* ------------------------------------------------------------------ *
 * Its own file.
 * ------------------------------------------------------------------ */

test("CT-111-122 the learning stream has its own logical name", () => {
  assert.equal(LEARNING_LOGICAL_NAME, "feature:<slug>:learning:events");
  assert.notEqual(LEARNING_LOGICAL_NAME, LOGICAL_NAME);
  assert.equal(
    learningEventsLogicalNameOf("111-event-schema-and-projection"),
    "feature:111-event-schema-and-projection:learning:events",
  );
});

test("CT-111-122 the projection reads the learning file as its OWN writer class", () => {
  assert.equal(LEARNING_WRITER_CLASS, "learning");
  assert.equal(MAIN_WRITER_CLASS, "run");
  assert.notEqual(LEARNING_WRITER_CLASS, MAIN_WRITER_CLASS);
  assert.deepEqual([...WRITER_CLASSES], ["run", "learning"]);
});

test("CT-111-122 the learning types of the catalogue are the domain of the writer", () => {
  const fromTheCatalogue = CATALOGUE.filter((entry) =>
    entry.type.startsWith(LEARNING_TYPE_PREFIX),
  ).map((entry) => entry.type);
  assert.ok(fromTheCatalogue.length >= 4, "the catalogue holds the learning types");
  assert.deepEqual([...LEARNING_TYPES], fromTheCatalogue, "the list is read, not written twice");
  assert.equal(isLearningType("learning.knob_adjusted"), true);
  assert.equal(isLearningType("commit.made"), false);
});

test("CT-111-122 the two streams are different files and hold disjoint events", () => {
  const dir = workdir();
  const runFile = join(dir, "events.jsonl");
  const learningFile = join(dir, "learning", "events.jsonl");

  const run = PrimaryWriter.open({
    file: runFile,
    runId: "run-ct-111-122",
    launchId: "launch-ct-111-122",
    holder: "engine",
  });
  const learning = LearningWriter.open({
    file: learningFile,
    slug: "115-learning",
    runId: "run-ct-111-122",
    launchId: "launch-ct-111-122",
    holder: "learning-feature",
  });

  run.append({ type: "commit.made", data: { phase: 1 } });
  learning.append({ type: "learning.observed", data: { phase: 1, pathRef: "p" } });
  run.append({ type: "commit.made", data: { phase: 2 } });
  learning.append({ type: "learning.observed", data: { phase: 2, pathRef: "p" } });
  run.close();
  learning.close();

  assert.notEqual(runFile, learningFile);
  assert.deepEqual(readBack(runFile), [
    { type: "commit.made", seq: 1 },
    { type: "commit.made", seq: 2 },
  ]);
  assert.deepEqual(readBack(learningFile), [
    { type: "learning.observed", seq: 1 },
    { type: "learning.observed", seq: 2 },
  ]);
});

/* ------------------------------------------------------------------ *
 * Its own `seq`.
 * ------------------------------------------------------------------ */

test("CT-111-122 the learning `seq` counts from 1, whatever the run stream reached", () => {
  const dir = workdir();
  const runFile = join(dir, "events.jsonl");
  const learningFile = join(dir, "learning.jsonl");

  const run = PrimaryWriter.open({
    file: runFile,
    runId: "r",
    launchId: "l",
    holder: "engine",
  });
  for (let i = 0; i < 7; i += 1) run.append({ type: "commit.made", data: { phase: i } });
  assert.equal(run.nextSeq, 8);

  const learning = LearningWriter.open({
    file: learningFile,
    slug: "115-learning",
    runId: "r",
    launchId: "l",
    holder: "learning-feature",
  });
  assert.equal(learning.nextSeq, 1, "the learning domain counts from 1 of its own");
  learning.append({ type: "learning.observed", data: { phase: 1, pathRef: "p" } });
  assert.equal(learning.nextSeq, 2);
  assert.equal(run.nextSeq, 8, "the learning append moved nothing in the run stream");
  run.append({ type: "commit.made", data: { phase: 9 } });
  assert.equal(learning.nextSeq, 2, "and the run append moved nothing in the learning stream");
  run.close();
  learning.close();

  assert.deepEqual(
    readBack(learningFile).map((e) => e.seq),
    [1],
  );
  assert.deepEqual(
    readBack(runFile).map((e) => e.seq),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
});

/* ------------------------------------------------------------------ *
 * Its own lock.
 * ------------------------------------------------------------------ */

test("CT-111-122 the learning lock is its own: neither domain blocks the other", () => {
  const dir = workdir();
  const runFile = join(dir, "events.jsonl");
  const learningFile = join(dir, "learning.jsonl");

  const run = PrimaryWriter.open({ file: runFile, runId: "r", launchId: "l", holder: "engine" });
  const learning = LearningWriter.open({
    file: learningFile,
    slug: "115-learning",
    runId: "r",
    launchId: "l",
    holder: "learning-feature",
  });
  assert.notEqual(run.lockPath, learning.lockPath);
  assert.equal(learning.lockPath, appendLockPathOf(learningFile));
  assert.ok(existsSync(run.lockPath));
  assert.ok(existsSync(learning.lockPath));

  // A second LEARNING writer is refused: the domain has one writer too.
  assert.throws(
    () =>
      LearningWriter.open({
        file: learningFile,
        slug: "115-learning",
        runId: "r",
        launchId: "l",
        holder: "second-learning",
      }),
    AppendLockHeld,
  );
  // The run's writer is untouched by that refusal and goes on writing.
  run.append({ type: "commit.made", data: { phase: 1 } });
  learning.close();
  // With the learning lock free, the run still holds its own.
  assert.throws(
    () => PrimaryWriter.open({ file: runFile, runId: "r", launchId: "l", holder: "second-engine" }),
    AppendLockHeld,
  );
  run.close();
  assert.deepEqual(
    readBack(runFile).map((e) => e.type),
    ["commit.made"],
  );
});

/* ------------------------------------------------------------------ *
 * The same envelope and the same ingress.
 * ------------------------------------------------------------------ */

test("CT-111-122 the learning writer uses the same envelope and the same gate", () => {
  const dir = workdir();
  const file = join(dir, "learning.jsonl");
  const learning = LearningWriter.open({
    file,
    slug: "115-learning",
    runId: "r",
    launchId: "l",
    holder: "learning-feature",
  });
  // A type the catalogue does not know is refused by the same gate as the run.
  assert.equal(learning.emit({ type: "no.such.type", data: {} }).written, false);
  // A learning type with a field the catalogue does not know is refused too.
  assert.equal(learning.emit({ type: "learning.observed", data: { notAField: 1 } }).written, false);
  assert.deepEqual(learning.pending(), [{ reason: "invalid", count: 2 }]);
  assert.equal(learning.emit({ type: "learning.observed", data: { phase: 1 } }).written, true);
  learning.close();

  const onDisk = readBack(file);
  assert.deepEqual(onDisk, [
    { type: "event.dropped", seq: 1 },
    { type: "learning.observed", seq: 2 },
  ]);
});

test("CT-111-122 a type that is not of the learning domain is refused by the learning writer", () => {
  const file = join(workdir(), "learning.jsonl");
  const learning = LearningWriter.open({
    file,
    slug: "115-learning",
    runId: "r",
    launchId: "l",
    holder: "learning-feature",
    domainOnly: true,
  });
  const outcome = learning.emit({ type: "commit.made", data: { phase: 1 } });
  assert.equal(outcome.written, false, "the run's own events do not belong in the learning file");
  learning.close();
  assert.deepEqual(readBack(file), []);
});
