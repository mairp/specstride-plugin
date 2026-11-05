/**
 * T009 — rows 6, 7, 31 and 125 of annex X §X.7 (the `parity` profile) are
 * registered with their values under `parity`, and rows 1 (`loop.strategy`,
 * owner 115) and 25 (`sandbox.level`, owner 109) are NOT registered here
 * (`packages/check-runner/src/registry/switches.ts`).
 *
 * Every assertion reads the row through `@specstride/contracts` and compares
 * it with the registration, so the test fails when either side moves.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { profileRow, rowOfKey } from "@specstride/contracts/profile/parity";
import { registeredSwitch } from "@specstride/contracts/profile/switches";
import {
  CheckRunnerSwitchError,
  ENV_ALLOWLIST_KEY,
  FOREIGN_KEYS,
  FOREIGN_ROWS,
  GATE_FINGERPRINT_KEY,
  PARALLELISM_CEILING,
  PARALLELISM_KEY,
  PARALLELISM_MIN,
  READ_FROM_THEIR_OWNERS,
  REGISTERED_SWITCH_KEYS,
  REGISTERED_SWITCH_ROWS,
  STEP_RUNNER_KEY,
  checkParallelism,
  checkRunnerSwitch,
  checkRunnerSwitches,
  declaredRow,
  defaultValueOf,
  foreignRow,
  parityConfiguration,
  parityValueOf,
  rowOfThisFeature,
  valueOfCell,
} from "../src/registry/switches.ts";
import * as registryIndex from "../src/registry/index.ts";

/** The error a call threw, as the value the assertions read. */
function caught(call: () => unknown): CheckRunnerSwitchError {
  try {
    call();
  } catch (error) {
    assert.ok(
      error instanceof CheckRunnerSwitchError,
      `a CheckRunnerSwitchError: ${String(error)}`,
    );
    return error;
  }
  assert.fail("the call was expected to throw");
}

/** The four rows T009 registers, with the key and the value under `parity`. */
const REGISTERED = [
  { number: 6, key: "verification.step_runner", parity: false },
  { number: 7, key: "verification.parallelism", parity: 1 },
  { number: 31, key: "integrity.gate_fingerprint", parity: false },
  { number: 125, key: "verification.envAllowlist", parity: false },
] as const;

