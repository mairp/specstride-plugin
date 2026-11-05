// CT-116-140 (IR-40; F116-FR-008, F116-FR-017): exit result and conditions in
// separate fields.
import { test } from "node:test";
import assert from "node:assert/strict";
import { annotateResult } from "../../src/protected/compare.ts";
import { bindResultToTree, freshnessOf } from "../../src/result/freshness.ts";

test("IR-40 the exit result is never replaced by a condition", () => {
  const annotated = annotateResult(
    {
      unitId: "u",
      ordinal: 1,
      commands: [
        {
          id: "c",
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
      tainted: { reason: "changed-during-check" },
      cached: false,
      flaky: false,
      interrupted: false,
      unchecked: false,
    },
  );
  assert.equal(annotated.commands[0].exit, 0);
  assert.notEqual(annotated.commands[0].conditions.tainted, false);
});

test("IR-40 each condition stands in a field of its own inside conditions", () => {
  const annotated = annotateResult(
    {
      unitId: "u",
      ordinal: 1,
      commands: [
        {
          id: "c",
          exit: 1,
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
      tainted: false,
      cached: { reason: "replayed" },
      flaky: false,
      interrupted: false,
      unchecked: false,
    },
  );
  const conditions = annotated.commands[0].conditions as Record<string, unknown>;
  assert.equal("tainted" in conditions, true);
  assert.equal("cached" in conditions, true);
  assert.notEqual(conditions.cached, false);
  assert.equal("exit" in conditions, false);
});

test("IR-40 freshness is a field of its own next to the exit result", () => {
  const bound = bindResultToTree({ unitId: "u", ordinal: 1, exit: 0 }, "t1", "t1");
  assert.equal(bound.exit, 0);
  assert.equal((bound as { freshness?: string }).freshness, freshnessOf("t1", "t1"));
});
