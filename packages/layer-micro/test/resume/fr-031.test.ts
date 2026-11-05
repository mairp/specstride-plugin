/**
 * CT-115-31 (T097, F115-FR-031; F115-SC-009) — characterization: one test
 * case per resume state.
 *
 * The five resume states of `ledger-micro-115.json` (the table of
 * `data-model.md`): a pass was running (no record); the last record is
 * `unit-declared`, `check-started`, `check-finished` or `disengaged`. For
 * each state a fixture stops the engine in that state and resumes; the
 * action and the counts equal the table of F115-FR-031.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendRecord, newLedger, type MicroLedger } from "../../src/ledger/records.ts";
import {
  RESUME_STATES,
  resumeStateOf,
  resumeFromLedger,
  readResumeLog,
  type ResumeLog,
} from "../../src/callpoints/resume.ts";

/** Fixture: stop the engine with the given last record kind. */
function stoppedAt(
  kind: "unit-declared" | "check-started" | "check-finished" | "disengaged",
  data: Record<string, unknown> = {},
): MicroLedger {
  return appendRecord(newLedger("run-s", 4), kind, data);
}

test("CT-115-31 (F115-FR-031): the five resume states are the closed set of the contract", () => {
  assert.deepEqual(
    [...RESUME_STATES],
    ["pass-running", "checkpoint-accepted", "check-running", "result-undelivered", "disengaged"],
  );
});

test("CT-115-31 state 1: no record — a pass was running; the pass is lost and no cycle is counted", () => {
  const ledger = newLedger("run-s", 4); // stopped mid-pass, nothing recorded
  assert.equal(resumeStateOf(ledger), "pass-running");
  const resumed = resumeFromLedger(ledger, {});
  assert.ok(resumed.ok);
  if (!resumed.ok) return;
  assert.equal(resumed.outcome.action, "pass-lost");
  assert.equal(resumed.outcome.countsCycle, false);
  assert.equal(resumed.outcome.countsFailure, false);
});

test("CT-115-31 state 2: last `unit-declared` — the check runs on the current tree; a differing fingerprint marks the declaration superseded", () => {
  const ledger = stoppedAt("unit-declared", {
    taskIds: ["T010"],
    fingerprint: "tree-aaa",
    checkpoint: "unit:u1:checkpoint",
  });
  assert.equal(resumeStateOf(ledger), "checkpoint-accepted");

  // Same fingerprint: the declaration stands.
  const same = resumeFromLedger(ledger, { currentFingerprint: "tree-aaa" });
  assert.ok(same.ok);
  if (!same.ok) return;
  assert.equal(same.outcome.action, "run-check");
  assert.equal(same.outcome.declarationSuperseded, false);

  // A differing fingerprint: the declaration is superseded, the result binds
  // to the current fingerprint.
  const diff = resumeFromLedger(ledger, { currentFingerprint: "tree-bbb" });
  assert.ok(diff.ok);
  if (!diff.ok) return;
  assert.equal(diff.outcome.action, "run-check");
  assert.equal(diff.outcome.declarationSuperseded, true);
  assert.equal(diff.outcome.resultBoundTo, "tree-bbb");
});

test("CT-115-31 state 3: last `check-started` — the check runs again; the interrupted run is recorded as `interrupted`; no cycle, no failure", () => {
  const ledger = stoppedAt("check-started", { ordinal: 2, scope: "inner", taskIds: ["T010"] });
  assert.equal(resumeStateOf(ledger), "check-running");
  const log: ResumeLog = { events: [] };
  const resumed = resumeFromLedger(ledger, { log });
  assert.ok(resumed.ok);
  if (!resumed.ok) return;
  assert.equal(resumed.outcome.action, "rerun-check");
  assert.equal(resumed.outcome.recordedAs, "interrupted");
  assert.equal(resumed.outcome.countsCycle, false);
  assert.equal(resumed.outcome.countsFailure, false);
  // The interruption is durable: an independent read path sees it.
  assert.deepEqual(readResumeLog(log), ["interrupted:check-running"]);
});

test("CT-115-31 state 4: last `check-finished` — the result is delivered when the fingerprint matches, the check runs again otherwise", () => {
  const ledger = stoppedAt("check-finished", {
    ordinal: 3,
    scope: "inner",
    fingerprint: "tree-ccc",
    delivered: false,
  });
  assert.equal(resumeStateOf(ledger), "result-undelivered");

  const matching = resumeFromLedger(ledger, { currentFingerprint: "tree-ccc" });
  assert.ok(matching.ok);
  if (!matching.ok) return;
  assert.equal(matching.outcome.action, "deliver-result");

  const changed = resumeFromLedger(ledger, { currentFingerprint: "tree-ddd" });
  assert.ok(changed.ok);
  if (!changed.ok) return;
  assert.equal(changed.outcome.action, "run-check");
});

test("CT-115-31 state 5: last `disengaged` — the layer stays off for the rest of the phase attempt", () => {
  const ledger = stoppedAt("disengaged", { cause: "unresolved-units" });
  assert.equal(resumeStateOf(ledger), "disengaged");
  const resumed = resumeFromLedger(ledger, {});
  assert.ok(resumed.ok);
  if (!resumed.ok) return;
  assert.equal(resumed.outcome.action, "stay-off");
  assert.equal(resumed.outcome.layerOff, true);
});

test("CT-115-31: every resume writes a durable record an independent read path sees", () => {
  const log: ResumeLog = { events: [] };
  const outcomes = [
    resumeFromLedger(newLedger("run-s", 1), { log }),
    resumeFromLedger(stoppedAt("disengaged"), { log }),
  ];
  for (const outcome of outcomes) assert.ok(outcome.ok);
  assert.equal(readResumeLog(log).length, 2);
  assert.match(readResumeLog(log)[0], /^pass-lost:/);
  assert.match(readResumeLog(log)[1], /^stay-off:/);
});