describe("T009 rows 6, 7, 31 and 125 are registered", () => {
  it("registers exactly the four rows, in the order of the annex", () => {
    assert.deepEqual([...REGISTERED_SWITCH_ROWS], [6, 7, 31, 125]);
    assert.deepEqual(
      checkRunnerSwitches.map((s) => s.number),
      [6, 7, 31, 125],
    );
    assert.deepEqual(
      [...REGISTERED_SWITCH_KEYS],
      REGISTERED.map((r) => r.key),
    );
    assert.deepEqual(
      checkRunnerSwitches.map((s) => s.key),
      REGISTERED.map((r) => r.key),
    );
  });

  it("the key of each row is the key annex X §X.7 holds for that row", () => {
    assert.equal(STEP_RUNNER_KEY, "verification.step_runner");
    assert.equal(PARALLELISM_KEY, "verification.parallelism");
    assert.equal(GATE_FINGERPRINT_KEY, "integrity.gate_fingerprint");
    assert.equal(ENV_ALLOWLIST_KEY, "verification.envAllowlist");
    for (const want of REGISTERED) {
      const row = profileRow(want.number);
      assert.ok(row !== undefined, `annex X §X.7 holds row ${want.number}`);
      assert.ok(row.keys.includes(want.key), `row ${want.number} names \`${want.key}\``);
      assert.equal(rowOfKey(want.key)?.number, want.number);
    }
  });

  it("every registered row names feature 148 as its owner", () => {
    for (const registered of checkRunnerSwitches) {
      const row = profileRow(registered.number);
      assert.ok(row !== undefined);
      assert.match(row.owner, /\b148\b/, `row ${registered.number} is owned by feature 148`);
      // The owner cell verbatim: row 31 names `148, 117`.
      assert.equal(registered.owner, row.owner);
    }
    assert.equal(checkRunnerSwitch(GATE_FINGERPRINT_KEY)?.owner, "148, 117");
  });

  it("each row carries its value under `parity`, read from the annex", () => {
    for (const want of REGISTERED) {
      const registered = checkRunnerSwitch(want.key);
      assert.ok(registered !== undefined, `\`${want.key}\` is registered`);
      assert.equal(registered.parityValue, want.parity, `\`${want.key}\` under parity`);
      assert.equal(parityValueOf(want.key), want.parity);
      // The cell of the annex travels beside the value it was read from.
      assert.equal(registered.parity, profileRow(want.number)?.parity);
    }
  });

  it("the `parity` configuration of this feature is the four keys and their values", () => {
    assert.deepEqual(parityConfiguration(), {
      "verification.step_runner": false,
      "verification.parallelism": 1,
      "integrity.gate_fingerprint": false,
      "verification.envAllowlist": false,
    });
  });

  it("row 125 is the environment allow-list: on by default, off under `parity`", () => {
    const registered = checkRunnerSwitch(ENV_ALLOWLIST_KEY);
    assert.ok(registered !== undefined);
    assert.equal(registered.number, 125);
    assert.equal(registered.defaultValue, true);
    assert.equal(registered.parityValue, false);
    assert.equal(defaultValueOf(ENV_ALLOWLIST_KEY), true);
    // The cell states the consequence after the value, and is kept verbatim.
    assert.equal(registered.parity, "off: the environment of the process is passed");
    assert.deepEqual([...(registered.registerRows ?? [])], ["DV-113"]);
  });

  it("the defaults are those of the annex: off, 1 with the ceiling 4, on, on", () => {
    assert.equal(defaultValueOf(STEP_RUNNER_KEY), false);
    assert.equal(defaultValueOf(PARALLELISM_KEY), 1);
    assert.equal(defaultValueOf(GATE_FINGERPRINT_KEY), true);
    assert.equal(defaultValueOf(ENV_ALLOWLIST_KEY), true);
    assert.equal(profileRow(7)?.default, "1 (ceiling 4)");
  });

  it("the registration reached the registry of switches of feature 100", () => {
    for (const want of REGISTERED) {
      const entry = registeredSwitch(want.key);
      assert.ok(entry !== undefined, `\`${want.key}\` is in the registry of feature 100`);
      assert.equal(entry.row?.number, want.number);
    }
  });

  it("each registered row is the one this feature's data file declares (T004)", () => {
    for (const want of REGISTERED) {
      const declared = declaredRow(want.number);
      assert.ok(declared !== undefined, `parity-rows.json holds row ${want.number}`);
      assert.equal(declared.key, want.key);
      assert.equal(declared.status, "confirmed");
    }
  });

  it("the switches are reachable through src/registry/index.ts", () => {
    assert.equal(registryIndex.checkRunnerSwitches, checkRunnerSwitches);
    assert.deepEqual([...registryIndex.REGISTERED_SWITCH_ROWS], [6, 7, 31, 125]);
    assert.deepEqual([...registryIndex.FOREIGN_ROWS], [1, 25]);
  });
});

