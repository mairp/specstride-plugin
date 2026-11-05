/**
 * CT-115-29 (T058, F115-FR-029) — characterization: no stop once phase
 * evidence exists; evidence set aside; evidence-predates-tree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evidencePredatesTree,
  limitAfterEvidence,
  newerEvidence,
  readSetAsideEvidence,
  recordLimitAfterEvidence,
  recordSetAsideEvidence,
  setAsideEvidence,
  type EvidenceStore,
  type RunLog,
} from "../../src/closing/closing-check.ts";

test("CT-115-29: no limit and no breaker of the pass loop stops the run once evidence exists", () => {
  const withLimit = limitAfterEvidence(true);
  assert.equal(withLimit.stop, false);
  assert.equal(withLimit.repairEnds, true);
  assert.equal(withLimit.goesTo, "phase-gate");
  const without = limitAfterEvidence(false);
  assert.equal(without.stop, false);
  assert.equal(without.repairEnds, false);
  assert.equal(without.goesTo, "phase-gate");
});

test("CT-115-29: phase evidence set aside is kept in the control plane with its hash", () => {
  const setAside = setAsideEvidence("sha256:abc", "run:r1:attempt:2:evidence-aside");
  assert.equal(setAside.setAside, true);
  assert.equal(setAside.hash, "sha256:abc");
  assert.match(setAside.location, /^run:/);
});

test("CT-115-29: the set-aside evidence is durable — written once, read back on an independent read path", () => {
  // The control-plane seam the runtime hands in: the layer writes through
  // `recordSetAsideEvidence` and never answers from the write; the read goes
  // only through `readSetAsideEvidence` on the same store — an independent
  // read path over durable state that did not exist before the write.
  const store: EvidenceStore = new Map();
  assert.equal(readSetAsideEvidence(store, "run:r1:attempt:2:evidence-aside"), undefined);
  const setAside = setAsideEvidence("sha256:abc", "run:r1:attempt:2:evidence-aside");
  recordSetAsideEvidence(store, setAside, 1_000);
  const readBack = readSetAsideEvidence(store, "run:r1:attempt:2:evidence-aside");
  assert.notEqual(readBack, undefined);
  assert.equal(readBack?.hash, "sha256:abc"); // the content hash, kept
  assert.equal(readBack?.writtenAt, 1_000); // the lifecycle instant, kept
  // Other locations are untouched, and the read of a fresh store proves the
  // state lives in the control plane, not in the return value.
  assert.equal(readSetAsideEvidence(store, "run:r1:attempt:3:evidence-aside"), undefined);
  assert.equal(readSetAsideEvidence(new Map(), "run:r1:attempt:2:evidence-aside"), undefined);
  // The durable hash feeds the gate choice: the read-back evidence is the
  // one the gate takes when nothing was written again.
  const newer = newerEvidence({ hash: readBack!.hash, writtenAt: readBack!.writtenAt });
  assert.deepEqual(newer, { hash: "sha256:abc", from: "set-aside" });
});

test("CT-115-29: the phase gate takes the newer of the evidence set aside and the evidence written again", () => {
  const aside = { hash: "sha256:old", writtenAt: 10 };
  assert.deepEqual(newerEvidence(aside, { hash: "sha256:new", writtenAt: 20 }), {
    hash: "sha256:new",
    from: "written-again",
  });
  // The set-aside evidence is newer: it is taken.
  assert.deepEqual(newerEvidence(aside, { hash: "sha256:newer-but-earlier", writtenAt: 5 }), {
    hash: "sha256:old",
    from: "set-aside",
  });
  // Nothing was written again: the set-aside evidence stands.
  assert.deepEqual(newerEvidence(aside), { hash: "sha256:old", from: "set-aside" });
});

test("CT-115-29: the tree changed and the evidence did not — evidence-predates-tree", () => {
  assert.deepEqual(evidencePredatesTree({ treeChanged: true, evidenceChanged: false }), {
    fact: "evidence-predates-tree",
  });
  assert.equal(evidencePredatesTree({ treeChanged: false, evidenceChanged: false }), undefined);
  assert.equal(evidencePredatesTree({ treeChanged: true, evidenceChanged: true }), undefined);
  assert.equal(evidencePredatesTree({ treeChanged: false, evidenceChanged: true }), undefined);
});

test("CT-115-29: the run record read back shows the gate reached and no stop, once evidence exists", () => {
  // The run record of the attempt is the durable state an independent
  // reader sees: the write appends the event, and the read back of the
  // record — not the function's return value — proves no stop and no exit
  // was ever recorded.
  const log: RunLog = { events: [] };
  recordLimitAfterEvidence(log, limitAfterEvidence(true));
  assert.deepEqual(log.events, ["phase.gate.reached"]);
  assert.equal(log.stopReason, undefined);
  assert.equal(log.exitCode, undefined);
  assert.equal(log.events.includes("phase.gate.reached"), true);
});
