/**
 * CT-115-125 (T099, IR-25; F115-FR-030) — characterization: the ledger is
 * chained and validated.
 *
 * Every record carries the hash of its predecessor and its own canonical
 * hash; a truncated, reordered or edited ledger fails validation at resume.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendRecord,
  lastRecord,
  newLedger,
  validateLedger,
  type LedgerRecord,
  type MicroLedger,
} from "../../src/ledger/records.ts";

/** The ledger as a tamperer sees it: the records are mutable to the tamperer only. */
type MutableLedger = { runId: string; phase: number; records: LedgerRecord[] };

function chained(): MicroLedger {
  let ledger = newLedger("run-i", 1);
  ledger = appendRecord(ledger, "unit-declared", { taskIds: ["T010"] });
  ledger = appendRecord(ledger, "check-started", { ordinal: 1 });
  ledger = appendRecord(ledger, "check-finished", { ordinal: 1 });
  return ledger;
}

test("CT-115-125 (IR-25): the ledger is chained — each record names the hash of its predecessor", () => {
  const ledger = chained();
  ledger.records.forEach((record, index) => {
    if (index === 0) {
      assert.equal(record.prevHash, "0".repeat(64), "the first record chains to the genesis hash");
    } else {
      assert.equal(record.prevHash, ledger.records[index - 1].hash);
    }
    assert.equal(record.hash.length, 64);
    assert.notEqual(record.hash, record.prevHash);
  });
});

test("CT-115-125 (IR-25): a valid ledger validates", () => {
  assert.deepEqual(validateLedger(chained()), { ok: true });
  assert.deepEqual(validateLedger(newLedger("run-i", 1)), { ok: true });
});

test("CT-115-125 (IR-25): an edited record fails validation", () => {
  const ledger = chained();
  const tampered = JSON.parse(JSON.stringify(ledger)) as MutableLedger;
  (tampered.records[1].data as Record<string, unknown>).ordinal = 99;
  const verdict = validateLedger(tampered);
  assert.ok(!verdict.ok);
  if (verdict.ok) return;
  assert.equal(verdict.reason, "edited");
  assert.equal(verdict.at, 1);
});

test("CT-115-125 (IR-25): a truncated ledger fails validation", () => {
  const ledger = chained();
  const truncated = JSON.parse(JSON.stringify(ledger)) as MutableLedger;
  // A record is dropped from the middle: the sequence numbers no longer run
  // consecutively and the chain of the successor points at a lost record.
  truncated.records.splice(1, 1);
  const verdict = validateLedger(truncated);
  assert.ok(!verdict.ok);
  if (verdict.ok) return;
  assert.equal(verdict.reason, "truncated");
});

test("CT-115-125 (IR-25): a reordered ledger fails validation", () => {
  const ledger = chained();
  const reordered = JSON.parse(JSON.stringify(ledger)) as MutableLedger;
  const second = reordered.records[1];
  reordered.records[1] = reordered.records[2];
  reordered.records[2] = second;
  const verdict = validateLedger(reordered);
  assert.ok(!verdict.ok);
  if (verdict.ok) return;
  assert.equal(verdict.reason, "reordered");
});

test("CT-115-125 (IR-25): an edited hash of the last record fails validation at resume", () => {
  const ledger = chained();
  const tampered = JSON.parse(JSON.stringify(ledger)) as MutableLedger;
  const last = lastRecord(tampered);
  assert.ok(last);
  tampered.records[tampered.records.length - 1] = { ...last, hash: "f".repeat(64) };
  const verdict = validateLedger(tampered);
  assert.ok(!verdict.ok);
});