describe("T009 rows 1 and 25 are read from their owners, not registered here", () => {
  it("names row 1 `loop.strategy` with owner 115 and row 25 `sandbox.level` with owner 109", () => {
    assert.deepEqual([...FOREIGN_ROWS], [1, 25]);
    assert.deepEqual([...FOREIGN_KEYS], ["loop.strategy", "sandbox.level"]);
    assert.deepEqual(
      READ_FROM_THEIR_OWNERS.map((r) => [r.number, r.key, r.owner]),
      [
        [1, "loop.strategy", "115"],
        [25, "sandbox.level", "109"],
      ],
    );
    assert.equal(foreignRow("loop.strategy")?.owner, "115");
    assert.equal(foreignRow("sandbox.level")?.owner, "109");
    assert.equal(foreignRow("verification.parallelism"), undefined);
  });

  it("the owner each row names is the owner annex X §X.7 names", () => {
    for (const foreign of READ_FROM_THEIR_OWNERS) {
      const row = profileRow(foreign.number);
      assert.ok(row !== undefined, `annex X §X.7 holds row ${foreign.number}`);
      assert.ok(row.keys.includes(foreign.key));
      assert.equal(row.owner, foreign.owner);
      assert.doesNotMatch(row.owner, /\b148\b/, `row ${foreign.number} is not owned by 148`);
      assert.ok(foreign.readFor.length > 0, "the reason it is read is stated");
    }
  });

  it("neither key is among the keys this module registers", () => {
    for (const key of FOREIGN_KEYS) {
      assert.equal(
        (REGISTERED_SWITCH_KEYS as readonly string[]).includes(key),
        false,
        `\`${key}\` is not registered by feature 148`,
      );
      assert.equal(checkRunnerSwitch(key), undefined);
      assert.equal(
        checkRunnerSwitches.some((s) => s.key === key),
        false,
      );
    }
    assert.equal(
      checkRunnerSwitches.some((s) => FOREIGN_ROWS.includes(s.number)),
      false,
    );
  });

  it("a row of another feature is refused rather than registered (F100-FR-212)", () => {
    for (const foreign of READ_FROM_THEIR_OWNERS) {
      // The guard every registration goes through refuses the row outright.
      const direct = caught(() => rowOfThisFeature(foreign.number, foreign.key));
      assert.equal(direct.key, foreign.key);
      assert.equal(direct.reason, "not-ours");
      assert.match(direct.message, new RegExp(`row ${foreign.number}\\b`));
      assert.match(direct.message, new RegExp(`\\b${foreign.owner}\\b`));
      assert.match(direct.message, /F100-FR-212/);

      // And reading its value through this module's own registry is refused
      // too: rows 1 and 25 are read from features 115 and 109, not from here.
      const read = caught(() => parityValueOf(foreign.key as never));
      assert.equal(read.key, foreign.key);
      assert.equal(read.reason, "not-ours");
    }
  });

  it("the guard accepts each of this feature's own four rows", () => {
    for (const want of REGISTERED) {
      const row = rowOfThisFeature(want.number, want.key);
      assert.equal(row.number, want.number);
      assert.ok(row.keys.includes(want.key));
    }
  });
});

describe("T009 the range of `verification.parallelism` and the reading of a cell", () => {
  it("the range is 1 to 4, the bounds EP-05 of feature 100 states (F148-FR-011)", () => {
    assert.equal(PARALLELISM_MIN, 1);
    assert.equal(PARALLELISM_CEILING, 4);
    for (const value of [1, 2, 3, 4]) assert.equal(checkParallelism(value), value);
  });

  it("a value outside the range is refused, not clamped", () => {
    for (const value of [0, -1, 5, 40, 1.5]) {
      const error = caught(() => checkParallelism(value));
      assert.equal(error.key, PARALLELISM_KEY);
      assert.equal(error.reason, "out-of-range");
      assert.match(error.message, /F148-FR-011/);
    }
  });

  it("valueOfCell reads the prose of a cell of the annex", () => {
    assert.equal(valueOfCell("off"), false);
    assert.equal(valueOfCell("on"), true);
    assert.equal(valueOfCell("1"), 1);
    assert.equal(valueOfCell("1 (ceiling 4)"), 1);
    assert.equal(valueOfCell("off: the environment of the process is passed"), false);
    assert.equal(valueOfCell("not used"), null);
    assert.equal(
      valueOfCell("The strongest the harness offers"),
      "The strongest the harness offers",
    );
  });

  it("a key with no row in §X.7 is refused", () => {
    const error = caught(() => parityValueOf("verification.nothing" as never));
    assert.equal(error.key, "verification.nothing");
    assert.equal(error.reason, "no-row");
    assert.match(error.message, /F100-FR-211/);
  });

  it("CheckRunnerSwitchError carries the key and the reason", () => {
    const error = new CheckRunnerSwitchError("a.key", "drift", "a message");
    assert.equal(error.name, "CheckRunnerSwitchError");
    assert.equal(error.key, "a.key");
    assert.equal(error.reason, "drift");
    assert.ok(error instanceof Error);
  });
});
