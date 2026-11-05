/**
 * T031 of feature 149 — the rows of this feature in the test of the `parity`
 * profile (annex X, §X.7; F149-FR-003, F149-FR-006; F100-FR-210,
 * F100-FR-211, F100-FR-212).
 *
 * Feature 149 owns two rows of the profile and reads a third:
 *
 * | Row | Switch                               | Key                       | Default | `parity`   | Owner |
 * |-----|--------------------------------------|---------------------------|---------|------------|-------|
 * | 24  | Model-tier bump after K rejections   | `attempt.tier_bump`       | `off`   | `off`      | 149   |
 * | 128 | K of the model-tier bump             | `attempt.tier_bump_after` | `2`     | `not used` | 149   |
 * | 32  | Comparison of the tree at phase entry| `integrity.phase_entry`   | `on`    | `off`      | 116; 149 performs the comparison |
 *
 * Why both rows are asserted here and not only in the own tests of the
 * feature: `packages/core/src/ep18/planner-tier-bump.ts` READS the two rows
 * through `profileRow` (phase 5, decision 9) and never registers them, so the
 * value of the option under `parity` and the default of K are facts of the
 * shipped data file. A change of either row would switch a PAID model tier on
 * under the profile that the parity oracle runs, and nothing else would catch
 * it: this test is the one that does.
 *
 * `packages/contracts/test/parity-profile.test.ts` (feature 100's T071) tests
 * the loader and the registry; this file tests the two rows of this feature
 * over the same loader. It imports only the `contracts` package: the core is
 * above `contracts` in the package graph and a test of `contracts` never
 * reaches it.
 *
 * T104 of FEATURE 101 adds the rows of that feature at the foot of this file,
 * under the heading "The rows of feature 101". Feature 101 owns two rows and
 * neither carries a configuration key, so the tests of 149 above are untouched
 * by them: `profileRows.filter((r) => r.owner === "149")` is still exactly 24
 * and 128, and `applyProfile` sets no key for a row without one.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  RESERVED_LITERALS,
  applyProfile,
  applySecondSuite,
  profileRow,
  profileRows,
  rowOfKey,
  type ProfileRow,
} from "../src/profile/parity.ts";
import {
  SwitchRegistrationError,
  registerSwitch,
  registeredSwitch,
  resetSwitchesForTest,
} from "../src/profile/switches.ts";

/** Row 24 of annex X §X.7 — the option of the model-tier bump (F149-FR-003). */
const TIER_BUMP_ROW = 24 as const;
/** Row 128 of annex X §X.7 — K of the model-tier bump (F149-FR-004). */
const K_ROW = 128 as const;
/** Row 32 — read by this feature, owned by another (phase 4, decision 3). */
const PHASE_ENTRY_ROW = 32 as const;

/** The two rows of the profile this feature owns, as §X.7 writes them. */
const ROWS_OF_THIS_FEATURE = [
  {
    number: TIER_BUMP_ROW,
    switch: "Model-tier bump after K rejections",
    key: "attempt.tier_bump",
    default: "off",
    parity: "off",
    owner: "149",
    registerRows: ["DV-079"],
  },
  {
    number: K_ROW,
    switch: "K of the model-tier bump",
    key: "attempt.tier_bump_after",
    default: "2",
    parity: "not used",
    owner: "149",
    registerRows: ["DV-079"],
  },
] as const;

test("T031: the rows 24 and 128 of the `parity` profile are this feature's, with their key, default, value under parity and owner", () => {
  for (const expected of ROWS_OF_THIS_FEATURE) {
    const row: ProfileRow | undefined = profileRow(expected.number);
    assert.ok(
      row !== undefined,
      `row ${String(expected.number)} of annex X §X.7 ("${expected.switch}") is in the profile`,
    );
    assert.equal(row.switch, expected.switch, `the switch of row ${String(expected.number)}`);
    assert.deepEqual(
      [...row.keys],
      [expected.key],
      `row ${String(expected.number)} names exactly the key ${expected.key}`,
    );
    assert.equal(row.default, expected.default, `the default of row ${String(expected.number)}`);
    assert.equal(row.parity, expected.parity, `row ${String(expected.number)} under parity`);
    assert.equal(row.owner, expected.owner, `the owner of row ${String(expected.number)}`);
    assert.deepEqual(
      [...row.registerRows],
      [...expected.registerRows],
      `the register rows of row ${String(expected.number)}`,
    );
    assert.equal(rowOfKey(expected.key)?.number, expected.number, `${expected.key} finds its row`);
  }
});

