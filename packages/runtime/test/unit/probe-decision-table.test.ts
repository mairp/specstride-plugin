/**
 * T030 — the decision table IS the probe's control flow, not a description
 * of it (F122-FR-013; research D-5).
 *
 * A module that said "from the decision table" in a comment and then held
 * seven `if`s of its own would pass every behaviour test in this feature and
 * would still be wrong the day the table changed. So this file asks the
 * question the other way round: for each row OF THE FILE, is there an
 * observation that reaches it, and is the result the one the FILE gives?
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROBE_RESULTS, UNKNOWN_COUNTS_AS_HELD } from "@specstride/contracts/ep/lock";
import {
  DECISION_TABLE_FILE,
  PROBE_ROWS,
  RESULTS_THAT_ARE_NOT_HELD,
  TABLE_ORDER,
  countsAsHeld,
  probeResultFrom,
  theOwnerIsDead,
  type ProbeObservations,
} from "../../src/lock/probe.ts";

/** The file itself, read again here, so the two readings cannot drift. */
const RAW = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../src/data/probe-decision-table.json"), "utf8"),
) as { requirement: string; order: string; rows: { id: string; result: string; held: boolean }[] };

/** The reading that reaches each row, named by the row's `when`. */
const REACHES: Readonly<Record<string, Partial<ProbeObservations>>> = Object.freeze({
  P1: { lockExists: false },
  P2: { lockExists: true, ownerRecordReadable: false },
  P3: { lockExists: true, ownerRecordReadable: true, foreign: true },
  P4: { lockExists: true, ownerRecordReadable: true, sameBoot: true, liveness: "alive" },
  P5: {
    lockExists: true,
    ownerRecordReadable: true,
    liveness: "dead",
    anOpenOwnedEntryPassesTheIdentityCheck: true,
  },
  P6: { lockExists: true, ownerRecordReadable: true, liveness: "dead" },
  // Everything was read, the owner is of this boot, and the kernel would not
  // say: nothing may be concluded.
  P7: { lockExists: true, ownerRecordReadable: true, sameBoot: true, liveness: "unknown" },
});

function observed(over: Partial<ProbeObservations>): ProbeObservations {
  return {
    lockExists: true,
    providerFailed: false,
    ownerRecordReadable: true,
    foreign: false,
    sameBoot: false,
    liveness: "unknown",
    anOpenOwnedEntryPassesTheIdentityCheck: false,
    ...over,
  };
}

test("the rows the module evaluates are the rows of the file, in the file's order", () => {
  assert.equal(RAW.requirement, "F122-FR-013");
  assert.equal(TABLE_ORDER, "first matching row");
  assert.deepEqual(
    PROBE_ROWS.map((r) => r.id),
    RAW.rows.map((r) => r.id),
  );
  assert.deepEqual(
    PROBE_ROWS.map((r) => r.result),
    RAW.rows.map((r) => r.result),
  );
  assert.deepEqual(
    PROBE_ROWS.map((r) => r.held),
    RAW.rows.map((r) => r.held),
  );
});

test("every row of the file is reachable, and gives the result the FILE gives it", () => {
  for (const row of RAW.rows) {
    const reading = REACHES[row.id];
    assert.notEqual(reading, undefined, `no reading of this test reaches row \`${row.id}\``);
    const decision = probeResultFrom(observed(reading ?? {}));
    assert.equal(decision.row, row.id, `the reading for \`${row.id}\` reached \`${decision.row}\``);
    assert.equal(decision.result, row.result, row.id);
    assert.equal(decision.held, row.held, row.id);
  }
});

test("the six results of the file are the six of EP-13", () => {
  assert.deepEqual([...new Set(RAW.rows.map((r) => r.result))].sort(), [...PROBE_RESULTS].sort());
});

test("`held` comes from the file, and agrees with the contract", () => {
  // F122-FR-013 — every result except `free` and `stale-owner-dead` counts
  // as held. Read out of the `held` column, not asserted twice.
  assert.deepEqual([...RESULTS_THAT_ARE_NOT_HELD].sort(), ["free", "stale-owner-dead"]);
  for (const result of PROBE_RESULTS) {
    assert.equal(countsAsHeld(result), !["free", "stale-owner-dead"].includes(result), result);
  }
  assert.equal(countsAsHeld("unknown"), UNKNOWN_COUNTS_AS_HELD);
  assert.equal(DECISION_TABLE_FILE, "packages/runtime/src/data/probe-decision-table.json");
});

test("an owner is dead when the kernel says so OR when the boot identity differs", () => {
  // F122-FR-013 — *an owner whose boot identity differs from the present
  // boot MUST count as dead, whatever process now has its pid.* So a live
  // endpoint of a PREVIOUS boot is still a dead owner.
  assert.equal(theOwnerIsDead(observed({ liveness: "dead", sameBoot: true })), true);
  assert.equal(theOwnerIsDead(observed({ liveness: "alive", sameBoot: false })), true);
  assert.equal(theOwnerIsDead(observed({ liveness: "alive", sameBoot: true })), false);
  // And the whole probe agrees: a live endpoint of another boot is stale.
  assert.equal(
    probeResultFrom(observed({ liveness: "alive", sameBoot: false })).result,
    "stale-owner-dead",
  );
});

test("a provider that failed gives `unknown`, whatever else was read", () => {
  // §F.5, "Failure of an implementation" — a provider that fails in
  // `acquire` or `probe` gives `unknown`, which counts as held.
  const decision = probeResultFrom(
    observed({ providerFailed: true, sameBoot: true, liveness: "alive" }),
  );
  assert.equal(decision.result, "unknown");
  assert.equal(decision.row, "P2");
  assert.equal(decision.held, true);
});
