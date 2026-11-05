/**
 * CT-115-39 (T106, F115-FR-039) — one test case per breach kind of the
 * closed set of row 141; and a refused act is an integrity event, not a
 * breach.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BREACH_KINDS,
  checkApproval,
  checkOuterCounters,
  checkCriticInputs,
  checkPasses,
  checkInvariants,
  isRefusal,
} from "../../src/breach/invariants.ts";

test("CT-115-39: the closed set of the breach kinds, row 141", () => {
  assert.deepEqual(
    [...BREACH_KINDS],
    ["approval-without-gate", "outer-counter-changed", "critic-input-excluded-field", "false-pass"],
  );
});

test("CT-115-39: approval-without-gate — an approval without a critic reply that matches the nonce", () => {
  const finding = checkApproval({
    events: [{ type: "verdict.recorded", fields: { nonceOk: false } }],
    outerCounters: { atLaunch: {}, now: {} },
    approval: { nonce: "n-1", phase: 3, attempt: 1, afterGate: true, afterPassLoop: true },
  });
  assert.equal(finding.length, 1);
  assert.equal(finding[0]!.kind, "approval-without-gate");
  assert.match(finding[0]!.detail, /nonce/);
});

test("CT-115-39: outer-counter-changed — a counter of F115-FR-027 changed by an inner event", () => {
  const finding = checkOuterCounters({
    events: [{ type: "check.started", fields: { checkId: "c1" } }],
    outerCounters: { atLaunch: { reject: 4 }, now: { reject: 5 } },
  });
  assert.equal(finding.length, 1);
  assert.equal(finding[0]!.kind, "outer-counter-changed");
  assert.match(finding[0]!.detail, /reject/);
});

test("CT-115-39: critic-input-excluded-field — a field annex D §D.7 never holds", () => {
  const finding = checkCriticInputs({
    events: [],
    outerCounters: { atLaunch: {}, now: {} },
    criticInputs: [{ phase: 2, attempt: 1, fields: { units: 4, note: "the proposer's note" } }],
  });
  assert.equal(finding.length, 1);
  assert.equal(finding[0]!.kind, "critic-input-excluded-field");
  assert.match(finding[0]!.detail, /note/);
});

test("CT-115-39: false-pass — a pass for a check that did not run, ran tainted, or differs in fingerprints", () => {
  const didNotRun = checkPasses({
    events: [],
    outerCounters: { atLaunch: {}, now: {} },
    passes: [{ unitId: "u1", checkId: "ghost", result: "pass" }],
  });
  assert.equal(didNotRun.length, 1);
  assert.equal(didNotRun[0]!.kind, "false-pass");
  assert.match(didNotRun[0]!.detail, /never started/);

  const tainted = checkPasses({
    events: [
      { type: "check.started", fields: { checkId: "c1" } },
      { type: "check.ended", fields: { checkId: "c1", condition: "tainted" } },
    ],
    outerCounters: { atLaunch: {}, now: {} },
    passes: [{ unitId: "u1", checkId: "c1", result: "pass" }],
  });
  assert.equal(tainted.length, 1);
  assert.equal(tainted[0]!.kind, "false-pass");
  assert.match(tainted[0]!.detail, /tainted/);

  const moved = checkPasses({
    events: [{ type: "check.started", fields: { checkId: "c1" } }],
    outerCounters: { atLaunch: {}, now: {} },
    passes: [
      {
        unitId: "u1",
        checkId: "c1",
        result: "pass",
        fingerprint: "aaa",
        fingerprintAtEntry: "bbb",
      },
    ],
  });
  assert.equal(moved.length, 1);
  assert.equal(moved[0]!.kind, "false-pass");
  assert.match(moved[0]!.detail, /fingerprint/);
});

test("CT-115-39: a refused act is an integrity event and not a breach", () => {
  const input = {
    events: [
      { type: "check.started", fields: { checkId: "c1" } },
      // The runtime detected the ledger change and refused it:
      { type: "integrity.noted", fields: { kind: "ledger-invalid", detail: "chained" } },
    ],
    outerCounters: { atLaunch: { reject: 4 }, now: { reject: 5 } },
  };
  assert.equal(isRefusal(input, "outer-counter-changed", "reject changed"), true);
  assert.deepEqual(checkInvariants(input), []);
});

test("CT-115-39: the invariants are one check over the event file and the ledger", () => {
  const breaches = checkInvariants({
    events: [],
    outerCounters: { atLaunch: {}, now: {} },
    approval: { nonce: "n", phase: 1, attempt: 1, afterGate: true, afterPassLoop: true },
    criticInputs: [{ phase: 1, attempt: 1, fields: { stdout: "…" } }],
    passes: [{ unitId: "u", checkId: "x", result: "pass" }],
  });
  assert.deepEqual(breaches.map((b) => b.kind).sort(), [
    "approval-without-gate",
    "critic-input-excluded-field",
    "false-pass",
  ]);
});
