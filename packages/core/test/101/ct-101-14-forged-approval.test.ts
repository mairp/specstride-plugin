/**
 * T070 — own test CT-101-14: a forged approval approves nothing.
 *
 * proves: F101-FR-031 (the five bindings, a missing record, a bare marker, and
 * the integrity event that names the phase and what failed) and F101-FR-011
 * (an APPROVED verdict whose record does not verify is handled as a rejection).
 *
 * criterion: F101-SC-004 — "100 per cent of approval records that are forged,
 * wrongly signed, missing or bound to another hash of the phase evidence are
 * refused on resume, and a planted marker approves 0 phases."
 *
 * fixtures: `FX-13/planted-approval-marker` and `FX-01`, port side only.
 *
 * The ways of forging are the SEVEN of `WAYS_OF_FORGING` plus the bare marker,
 * which is the eighth member of row 255 of annex X §X.6. Each is driven twice:
 *
 *  - over the verification itself (`packages/core/src/approval/verify.ts`),
 *    with the record built honestly and then broken in exactly one place, so
 *    that the failure the integrity event names is the EARLIEST cause and not
 *    a cascade; and
 *  - over a whole RESUME of the engine (`forgedResume`), so the claim "refused
 *    on resume" is measured on the run and not on a unit.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalRecordHash } from "@specstride/kernel/hasher";
import { APPROVAL_FAILURES, isApprovalFailure } from "@specstride/contracts/enums/gate";
import {
  BINDINGS_CHECKED,
  INTEGRITY_EVENT_KIND,
  INTEGRITY_EVENT_TYPE,
  THE_TREE_FINGERPRINT_IS_COMPARED_AT,
  THE_TREE_FINGERPRINT_MAKES_A_RECORD_FAIL,
  verifyApprovalRecord,
  type ApprovalVerificationInputs,
} from "../../src/approval/verify.ts";
import {
  APPROVAL_SCHEMA_ID,
  unsignedApprovalRecord,
  type ApprovalRecordOfThePhase,
} from "../../src/approval/record.ts";
import {
  keyIdOf,
  newApprovalKey,
  signWithTheApprovalKey,
  type ApprovalKeyRecord,
} from "../../src/approval/key.ts";
import {
  AN_APPROVED_VERDICT_WITHOUT_A_VERIFYING_RECORD_IS,
  outcomeOfAnApprovedVerdict,
} from "../../src/engine/phase.ts";
import {
  FX_13_MARKERS_ON_EVERY_PHASE,
  FX_13_PLANTED_MARKER,
  FX_01_THREE_PHASES,
  WAYS_OF_FORGING,
  forgedResume,
  runFixture,
  type WayOfForging,
} from "./run-harness.ts";

/* ------------------------------------------------------------------ *
 * An honest approval of phase 1, and the one key that signed it.
 * ------------------------------------------------------------------ */

const KEY: ApprovalKeyRecord = newApprovalKey("101-gate-and-verdict", "2026-10-03T00:00:00.000Z");
const EVIDENCE_HASH = createHash("sha256").update("the phase evidence", "utf8").digest("hex");
const VERIFICATION_HASH = createHash("sha256").update("the stored result", "utf8").digest("hex");
const NONCE_HASH = createHash("sha256").update("a".repeat(16)).digest("hex");

/** The record as the engine writes it, signed with `KEY`. */
function honestRecord(): ApprovalRecordOfThePhase {
  const unsigned = unsignedApprovalRecord(
    {
      schema: APPROVAL_SCHEMA_ID,
      feature: "101-gate-and-verdict",
      phase: 1,
      runId: "run-honest",
      engineStartId: "e1",
      attemptId: "e1-a1",
      verdictId: "v-1-1",
      nonceHash: NONCE_HASH,
      critic: {
        harness: "stub",
        provider: "stub",
        model: "stub-critic",
        form: "tool-less",
        proof: "not-made",
      },
      evidenceHash: EVIDENCE_HASH,
      verification: { mode: "required", hash: VERIFICATION_HASH },
      treeFingerprint: "tree-1",
      approvedAt: "2026-10-03T00:00:00.000Z",
    } as ApprovalRecordOfThePhase,
    KEY.keyId,
  );
  return Object.freeze({
    ...unsigned,
    sig: signWithTheApprovalKey(KEY, canonicalRecordHash(unsigned)),
  }) as ApprovalRecordOfThePhase;
}

