/**
 * T007 — the comparison of the source hashes (F102-FR-015, F102-FR-017).
 *
 * The hashes are computed over real files with the canonical hasher of the
 * kernel; the comparison is observed through the result's `changed` list —
 * the list the refusal names — and against the kernel's own hash values.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TASKS_HASH_IGNORES_CHECKBOXES,
  compareSourceHashes,
  currentSourceHashes,
  hashSourceFile,
  isRefused,
} from "../../../cli/src/run-control/source-compare.ts";
import { canonicalHasher } from "@specstride/kernel";

const DIR = mkdtempSync(join(tmpdir(), "specstride-102-srcmp-"));

const TASKS_V1 = "- [ ] T004 Write the stop-request writer\n- [ ] T005 Write the snapshot writer\n";
const TASKS_TICKED =
  "- [x] T004 Write the stop-request writer\n- [ ] T005 Write the snapshot writer\n";
const TASKS_EDITED = "- [x] T004 Write the stop-request writer\n- [ ] T009 A new task appears\n";

function paths() {
  return {
    spec: join(DIR, "spec.md"),
    plan: join(DIR, "plan.md"),
    tasks: join(DIR, "tasks.md"),
  };
}

function seed() {
  const p = paths();
  writeFileSync(p.spec, "# Feature 102\n");
  writeFileSync(p.plan, "# Plan\n");
  writeFileSync(p.tasks, TASKS_V1);
  return p;
}

test("T007: the hashes come from the canonical hasher (F100-FR-207)", () => {
  const p = seed();
  const now = currentSourceHashes(p);
  assert.equal(now.spec.contentHash, canonicalHasher.contentHash("# Feature 102\n"));
  // For the task list BOTH hashes are recorded; the ignored-checkboxes hash
  // is the kernel's (F102-FR-017).
  assert.equal(
    now.tasks.hashIgnoringCheckboxes,
    canonicalHasher.taskListHashIgnoringCheckboxes(TASKS_V1),
  );
  assert.equal(TASKS_HASH_IGNORES_CHECKBOXES, true);
  // The two hashes of the task list differ once a box is ticked: the
  // content hash sees the tick, the ignored-checkboxes hash does not.
  const ticked = canonicalHasher.taskListHashIgnoringCheckboxes(TASKS_TICKED);
  assert.notEqual(canonicalHasher.contentHash(TASKS_TICKED), ticked);
});

test("T007: unchanged sources are fresh and refuse nothing", () => {
  const p = seed();
  const now = currentSourceHashes(p);
  const recorded = {
    spec: { contentHash: now.spec.contentHash },
    plan: { contentHash: now.plan.contentHash },
    tasks: {
      contentHash: now.tasks.contentHash,
      hashIgnoringCheckboxes: now.tasks.hashIgnoringCheckboxes,
    },
  };
  const result = compareSourceHashes(recorded, now);
  assert.equal(result.verdict, "fresh");
  assert.deepEqual(result.changed, []);
  assert.equal(isRefused(result), false);
});

test("T007: a tick of a checkbox refuses NOTHING (F102-FR-017)", () => {
  const p = seed();
  const atLaunch = currentSourceHashes(p);
  writeFileSync(p.tasks, TASKS_TICKED); // the runtime ticked T004
  const now = currentSourceHashes(p);
  assert.notEqual(now.tasks.contentHash, atLaunch.tasks.contentHash); // the bytes differ
  assert.equal(now.tasks.hashIgnoringCheckboxes, atLaunch.tasks.hashIgnoringCheckboxes);
  const result = compareSourceHashes(
    {
      spec: { contentHash: atLaunch.spec.contentHash },
      plan: { contentHash: atLaunch.plan.contentHash },
      tasks: {
        contentHash: atLaunch.tasks.contentHash,
        hashIgnoringCheckboxes: atLaunch.tasks.hashIgnoringCheckboxes,
      },
    },
    now,
  );
  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.ticksOnly, ["tasks"]);
  assert.equal(isRefused(result), false);
});

test("T007: a change beyond the ticks refuses and names every changed file (F102-FR-015)", () => {
  const p = seed();
  const atLaunch = currentSourceHashes(p);
  writeFileSync(p.tasks, TASKS_EDITED); // beyond ticks
  writeFileSync(p.plan, "# Plan, changed\n");
  const result = compareSourceHashes(
    {
      spec: { contentHash: atLaunch.spec.contentHash },
      plan: { contentHash: atLaunch.plan.contentHash },
      tasks: {
        contentHash: atLaunch.tasks.contentHash,
        hashIgnoringCheckboxes: atLaunch.tasks.hashIgnoringCheckboxes,
      },
    },
    currentSourceHashes(p),
  );
  assert.deepEqual([...result.changed].sort(), ["plan", "tasks"]);
  assert.equal(isRefused(result), true);
  assert.match(result.message, /plan, tasks/); // every changed file is named
});

test("T007: a file that DISAPPEARED counts as changed and is named (F102-FR-015)", () => {
  const p = seed();
  const atLaunch = currentSourceHashes(p);
  rmSync(p.plan);
  const result = compareSourceHashes(
    {
      spec: { contentHash: atLaunch.spec.contentHash },
      plan: { contentHash: atLaunch.plan.contentHash },
      tasks: {
        contentHash: atLaunch.tasks.contentHash,
        hashIgnoringCheckboxes: atLaunch.tasks.hashIgnoringCheckboxes,
      },
    },
    currentSourceHashes(p),
  );
  assert.deepEqual(result.changed, ["plan"]);
  assert.equal(result.states.plan, "unreadable");
});

test("T007: a file that APPEARED where the snapshot holds no hash counts as changed", () => {
  const p = seed();
  const now = currentSourceHashes(p);
  const result = compareSourceHashes(
    {
      spec: { contentHash: now.spec.contentHash },
      plan: undefined, // not recorded at launch
      tasks: { contentHash: now.tasks.contentHash },
    },
    now,
  );
  assert.deepEqual(result.changed, ["plan"]);
});

test("T007: an unreadable file has no hash at all", () => {
  const read = hashSourceFile("plan", join(DIR, "missing.md"));
  assert.equal(read.contentHash, undefined);
});
