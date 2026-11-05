/**
 * CT-115-30 (T096, F115-FR-030; F115-SC-009) — characterization: the record
 * kinds of the ledger namespace `micro`, written ahead.
 *
 * The kinds are exactly the closed set of `spec.md` ("Closed sets"), which
 * `packages/contracts/data/ledger-micro-115.json` mirrors. Every record is
 * appended to the ledger BEFORE the act it describes (write-ahead): when the
 * act throws, the record is already there. The records live in the
 * namespace `micro` and the engine writes them for the layer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  LEDGER_RECORD_KINDS,
  MICRO_NAMESPACE,
  WRITE_AHEAD,
  appendRecord,
  lastRecord,
  newLedger,
  validateLedger,
} from "../../src/ledger/records.ts";

const CONTRACT = JSON.parse(
  readFileSync(
    join(
      fileURLToPath(import.meta.url),
      "..",
      "..",
      "..",
      "..",
      "contracts",
      "data",
      "ledger-micro-115.json",
    ),
    "utf8",
  ),
) as { kinds: string[]; namespace: string; writeAhead: boolean };

test("CT-115-30 (F115-FR-030): the record kinds are exactly the closed set of the contract", () => {
  assert.deepEqual(
    [...LEDGER_RECORD_KINDS],
    [
      "unit-declared",
      "check-started",
      "check-finished",
      "unit-kept",
      "unit-repair",
      "unit-unresolved",
      "command-excluded",
      "escalation",
      "closing-check",
      "disengaged",
      "integrity",
    ],
  );
  assert.deepEqual([...LEDGER_RECORD_KINDS], CONTRACT.kinds);
});

test("CT-115-30 (F115-FR-030): the namespace is micro and the writing is write-ahead", () => {
  assert.equal(MICRO_NAMESPACE, CONTRACT.namespace);
  assert.equal(MICRO_NAMESPACE, "micro");
  assert.equal(WRITE_AHEAD, true);
  assert.equal(CONTRACT.writeAhead, true);
});

test("CT-115-30 (F115-FR-030): each record is appended before the act it describes", () => {
  let ledger = newLedger("run-r", 2);
  // The act of the unit: append the record, then run the act. Write-ahead
  // means the record survives even when the act throws.
  const actThatThrows = () => {
    ledger = appendRecord(ledger, "check-started", { ordinal: 1, scope: "inner" });
    throw new Error("the check exploded");
  };
  assert.throws(actThatThrows, /check exploded/);
  // The record is durable although the act never completed.
  const last = lastRecord(ledger);
  assert.ok(last, "a record exists after the act threw");
  assert.equal(last?.kind, "check-started");
  assert.deepEqual(last?.data, { ordinal: 1, scope: "inner" });
  assert.equal(validateLedger(ledger).ok, true);
});

test("CT-115-30 (F115-FR-030): the ledger records are ordered, seq-numbered, in one namespace", () => {
  let ledger = newLedger("run-r", 3);
  for (const kind of ["unit-declared", "check-started", "check-finished", "unit-kept"] as const) {
    ledger = appendRecord(ledger, kind, {});
  }
  assert.equal(ledger.records.length, 4);
  ledger.records.forEach((record, index) => {
    assert.equal(record.seq, index);
    assert.equal(record.namespace, MICRO_NAMESPACE);
  });
  assert.equal(ledger.records[0].kind, "unit-declared");
});

test("CT-115-30 (F115-FR-030): a kind outside the closed set is never appended", () => {
  const ledger = newLedger("run-r", 1);
  assert.throws(() => appendRecord(ledger, "invented-kind" as never, {}), /closed set/);
});
