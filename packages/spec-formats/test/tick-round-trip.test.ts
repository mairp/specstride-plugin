/**
 * T047 — CT-104-5, the round trip of `tick` (F104-FR-017).
 *
 * Five claims, each measured on the FILE and not on the return value:
 *
 *   1. a tick changes CHECKBOX BYTES ONLY — the two byte strings have the same
 *      length and differ in exactly the mark positions;
 *   2. a SECOND tick changes 0 lines;
 *   3. the file MODE is kept;
 *   4. NOTHING is written when no line changed — measured by the modification
 *      time, which any rewrite would move, and by the inode;
 *   5. a FAILED tick leaves the file as it was.
 *
 * The fifth claim has two failure classes and both are here. A failure BEFORE
 * the write (the file cannot be read, or the grammar throws) leaves the file
 * alone because nothing was written at all. A failure DURING the write is the
 * interesting one: the write goes through the atomic write of feature 100,
 * which opens a temporary name in the same directory with `wx`, fsyncs and
 * renames. The test makes that `openSync` fail by occupying the temporary name
 * — the attempt counter is pinned, so the name is known — and then measures
 * that the target still holds its old bytes and its old mode. A reader
 * therefore never sees a half-ticked file: either the old bytes or the new.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWrite, isTemporaryName, temporaryNameFor } from "@specstride/kernel/atomic-write";
import { MARK_WRITTEN_BY_TICK, type SpecGrammar } from "../src/model.ts";
import {
  WRITES_NOTHING_WHEN_NO_LINE_CHANGED,
  countPrintedBy,
  tickFile,
  tickText,
} from "../src/tick.ts";
import { grammarOf } from "../src/adapters/index.ts";

/**
 * The task list the round trip runs over. Every line is one a rule of
 * F104-FR-017 has something to say about: a plain unticked task, one already
 * ticked, an indented one, an empty box, a checkbox with no text, one with no
 * task id, one under a level-3 heading, and a task of a second phase.
 */
const TASKS = [
  "# Tasks",
  "",
  "## Phase 1: Setup",
  "",
  "- [ ] T001 [P] a plain unticked task",
  "- [x] T002 already ticked",
  "  - [ ] T003 an indented task",
  "- [] T004 an empty box",
  "- [ ]",
  "- [ ] a checkbox with no task id",
  "",
  "### A level-3 heading does not end the section",
  "",
  "- [ ] T005 under a level-3 heading",
  "",
  "## Phase 2: Next",
  "",
  "- [ ] T010 a task of the next phase",
  "",
].join("\n");

/** The 1-based line numbers a tick of phase 1 changes, and no others. */
const CHANGED_BY_PHASE_1 = Object.freeze([5, 7, 10, 14]);

/** A throw-away directory with one task list in it, removed by the caller. */
function workspace(content = TASKS): {
  readonly directory: string;
  readonly path: string;
  readonly remove: () => void;
} {
  const directory = mkdtempSync(join(tmpdir(), "ss104-tick-"));
  const path = join(directory, "tasks.md");
  writeFileSync(path, content);
  return {
    directory,
    path,
    remove: () => rmSync(directory, { recursive: true, force: true }),
  };
}

/** The state of a file that a tick must either keep or change by marks alone. */
function stateOf(path: string): {
  readonly bytes: Buffer;
  readonly mode: number;
  readonly mtimeMs: number;
  readonly ino: number;
  readonly size: number;
} {
  const stat = statSync(path);
  return {
    bytes: readFileSync(path),
    mode: stat.mode & 0o7777,
    mtimeMs: stat.mtimeMs,
    ino: stat.ino,
    size: stat.size,
  };
}

/** The byte positions at which two equal-length byte strings differ. */
function differingPositions(before: Buffer, after: Buffer): readonly number[] {
  assert.equal(after.length, before.length, "a tick adds and removes no byte");
  const found: number[] = [];
  for (let index = 0; index < after.length; index += 1) {
    if (after[index] !== before[index]) found.push(index);
  }
  return found;
}