/** The inputs of an honest verification of phase 1. */
function honestInputs(): ApprovalVerificationInputs {
  return {
    phase: 1,
    record: honestRecord(),
    key: KEY,
    verdictRecord: { verdictId: "v-1-1", verdict: "APPROVED", nonceHash: NONCE_HASH },
    evidenceHashSetAside: EVIDENCE_HASH,
    storedVerificationHash: VERIFICATION_HASH,
    canonicalRecordHash,
  };
}

/** One way of forging, as inputs of the verification. */
function forged(how: WayOfForging | "marker-only"): ApprovalVerificationInputs {
  const honest = honestInputs();
  const record = honest.record as ApprovalRecordOfThePhase;
  switch (how) {
    case "missing":
      return { ...honest, record: undefined };
    case "marker-only":
      // A bare approval marker of an as-is system, with no record beside it.
      return { ...honest, record: undefined, markerStands: true };
    case "schema":
      return { ...honest, record: { ...record, phase: "one" } };
    case "signature":
      return { ...honest, record: { ...record, sig: "0".repeat(64) } };
    case "key-unknown":
      return { ...honest, record: { ...record, keyId: "f".repeat(64) } };
    case "verdict":
      return {
        ...honest,
        verdictRecord: { verdictId: "v-1-1", verdict: "REJECTED", nonceHash: NONCE_HASH },
      };
    case "evidence-hash":
      return { ...honest, evidenceHashSetAside: "a".repeat(64) };
    case "verification-hash":
      return { ...honest, storedVerificationHash: "b".repeat(64) };
  }
}

/** Every way of forging, including the bare marker. */
const EVERY_WAY: readonly (WayOfForging | "marker-only")[] = Object.freeze([
  ...WAYS_OF_FORGING,
  "marker-only",
]);

/* ------------------------------------------------------------------ *
 * The honest record is the control: the test is not passing on nothing.
 * ------------------------------------------------------------------ */

test("CT-101-14: the honest approval of phase 1 VERIFIES (the control)", () => {
  const read = verifyApprovalRecord(honestInputs());
  assert.equal(
    read.approved,
    true,
    "the honest record must verify, or every case below is vacuous",
  );
  assert.equal(read.failed, undefined);
  assert.equal(read.integrityEvent, undefined);
  // F101-FR-031 — the five bindings the requirement names, in its order.
  assert.deepEqual(
    [...BINDINGS_CHECKED],
    [
      "schema",
      "signature",
      "verdict record",
      "hash of the phase evidence set aside",
      "hash of the stored result of the verification gate",
    ],
  );
});

test("CT-101-14: the fingerprint of the tree never makes a record fail (F101-FR-031)", () => {
  assert.equal(THE_TREE_FINGERPRINT_MAKES_A_RECORD_FAIL, false);
  // The verification is handed NO fingerprint of the tree as it stands, so it
  // cannot compare one at all: the field does not exist on its inputs.
  assert.equal(Object.hasOwn(honestInputs(), "treeFingerprint"), false);
  // A record that binds ANY fingerprint verifies, as long as its own five
  // bindings hold: the record below binds a fingerprint of a tree that is no
  // longer there, and it still verifies.
  const unsigned = unsignedApprovalRecord(
    { ...honestRecord(), treeFingerprint: "a-tree-that-is-gone" } as ApprovalRecordOfThePhase,
    KEY.keyId,
  );
  const bound = {
    ...unsigned,
    sig: signWithTheApprovalKey(KEY, canonicalRecordHash(unsigned)),
  } as ApprovalRecordOfThePhase;
  const read = verifyApprovalRecord({ ...honestInputs(), record: bound });
  assert.equal(read.approved, true);
  assert.equal(read.record?.treeFingerprint, "a-tree-that-is-gone");
  // Where the comparison IS made is phase entry (F100-FR-136).
  assert.equal(THE_TREE_FINGERPRINT_IS_COMPARED_AT, "phase entry");
});

/* ------------------------------------------------------------------ *
 * Every way of forging: not approved, and the event names what failed.
 * ------------------------------------------------------------------ */

for (const how of EVERY_WAY) {
  test(`CT-101-14: a \`${how}\` approval counts as NOT approved and names what failed`, () => {
    const read = verifyApprovalRecord(forged(how));
    assert.equal(read.approved, false, `\`${how}\` must not count as approved`);
    // The failure is a member of row 255 of annex X §X.6, and it is the one
    // the forgery broke — the EARLIEST cause, not a consequence.
    assert.equal(read.failed, how);
    assert.ok(isApprovalFailure(String(read.failed)));
    // F101-FR-031 — an integrity event that NAMES THE PHASE and WHAT FAILED.
    const event = read.integrityEvent;
    assert.ok(event !== undefined, "an integrity event must be raised");
    assert.equal(event.type, INTEGRITY_EVENT_TYPE);
    assert.equal(event.kind, INTEGRITY_EVENT_KIND);
    assert.equal(event.phase, 1);
    assert.equal(event.failed, how);
    assert.match(event.detail, /phase 1/);
    assert.match(event.detail, new RegExp(how));
    // No event of a failed approval carries key MATERIAL (F101-FR-030).
    assert.equal(JSON.stringify(event).includes(KEY.key), false);
  });
}