test("T031: the option is off by default and off under `parity`, and K is not used under `parity` (F149-FR-003)", () => {
  const option = profileRow(TIER_BUMP_ROW);
  // F149-FR-003: the option is OFF BY DEFAULT. The default and the value under
  // the profile are the same literal, so selecting `parity` cannot switch it on.
  assert.equal(option?.default, "off");
  assert.equal(option?.parity, "off");
  assert.equal(option?.default, option?.parity);

  const k = profileRow(K_ROW);
  // Research D2: K is 2. The default is the literal of the annex, as text.
  assert.equal(k?.default, "2");
  assert.equal(Number(k?.default), 2);
  // Under `parity` K is `not used`, which is a reserved literal of §X.6 row 239
  // and not a value of K: with the option off, K decides nothing.
  assert.equal(k?.parity, "not used");
  assert.ok(
    (RESERVED_LITERALS as readonly string[]).includes("not used"),
    "`not used` is a reserved literal and is never read as a number",
  );
  assert.equal(Number.isNaN(Number(k?.parity)), true, "`not used` is not a number");
});

test("T031: selecting the `parity` profile sets the option off and leaves K unused", () => {
  const applied = applyProfile();
  assert.equal(applied.config["attempt.tier_bump"], "off");
  assert.equal(applied.config["attempt.tier_bump_after"], "not used");
  // Both keys come from the rows of this feature and from nowhere else.
  const fromOurRows = applied.applied.filter((a) => a.row === TIER_BUMP_ROW || a.row === K_ROW);
  assert.deepEqual(fromOurRows.map((a) => a.key).sort(), [
    "attempt.tier_bump",
    "attempt.tier_bump_after",
  ]);
  // The second suite changes row 1 and nothing else, so the bump stays off in it.
  const suite = applySecondSuite();
  assert.equal(suite.config["attempt.tier_bump"], "off");
  assert.equal(suite.config["attempt.tier_bump_after"], "not used");
});

test("T031: the rows this feature owns are exactly 24 and 128, and row 32 is another feature's", () => {
  const ours = profileRows.filter((r) => r.owner === "149").map((r) => r.number);
  assert.deepEqual(
    [...ours].sort((a, b) => a - b),
    [TIER_BUMP_ROW, K_ROW],
    "feature 149 owns row 24 and row 128 and no other row of the profile",
  );
  // Row 32 is performed by this feature and owned by feature 116, so this
  // feature registers no switch for it (phase 4, decision 3).
  const phaseEntry = profileRow(PHASE_ENTRY_ROW);
  assert.equal(phaseEntry?.keys[0], "integrity.phase_entry");
  assert.notEqual(phaseEntry?.owner, "149");
  assert.match(String(phaseEntry?.owner), /149 performs the comparison/);
});

test("T031: feature 149 registers its two switches, and another feature cannot change them (F100-FR-212)", () => {
  resetSwitchesForTest();
  for (const expected of ROWS_OF_THIS_FEATURE) {
    const registered = registerSwitch({
      key: expected.key,
      owner: expected.owner,
      default: expected.default,
      parity: expected.parity,
      registerRows: [...expected.registerRows],
    });
    assert.equal(registered.row?.number, expected.number);
    assert.equal(registeredSwitch(expected.key)?.owner, "149");
  }
  resetSwitchesForTest();
  // A registration of the option under another owner is refused: nothing but
  // this feature may change what `attempt.tier_bump` defaults to.
  assert.throws(
    () =>
      registerSwitch({
        key: "attempt.tier_bump",
        owner: "100",
        default: "on",
        parity: "on",
      }),
    (err: unknown) => {
      assert.ok(err instanceof SwitchRegistrationError);
      assert.equal(err.reason, "wrong-owner");
      return true;
    },
  );
  resetSwitchesForTest();
});