test("CT-104-5: a tick changes CHECKBOX BYTES ONLY", () => {
  const ws = workspace();
  try {
    chmodSync(ws.path, 0o640);
    const before = stateOf(ws.path);

    const result = tickFile({ path: ws.path, format: "speckit-tasks", request: { phase: 1 } });
    assert.equal(result.changed, 4);
    assert.deepEqual(result.lines, CHANGED_BY_PHASE_1);
    assert.deepEqual(result.taskIds, ["T001", "T003", "T005"]);

    const after = stateOf(ws.path);
    // Exactly four bytes differ, and every one of them is the MARK: a space
    // before and `x` after. Nothing else of the file moved.
    const differing = differingPositions(before.bytes, after.bytes);
    assert.equal(differing.length, 4);
    for (const index of differing) {
      assert.equal(String.fromCharCode(before.bytes[index] as number), " ");
      assert.equal(String.fromCharCode(after.bytes[index] as number), MARK_WRITTEN_BY_TICK);
    }
    // ...and each of those positions is inside one of the four lines the rule
    // names, which is the same claim read the other way round.
    const linesBefore = before.bytes.toString("utf8").split("\n");
    const linesAfter = after.bytes.toString("utf8").split("\n");
    assert.equal(linesBefore.length, linesAfter.length);
    linesBefore.forEach((line, index) => {
      const number = index + 1;
      if (CHANGED_BY_PHASE_1.includes(number)) {
        assert.equal(linesAfter[index], line.replace("[ ]", "[x]"), `line ${number}`);
        return;
      }
      assert.equal(linesAfter[index], line, `line ${number} is untouched`);
    });
    // The four lines the rule EXCLUDES, each named.
    assert.equal(linesAfter[5], "- [x] T002 already ticked");
    assert.equal(linesAfter[7], "- [] T004 an empty box");
    assert.equal(linesAfter[8], "- [ ]");
    assert.equal(linesAfter[17], "- [ ] T010 a task of the next phase");
    // No temporary name was left behind.
    assert.deepEqual(readdirSync(ws.directory).sort(), ["tasks.md"]);
    assert.equal(readdirSync(ws.directory).filter(isTemporaryName).length, 0);
  } finally {
    ws.remove();
  }
});

test("CT-104-5: a SECOND tick changes 0 lines, and writes nothing", () => {
  const ws = workspace();
  try {
    const first = tickFile({ path: ws.path, format: "speckit-tasks", request: { phase: 1 } });
    assert.equal(countPrintedBy(first), 4);
    const after = stateOf(ws.path);

    const second = tickFile({ path: ws.path, format: "speckit-tasks", request: { phase: 1 } });
    assert.equal(countPrintedBy(second), 0);
    // The file is the same file, with the same bytes, at the same time: a
    // rewrite would have moved the modification time and the inode.
    const now = stateOf(ws.path);
    assert.deepEqual(now.bytes, after.bytes);
    assert.equal(now.mtimeMs, after.mtimeMs);
    assert.equal(now.ino, after.ino);

    // A THIRD tick, and a tick of a phase the file does not have, are the same.
    assert.equal(
      countPrintedBy(tickFile({ path: ws.path, format: "speckit-tasks", request: { phase: 1 } })),
      0,
    );
    assert.equal(
      countPrintedBy(tickFile({ path: ws.path, format: "speckit-tasks", request: { phase: 9 } })),
      0,
    );
    assert.deepEqual(stateOf(ws.path), after);
    // The round trip over the TEXT is the same claim with no file in it.
    const once = tickText({ text: TASKS, format: "speckit-tasks", request: { phase: 1 } });
    assert.equal(
      tickText({ text: once.text, format: "speckit-tasks", request: { phase: 1 } }).changed,
      0,
    );
  } finally {
    ws.remove();
  }
});

test("CT-104-5: the file MODE is kept", () => {
  const ws = workspace();
  try {
    // Three modes, one of which is not the owner-only default of the atomic
    // write — so "the mode is kept" is observably different from "the mode is
    // the default".
    for (const mode of [0o640, 0o664, 0o600]) {
      writeFileSync(ws.path, TASKS);
      chmodSync(ws.path, mode);
      const result = tickFile({ path: ws.path, format: "speckit-tasks", request: { phase: 1 } });
      assert.equal(result.changed, 4, `mode ${mode.toString(8)}`);
      assert.equal(statSync(ws.path).mode & 0o7777, mode, `mode ${mode.toString(8)}`);
    }
    // The mode of a file nothing was written to is kept for the same reason:
    // there was no write to replace it.
    writeFileSync(ws.path, TASKS);
    chmodSync(ws.path, 0o600);
    assert.equal(
      tickFile({ path: ws.path, format: "speckit-tasks", request: { phase: 9 } }).changed,
      0,
    );
    assert.equal(statSync(ws.path).mode & 0o7777, 0o600);
  } finally {
    ws.remove();
  }
});

test("CT-104-5: NOTHING is written when no line changed", () => {
  assert.equal(WRITES_NOTHING_WHEN_NO_LINE_CHANGED, true);
  const ws = workspace();
  try {
    // Five inputs that change no line, each for its own reason.
    const nothingChanges = [
      // (a) a phase the file does not hold;
      { format: "speckit-tasks" as const, request: { phase: 9 } },
      // (b) a phase whose every box is already ticked;
      { format: "speckit-tasks" as const, request: { phase: 2 } },
      // (c) task ids the file does not hold;
      { format: "speckit-tasks" as const, request: { taskIds: ["T999"] } },
      // (d) an empty list of task ids;
      { format: "speckit-tasks" as const, request: { taskIds: [] } },
      // (e) a format that is never ticked at all.
      { format: "native" as const, request: { phase: 1 } },
    ];
    // (b) needs a task list whose phase 2 is already done.
    writeFileSync(ws.path, TASKS.replace("- [ ] T010", "- [x] T010"));
    const before = stateOf(ws.path);
    for (const input of nothingChanges) {
      const result = tickFile({ path: ws.path, ...input });
      assert.equal(result.changed, 0, JSON.stringify(input.request));
      const now = stateOf(ws.path);
      assert.deepEqual(now.bytes, before.bytes, JSON.stringify(input.request));
      assert.equal(now.mtimeMs, before.mtimeMs, "no write at all");
      assert.equal(now.ino, before.ino, "the file was not replaced");
    }
    // And no temporary name was ever created in the directory.
    assert.deepEqual(readdirSync(ws.directory).sort(), ["tasks.md"]);
  } finally {
    ws.remove();
  }
});

