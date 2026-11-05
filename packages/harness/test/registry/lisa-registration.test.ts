/**
 * T009 — CT-109-101: characterization of Lisa's provider seam (F109-FR-002).
 *
 * As-is item: "A provider declares its capability levels; registering one
 * whose declared level has no matching operation fails". A declared level
 * WITHOUT its operation fails registration — the characterization pins that
 * the seam keeps the behaviour.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRegistration } from "../../src/registry/levels.ts";

test("CT-109-101: a declared level with no operation of that level fails registration", () => {
  const result = checkRegistration({
    id: "lisa-provider",
    levels: ["proposer"],
    operations: { proposer: [] },
  });
  assert.equal(result.ok, false);
  assert.equal(result.refusals.length, 1);
  assert.equal(result.refusals[0]!.level, "proposer");
  assert.match(
    result.refusals[0]!.reason,
    /declares the level `proposer` and holds no operation of that level/,
  );
  assert.equal(result.offered.proposer, false);
});

test("CT-109-101: the failure is per level, and a level that holds operations still registers", () => {
  const result = checkRegistration({
    id: "lisa-provider",
    levels: ["proposer", "completion"],
    operations: {
      proposer: ["P1", "P2", "P3", "P4", "P5", "P6"],
      completion: [],
    },
  });
  assert.equal(result.ok, false, "the completion level without operations fails the registration");
  assert.equal(result.refusals[0]!.level, "completion");
  assert.equal(result.offered.proposer, true, "the proposer level itself is sound");
});

test("CT-109-101: the missing-operation record is distinct from a partially missing capability", () => {
  // No operation at all: registration FAILS.
  const failed = checkRegistration({
    id: "a",
    levels: ["completion"],
    operations: { completion: [] },
  });
  assert.equal(failed.ok, false);
  // Some operations but not all six: registration holds, the role is not
  // offered, and the missing capability is recorded.
  const partial = checkRegistration({
    id: "b",
    levels: ["completion"],
    operations: { completion: ["C1"] },
  });
  assert.equal(partial.ok, true);
  assert.equal(partial.offered.completion, false);
  assert.deepEqual([...partial.missing.completion], ["C2", "C3", "C4", "C5", "C6"]);
});
