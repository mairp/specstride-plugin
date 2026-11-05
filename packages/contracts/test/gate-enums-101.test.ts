/**
 * T003 of feature 101 — the three closed sets of the spec of the phase gate,
 * each with its unknown-value rule (`packages/contracts/src/enums/gate.ts`;
 * annex X §X.6, rows 251, 252 and 255; F100-FR-021, F100-FR-208, F100-FR-209).
 *
 * The three sets are the details of a MALFORMED verdict (row 251), the cases of
 * a diagnosis (row 252) and what failed in an approval record (row 255). For
 * each the test reads the row from `data/closed-sets.json` — an independent read
 * path, beside the module's own export — and asserts the members, the owner and
 * the unknown-value rule the cell of the row asks for.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import closedSetsData from "../data/closed-sets.json" with { type: "json" };
import { closedSets } from "../src/enums/all-sets.ts";
import * as gate from "../src/enums/gate.ts";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODULE_FILE = join(PKG, "src/enums/gate.ts");

type Row = {
  number: number;
  name: string;
  literals: string[];
  owner: string;
  unknownValue: string;
};

const rows = (closedSetsData as { closedSets: Row[] }).closedSets;
const rowOf = (number: number): Row => {
  const row = rows.find((r) => r.number === number);
  assert.ok(row !== undefined, `data/closed-sets.json holds row ${number}`);
  return row;
};

test("T003: the module is packages/contracts/src/enums/gate.ts and names the three rows", () => {
  assert.equal(existsSync(MODULE_FILE), true, "src/enums/gate.ts exists");
  const text = readFileSync(MODULE_FILE, "utf8");
  assert.ok(text.length > 0);
  assert.deepEqual([...gate.CLOSED_SET_ROWS], [251, 252, 255]);
  assert.equal(gate.ANNEX_SECTION, "annex X, §X.6");
  assert.equal(gate.GATE_CLOSED_SETS.size, 3);
  for (const number of gate.CLOSED_SET_ROWS) {
    const set = gate.GATE_CLOSED_SETS.get(number);
    assert.ok(set !== undefined, `the module holds row ${number}`);
    // The same object the one map of the package holds: the module registers
    // nothing of its own, so the assembly of T257 stays complete.
    assert.equal(set, closedSets.get(number), `row ${number} is the set of the one map`);
    assert.equal(set.name, rowOf(number).name);
    assert.equal(set.owner, "101");
  }
});

test("T003: row 251 — details of a MALFORMED verdict, unknown value read as `call-failed`", () => {
  const row = rowOf(251);
  assert.equal(row.name, "Details of a MALFORMED verdict");
  assert.deepEqual([...gate.MALFORMED_DETAILS], row.literals);
  assert.deepEqual(
    [...gate.MALFORMED_DETAILS],
    ["nonce-mismatch", "no-verdict-line", "multiple-verdict-lines", "call-failed"],
  );
  for (const member of row.literals) assert.equal(gate.isMalformedDetail(member), true);
  assert.equal(gate.isMalformedDetail("something-else"), false);

  // The unknown-value rule of the row: `default`, treated as `call-failed`.
  assert.equal(row.unknownValue, "Read as `call-failed`; the verdict stays MALFORMED");
  assert.equal(gate.DETAIL_WHEN_UNKNOWN, "call-failed");
  const outcome = gate.detailOnUnknown("something-else", row.name);
  assert.equal(outcome.kind, "default");
  assert.equal(outcome.treatedAs, "call-failed");
  assert.equal(outcome.cell, row.unknownValue);
  assert.match(outcome.message, /Details of a MALFORMED verdict/);
  assert.match(outcome.message, /something-else/);
  assert.equal(gate.detailOrDefault("something-else"), "call-failed");
  assert.equal(gate.detailOrDefault("nonce-mismatch"), "nonce-mismatch");
  assert.equal(gate.DETAIL_STANDS_ONLY_WITH_MALFORMED, true);
  // The same outcome through the one entry of the module.
  assert.deepEqual(gate.onUnknown(251, "something-else"), outcome);
});

test("T003: row 252 — cases of a diagnosis, unknown value is the case `unknown`", () => {
  const row = rowOf(252);
  assert.equal(row.name, "Cases of a diagnosis");
  assert.deepEqual([...gate.DIAGNOSIS_CASES], row.literals);
  assert.deepEqual([...gate.DIAGNOSIS_CASES], ["grounding", "real_gap", "unknown"]);
  for (const member of row.literals) assert.equal(gate.isDiagnosisCase(member), true);
  assert.equal(gate.isDiagnosisCase("guesswork"), false);

  // The unknown-value rule of the row: shown as `unknown`, with an attention
  // item; `unknown` is itself a member of the set.
  assert.equal(row.unknownValue, "`unknown`");
  assert.equal(gate.CASE_WHEN_UNKNOWN, "unknown");
  assert.equal(gate.isDiagnosisCase(gate.CASE_WHEN_UNKNOWN), true);
  const outcome = gate.diagnosisCaseOnUnknown("guesswork", row.name);
  assert.equal(outcome.kind, "show-as-unknown");
  assert.equal(outcome.attentionItem, true);
  assert.equal(outcome.cell, row.unknownValue);
  assert.match(outcome.message, /Cases of a diagnosis/);
  assert.equal(gate.diagnosisCaseOrDefault("guesswork"), "unknown");
  assert.equal(gate.diagnosisCaseOrDefault("real_gap"), "real_gap");
  assert.deepEqual([...gate.DIAGNOSIS_CASES_THAT_SAY_SOMETHING], ["grounding", "real_gap"]);
  assert.deepEqual(gate.onUnknown(252, "guesswork"), outcome);
});

test("T003: row 255 — what failed in an approval record, unknown value is not approved", () => {
  const row = rowOf(255);
  assert.equal(row.name, "What failed in an approval record");
  assert.deepEqual([...gate.APPROVAL_FAILURES], row.literals);
  assert.deepEqual(
    [...gate.APPROVAL_FAILURES],
    [
      "schema",
      "signature",
      "key-unknown",
      "verdict",
      "evidence-hash",
      "verification-hash",
      "missing",
      "marker-only",
    ],
  );
  for (const member of row.literals) assert.equal(gate.isApprovalFailure(member), true);
  assert.equal(gate.isApprovalFailure("looks-fine"), false);

  // The unknown-value rule of the row: refuse — the record counts as not
  // approved, which is the same safe failure as for every member.
  assert.equal(row.unknownValue, "The record counts as not approved");
  assert.equal(gate.RECORD_COUNTS_AS_APPROVED_ON_AN_UNKNOWN_FAILURE, false);
  const outcome = gate.approvalFailureOnUnknown("looks-fine", row.name);
  assert.equal(outcome.kind, "refuse");
  assert.equal(outcome.cell, row.unknownValue);
  assert.match(outcome.message, /What failed in an approval record/);
  assert.match(outcome.message, /looks-fine/);
  assert.equal(gate.approvalCountsAsApproved(undefined), true);
  for (const member of row.literals) {
    assert.equal(gate.approvalCountsAsApproved(member), false, `${member} is not approved`);
  }
  assert.equal(gate.approvalCountsAsApproved("looks-fine"), false, "and neither is an unknown one");
  assert.deepEqual(gate.onUnknown(255, "looks-fine"), outcome);
});

test("T003: a row that is none of the three is refused by the one entry", () => {
  assert.throws(
    () => gate.onUnknown(9 as never, "plain"),
    /the row 9 is none of the three closed sets of feature 101/,
  );
});
