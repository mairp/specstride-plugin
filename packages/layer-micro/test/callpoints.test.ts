/**
 * CT-115-2 — the skeleton of the eight call points (T010, F115-FR-002):
 * every point of `CALL_POINTS` of EP-04 exists, is exposed by the package,
 * and returns `none` — so the layer registers and is inert, and a run with
 * it observes exactly the classic loop (F115-FR-006).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { epLoopLayer } from "@specstride/contracts";
import { CALLED_POINTS, callPoints } from "../src/callpoints/index.ts";

test("T010: the skeleton exposes exactly the eight call points of EP-04, in order", () => {
  const points = epLoopLayer.CALL_POINTS;
  assert.equal(points.length, 8);
  assert.deepEqual([...CALLED_POINTS], [...points]);
  assert.deepEqual(Object.keys(callPoints), [...points]);
});

test("T010: every call point returns `none` (F115-FR-002)", () => {
  const view = { runId: "run-test", phase: 1 };
  for (const point of epLoopLayer.CALL_POINTS) {
    const result = callPoints[point]({ point, view });
    assert.equal(result, "none", `the call point ${point} is inert`);
  }
});

test("T010: the result of every point is the value an unknown return is read as", () => {
  assert.equal(epLoopLayer.RETURN_WHEN_UNKNOWN, "none");
});
