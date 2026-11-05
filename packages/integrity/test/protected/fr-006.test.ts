// CT-116-6 (F116-FR-006): tainted keeps the exit result, the unit is not
// recorded as kept, the verification gate still runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareAroundCheck, annotateResult } from "../../src/protected/compare.ts";
import { notKept } from "../../src/protected/compare.ts";

test("CT-116-6 a tainted result keeps its exit result in its own field", () => {
  const result = annotateResult(
    {
      unitId: "u1",
      ordinal: 1,
      commands: [
        {
          id: "c1",
          exit: 0,
          conditions: {
            tainted: false,
            cached: false,
            flaky: false,
            interrupted: false,
            unchecked: false,
          },
        },
      ],
    },
    {
      tainted: { reason: "protected-set-changed" },
      cached: false,
      flaky: false,
      interrupted: false,
      unchecked: false,
    },
  );
  assert.equal(result.commands[0].exit, 0); // exit kept
  assert.notEqual(result.commands[0].conditions.tainted, false);
});

test("CT-116-6 a unit whose check carries tainted is not recorded as kept", () => {
  assert.equal(notKept({ tainted: { reason: "changed-during-check" } }), false);
  assert.equal(notKept({ tainted: false }), true);
});

test("CT-116-6 the verification gate still runs on a differing protected set and does not halt", () => {
  const verdict = compareAroundCheck({
    treeBefore: "t1",
    treeAfter: "t2",
    changedPaths: ["toolchain/runner.json"],
    declaredWrites: [],
    authorised: {},
  });
  assert.equal(verdict.gateStillRuns, true);
  assert.equal(verdict.blocked, false);
  assert.notEqual(verdict.conditions.tainted, false);
  assert.equal(
    verdict.conditions.tainted && verdict.conditions.tainted.reason,
    "changed-during-check",
  );
});

test("CT-116-6 tainted is never a pass, whatever the exit code", () => {
  const verdict = compareAroundCheck({
    treeBefore: "t1",
    treeAfter: "t2",
    changedPaths: ["x.ts"],
    declaredWrites: [],
    authorised: {},
  });
  assert.equal(verdict.isPass, false);
});