/* ==================================================================== *
 * The rows of FEATURE 101 (T104 of `specs/101-gate-and-verdict/tasks.md`).
 *
 * Feature 101 owns two rows of the `parity` profile of annex X §X.7:
 *
 * | Row | Switch                                             | Key  | Default | `parity` | Owner |
 * |-----|----------------------------------------------------|------|---------|----------|-------|
 * | 129 | Refusal of a start for ticked phases without an approval record | — | `on` | `off` | 101 |
 * | 133 | A missing credential of the critic is a configuration error, found before the call | — | `on` | `off` | 101 |
 *
 * Row 129 is the switch of F101-FR-032: a specification whose phase shows every
 * task ticked while no approval record of it verifies refuses the start with
 * exit 3 — ON by default, and OFF under `parity`, because the baseline knows no
 * such refusal (DV-029). `packages/core/src/approval/ticked-without-record.ts`
 * READS the row through `profileRow(129)` and never registers it, so the value
 * of the row under the profile is a fact of this shipped data file.
 *
 * Row 133 is the switch of F101-FR-010: a missing credential of the critic is a
 * configuration error, found BEFORE the call by `preflight` and refused with
 * exit 3 and `critic_config`, with no count changed — ON by default, and OFF
 * under `parity`, where the missing credential is raised INSIDE the call and
 * scored as a failed call, as the reference does (DV-117, CQ-187).
 *
 * Why both rows are asserted here: a change of either one would silently change
 * what the parity oracle runs — row 129 would make the oracle refuse a start the
 * reference makes, and row 133 would make it halt before a call the reference
 * makes and scores. Nothing else in the workspace would catch that; this test
 * is the one that does.
 *
 * This file imports only the `contracts` package. `packages/core/` is above
 * `contracts` in the package graph, so the two modules of feature 101 that read
 * these rows are named here and never imported.
 * ==================================================================== */

/** Row 129 of annex X §X.7 — the refusal of F101-FR-032. */
const REFUSAL_ROW = 129 as const;
/** Row 133 of annex X §X.7 — the switch of a missing credential of F101-FR-010. */
const CREDENTIAL_ROW = 133 as const;

/** The two rows feature 101 owns, as §X.7 writes them. */
const ROWS_OF_FEATURE_101 = [
  {
    number: REFUSAL_ROW,
    switch: "Refusal of a start for ticked phases without an approval record",
    keyNote: "— (follows the approval record)",
    default: "on",
    parity: "off",
    owner: "101",
    registerRows: ["DV-029"],
    /** The module of feature 101 that READS the row; never imported here. */
    readBy: "packages/core/src/approval/ticked-without-record.ts",
    requirement: "F101-FR-032",
  },
  {
    number: CREDENTIAL_ROW,
    switch:
      "A missing credential of the critic is a configuration error, found before the call by " +
      "`preflight` and refused with engine exit 3 and `critic_config`; no count changes",
    keyNote: "— (none; feature 110 may name one)",
    default: "on",
    parity:
      "off: the missing credential is raised inside the call and scored as a failed call (DV-117)",
    owner: "101",
    registerRows: ["DV-117"],
    readBy: "packages/core/src/gate/critic-call.ts",
    requirement: "F101-FR-010",
  },
] as const;

test("T104: the rows 129 and 133 of the `parity` profile are feature 101's, with their switch, key cell, default, value under parity and owner", () => {
  for (const expected of ROWS_OF_FEATURE_101) {
    const row: ProfileRow | undefined = profileRow(expected.number);
    assert.ok(
      row !== undefined,
      `row ${String(expected.number)} of annex X §X.7 ("${expected.switch}") is in the profile`,
    );
    assert.equal(row.switch, expected.switch, `the switch of row ${String(expected.number)}`);
    assert.equal(row.keyNote, expected.keyNote, `the key cell of row ${String(expected.number)}`);
    assert.equal(row.default, expected.default, `the default of row ${String(expected.number)}`);
    assert.equal(row.parity, expected.parity, `row ${String(expected.number)} under parity`);
    assert.equal(row.owner, expected.owner, `the owner of row ${String(expected.number)}`);
    assert.deepEqual(
      [...row.registerRows],
      [...expected.registerRows],
      `the register rows of row ${String(expected.number)}`,
    );
    // Neither row carries a configuration key: the feature that owns the row
    // reads the row itself, so no key of the configuration can set it.
    assert.deepEqual([...row.keys], [], `row ${String(expected.number)} names no key`);
  }
});

