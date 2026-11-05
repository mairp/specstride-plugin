/**
 * CT-115-156 (T037, IR-56, F115-FR-012) — the task list is read at launch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readTaskListAtLaunch, taskListRecordName } from "../../src/unit/task-list.ts";

test("CT-115-156: the reading comes from the record of launch, never from a copy", () => {
  const records = new Map([
    ["run:r1:task-list", { phase: 1, taskIds: ["T010", "T011"], hash: "h1" }],
  ]);
  let reads = 0;
  const view = {
    readRecord(name: string) {
      reads += 1;
      return records.get(name);
    },
  };
  const first = readTaskListAtLaunch("r1", view);
  const second = readTaskListAtLaunch("r1", view);
  assert.equal(reads, 2); // every call reads again; nothing is cached
  assert.ok(first.ok && second.ok);
  assert.deepEqual(first.taskList, second.taskList);
  assert.equal(taskListRecordName("r1"), "run:r1:task-list");
});

test("CT-115-156: a record that is not a task list of the phase is not guessed at", () => {
  const view = { readRecord: () => ({ tasks: "not a list" }) };
  const read = readTaskListAtLaunch("r1", view);
  assert.deepEqual(read, { ok: false, reason: "not-a-task-list" });
});

test("CT-115-156: the layer stores no copy under a name of its own", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const src = join(fileURLToPath(import.meta.url), "..", "..", "..", "src");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts")) {
        const text = readFileSync(path, "utf8");
        // No logical name of a stored copy, and no writer of the record.
        if (/writeRecord|taskListRecordName\([^)]*\)\s*=/.test(text)) offenders.push(path);
      }
    }
  };
  walk(src);
  assert.deepEqual(offenders, []);
});
