/**
 * T004 of feature 116 — row 32 of the `parity` profile, the switch of the
 * comparison of the tree at phase entry (annex X, §X.7, row 32; F116-FR-012;
 * F100-FR-210, F100-FR-211; DV-077).
 *
 * The row is declared in `packages/contracts/data/parity-rows-116.json`,
 * delivered from `specs/116-check-integrity-and-unit-evidence/contracts/parity-rows.json`
 * through `contracts/deliver.json` (byte identity in `deliver-116.test.ts`;
 * this file proves the CONTENT). The test that must find a value for the
 * switch is the profile test: `profileRow(32)` over the shipped profile data
 * (`data/parity-profile.json`) must return the row, its default must be `on`,
 * and applying the profile `parity` must set the key
 * `integrity.phase_entry` to `off` — so a consumer that reads the switch
 * through `profileRow` finds a value under both profiles, exactly as
 * `packages/contracts/test/profile.test.ts` does for the rows of feature 149.
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
  JSON.parse(readFileSync(resolve(PKG_ROOT, "data/parity-rows-116.json"), "utf8")) as {
    schema: string;
    owner: string;
    owned: DeclaredRow[];
    proposed: unknown[];
  }
).owned;

test("T004: the data file declares exactly row 32 of the `parity` profile", () => {
  assert.equal(declared.length, 1);
  const row = declared[0];
  assert.equal(row.Row, "32");
  assert.equal(row.Switch, "Comparison of the tree at phase entry");
  assert.equal(row.Key, "integrity.phase_entry");
  assert.equal(row.Default, "on");
  assert.equal(row["Under `parity`"], "off");
  assert.equal(row["Register row"], "DV-077");
  assert.equal(row.Requirement, "F116-FR-012");
  assert.deepEqual(
    declared[0] &&
      (
        JSON.parse(readFileSync(resolve(PKG_ROOT, "data/parity-rows-116.json"), "utf8")) as {
          proposed: unknown[];
        }
      ).proposed,
    [],
  );
});

test("T004: the profile test finds the switch — profileRow(32) returns the row (F100-FR-210)", () => {
  const row = profileRow(32);
  assert.ok(row, "row 32 is in the shipped profile data");
  assert.deepEqual(row.keys, ["integrity.phase_entry"]);
  assert.ok(row.owner.includes("116"), `row 32 is owned by 116: ${row.owner}`);
  const byKey = rowOfKey("integrity.phase_entry");
  assert.ok(byKey, "the switch is findable by its key");
  assert.equal(byKey?.number, 32);
  assert.ok(profileRows.some((r) => r.number === 32));
});

test("T004: the default is `on` and `parity` sets the key to `off` (F116-FR-012)", () => {
  const row = profileRow(32);
  assert.equal(row?.default, "on");
  const underParity = applyProfile({}, [row!]).config;
  assert.equal(
    underParity["integrity.phase_entry"],
    "off",
    "under `parity` the comparison of the tree at phase entry is off",
  );
});
