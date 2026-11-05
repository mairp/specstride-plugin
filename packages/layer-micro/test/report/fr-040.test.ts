/**
 * CT-115-40 (T107, F115-FR-040) — on a breach: the layer off for the run,
 * the approval void, the phase gated again. The layer itself does not void
 * the approval: it reports the breach, and the engine acts through the
 * contract of the approval record.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkInvariants } from "../../src/breach/invariants.ts";
import { reportBreach, tripwireRaisedEvent } from "../../src/breach/report.ts";

const breached = checkInvariants({
  events: [{ type: "check.started", fields: { checkId: "c1" } }],
  outerCounters: { atLaunch: { reject: 4 }, now: { reject: 5 } },
})[0]!;

test("CT-115-40: on a breach the layer returns layerOffForRun", () => {
  const report = reportBreach(breached);
  assert.equal(report.directive, "layerOffForRun");
  assert.equal(report.cause, "breach");
});

test("CT-115-40: the approval is void and the phase is gated again — by the engine", () => {
  const report = reportBreach(breached);
  assert.equal(report.approvalVoid, true);
  // The layer MUST NOT void the approval: it reports, the engine acts.
  assert.equal(report.approvalVoidedBy, "engine");
  assert.equal(report.phaseGatedAgain, true);
});

test("CT-115-40: the breach is in the digest", () => {
  const report = reportBreach(breached);
  assert.equal(report.digestEntry, `breach:${report.kind}:${report.ruleId}`);
});

test("CT-115-40: the report carries no exit code, no stop reason and no run state (IR-07)", () => {
  const report = reportBreach(breached);
  assert.equal(report.exitCode, undefined);
  assert.equal(report.stopReason, undefined);
  assert.equal(report.runState, undefined);
});

test("CT-115-40: the tripwire record is requested; the event carries the kind and the rule id", () => {
  const report = reportBreach(breached);
  assert.equal(report.tripwireRequested, true);
  const event = tripwireRaisedEvent(report);
  assert.equal(event.type, "tripwire.raised");
  assert.equal(event.fields["kind"], report.kind);
  assert.equal(event.fields["ruleId"], report.ruleId);
});

test("CT-115-40: only a breach kind of row 141 is reportable", () => {
  assert.throws(
    () =>
      reportBreach({
        kind: "not-a-breach" as never,
        ruleId: "IR-28",
        detail: "d",
      }),
    /row 141/,
  );
});