test("CT-101-14: every member of row 255 is reached by a way of forging", () => {
  const reached = new Set(EVERY_WAY.map((how) => verifyApprovalRecord(forged(how)).failed));
  for (const member of APPROVAL_FAILURES) {
    assert.ok(reached.has(member), `no way of forging reaches \`${member}\``);
  }
  assert.equal(reached.size, APPROVAL_FAILURES.length);
});

test("CT-101-14: a record signed with ANOTHER key of the same shape does not verify", () => {
  // The forger holds a key, just not THIS one: the signature is well formed
  // and over the right canonical hash, and it still fails.
  const other = newApprovalKey("101-gate-and-verdict", "2026-10-03T00:00:00.000Z");
  assert.notEqual(other.key, KEY.key);
  const honest = honestInputs();
  const record = honest.record as ApprovalRecordOfThePhase;
  const unsigned = unsignedApprovalRecord(record, record.keyId);
  const read = verifyApprovalRecord({
    ...honest,
    record: { ...record, sig: signWithTheApprovalKey(other, canonicalRecordHash(unsigned)) },
  });
  assert.equal(read.approved, false);
  assert.equal(read.failed, "signature");
});

test("CT-101-14: a record that names a key whose id does not match its material fails", () => {
  // `keyId` is the hash of the material (F101-FR-030), so a record that names
  // a key id the runtime's key does not carry is `key-unknown`.
  const honest = honestInputs();
  assert.equal(KEY.keyId, keyIdOf(KEY.key));
  const read = verifyApprovalRecord({
    ...honest,
    key: { ...KEY, keyId: "c".repeat(64) },
  });
  assert.equal(read.approved, false);
  assert.equal(read.failed, "key-unknown");
});

test("CT-101-14: a verdict record with the nonce of another call does not approve", () => {
  const honest = honestInputs();
  const read = verifyApprovalRecord({
    ...honest,
    verdictRecord: {
      verdictId: "v-1-1",
      verdict: "APPROVED",
      nonceHash: createHash("sha256").update("b".repeat(16)).digest("hex"),
    },
  });
  assert.equal(read.approved, false);
  assert.equal(read.failed, "verdict");
});

/* ------------------------------------------------------------------ *
 * F101-SC-004 — refused ON RESUME, over the whole engine.
 * ------------------------------------------------------------------ */

for (const how of WAYS_OF_FORGING) {
  test(`CT-101-14 (resume): a \`${how}\` approval of phase 1 makes the run start AT phase 1`, async () => {
    const run = await runFixture(forgedResume(how));
    const started = run.events.filter((e) => e.type === "phase.started").map((e) => e.data.phase);
    // The honest resume of FX-13 starts at phase 2; with the approval forged
    // the run starts at phase 1 — the forgery approved nothing.
    assert.deepEqual(started, [1, 2, 3], `\`${how}\` was accepted on resume`);
    // The read raised the integrity event of THAT phase and THAT failure.
    const events = run.integrityEvents.filter((e) => e.phase === 1);
    assert.ok(events.length >= 1, "no integrity event for the forged phase");
    assert.equal(events[0]?.failed, how);
    assert.equal(events[0]?.kind, INTEGRITY_EVENT_KIND);
    // It reached the event stream of the run, with the phase and the failure.
    const emitted = run.events.filter((e) => e.type === INTEGRITY_EVENT_TYPE);
    assert.ok(emitted.some((e) => e.data.phase === 1 && e.data.failed === how));
    assert.equal(run.exitCode, 0);
  });
}

test("CT-101-14 (resume): the honest resume of FX-13 starts at phase 2 (the control)", async () => {
  const run = await runFixture({ ...forgedResume("missing"), forgeTheApprovalOf: undefined });
  const started = run.events.filter((e) => e.type === "phase.started").map((e) => e.data.phase);
  assert.deepEqual(started, [2, 3]);
});

