/**
 * CT-115-128 (T109, IR-28; F115-FR-039) — a breach of the integrity of the
 * phase gate: the invariants are checked on the event file of every run by
 * the doctor and in the build, each finding carries the rule id IR-28, and a
 * refused act never becomes a breach.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BREACH_KINDS, RULE_ID, checkInvariants } from "../../src/breach/invariants.ts";
import { reportBreach } from "../../src/breach/report.ts";

test("CT-115-128: every breach kind is found by the invariant check over the event file", () => {
  // approval-without-gate
  const withoutGate = checkInvariants({
    events: [],
    outerCounters: { atLaunch: {}, now: {} },
    approval: { nonce: "n", phase: 1, attempt: 2, afterGate: true, afterPassLoop: true },
  });
  assert.deepEqual(
    withoutGate.map((b) => b.kind),
    ["approval-without-gate"],
  );

  // outer-counter-changed
  const counter = checkInvariants({
    events: [{ type: "check.started", fields: { checkId: "c" } }],
    outerCounters: { atLaunch: { reject: 1 }, now: { reject: 2 } },
  });
  assert.deepEqual(
    counter.map((b) => b.kind),
    ["outer-counter-changed"],
  );

  // critic-input-excluded-field
  const excluded = checkInvariants({
    events: [],
    outerCounters: { atLaunch: {}, now: {} },
    criticInputs: [{ phase: 1, attempt: 1, fields: { stderr: "…" } }],
  });
  assert.deepEqual(
    excluded.map((b) => b.kind),
    ["critic-input-excluded-field"],
  );

  // false-pass
  const falsePass = checkInvariants({
    events: [],
    outerCounters: { atLaunch: {}, now: {} },
    passes: [{ unitId: "u", checkId: "ghost", result: "pass" }],
  });
  assert.deepEqual(
    falsePass.map((b) => b.kind),
    ["false-pass"],
  );

  assert.deepEqual(
    [...BREACH_KINDS],
    ["approval-without-gate", "outer-counter-changed", "critic-input-excluded-field", "false-pass"],
  );
});

test("CT-115-128: a clean event file gives no breach", () => {
  assert.deepEqual(
    checkInvariants({
      events: [
        { type: "check.started", fields: { checkId: "c1" } },
        { type: "verdict.recorded", fields: { nonceOk: true } },
      ],
      outerCounters: { atLaunch: { reject: 4 }, now: { reject: 4 } },
    }),
    [],
  );
});

test("CT-115-128: every finding carries the rule id IR-28 and is reportable", () => {
  for (const kind of BREACH_KINDS) {
    assert.equal(RULE_ID[kind], "IR-28");
  }
  const finding = checkInvariants({
    events: [],
    outerCounters: { atLaunch: {}, now: {} },
    approval: { nonce: "n", phase: 1, attempt: 1, afterGate: true, afterPassLoop: true },
  })[0]!;
  const report = reportBreach(finding);
  assert.equal(report.ruleId, "IR-28");
  assert.equal(report.directive, "layerOffForRun");
});

test("CT-115-128: an act the runtime refused is an integrity event and not a breach", () => {
  assert.deepEqual(
    checkInvariants({
      events: [
        { type: "check.started", fields: { checkId: "c" } },
        { type: "integrity.noted", fields: { kind: "ledger-invalid", detail: "chained" } },
      ],
      outerCounters: { atLaunch: { reject: 1 }, now: { reject: 2 } },
    }),
    [],
  );
});
