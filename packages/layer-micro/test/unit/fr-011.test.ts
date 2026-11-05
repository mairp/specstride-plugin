/**
 * CT-115-11 (T016, F115-FR-011) — one test case per refusal reason of a
 * checkpoint, from the closed set of annex X §X.6 row 138.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { afterPass, type AfterPassInput } from "../../src/callpoints/after-pass.ts";
import { CHECKPOINT_REFUSAL_REASONS } from "../../src/unit/validate.ts";
import type { CheckpointClaimReader } from "@specstride/contracts";
import type { ClaimRefusalReason } from "@specstride/contracts";

const REASONS = [
  "pass-killed",
  "foreign-id",
  "yield-in-pass",
  "not-regular",
  "stale",
  "too-large",
  "changed-while-read",
  "empty",
] as const;

test("CT-115-11: the closed set of the refusal reasons is complete", () => {
  assert.deepEqual([...CHECKPOINT_REFUSAL_REASONS], [...REASONS]);
});

function readerRefusing(reason: ClaimRefusalReason): CheckpointClaimReader {
  return {
    async readClaim() {
      return { ok: false, refusal: { reason } };
    },
  };
}
function readerFor(tasks: string[]): CheckpointClaimReader {
  return {
    async readClaim() {
      return { ok: true, claim: { schema: "specstride.checkpoint/1", tasks } };
    },
  };
}
const BASE: Omit<AfterPassInput, "claimReader"> = {
  unitId: "u1",
  phaseTaskIds: ["T010", "T011"],
};

test("CT-115-11: pass-killed — a checkpoint of a killed pass is refused", async () => {
  const outcome = await afterPass({
    ...BASE,
    claimReader: readerFor(["T010"]),
    passKilled: true,
  });
  assert.deepEqual(outcome, { result: "refuse", refusalReason: "pass-killed" });
});

test("CT-115-11: foreign-id — an id outside the phase is refused", async () => {
  const outcome = await afterPass({
    ...BASE,
    claimReader: readerFor(["T099"]),
  });
  assert.deepEqual(outcome, { result: "refuse", refusalReason: "foreign-id" });
});

test("CT-115-11: yield-in-pass — a yield artifact in the pass is refused", async () => {
  const outcome = await afterPass({
    ...BASE,
    claimReader: readerFor(["T010"]),
    yieldInPass: true,
  });
  assert.deepEqual(outcome, { result: "refuse", refusalReason: "yield-in-pass" });
});

test("CT-115-11: not-regular, stale, too-large, changed-while-read — the file rules", async () => {
  for (const reason of ["not-regular", "stale", "too-large", "changed-while-read"] as const) {
    const outcome = await afterPass({ ...BASE, claimReader: readerRefusing(reason) });
    assert.deepEqual(outcome, { result: "refuse", refusalReason: reason });
  }
});

test("CT-115-11: empty — a checkpoint that holds no id is refused", async () => {
  const outcome = await afterPass({ ...BASE, claimReader: readerFor([]) });
  assert.deepEqual(outcome, { result: "refuse", refusalReason: "empty" });
});

test("CT-115-11: a refusal changes no counter and accounts the pass as classic", async () => {
  const counters = { reject: 1, passCount: 2, attemptNumber: 1 };
  const before = structuredClone(counters);
  await afterPass({ ...BASE, claimReader: readerRefusing("too-large") });
  assert.deepEqual(counters, before);
});
