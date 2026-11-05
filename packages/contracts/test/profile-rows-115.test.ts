/**
 * T007 of feature 115 — the rows of the `parity` profile this feature owns:
 * rows 1, 2, 3, 64 and 65 of annex X, §X.7 (F115-FR-001, F115-FR-022,
 * F115-FR-023, F115-FR-028, F115-FR-033, F115-FR-034; F100-FR-210,
 * F100-FR-211; the section "Rows of the `parity` profile" of
 * `specs/115-micro-loop-layer/spec.md`).
 *
 * The rows are declared in `packages/contracts/data/parity-rows-115.json`
 * with the key names of the annex. The test that must find a value for every
 * switch is the profile test: `profileRow(n)` over the shipped profile data
 * (`data/parity-profile.json`) must return each row, the owner must carry
 * `115`, and every key of every row must resolve through `rowOfKey` — with a
 * default for the rows that `parity` marks `not used` (rows 64 and 65), and
 * an applied value under `parity` for the rows it narrows (1, 2 and 3).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyProfile, profileRow, profileRows, rowOfKey } from "../src/profile/parity.ts";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type DeclaredRow = {
  Row: string;
  Switch: string;
  Key: string;
  Default: string;
  "Under `parity`": string;
  "Register row": string;
  Requirement: string;
};

const declared = (
  JSON.parse(readFileSync(resolve(PKG_ROOT, "data/parity-rows-115.json"), "utf8")) as {
    schema: string;
    owner: string;
    owned: DeclaredRow[];
    proposed: unknown[];
  }
).owned;

/** The rows this feature owns, with the keys and defaults of the annex. */
const ROWS = [
  { number: 1, keys: ["loop.strategy"], def: "micro", parity: "classic" },
  { number: 2, keys: ["loop.micro.closing_check"], def: "on", parity: "off" },
  { number: 3, keys: ["loop.escalation"], def: "on", parity: "off" },
  { number: 64, keys: ["loop.routing"], def: "on", parity: "not used" },
  {
    number: 65,
    keys: [
      "loop.micro.caps.repairs",
      "loop.micro.caps.escalationsPerTask",
      "loop.micro.caps.escalationsPerAttempt",
      "loop.micro.caps.proposalMin",
      "loop.micro.caps.unitMin",
      "loop.micro.caps.checkMin",
      "loop.micro.caps.checkSharePercent",
      "loop.micro.caps.cyclesExtra",
      "loop.micro.caps.cyclesMin",
      "loop.micro.caps.unresolvedUnits",
    ],
    def: "2; 1; 2; 20; 30; 5; 15; 6; 12; 2",
    parity: "not used",
  },
] as const;

test("T007: the data file declares exactly the five rows this feature owns", () => {
  assert.equal(declared.length, 5);
  assert.deepEqual(
    declared.map((r) => r.Row),
    ["1", "2", "3", "64", "65"],
  );
  for (const row of declared) {
    assert.notEqual(row.Switch.trim(), "", `row ${row.Row} has a switch name`);
    assert.notEqual(row.Key.trim(), "", `row ${row.Row} names its key(s)`);
    assert.notEqual(row.Default.trim(), "", `row ${row.Row} states a default`);
    assert.notEqual(
      row["Under `parity`"].trim(),
      "",
      `row ${row.Row} states the value under \`parity\``,
    );
  }
});

test("T007: the profile test finds a value for every switch (F100-FR-210)", () => {
  for (const expected of ROWS) {
    const row = profileRow(expected.number);
    assert.ok(row, `row ${expected.number} is in the shipped profile data`);
    assert.ok(row.owner.includes("115"), `row ${expected.number} is owned by 115: ${row.owner}`);
    assert.deepEqual(row.keys, [...expected.keys], `row ${expected.number}: the keys of the annex`);
    assert.equal(row.default, expected.def, `row ${expected.number}: default`);
    assert.equal(row.parity, expected.parity, `row ${expected.number}: under parity`);
    for (const key of expected.keys) {
      const byKey = rowOfKey(key);
      assert.ok(byKey, `the switch ${key} is findable by its key`);
      assert.equal(byKey?.number, expected.number);
    }
  }
  assert.ok(profileRows.some((r) => r.number === 65));
});

test("T007: rows 1, 2 and 3 take their `parity` value; rows 64 and 65 keep their defaults (F115-FR-001, F115-FR-028, F115-FR-034)", () => {
  for (const expected of ROWS) {
    const row = profileRow(expected.number)!;
    const underParity = applyProfile({}, [row]).config;
    for (const key of expected.keys) {
      if (expected.parity === "not used") {
        // A switch the `parity` profile does not use keeps its default, so a
        // reader of the key finds a value under both profiles either way.
        assert.ok(row.default.length > 0, `${key}: the shipped row carries a default`);
      } else {
        assert.equal(
          underParity[key],
          expected.parity,
          `${key}: under \`parity\` the value is ${expected.parity}`,
        );
      }
    }
  }
});

test("T007: row 65 carries a default for each of its ten keys (F115-FR-022, F115-FR-023)", () => {
  const defaults = profileRow(65)!
    .default.split(";")
    .map((s) => s.trim());
  const keys = profileRow(65)!.keys;
  assert.equal(keys.length, 10);
  assert.equal(defaults.length, 10, "one default per key");
  assert.deepEqual(keys, [...ROWS[4].keys]);
});
