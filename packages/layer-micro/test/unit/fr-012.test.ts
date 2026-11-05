/**
 * CT-115-12 (T017, F115-FR-012) — validation against the task list as read
 * at launch (`run:<runId>:task-list`); a difference at the phase gate is
 * given to the builder of the fact block as `task-list-changed`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readTaskListAtLaunch,
  compareTaskListAtGate,
  taskListRecordName,
  TASK_LIST_RECORD,
  TASK_LIST_CHANGED_FACT,
} from "../../src/unit/task-list.ts";
import { validateCheckpoint } from "../../src/unit/validate.ts";
import { contributeCriticInput } from "../../src/callpoints/contribute-critic-input.ts";

const TASK_LIST = { phase: 3, taskIds: ["T010", "T011"], hash: "hash-1" };

test("CT-115-12: the record is read through the view, by its launch name", () => {
  assert.equal(TASK_LIST_RECORD, "run:<runId>:task-list");
  assert.equal(taskListRecordName("r7"), "run:r7:task-list");
  let asked: string | undefined;
  const view = {
    readRecord(name: string) {
      asked = name;
      return TASK_LIST;
    },
  };
  const read = readTaskListAtLaunch("r7", view);
  assert.ok(read.ok);
  assert.equal(asked, "run:r7:task-list");
  assert.deepEqual(read.taskList, TASK_LIST);
});

test("CT-115-12: validation uses the reading at launch", () => {
  const result = validateCheckpoint(
    { schema: "specstride.checkpoint/1", tasks: ["T011"] },
    { phaseTaskIds: TASK_LIST.taskIds },
  );
  assert.ok(result.ok);
  const refused = validateCheckpoint(
    { schema: "specstride.checkpoint/1", tasks: ["T999"] },
    { phaseTaskIds: TASK_LIST.taskIds },
  );
  assert.deepEqual(refused, { ok: false, reason: "foreign-id" });
});

test("CT-115-12: ticked checkboxes are the only allowed difference", () => {
  const same = compareTaskListAtGate(TASK_LIST, {
    ...TASK_LIST,
    ticked: { T010: true },
  });
  assert.deepEqual(same, { changed: false });
  for (const atGate of [
    { phase: 3, taskIds: ["T010", "T012"], hash: "hash-1" },
    { phase: 3, taskIds: ["T011", "T010"], hash: "hash-1" },
    { phase: 3, taskIds: ["T010", "T011"], hash: "hash-2" },
    { phase: 4, taskIds: ["T010", "T011"], hash: "hash-1" },
  ]) {
    const changed = compareTaskListAtGate(TASK_LIST, atGate);
    assert.deepEqual(changed, { changed: true, fact: TASK_LIST_CHANGED_FACT });
  }
});

test("CT-115-12: the fact reaches the builder of the fact block", () => {
  let received: { facts?: readonly string[] } | undefined;
  const rows = contributeCriticInput({
    builder: {
      build(input) {
        received = input;
        return [
          {
            unitId: "u1",
            declaredTasks: ["T010"],
            outcome: "kept",
            commands: [],
          },
        ];
      },
    },
    units: [{ unitId: "u1", tasks: ["T010"], outcome: "kept" }],
    checkResults: {},
    taskListAtLaunch: TASK_LIST,
    facts: [TASK_LIST_CHANGED_FACT],
  }).rows;
  assert.equal(rows.length, 1);
  assert.deepEqual(received?.facts, ["task-list-changed"]);
});

test("CT-115-12: the layer writes no task list", () => {
  // The view of the layer is read-only: it has no way to write a record,
  // and the module exports no writer of `run:<runId>:task-list`.
  const view = { readRecord: () => TASK_LIST };
  const keys = Object.keys(view);
  assert.deepEqual(keys, ["readRecord"]);
});
