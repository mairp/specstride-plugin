/**
 * T068 — every option of the feature holds a parity value, and feature 100's
 * parity profile holds a row for every one of them (annex X, §X.7; EP-17).
 *
 * The table is `packages/runtime/src/data/parity-rows.json`. The profile is
 * `packages/contracts/data/parity-profile.json`, read through
 * `profileRow`/`profileRows` of `@specstride/contracts/profile/parity`. The
 * test reads both from the product's own loaders, so the two cannot drift
 * without a failure.
 */
import test from "node:test";
import assert from "node:assert/strict";
import table from "../../src/data/parity-rows.json" with { type: "json" };
import { PROFILE_NAME, profileRow, profileRows } from "@specstride/contracts/profile/parity";

type Row = {
  readonly switch: string;
  readonly key: string;
  readonly parity: string;
  readonly row: number;
  readonly status: string;
};

const ROWS = (table as { readonly feature: string; readonly rows: readonly Row[] }).rows;

test("T068: every option of the feature has a parity value and a row of the parity profile", () => {
  assert.equal(
    (table as { readonly feature: string }).feature,
    "122-detached-runtime",
    "the table belongs to this feature",
  );
  assert.ok(ROWS.length >= 7, `the table holds the feature's options (${ROWS.length})`);
  for (const option of ROWS) {
    // A parity value that says what parity does, not an empty promise.
    assert.ok(
      typeof option.parity === "string" && option.parity.trim().length > 0,
      `the option "${option.switch}" holds a parity value`,
    );
    assert.equal(option.status, "confirmed", `the row of "${option.switch}" is confirmed`);
    // Feature 100's profile holds the row, and the row names the key.
    const row = profileRow(option.row);
    assert.ok(row !== undefined, `the profile holds row ${option.row} for "${option.switch}"`);
    if (row !== undefined) {
      assert.ok(
        row.keys.includes(option.key),
        `row ${option.row} of profile "${PROFILE_NAME}" names the key "${option.key}" ` +
          `(it names ${JSON.stringify(row.keys)})`,
      );
    }
  }
  // The rows the feature claimed, named: 41, 113, 114, 115 and 116 — read
  // from the profile, not from the table.
  for (const number of [41, 113, 114, 115, 116]) {
    assert.ok(
      profileRows.some((row) => row.number === number),
      `the profile holds row ${number}`,
    );
  }
  assert.ok(
    profileRow(114)?.keys.includes("runtime.handshake.timeoutSec") === true &&
      profileRow(114)?.keys.includes("runtime.lease.heartbeatSec") === true &&
      profileRow(114)?.keys.includes("runtime.lease.graceSec") === true,
    "row 114 holds the handshake and lease keys",
  );
});
