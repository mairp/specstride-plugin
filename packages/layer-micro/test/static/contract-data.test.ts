/**
 * T141 (F115-FR-022; F115-FR-023; F115-FR-033) — static: every key of
 * `packages/contracts/data/parity-rows-115.json` is a key of row 1, 2, 3,
 * 64 or 65 of the `parity` profile of feature 100, in its spelling
 * (`proposalMin`, `unitMin`, `checkMin` included), and every closed set of
 * `packages/contracts/data/closed-sets-115.json` carries its row number of
 * annex X §X.6.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONTRACTS = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "contracts",
  "data",
);

const ROWS_115 = JSON.parse(readFileSync(join(CONTRACTS, "parity-rows-115.json"), "utf8")) as {
  owned: { Row: string; Key: string }[];
};

const PROFILE = JSON.parse(readFileSync(join(CONTRACTS, "parity-profile.json"), "utf8")) as {
  profile: string;
  switches: { number: number; key: string; keys: string[] }[];
};

const CLOSED_SETS = JSON.parse(readFileSync(join(CONTRACTS, "closed-sets-115.json"), "utf8")) as {
  sets: { row?: string; set: string }[];
};

const OWNED_ROWS = new Set([1, 2, 3, 64, 65]);

test("T141: the profile of feature 100 is the profile the rows are checked against", () => {
  assert.equal(PROFILE.profile, "parity");
  // The spelling of row 65 holds the cap keys, `proposalMin`, `unitMin` and
  // `checkMin` included, exactly as annex X §X.7 spells them.
  const row65 = PROFILE.switches.find((s) => s.number === 65);
  assert.ok(row65);
  for (const key of [
    "loop.micro.caps.proposalMin",
    "loop.micro.caps.unitMin",
    "loop.micro.caps.checkMin",
  ]) {
    assert.ok(row65.keys.includes(key), `row 65 does not carry ${key} in the profile's spelling`);
  }
});

test("T141: every key of parity-rows-115.json is a key of row 1, 2, 3, 64 or 65, in its spelling", () => {
  assert.ok(ROWS_115.owned.length >= 5);
  for (const row of ROWS_115.owned) {
    assert.equal(
      OWNED_ROWS.has(Number(row.Row)),
      true,
      `row ${row.Row} is not one of 1, 2, 3, 64, 65`,
    );
    const profileRow = PROFILE.switches.find((s) => s.number === Number(row.Row));
    assert.ok(profileRow, `row ${row.Row} is not in the parity profile`);
    // The key of the row appears in the profile row's keys, spelled exactly.
    const keys = row.Key.split(",").map((k) => k.trim());
    assert.ok(keys.length >= 1);
    for (const key of keys) {
      assert.ok(
        profileRow.keys.includes(key),
        `key ${key} of row ${row.Row} is not in the profile's spelling (${profileRow.keys.join(", ")})`,
      );
    }
  }
});

test("T141: every closed set of closed-sets-115.json carries its row number of annex X §X.6", () => {
  assert.ok(CLOSED_SETS.sets.length === 10, `expected 10 closed sets`);
  for (const set of CLOSED_SETS.sets) {
    assert.ok(
      typeof set.row === "string" && /^\d+$/.test(set.row),
      `the closed set "${set.set}" carries no row number`,
    );
    assert.ok(
      Number(set.row) >= 55 && Number(set.row) <= 141,
      `the row ${set.row} of "${set.set}" is not a row of annex X §X.6`,
    );
  }
});
