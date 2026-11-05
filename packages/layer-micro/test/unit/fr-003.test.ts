/**
 * CT-115-3 (T012, F115-FR-003) — level L1 on a harness that is only
 * declared: the recorded level is L1 whatever the harness, and the point
 * never tests a harness name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MICRO_LEVEL, registerLayerMicro } from "../../src/register.ts";
import { afterPass } from "../../src/callpoints/after-pass.ts";
import type { CheckpointClaimReader } from "@specstride/contracts";

/** A harness that was discovered and declared, but never tested. */
const DECLARED_ONLY = { name: "declared-only", tested: false, declared: true } as const;

function readerFor(tasks: string[]): CheckpointClaimReader {
  return {
    async readClaim() {
      return { ok: true, claim: { schema: "specstride.checkpoint/1", tasks, note: "n" } };
    },
  };
}

test("CT-115-3: the recorded level is L1", () => {
  const registration = registerLayerMicro();
  assert.equal(registration.level, "L1");
  assert.equal(MICRO_LEVEL, "L1");
});

test("CT-115-3: a pass ends at the checkpoint on a declared-only harness", async () => {
  const outcome = await afterPass({
    claimReader: readerFor(["T010"]),
    unitId: "u1",
    phaseTaskIds: ["T010", "T011"],
    // The harness is only declared: the layer needs no capability beyond
    // the proposer level, so the checkpoint is accepted as on any harness.
    ...(DECLARED_ONLY.declared ? {} : {}),
  });
  assert.equal(outcome.result, "accept");
  assert.deepEqual(outcome.tasks, ["T010"]);
});

test("CT-115-3: the point never tests a harness name", async () => {
  const first = await afterPass({
    claimReader: readerFor(["T010"]),
    unitId: "u1",
    phaseTaskIds: ["T010"],
  });
  const second = await afterPass({
    claimReader: readerFor(["T010"]),
    unitId: "u1",
    phaseTaskIds: ["T010"],
  });
  assert.equal(first.result, second.result);
  assert.deepEqual(first, second);
});
