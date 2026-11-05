/**
 * T007 — unit tests of the hash that ignores checkboxes, the one rule of the
 * grammar the hasher holds (F104-FR-022; annex X §X.5).
 *
 * The property the whole staleness verdict rests on: ticking or clearing a
 * box never changes this hash, so a tick by the proposer, by the engine after
 * approval or by the runtime never makes a run stale (F104-FR-024).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DIVERGENCE_OF_THE_DOTTED_FORM,
  MARK_RULE_FORMS,
  contentHash,
  taskListHashIgnoringCheckboxes,
  taskListHashIgnoringCheckboxesOfBytes,
  withLineEndsAsOneForm,
  withMarksReplaced,
} from "../../src/hasher/index.ts";
import {
  BASELINE_HASH_IGNORING_CHECKBOXES_OF_THE_IDS,
  BASELINE_HASH_IGNORING_CHECKBOXES_OF_THE_TASK_LIST,
  CONTENT_HASH_OF_THE_TASK_LIST,
  CONTENT_HASH_OF_THE_TASK_LIST_TICKED,
  EMPTY_BOX,
  EMPTY_BOX_TICKED,
  HASH_IGNORING_CHECKBOXES_OF_THE_EMPTY_BOX,
  HASH_IGNORING_CHECKBOXES_OF_THE_EMPTY_BOX_TICKED,
  HASH_IGNORING_CHECKBOXES_OF_THE_MIXED_TASK_LIST,
  HASH_IGNORING_CHECKBOXES_OF_THE_OPENSPEC_TASK_LIST,
  HASH_IGNORING_CHECKBOXES_WITHOUT_A_TASK_ID,
  HASH_IGNORING_CHECKBOXES_WITHOUT_A_TASK_ID_TICKED,
  HASH_OF_THE_SINGLE_NUMBER,
  HASH_OF_THE_SINGLE_NUMBER_TICKED,
  LINE_WITHOUT_A_TASK_ID,
  LINE_WITHOUT_A_TASK_ID_TICKED,
  MIXED_TASK_LIST,
  MIXED_TASK_LIST_TICKED,
  OPENSPEC_TASK_LIST,
  OPENSPEC_TASK_LIST_TICKED,
  SINGLE_NUMBER,
  SINGLE_NUMBER_TICKED,
  TASK_LIST,
  TASK_LIST_TICKED,
  TASK_LIST_WITH_IDS,
  TASK_LIST_WITH_IDS_CLEARED,
} from "./baseline.ts";

test("T007: the hash of a `T`-id task list equals the baseline's (B-2477, research D-3)", () => {
  assert.equal(
    taskListHashIgnoringCheckboxes(TASK_LIST),
    BASELINE_HASH_IGNORING_CHECKBOXES_OF_THE_TASK_LIST,
  );
  assert.equal(
    taskListHashIgnoringCheckboxes(TASK_LIST_WITH_IDS),
    BASELINE_HASH_IGNORING_CHECKBOXES_OF_THE_IDS,
  );
});

test("T007: ticking or clearing a box never changes the hash", () => {
  // The content hash DOES change; the hash that ignores checkboxes does not.
  assert.equal(contentHash(TASK_LIST), CONTENT_HASH_OF_THE_TASK_LIST);
  assert.equal(contentHash(TASK_LIST_TICKED), CONTENT_HASH_OF_THE_TASK_LIST_TICKED);
  assert.notEqual(contentHash(TASK_LIST), contentHash(TASK_LIST_TICKED));

  assert.equal(
    taskListHashIgnoringCheckboxes(TASK_LIST_TICKED),
    BASELINE_HASH_IGNORING_CHECKBOXES_OF_THE_TASK_LIST,
  );
  assert.equal(
    taskListHashIgnoringCheckboxes(TASK_LIST_WITH_IDS_CLEARED),
    BASELINE_HASH_IGNORING_CHECKBOXES_OF_THE_IDS,
  );
});

test("T007: the mark rule covers an indented line, tabs, and a `T` id with one letter", () => {
  // `  - [x] T012a`, `\t-\t[ ]\tT013` and `- [X] T014` are all task lines.
  const replaced = withMarksReplaced(TASK_LIST_WITH_IDS);
  assert.equal(replaced, withMarksReplaced(TASK_LIST_WITH_IDS_CLEARED));
  assert.ok(replaced.includes("  - [ ] T012a"), replaced);
  assert.ok(replaced.includes("[ ]\tT013"), replaced);
  assert.ok(replaced.includes("- [ ] T014"), replaced);
  // Only the one mark character is touched; every other byte stays.
  assert.equal(replaced.length, TASK_LIST_WITH_IDS.length);
});

test("T007: a line with an empty box `[]` is outside the rule, as at the baseline", () => {
  // Research D-3: a broader rule that also covered `[]` would give hashes
  // that differ from the baseline's. A tick of such a line IS a change.
  assert.equal(
    taskListHashIgnoringCheckboxes(EMPTY_BOX),
    HASH_IGNORING_CHECKBOXES_OF_THE_EMPTY_BOX,
  );
  assert.equal(
    taskListHashIgnoringCheckboxes(EMPTY_BOX_TICKED),
    HASH_IGNORING_CHECKBOXES_OF_THE_EMPTY_BOX_TICKED,
  );
  assert.notEqual(
    taskListHashIgnoringCheckboxes(EMPTY_BOX),
    taskListHashIgnoringCheckboxes(EMPTY_BOX_TICKED),
  );
});

test("T007: a checkbox line with no task id is not covered", () => {
  assert.equal(
    taskListHashIgnoringCheckboxes(LINE_WITHOUT_A_TASK_ID),
    HASH_IGNORING_CHECKBOXES_WITHOUT_A_TASK_ID,
  );
  assert.equal(
    taskListHashIgnoringCheckboxes(LINE_WITHOUT_A_TASK_ID_TICKED),
    HASH_IGNORING_CHECKBOXES_WITHOUT_A_TASK_ID_TICKED,
  );
  assert.notEqual(
    HASH_IGNORING_CHECKBOXES_WITHOUT_A_TASK_ID,
    HASH_IGNORING_CHECKBOXES_WITHOUT_A_TASK_ID_TICKED,
  );
});

test("T007: the rule covers the dotted id of `openspec-change` (DV-118)", () => {
  assert.deepEqual([...MARK_RULE_FORMS], ["T-id", "dotted-id"]);
  assert.equal(DIVERGENCE_OF_THE_DOTTED_FORM, "DV-118");
  assert.equal(
    taskListHashIgnoringCheckboxes(OPENSPEC_TASK_LIST),
    HASH_IGNORING_CHECKBOXES_OF_THE_OPENSPEC_TASK_LIST,
  );
  // The engine's own tick of an OpenSpec change never makes a run stale.
  assert.equal(
    taskListHashIgnoringCheckboxes(OPENSPEC_TASK_LIST_TICKED),
    HASH_IGNORING_CHECKBOXES_OF_THE_OPENSPEC_TASK_LIST,
  );
  // A list that holds both forms is tick-insensitive in both.
  assert.equal(
    taskListHashIgnoringCheckboxes(MIXED_TASK_LIST),
    HASH_IGNORING_CHECKBOXES_OF_THE_MIXED_TASK_LIST,
  );
  assert.equal(
    taskListHashIgnoringCheckboxes(MIXED_TASK_LIST_TICKED),
    HASH_IGNORING_CHECKBOXES_OF_THE_MIXED_TASK_LIST,
  );
});

test("T007: the widened form changes nothing for a list of `T` ids only", () => {
  // DV-118 is a divergence from the baseline for OpenSpec lines ONLY. Over a
  // task list with `T` ids the widened rule gives the baseline's own value,
  // which is what the golden above is.
  assert.equal(
    taskListHashIgnoringCheckboxes(TASK_LIST),
    BASELINE_HASH_IGNORING_CHECKBOXES_OF_THE_TASK_LIST,
  );
  // A single undotted number is no dotted id and stays uncovered.
  assert.equal(taskListHashIgnoringCheckboxes(SINGLE_NUMBER), HASH_OF_THE_SINGLE_NUMBER);
  assert.equal(
    taskListHashIgnoringCheckboxes(SINGLE_NUMBER_TICKED),
    HASH_OF_THE_SINGLE_NUMBER_TICKED,
  );
  assert.notEqual(HASH_OF_THE_SINGLE_NUMBER, HASH_OF_THE_SINGLE_NUMBER_TICKED);
});

test("T007: line ends are taken as one form", () => {
  // The baseline reads the file in Python's text mode, which translates
  // `\r\n` and a lone `\r` to `\n` before hashing (F104-FR-022).
  const crlf = TASK_LIST.replace(/\n/g, "\r\n");
  const cr = TASK_LIST.replace(/\n/g, "\r");
  assert.equal(withLineEndsAsOneForm(crlf), TASK_LIST);
  assert.equal(withLineEndsAsOneForm(cr), TASK_LIST);
  assert.equal(
    taskListHashIgnoringCheckboxes(crlf),
    BASELINE_HASH_IGNORING_CHECKBOXES_OF_THE_TASK_LIST,
  );
  assert.equal(
    taskListHashIgnoringCheckboxes(cr),
    BASELINE_HASH_IGNORING_CHECKBOXES_OF_THE_TASK_LIST,
  );
});

test("T007: a file that cannot be decoded gives no hash, and so a difference", () => {
  const good = new TextEncoder().encode(TASK_LIST);
  assert.equal(
    taskListHashIgnoringCheckboxesOfBytes(good),
    BASELINE_HASH_IGNORING_CHECKBOXES_OF_THE_TASK_LIST,
  );
  // An invalid UTF-8 sequence: the baseline's `UnicodeDecodeError` branch.
  const bad = Uint8Array.from([0x2d, 0x20, 0x5b, 0x20, 0x5d, 0xff, 0xfe, 0x0a]);
  assert.equal(taskListHashIgnoringCheckboxesOfBytes(bad), undefined);
});

test("T007: the hash is the content hash of the text with the marks replaced", () => {
  // The two operations compose: no second hashing scheme is introduced.
  assert.equal(
    taskListHashIgnoringCheckboxes(TASK_LIST),
    contentHash(withMarksReplaced(withLineEndsAsOneForm(TASK_LIST))),
  );
});
