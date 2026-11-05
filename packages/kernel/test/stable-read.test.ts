/**
 * T213 — contract test CT-100-328 for the check of files read while a run
 * writes them (annex B, §B.2; F100-FR-228).
 *
 * The engine brackets a proposer pass around three files the proposer could
 * reach: the event stream of the run, the decision log of learning and the
 * observation of the current phase. Before the pass it records the size and the
 * hash of the leading bytes of each; after the pass it checks that those
 * leading bytes are unchanged. Appends are allowed. A file that shrank, or
 * whose leading bytes changed, gives one event `integrity.events_changed` with
 * the phase, the phase attempt and the file, and the run is left out of every
 * baseline and every evaluation of learning.
 *
 * The rule and its thresholds belong to feature 106 (F106-FR-037); what is
 * tested here is the mechanism of the kernel.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ANNEX_SECTION,
  APPENDS_ARE_ALLOWED,
  BRACKETED_LOGICAL_NAMES,
  DEFAULT_LEADING_BYTES,
  CHANGED_FILE_EVENT_FIELDS,
  EVENT_OF_A_CHANGED_FILE,
  HASH_ALGORITHM,
  INSTABILITY_REASONS,
  LEARNING_MODE_THAT_TAKES_NO_BRACKET,
  REQUIREMENT,
  RULE_OWNER,
  RULE_REQUIREMENT,
  StableReadError,
  bracketCheck,
  bracketIsTaken,
  bracketTake,
  checkLeadingBytes,
  eventOf,
  leadingBytesAreUnchanged,
  markLeadingBytes,
  stableRead,
} from "../src/stable-read/index.ts";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "specstride-stable-read-"));
}

test("CT-100-328: the bracket is taken for the three files the proposer could reach (F100-FR-228)", () => {
  assert.equal(ANNEX_SECTION, "annex B, §B.2");
  assert.equal(REQUIREMENT, "F100-FR-228");
  assert.deepEqual(
    [...BRACKETED_LOGICAL_NAMES],
    [
      "run:<runId>:events",
      "feature:<slug>:learning:decisions",
      "feature:<slug>:learning:observation:<N>",
    ],
  );
  // The rule and its thresholds belong to feature 106.
  assert.equal(RULE_OWNER, "106");
  assert.equal(RULE_REQUIREMENT, "F106-FR-037");
});

test("CT-100-328: the bracket is taken when the learning mode is not `off` (F100-FR-228)", () => {
  assert.equal(LEARNING_MODE_THAT_TAKES_NO_BRACKET, "off");
  assert.equal(bracketIsTaken("off"), false);
  for (const mode of ["suggest", "apply"]) assert.equal(bracketIsTaken(mode), true, mode);
});

test("CT-100-328: the mark records the size and the hash of the leading bytes (F100-FR-228)", () => {
  const dir = scratch();
  try {
    const file = join(dir, "events.jsonl");
    writeFileSync(file, "one\ntwo\n");
    const mark = markLeadingBytes(file, { logicalName: "run:<runId>:events" });
    assert.equal(mark.size, 8);
    assert.equal(mark.logicalName, "run:<runId>:events");
    assert.equal(mark.leadingBytes, 8, "the whole file, where it is shorter than the window");
    assert.match(mark.hash ?? "", /^[0-9a-f]{64}$/, `the hash is a ${HASH_ALGORITHM} digest`);
    assert.equal(DEFAULT_LEADING_BYTES, 65536);
    // The same bytes give the same hash: the mark is a function of the content.
    const again = markLeadingBytes(file);
    assert.equal(again.hash, mark.hash);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-100-328: an append leaves the leading bytes unchanged (F100-FR-228)", () => {
  const dir = scratch();
  try {
    const file = join(dir, "events.jsonl");
    writeFileSync(file, "one\n");
    const mark = markLeadingBytes(file);
    appendFileSync(file, "two\nthree\n");
    assert.equal(APPENDS_ARE_ALLOWED, true);
    assert.equal(leadingBytesAreUnchanged(mark), true);
    assert.equal(checkLeadingBytes(mark), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-100-328: a file whose leading bytes changed is reported, with its event (F100-FR-228)", () => {
  const dir = scratch();
  try {
    const file = join(dir, "decisions.jsonl");
    writeFileSync(file, "first\n");
    const mark = markLeadingBytes(file, {
      logicalName: "feature:<slug>:learning:decisions",
    });
    writeFileSync(file, "other\n"); // the same size, different bytes
    const finding = checkLeadingBytes(mark);
    assert.ok(finding !== undefined, "a rewritten file is not stable");
    assert.equal(finding.reason, "leading-bytes-changed");
    assert.equal(finding.event, EVENT_OF_A_CHANGED_FILE);
    assert.equal(finding.event, "integrity.events_changed");
    assert.equal(finding.logicalName, "feature:<slug>:learning:decisions");
    assert.equal(leadingBytesAreUnchanged(mark), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-100-328: a file that shrank is reported (F100-FR-228)", () => {
  const dir = scratch();
  try {
    const file = join(dir, "observation.json");
    writeFileSync(file, '{"a":1}\n');
    const mark = markLeadingBytes(file);
    writeFileSync(file, "{");
    const finding = checkLeadingBytes(mark);
    assert.ok(finding !== undefined);
    assert.equal(finding.reason, "shrank");
    assert.equal(finding.sizeBefore, 8);
    assert.equal(finding.sizeAfter, 1);
    assert.ok(INSTABILITY_REASONS.includes(finding.reason));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-100-328: a file that appeared or vanished during the pass is reported (F100-FR-228)", () => {
  const dir = scratch();
  try {
    const file = join(dir, "observation.json");
    const absent = markLeadingBytes(file, { logicalName: "x" });
    assert.equal(absent.size, null);
    assert.equal(absent.hash, null);
    assert.equal(checkLeadingBytes(absent), undefined, "absent before and after is no change");
    writeFileSync(file, "{}\n");
    assert.equal(checkLeadingBytes(absent)?.reason, "appeared");
    const present = markLeadingBytes(file);
    rmSync(file);
    assert.equal(checkLeadingBytes(present)?.reason, "vanished");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-100-328: a reading between the mark and the check reports whether it was stable (F100-FR-228)", () => {
  const dir = scratch();
  try {
    const file = join(dir, "events.jsonl");
    writeFileSync(file, "one\n");
    // A reading during which the writer only appends is stable.
    const good = stableRead(file, () => {
      appendFileSync(file, "two\n");
      return "read";
    });
    assert.equal(good.stable, true);
    assert.equal(good.value, "read");
    assert.equal(good.finding, undefined);
    // A reading during which the writer rewrote the head is not. The file is
    // rewritten to the same size, so the finding is of the leading bytes and
    // not of a shrink.
    const bad = stableRead(file, () => {
      writeFileSync(file, "zzz\nyyy\n");
      return "read";
    });
    assert.equal(bad.stable, false);
    assert.equal(bad.finding?.reason, "leading-bytes-changed");
    assert.equal(bad.finding?.event, "integrity.events_changed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-100-328: the bracket of a pass reports one finding per changed file and leaves the run out (F100-FR-228)", () => {
  const dir = scratch();
  try {
    const events = join(dir, "events.jsonl");
    const decisions = join(dir, "decisions.jsonl");
    const observation = join(dir, "observation.json");
    writeFileSync(events, "e1\n");
    writeFileSync(decisions, "d1\n");
    writeFileSync(observation, '{"n":1}\n');
    const files = [
      { logicalName: "run:<runId>:events", path: events },
      { logicalName: "feature:<slug>:learning:decisions", path: decisions },
      { logicalName: "feature:<slug>:learning:observation:<N>", path: observation },
    ] as const;

    // A pass that only appended: the bracket is clean and the run stays in.
    const clean = bracketTake(files);
    appendFileSync(events, "e2\n");
    const cleanReport = bracketCheck(clean);
    assert.equal(cleanReport.unchanged, true);
    assert.deepEqual([...cleanReport.findings], []);
    assert.equal(cleanReport.runIsLeftOutOfEveryBaseline, false);
    assert.equal(cleanReport.runIsLeftOutOfEveryEvaluation, false);

    // A pass that rewrote two of the three: one finding each, and the run is
    // left out of every baseline and every evaluation of learning.
    const dirty = bracketTake(files);
    writeFileSync(events, "zz\n");
    writeFileSync(decisions, "yy\n");
    const dirtyReport = bracketCheck(dirty);
    assert.equal(dirtyReport.unchanged, false);
    assert.equal(dirtyReport.findings.length, 2);
    assert.deepEqual(
      dirtyReport.findings.map((f) => f.logicalName),
      ["run:<runId>:events", "feature:<slug>:learning:decisions"],
    );
    assert.equal(dirtyReport.runIsLeftOutOfEveryBaseline, true);
    assert.equal(dirtyReport.runIsLeftOutOfEveryEvaluation, true);

    // The event carries the phase, the phase attempt and the file, and no more.
    const event = eventOf(dirtyReport.findings[0]!, 9, "e1-a2");
    assert.equal(event.type, "integrity.events_changed");
    assert.equal(event.phase, 9);
    assert.equal(event.attempt, "e1-a2");
    assert.equal(event.file, "run:<runId>:events");
    for (const field of CHANGED_FILE_EVENT_FIELDS) assert.ok(field in event, field);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-100-328: a window that is not a whole number above 0 is refused", () => {
  const dir = scratch();
  try {
    const file = join(dir, "events.jsonl");
    writeFileSync(file, "x\n");
    assert.throws(() => markLeadingBytes(file, { leadingBytes: 0 }), StableReadError);
    assert.throws(() => markLeadingBytes(file, { leadingBytes: 1.5 }), StableReadError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-100-328: the window bounds the reading, so a long file is not read whole", () => {
  const dir = scratch();
  try {
    const file = join(dir, "events.jsonl");
    writeFileSync(file, "a".repeat(1000));
    const mark = markLeadingBytes(file, { leadingBytes: 16 });
    assert.equal(mark.leadingBytes, 16);
    assert.equal(mark.size, 1000);
    // A change past the window is not seen: appends are allowed.
    appendFileSync(file, "b".repeat(100));
    assert.equal(leadingBytesAreUnchanged(mark), true);
    // A change inside the window is seen.
    writeFileSync(file, "z".repeat(1100));
    assert.equal(checkLeadingBytes(mark)?.reason, "leading-bytes-changed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