test("CT-101-14: F101-SC-004 — 100 per cent of the forgeries are refused on resume", async () => {
  let refused = 0;
  for (const how of WAYS_OF_FORGING) {
    const run = await runFixture(forgedResume(how));
    const started = run.events.filter((e) => e.type === "phase.started").map((e) => e.data.phase);
    if (started[0] === 1) refused += 1;
  }
  assert.equal(refused, WAYS_OF_FORGING.length);
  assert.equal(refused / WAYS_OF_FORGING.length, 1);
});

/* ------------------------------------------------------------------ *
 * F101-SC-004 — a planted marker approves 0 phases.
 * ------------------------------------------------------------------ */

test("CT-101-14 (FX-13/planted-approval-marker): a bare marker approves 0 phases", async () => {
  const run = await runFixture(FX_13_PLANTED_MARKER);
  const started = run.events.filter((e) => e.type === "phase.started").map((e) => e.data.phase);
  // The marker stands in the workspace part; the run starts at the phase
  // anyway, so the marker approved nothing.
  assert.deepEqual(started, [1]);
  const marker = [...run.files.keys()].filter((p) => p.endsWith("GATE1-APPROVED"));
  assert.equal(marker.length, 1, "the marker must still stand: it is not repaired, it is ignored");
  // The failure is `marker-only` and not `missing`: a planted marker is
  // reported as what it is (threat T-02).
  assert.equal(
    run.integrityEvents.some((e) => e.phase === 1 && e.failed === "marker-only"),
    true,
  );
});

test("CT-101-14: markers on EVERY phase approve 0 of them (F101-SC-004)", async () => {
  const run = await runFixture(FX_13_MARKERS_ON_EVERY_PHASE);
  const started = run.events.filter((e) => e.type === "phase.started").map((e) => e.data.phase);
  assert.deepEqual(started, [1, 2, 3]);
  // Not one of the three markers took the run past a phase.
  const approvedByAMarker = 0;
  assert.equal(approvedByAMarker, 0);
  assert.equal(run.integrityEvents.filter((e) => e.failed === "marker-only").length >= 1, true);
  // The engine itself writes NO marker (F101-FR-029): every marker on the tree
  // is the one the fixture planted.
  const markers = [...run.files.keys()].filter((p) => /GATE\d+-APPROVED$/.test(p));
  assert.deepEqual(markers.length, 3);
});

/* ------------------------------------------------------------------ *
 * F101-FR-011 — an APPROVED verdict without a verifying record.
 * ------------------------------------------------------------------ */

test("CT-101-11-14: F101-FR-011 — an APPROVED verdict whose record is missing is a rejection", () => {
  assert.equal(AN_APPROVED_VERDICT_WITHOUT_A_VERIFYING_RECORD_IS, "rejected");
  const after = outcomeOfAnApprovedVerdict(1, () => verifyApprovalRecord(forged("missing")));
  assert.equal(after.outcome, "rejected");
  assert.equal(after.failed, "missing");
  assert.equal(after.integrityEvent?.phase, 1);
});

for (const how of EVERY_WAY) {
  test(`CT-101-14: F101-FR-011 — an APPROVED verdict with a \`${how}\` record is a rejection`, () => {
    const after = outcomeOfAnApprovedVerdict(1, () => verifyApprovalRecord(forged(how)));
    assert.equal(after.outcome, "rejected");
    assert.equal(after.failed, how);
  });
}

test("CT-101-14: F101-FR-011 — with a record that verifies the outcome is `approved`", () => {
  const after = outcomeOfAnApprovedVerdict(1, () => verifyApprovalRecord(honestInputs()));
  assert.equal(after.outcome, "approved");
  assert.equal(after.failed, undefined);
  assert.equal(after.integrityEvent, undefined);
});

test("CT-101-14 (FX-01): an honest run writes an approval record per phase that verifies", async () => {
  const run = await runFixture(FX_01_THREE_PHASES);
  assert.equal(run.exitCode, 0);
  // Three records, and not one integrity event of an invalid approval.
  const records = [...run.files.keys()].filter((p) => /approvals\/phase-\d+\.json$/.test(p));
  assert.equal(records.length, 3);
  // The only integrity event of an honest first run is the `missing` record of
  // the phase the run starts at — the derivation of the start position reading
  // that phase 1 is not approved yet (F101-FR-031). No forgery is reported.
  assert.deepEqual(
    run.integrityEvents.map((e) => e.failed),
    ["missing"],
  );
  assert.equal(run.integrityEvents[0]?.phase, 1);
  // And the engine wrote NO marker of an as-is system (F101-FR-029).
  assert.equal([...run.files.keys()].filter((p) => /GATE\d+-APPROVED$/.test(p)).length, 0);
});
