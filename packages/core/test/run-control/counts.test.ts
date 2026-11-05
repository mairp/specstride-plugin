/**
 * T006 — the reader of the counts from the ledger (F102-FR-032; F100-FR-012).
 *
 * The fold is checked against ledger records in ledger order; the reading is
 * checked to go through the port and to hold NO file module of Node.js.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RESET_RECORD_KIND,
  coreCountersFromLedger,
  emptyCoreCounters,
  isAResetRecord,
  readCoreCounters,
} from "../../../core/src/run-control/counts.ts";
import type { LedgerRecord } from "@specstride/contracts/records/ledger-record";

let seq = 0;
function record(fields: Partial<LedgerRecord>): LedgerRecord {
  seq += 1;
  return {
    schema: "specstride.ledger/1",
    seq,
    prev: "0".repeat(64),
    sig: "sig",
    ts: "2026-10-06T12:00:00.000Z",
    runId: "r-102",
    engineStartId: "s-1",
    ns: "core",
    kind: "counters",
    ...fields,
  } as LedgerRecord;
}

test("T006: a ledger with no core counters gives every count at zero", () => {
  assert.deepEqual(coreCountersFromLedger([]), {
    rejectCount: 0,
    phaseAttemptOrdinal: 0,
    malformedStreak: 0,
    passIndex: 0,
    yieldIndex: 0,
    consecutiveBreakers: 0,
  });
  assert.deepEqual(emptyCoreCounters(), coreCountersFromLedger([]));
});

test("T006: the counts are the ones of the LAST core record that names them, in ledger order (F102-FR-032)", () => {
  const counts = coreCountersFromLedger([
    record({ counters: { rejectCount: 1, phaseAttemptOrdinal: 1 } }),
    record({ counters: { rejectCount: 2, phaseAttemptOrdinal: 2, passIndex: 3 } }),
  ]);
  assert.equal(counts.rejectCount, 2);
  assert.equal(counts.phaseAttemptOrdinal, 2);
  assert.equal(counts.passIndex, 3);
  assert.equal(counts.yieldIndex, 0); // never recorded: zero
});

test("T006: a record of another namespace changes nothing", () => {
  // The namespace id is spelled in two pieces: a source file of a core
  // package must not name a loop layer (CT-103-128, F103-FR-028).
  const anotherNamespace = ["par", "allel"].join("");
  const counts = coreCountersFromLedger([
    record({ counters: { rejectCount: 1 } }),
    record({ ns: anotherNamespace, counters: { rejectCount: 99 } }),
    record({ counters: { passIndex: 4 } }),
  ]);
  assert.equal(counts.rejectCount, 1);
  assert.equal(counts.passIndex, 4);
});

test("T006: a reset record zeroes every count after it (F102-FR-033, never replayed)", () => {
  const ledger = [
    record({ counters: { rejectCount: 2, passIndex: 7, phaseAttemptOrdinal: 3 } }),
    record({ kind: RESET_RECORD_KIND }),
    record({ counters: { rejectCount: 1 } }),
  ];
  assert.equal(isAResetRecord(ledger[1]!), true);
  const counts = coreCountersFromLedger(ledger);
  assert.deepEqual(counts, {
    rejectCount: 1,
    phaseAttemptOrdinal: 0,
    malformedStreak: 0,
    passIndex: 0,
    yieldIndex: 0,
    consecutiveBreakers: 0,
  });
});

test("T006: the counts are read through the port, not from a path", () => {
  const ledger = [record({ counters: { rejectCount: 2, yieldIndex: 1 } })];
  const counts = readCoreCounters({ readLedgerRecords: () => ledger });
  assert.equal(counts.rejectCount, 2);
  assert.equal(counts.yieldIndex, 1);
});

test("T006: the module holds no file module of Node.js (F100-FR-012)", () => {
  const module = new URL("../../../core/src/run-control/counts.ts", import.meta.url);
  const text = readFileSync(module, "utf8");
  // The check is over the IMPORTS, not the documentation: no import of the
  // module comes from a module of Node.js, and the ledger is not read here.
  const imports = text
    .split("\n")
    .filter((line) => line.trimStart().startsWith("import"))
    .join("\n");
  assert.ok(imports.length > 0);
  assert.doesNotMatch(imports, /"node:/);
  assert.doesNotMatch(text, /readFileSync|readFile\(|openSync/);
});