test("T104: both rows of feature 101 are ON by default and OFF under `parity` (F101-FR-032, F101-FR-010)", () => {
  const refusal = profileRow(REFUSAL_ROW);
  // F101-FR-032 — the refusal stands by default and is off under `parity`,
  // because the reference knows no such refusal (DV-029).
  assert.equal(refusal?.default, "on");
  assert.equal(refusal?.parity, "off");
  assert.notEqual(refusal?.default, refusal?.parity, "selecting `parity` switches it OFF");
  assert.ok(
    (RESERVED_LITERALS as readonly string[]).includes(String(refusal?.parity)),
    "`off` is a reserved literal of §X.6 row 239 and names no value of a key",
  );

  const credential = profileRow(CREDENTIAL_ROW);
  // F101-FR-010 — the check before the call stands by default; under `parity`
  // the missing credential is raised inside the call and scored MALFORMED.
  assert.equal(credential?.default, "on");
  assert.equal(
    String(credential?.parity).startsWith("off"),
    true,
    "the cell of row 133 under `parity` begins with the reserved literal `off`",
  );
  assert.match(String(credential?.parity), /inside the call/);
  assert.match(String(credential?.parity), /DV-117/);
});

test("T104: selecting the `parity` profile sets NO key for either row of feature 101, and the rows are reported as keyless", () => {
  const applied = applyProfile();
  for (const expected of ROWS_OF_FEATURE_101) {
    assert.ok(
      applied.rowsWithoutKeys.includes(expected.number),
      `row ${String(expected.number)} is reported among the rows that name no key`,
    );
    assert.equal(
      applied.applied.some((a) => a.row === expected.number),
      false,
      `row ${String(expected.number)} set no key of the configuration`,
    );
  }
  // The second suite of the oracle changes row 1 and nothing else, so both rows
  // of feature 101 stay keyless and unchanged in it (F100-FR-211).
  const suite = applySecondSuite();
  for (const expected of ROWS_OF_FEATURE_101) {
    assert.ok(suite.rowsWithoutKeys.includes(expected.number));
    assert.equal(profileRow(expected.number)?.parity, expected.parity);
  }
});

test("T104: feature 101 owns exactly the rows 129 and 133, and no key of the configuration finds either", () => {
  const theirs = profileRows.filter((r) => r.owner === "101").map((r) => r.number);
  assert.deepEqual(
    [...theirs].sort((a, b) => a - b),
    [REFUSAL_ROW, CREDENTIAL_ROW],
    "feature 101 owns row 129 and row 133 and no other row of the profile",
  );
  // A row without a key is reachable by its number alone: `rowOfKey` finds it
  // for no key at all, which is what "— " in the key cell means.
  for (const expected of ROWS_OF_FEATURE_101) {
    const row = profileRow(expected.number);
    assert.ok(row !== undefined);
    for (const key of ["gate.refuse_ticked", "critic.api_key", "attempt.tier_bump"]) {
      assert.notEqual(
        rowOfKey(key)?.number,
        expected.number,
        `${key} does not find row ${String(expected.number)}`,
      );
    }
  }
  // The rows of feature 101 and the rows of feature 149 are disjoint, so this
  // file holds no row twice.
  const ofFeature149 = profileRows.filter((r) => r.owner === "149").map((r) => r.number);
  for (const number of theirs) {
    assert.equal(
      ofFeature149.includes(number),
      false,
      `row ${String(number)} belongs to one feature only`,
    );
  }
});

test("T104: a registration of either row of feature 101 under another owner is refused (F100-FR-212)", () => {
  resetSwitchesForTest();
  // Neither row carries a key, so neither is registered as a switch of the
  // configuration at all; what the registry must refuse is another feature
  // claiming the switch through a key of its own invention.
  for (const expected of ROWS_OF_FEATURE_101) {
    const row = profileRow(expected.number);
    assert.deepEqual([...(row?.keys ?? [])], [], `row ${String(expected.number)} registers no key`);
  }
  assert.throws(
    () =>
      registerSwitch({
        key: "attempt.tier_bump",
        owner: "101",
        default: "off",
        parity: "off",
      }),
    (err: unknown) => {
      assert.ok(err instanceof SwitchRegistrationError);
      assert.equal(err.reason, "wrong-owner");
      return true;
    },
    "feature 101 cannot claim a switch of feature 149",
  );
  resetSwitchesForTest();
});