test("CT-104-5: a FAILED tick leaves the file as it was — before the write", () => {
  const ws = workspace();
  try {
    chmodSync(ws.path, 0o640);
    const before = stateOf(ws.path);

    // (a) the file cannot be READ: a directory, which is platform-independent
    // and does not depend on the user the test runs as.
    const directory = join(ws.directory, "a-directory");
    mkdirSync(directory);
    assert.throws(
      () => tickFile({ path: directory, format: "speckit-tasks", request: { phase: 1 } }),
      /EISDIR|illegal operation/,
    );
    assert.deepEqual(stateOf(ws.path), before);

    // (b) the file is gone.
    assert.throws(
      () =>
        tickFile({
          path: join(ws.directory, "nope.md"),
          format: "speckit-tasks",
          request: { phase: 1 },
        }),
      /ENOENT/,
    );
    assert.deepEqual(stateOf(ws.path), before);

    // (c) the GRAMMAR throws while the spec is being read. The tick is reached
    // through the one grammar owner, so a grammar that fails is the realistic
    // mid-operation failure — and the file must still be untouched.
    const sound = grammarOf("speckit-tasks");
    assert.ok(sound !== undefined, "the registry holds the grammar of `speckit-tasks`");
    const throwing: SpecGrammar = {
      name: sound.name,
      taskIdForm: sound.taskIdForm,
      criteriaHeading: sound.criteriaHeading,
      phasesOf: () => {
        throw new Error("the grammar failed");
      },
      findingsOf: (phases, text) => sound.findingsOf(phases, text),
      titleOfASection: (section) => sound.titleOfASection(section),
      mayBeTicked: (text) => sound.mayBeTicked(text),
    };
    assert.throws(
      () => tickFile({ path: ws.path, format: "speckit-tasks", request: { phase: 1 } }, throwing),
      /the grammar failed/,
    );
    assert.deepEqual(stateOf(ws.path), before);
    // Nothing was left in the directory but the file and the directory of (a).
    assert.deepEqual(readdirSync(ws.directory).sort(), ["a-directory", "tasks.md"]);
    assert.equal(readdirSync(ws.directory).filter(isTemporaryName).length, 0);

    // A sound grammar over the same file still ticks, so (c) failed for the
    // reason the test gave it and not because the input was unusable.
    assert.equal(
      tickFile({ path: ws.path, format: "speckit-tasks", request: { phase: 1 } }, sound).changed,
      4,
    );
  } finally {
    ws.remove();
  }
});

test("CT-104-5: a FAILED tick leaves the file as it was — during the write", () => {
  const ws = workspace();
  try {
    chmodSync(ws.path, 0o640);
    const before = stateOf(ws.path);
    // The write of `tick` is the atomic write of feature 100: a temporary name
    // in the SAME directory, opened with `wx`, fsynced, then renamed. The
    // attempt counter is pinnable, so the temporary name is known — and
    // OCCUPYING it makes `openSync` fail with EEXIST, which is a failure after
    // the decision to write and before the rename.
    const temporary = temporaryNameFor(ws.path, 104_047);
    writeFileSync(temporary, "in the way");
    const ticked = tickText({ text: TASKS, format: "speckit-tasks", request: { phase: 1 } });
    assert.equal(ticked.changed, 4, "there IS something to write");
    assert.throws(
      () => atomicWrite(ws.path, ticked.text, { mode: before.mode, attempt: 104_047 }),
      /EEXIST/,
    );
    // The target still holds its OLD bytes, its old mode and its old inode: a
    // reader sees the file it saw before, never a half-ticked one.
    const after = stateOf(ws.path);
    assert.deepEqual(after.bytes, before.bytes);
    assert.equal(after.mode, before.mode);
    assert.equal(after.ino, before.ino);
    assert.equal(after.size, before.size);

    // The same write SUCCEEDS once the name is free, so the failure was the
    // occupied name and not an unusable input.
    rmSync(temporary, { force: true });
    atomicWrite(ws.path, ticked.text, { mode: before.mode, attempt: 104_048 });
    assert.equal(readFileSync(ws.path, "utf8"), ticked.text);
    assert.equal(statSync(ws.path).mode & 0o7777, before.mode);
    assert.deepEqual(readdirSync(ws.directory).sort(), ["tasks.md"]);
    // The new bytes differ from the old ones in the four marks and nowhere
    // else, so the write that did land is the same checkbox-only change.
    assert.equal(differingPositions(before.bytes, readFileSync(ws.path)).length, 4);
  } finally {
    ws.remove();
  }
});
