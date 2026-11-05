/**
 * CT-115-38 (T105, F115-FR-038) — the `[LOOP]` line: keys, order, values,
 * and its absence under the `parity` profile.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOOP_LINE_KEYS,
  renderLoopLine,
  renderClassicLoopLine,
  renderStatusLine,
  buildReport,
} from "../../src/callpoints/report.ts";

const full: Parameters<typeof renderLoopLine>[0] = {
  containment: "C1",
  protection: "detect",
  units: 14,
  pass: 12,
  fail: 1,
  unchecked: 1,
  tainted: 0,
  cycles: 19,
  disengaged: 0,
  escalations: 1,
  failfastStops: 1,
  fallback: "none",
};

test("CT-115-38: the keys, in the order of F115-FR-038", () => {
  assert.deepEqual(
    [...LOOP_LINE_KEYS],
    [
      "strategy",
      "level",
      "containment",
      "protection",
      "units",
      "pass",
      "fail",
      "unchecked",
      "tainted",
      "cycles",
      "disengaged",
      "escalations",
      "failfast-stops",
      "fallback",
    ],
  );
  const line = renderLoopLine(full)!;
  assert.match(line, /^\[LOOP\] /);
  const keys = line
    .slice("[LOOP] ".length)
    .split(" ")
    .map((pair) => pair.split("=")[0]);
  assert.deepEqual(keys, [...LOOP_LINE_KEYS]);
});

test("CT-115-38: the values, and the example of the contract", () => {
  const line = renderLoopLine(full, { strategy: "micro", level: "L1" })!;
  assert.equal(
    line,
    "[LOOP] strategy=micro level=L1 containment=C1 protection=detect units=14 pass=12 fail=1 " +
      "unchecked=1 tainted=0 cycles=19 disengaged=0 escalations=1 failfast-stops=1 fallback=none",
  );
});

test("CT-115-38: protection carries ,basic when a detected toolchain has no profile", () => {
  const line = renderLoopLine({ ...full, protection: "detect", protectionBasic: true })!;
  assert.match(line, /protection=detect,basic /);
  const prevent = renderLoopLine({ ...full, protection: "prevent" })!;
  assert.match(prevent, /protection=prevent /);
});

test("CT-115-38: fallback is none or a fallback reason of row 59", () => {
  assert.match(renderLoopLine({ ...full, fallback: "none" })!, /fallback=none$/);
  assert.match(renderLoopLine({ ...full, fallback: "single-unit" })!, /fallback=single-unit$/);
  assert.throws(() => renderLoopLine({ ...full, fallback: "because" as never }), /fallback reason/);
  assert.throws(() => renderLoopLine({ ...full, containment: "C9" as never }), /containment/);
});

test("CT-115-38: with the layer off by rule the line reads strategy=classic reason=<reason>", () => {
  assert.equal(
    renderClassicLoopLine("gate-not-executing"),
    "strategy=classic reason=gate-not-executing",
  );
  assert.equal(renderClassicLoopLine("tripwire"), "strategy=classic reason=tripwire");
});

test("CT-115-38: neither line is printed under the parity profile; the status line carries the strategy", () => {
  assert.equal(renderLoopLine(full, { profile: "parity" }), undefined);
  assert.equal(renderClassicLoopLine("tripwire", { profile: "parity" }), undefined);
  assert.equal(renderStatusLine("micro", { profile: "parity" }), undefined);
  assert.equal(renderStatusLine("micro"), "strategy=micro");
  assert.equal(renderStatusLine("classic"), "strategy=classic");
});

test("CT-115-38: the report call point returns the line, the classic line, or none", () => {
  assert.deepEqual(buildReport({ engaged: true, strategy: "micro", report: full }), {
    kind: "loop-line",
    line: renderLoopLine(full)!,
  });
  assert.deepEqual(buildReport({ engaged: false, strategy: "micro", fallbackReason: "tripwire" }), {
    kind: "classic-line",
    line: "strategy=classic reason=tripwire",
  });
  assert.deepEqual(
    buildReport({ engaged: true, strategy: "micro", profile: "parity", report: full }),
    {
      kind: "none",
    },
  );
});
