/**
 * T071 — contract tests CT-100-310, CT-100-311 and CT-100-312 for the `parity`
 * profile (annex X, §X.7; F100-FR-210, F100-FR-211, F100-FR-212;
 * F100-SC-006).
 */
import test from "node:test";
import assert from "node:assert/strict";
import profileData from "../data/parity-profile.json" with { type: "json" };
import {
  PROFILE_KEY,
  PROFILE_NAME,
  RESERVED_LITERALS,
  SCHEMA_ID,
  SECOND_SUITE_ROW,
  SECOND_SUITE_VALUE,
  SELECTED_BY,
  applyProfile,
  applySecondSuite,
  loadProfile,
  profileRow,
  profileRows,
  rowOfKey,
  rowsWithKeys,
  secondSuiteRows,
} from "../src/profile/parity.ts";
import {
  SwitchRegistrationError,
  registerSwitch,
  registeredSwitch,
  registeredSwitches,
  resetSwitchesForTest,
  sealSwitches,
  switchesAreSealed,
  switchesWithoutARow,
} from "../src/profile/switches.ts";

const RAW = profileData as { profile: string; switches: { number: number }[] };

test("CT-100-310: the profile is versioned data with one row per switch (F100-FR-210)", () => {
  assert.equal(PROFILE_NAME, "parity");
  assert.equal(SCHEMA_ID, "specstride.profile/1");
  assert.equal(profileRows.length, RAW.switches.length);
  assert.equal(loadProfile().length, RAW.switches.length);
  const numbers = profileRows.map((r) => r.number);
  assert.equal(new Set(numbers).size, numbers.length, "each row number once");
  for (const row of profileRows) {
    assert.notEqual(row.switch.trim(), "", `row ${row.number} names its switch`);
    assert.notEqual(row.owner.trim(), "", `row ${row.number} names its owner`);
    assert.notEqual(row.parity.trim(), "", `row ${row.number} has a value under parity`);
    assert.notEqual(row.default.trim(), "", `row ${row.number} has a default`);
  }
  assert.equal(profileRow(1)?.switch, "Loop strategy");
  assert.deepEqual(profileRow(1)?.keys, ["loop.strategy"]);
  assert.equal(profileRow(1)?.parity, "classic");
  assert.equal(profileRow(1)?.default, "micro");
  assert.equal(profileRow(999), undefined);
  // The reserved literals of annex X §X.6 row 239.
  assert.deepEqual([...RESERVED_LITERALS], ["off", "not used", "baseline", "as-is", "(fixture)"]);
  // The profile is selected by ordinary configuration.
  assert.equal(SELECTED_BY, "configuration");
  assert.equal(PROFILE_KEY, "profile");
});

test("CT-100-310: applying the profile sets every key to its value under parity and does nothing else", () => {
  const before = { "something.else": "kept" };
  const applied = applyProfile(before);
  assert.equal(applied.config["something.else"], "kept", "it does nothing else");
  for (const row of rowsWithKeys()) {
    for (const key of row.keys) {
      assert.equal(applied.config[key], row.parity, `${key} of row ${row.number}`);
    }
  }
  // Every key of every row is applied, and nothing beyond them is added.
  const keys = new Set(rowsWithKeys().flatMap((r) => [...r.keys]));
  const added = Object.keys(applied.config).filter((k) => k !== "something.else");
  assert.deepEqual(new Set(added), keys);
  assert.equal(
    applied.applied.length,
    [...rowsWithKeys()].reduce((n, r) => n + r.keys.length, 0),
  );
  // Rows that name no key are reported, never guessed at.
  for (const number of applied.rowsWithoutKeys) {
    assert.deepEqual(profileRow(number)?.keys, []);
  }
  assert.equal(rowOfKey("loop.strategy")?.number, 1);
  assert.equal(rowOfKey("no.such.key"), undefined);
});

test("CT-100-311: the second suite is the profile with row 1 set to micro and nothing else changed (F100-FR-211)", () => {
  assert.equal(SECOND_SUITE_ROW, 1);
  assert.equal(SECOND_SUITE_VALUE, "micro");
  const rows = secondSuiteRows();
  assert.equal(rows.length, profileRows.length);
  assert.equal(rows.find((r) => r.number === 1)?.parity, "micro");
  for (const row of rows) {
    if (row.number === 1) continue;
    assert.equal(row.parity, profileRow(row.number)?.parity, `row ${row.number} is unchanged`);
  }
  const suite = applySecondSuite();
  assert.equal(suite.config["loop.strategy"], "micro");
  const first = applyProfile();
  for (const key of Object.keys(first.config)) {
    if (key === "loop.strategy") continue;
    assert.equal(suite.config[key], first.config[key], `${key} is unchanged`);
  }
});

test("CT-100-312: a package registers its switch, and a wrong owner is refused (F100-FR-212)", () => {
  resetSwitchesForTest();
  assert.equal(switchesAreSealed(), false);
  const row = profileRow(1);
  assert.notEqual(row, undefined);
  const registered = registerSwitch({
    key: "loop.strategy",
    owner: String(row?.owner),
    default: "micro",
    parity: "classic",
    registerRows: ["DV-012"],
  });
  assert.equal(registered.row?.number, 1);
  assert.equal(registeredSwitch("loop.strategy")?.key, "loop.strategy");
  assert.equal(registeredSwitches().length, 1);
  // A feature does not change a row of another feature.
  assert.throws(
    () =>
      registerSwitch({
        key: "loop.micro.closing_check",
        owner: "100",
        default: "on",
        parity: "off",
      }),
    (err: unknown) => {
      assert.ok(err instanceof SwitchRegistrationError);
      assert.equal(err.reason, "wrong-owner");
      assert.match(err.message, /A feature does not change a row of another feature/);
      return true;
    },
  );
  // A switch registered twice is refused.
  assert.throws(
    () =>
      registerSwitch({
        key: "loop.strategy",
        owner: String(row?.owner),
        default: "micro",
        parity: "classic",
      }),
    (err: unknown) => {
      assert.ok(err instanceof SwitchRegistrationError);
      assert.equal(err.reason, "twice");
      return true;
    },
  );
  // A switch without a row is reported; it fails the build (T259).
  registerSwitch({ key: "a.switch.no.row.holds", owner: "100", default: "off", parity: "off" });
  assert.deepEqual([...switchesWithoutARow()], ["a.switch.no.row.holds"]);
  // The registry is read-only after launch.
  sealSwitches();
  assert.equal(switchesAreSealed(), true);
  assert.throws(
    () => registerSwitch({ key: "too.late", owner: "100", default: "off", parity: "off" }),
    (err: unknown) => {
      assert.ok(err instanceof SwitchRegistrationError);
      assert.equal(err.reason, "after-launch");
      return true;
    },
  );
  resetSwitchesForTest();
});
