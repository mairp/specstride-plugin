/**
 * T036 (feature 112) — CT-112-132 (F112-FR-032): `events.gateIntegrity`.
 *
 * A planted breach for each of the FIVE invariants of the integrity of the
 * phase gate fails; a log that holds none of the events an invariant needs is
 * `info`, never `fail`; and a detected and refused attempt (`integrity.noted`
 * naming the kind) is NOT a breach. The event logs are the fixtures of the
 * test tree: the same logs the other fixtures' runs wrote.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gateIntegrityCheck,
  gateIntegrityBreaches,
  type GateEvent,
} from "../src/integrity/gate.ts";
/** A helper to build one event of a fixture log. */
function e(seq: number, type: string, data: Record<string, unknown> = {}): GateEvent {
  return { seq, type, data };
}

/** A healthy log: opener, gate, verdict, approval, closer — seq without gaps. */
function healthyLog(): GateEvent[] {
  return [
    e(1, "run.started"),
    e(2, "attempt.started", { attempt: 1 }),
    e(3, "pass.started", { attempt: 1 }),
    e(4, "pass.ended", { attempt: 1 }),
    e(5, "verification.started", { attempt: 1 }),
    e(6, "verification.ended", { attempt: 1, result: "pass" }),
    e(7, "verdict.recorded", { attempt: 1, nonce: "n-1" }),
    e(8, "approval.recorded", { attempt: 1, nonce: "n-1" }),
    e(9, "attempt.ended", { attempt: 1 }),
    e(10, "run.ended", { endCause: "done" }),
  ];
}

async function severityFor(events: readonly GateEvent[]): Promise<string> {
  // The probe receives the fixture log as the injected `events` value.
  const direct = await gateIntegrityCheck.probe({ events });
  return gateIntegrityCheck.severityRule(direct);
}

test("CT-112-132: a healthy log gives no breach, and a log without the events gives info", async () => {
  assert.equal(await severityFor(healthyLog()), "ok");
  // No event of any invariant in the log: `info`, never `fail` (F112-FR-032).
  assert.equal(await severityFor([]), "info");
  const unrelated = await severityFor([e(1, "usage.reported", { role: "proposer", spent: 1 })]);
  assert.equal(unrelated, "info");
});

test("CT-112-132: invariant 1 — an approval without the gate fails", async () => {
  const log = healthyLog().filter((ev) => ev.type !== "verification.ended");
  const { breaches } = gateIntegrityBreaches(log);
  assert.ok(breaches.some((b) => b.invariant === 1 && b.kind === "approval-without-verdict"));
  assert.equal(await severityFor(log), "fail");
  // An approval with no matching critic verdict fails as well.
  const noVerdict = healthyLog().filter((ev) => ev.type !== "verdict.recorded");
  assert.equal(await severityFor(noVerdict), "fail");
});

test("CT-112-132: invariant 2 — an inner event that changes a limited counter fails", async () => {
  const log = [...healthyLog(), e(11, "inner.microloop", { rejectCount: 7 })];
  assert.equal(await severityFor(log), "fail");
  // Any limited counter trips it: the ordinal, the streak, the signature.
  for (const counter of ["phaseAttemptOrdinal", "malformedStreak", "diagnosticianSignature"]) {
    const log2 = [...healthyLog(), e(11, "inner.unit", { [counter]: 1 })];
    assert.ok(gateIntegrityBreaches(log2).breaches.length > 0, counter);
  }
  // An inner event without a counter does not.
  assert.equal(await severityFor([...healthyLog(), e(11, "inner.note", { text: "x" })]), "ok");
});

test("CT-112-132: invariant 3 — a critic-class input with an excluded field fails", async () => {
  const log = [...healthyLog(), e(11, "critic.input", { note: "pasted transcript" })];
  assert.equal(await severityFor(log), "fail");
  assert.equal(await severityFor([...healthyLog(), e(11, "critic.input", { hash: "abc" })]), "ok");
});

test("CT-112-132: invariant 4 — a pass that did not run, ran tainted, or fingerprints differ", async () => {
  // A pass recorded for a check that never started.
  const neverRan = [...healthyLog(), e(11, "check.passed", { checkId: "ghost" })];
  assert.equal(await severityFor(neverRan), "fail");
  // A check that ran tainted and still reads as pass.
  const tainted = [
    ...healthyLog(),
    e(11, "check.started", { checkId: "c", tainted: true }),
    e(12, "check.passed", { checkId: "c" }),
  ];
  assert.equal(await severityFor(tainted), "fail");
  // Fingerprints that differ before and after.
  const fingerprints = [
    ...healthyLog(),
    e(11, "check.started", { checkId: "c", fingerprint: "aaa" }),
    e(12, "check.passed", { checkId: "c", fingerprint: "bbb" }),
  ];
  assert.equal(await severityFor(fingerprints), "fail");
  // A clean check reads as ok.
  const clean = [
    ...healthyLog(),
    e(11, "check.started", { checkId: "c", fingerprint: "aaa" }),
    e(12, "check.passed", { checkId: "c", fingerprint: "aaa" }),
    e(13, "check.ended", { checkId: "c" }),
  ];
  assert.equal(await severityFor(clean), "ok");
});

test("CT-112-132: invariant 5 — a seq gap or an unclosed opener fails", async () => {
  const gapped = healthyLog().filter((ev) => ev.seq !== 5);
  assert.equal(await severityFor(gapped), "fail");
  const gappedDetail = gateIntegrityBreaches(gapped).breaches;
  assert.ok(gappedDetail.some((b) => b.kind === "seq-gap"));
  // An opener that nothing closes.
  const unclosed = [
    e(1, "run.started"),
    e(2, "pass.started", { attempt: 1 }),
    e(3, "run.ended", { endCause: "done" }),
  ];
  const unclosedBreaches = gateIntegrityBreaches(unclosed).breaches;
  assert.ok(unclosedBreaches.some((b) => b.kind === "unclosed"));
  assert.equal(await severityFor(unclosed), "fail");
});

test("CT-112-132: a detected and refused attempt is NOT a breach", async () => {
  const bad = healthyLog().filter((ev) => ev.type !== "verification.ended");
  assert.equal(await severityFor(bad), "fail");
  // The run detected the breach and refused: the log notes it (also the
  // seq-gap and the unclosed opener the removal itself causes).
  const refused = [
    ...bad,
    e(11, "integrity.noted", { kind: "approval-without-verdict" }),
    e(12, "integrity.noted", { kind: "seq-gap" }),
    e(13, "integrity.noted", { kind: "unclosed" }),
  ];
  assert.equal(await severityFor(refused), "ok");
  // The refusal covers the other kinds too.
  for (const kind of [
    "inner-counter-changed",
    "critic-input-excluded-field",
    "false-pass",
    "seq-gap",
    "unclosed",
  ]) {
    assert.ok(
      !gateIntegrityBreaches([
        e(1, "inner.x", { rejectCount: 1 }),
        e(2, "integrity.noted", { kind }),
      ]).breaches.some((b) => b.kind === kind),
      kind,
    );
  }
});

test("CT-112-132: the check is in the events group, never launch-blocking, order 45", () => {
  assert.equal(gateIntegrityCheck.id, "events.gateIntegrity");
  assert.equal(gateIntegrityCheck.group, "events");
  assert.equal(gateIntegrityCheck.lb, false);
  assert.equal(gateIntegrityCheck.order, 45);
});
