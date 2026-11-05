/**
 * T009 — rows 15, 33 and the six keys of the rows 123, 124 and 126 of annex X
 * §X.7 are registered with their values under `parity`; rows 1, 6, 7 and 31
 * are read from their owners, and rows 6, 7 and 31 READ ONLY, for the rule of
 * F105-FR-020 on when a manifest is written
 * (`packages/verification/src/mode/switches.ts`).
 *
 * Every assertion reads the row through `@specstride/contracts` and compares
 * it with the registration, so the test fails when either side moves, and
 * each value is compared with `packages/verification/data/parity-rows.json`
 * as well, so neither the annex, the contracts data nor the code can drift
 * from the other two.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { profileRow, rowOfKey } from "@specstride/contracts/profile/parity";
import { registeredSwitch } from "@specstride/contracts/profile/switches";
import parityRows from "../data/parity-rows.json" with { type: "json" };
import {
  COMMANDS_KEY,
  FOREIGN_KEYS,
  FOREIGN_ROWS,
  GENERATE_TESTS_KEY,
  MANIFEST_RELAUNCH_KEY,
  OWNED_SWITCH_KEYS,
  OWNED_SWITCH_ROWS,
  PARALLELISM_OFF,
  PARITY_LOOP_STRATEGY,
  READ_FROM_THEIR_OWNERS,
  READ_ONLY_KEYS,
  READ_ONLY_ROWS,
  REGISTERED_SWITCH_KEYS,
  REGISTERED_SWITCH_ROWS,
  STALENESS_CHECK_POINTS_KEY,
  TAIL_ERR_LINES_KEY,
  TAIL_LINES_KEY,
  TEST_PLAN_KEY,
  VERIFICATION_MODE_KEY,
  VerificationSwitchError,
  declaredRow,
  defaultValueOf,
  foreignRow,
  manifestIsWritten,
  parityConfiguration,
  parityManifestRuleInput,
  parityValueOf,
  rawCellsOf,
  readOnlySwitch,
  rowOfThisFeature,
  valueOfCell,
  valueOfCellForKey,
  verificationSwitch,
  verificationSwitches,
  verificationSwitchesOfRow,
  writeReadOnlySwitch,
} from "../src/mode/switches.ts";
import * as modeIndex from "../src/mode/index.ts";

/** The error a call threw, as the value the assertions read. */
function caught(call: () => unknown): VerificationSwitchError {
  try {
    call();
  } catch (error) {
    assert.ok(
      error instanceof VerificationSwitchError,
      `a VerificationSwitchError: ${String(error)}`,
    );
    return error;
  }
  assert.fail("the call was expected to throw");
}

/** The eight keys T009 registers, with the row and the value under `parity`. */
const REGISTERED = [
  { number: 15, key: STALENESS_CHECK_POINTS_KEY, parity: "critic start only", owned: false },
  { number: 33, key: MANIFEST_RELAUNCH_KEY, parity: false, owned: false },
  { number: 123, key: VERIFICATION_MODE_KEY, parity: null, owned: true },
  { number: 124, key: TEST_PLAN_KEY, parity: null, owned: true },
  { number: 124, key: COMMANDS_KEY, parity: null, owned: true },
  { number: 124, key: GENERATE_TESTS_KEY, parity: null, owned: true },
  { number: 126, key: TAIL_LINES_KEY, parity: 80, owned: true },
  { number: 126, key: TAIL_ERR_LINES_KEY, parity: 40, owned: true },
] as const;

/**
 * The value `data/parity-rows.json` declares under `parity` for a key, read
 * the way the annex cell is read. The contracts data writes a state as the
 * prose of the annex ("off"); `valueOfCell` is the one place that turns such
 * a cell into the value this package uses, so the comparison goes through it
 * rather than keeping a second spelling of the same rule in the test.
 */
function declaredValue(row: number, key: string): unknown {
  const entry = declaredRow(row, key);
  assert.ok(entry !== undefined, `data/parity-rows.json holds row ${String(row)} \`${key}\``);
  const declared = entry.underParity;
  return typeof declared === "string" ? valueOfCell(declared) : declared;
}

describe("T009 the rows this feature registers", () => {
  it("registers rows 15, 33, 123, 124 and 126 and nothing else", () => {
    assert.deepEqual([...REGISTERED_SWITCH_ROWS], [15, 33, 123, 124, 126]);
    assert.deepEqual([...OWNED_SWITCH_ROWS], [123, 124, 126]);
    assert.equal(verificationSwitches.length, 8);
    assert.deepEqual(
      verificationSwitches.map((s) => s.number),
      REGISTERED.map((r) => r.number),
    );
  });

  it("registers the eight keys of those five rows, in the order of the annex", () => {
    assert.deepEqual(
      [...REGISTERED_SWITCH_KEYS],
      REGISTERED.map((r) => r.key),
    );
    assert.deepEqual(
      [...OWNED_SWITCH_KEYS],
      REGISTERED.filter((r) => r.owned).map((r) => r.key),
    );
    assert.equal(OWNED_SWITCH_KEYS.length, 6, "the six keys of the rows 123, 124 and 126");
  });

  it("gives the rows that carry more than one key all of their keys", () => {
    assert.deepEqual(
      verificationSwitchesOfRow(124).map((s) => s.key),
      [TEST_PLAN_KEY, COMMANDS_KEY, GENERATE_TESTS_KEY],
    );
    assert.deepEqual(
      verificationSwitchesOfRow(126).map((s) => s.key),
      [TAIL_LINES_KEY, TAIL_ERR_LINES_KEY],
    );
    assert.equal(verificationSwitchesOfRow(15).length, 1);
    assert.equal(verificationSwitchesOfRow(33).length, 1);
    assert.deepEqual([...verificationSwitchesOfRow(7)], [], "row 7 is not registered here");
  });

  for (const entry of REGISTERED) {
    it(`row ${String(entry.number)} \`${entry.key}\` carries the value of the annex`, () => {
      const registered = verificationSwitch(entry.key);
      assert.ok(registered !== undefined, `\`${entry.key}\` is registered`);
      assert.equal(registered.number, entry.number);
      assert.equal(registered.owned, entry.owned);
      assert.deepEqual(registered.parityValue, entry.parity);
      assert.deepEqual(parityValueOf(entry.key), entry.parity);
      // The row of §X.7 names the key and names feature 105 as an owner.
      const row = profileRow(entry.number);
      assert.ok(row !== undefined);
      assert.ok(row.keys.includes(entry.key));
      assert.match(row.owner, /\b105\b/);
      assert.equal(rowOfKey(entry.key)?.number, entry.number);
      // The registry of feature 100 holds it under the owner cell, verbatim.
      const shared = registeredSwitch(entry.key);
      assert.ok(shared !== undefined, "feature 100's registry holds it");
      assert.equal(shared.owner, row.owner);
      assert.equal(shared.default, row.default);
      assert.equal(shared.parity, row.parity);
    });
  }

  it("matches `data/parity-rows.json` for every key, for the value under `parity`", () => {
    // Rows 123 and 124 say "As the fixture sets it", which names no value:
    // the registration is `null` and the contracts data says so in prose.
    const prose = /^as the fixture sets/i;
    for (const entry of REGISTERED) {
      const raw = declaredRow(entry.number, entry.key)?.underParity;
      if (typeof raw === "string" && prose.test(raw)) {
        assert.equal(entry.parity, null, `\`${entry.key}\` names no value under parity`);
        continue;
      }
      assert.deepEqual(entry.parity, declaredValue(entry.number, entry.key), `\`${entry.key}\``);
    }
  });

  it("matches `data/parity-rows.json` for the default of every owned key", () => {
    for (const key of OWNED_SWITCH_KEYS) {
      const row = rowOfKey(key);
      assert.ok(row !== undefined);
      const entry = declaredRow(row.number, key);
      assert.ok(entry !== undefined);
      const declared = entry.default;
      assert.deepEqual(
        defaultValueOf(key),
        typeof declared === "string" ? valueOfCell(declared) : (declared ?? null),
        `\`${key}\``,
      );
    }
  });

  it("reads the defaults of rows 15 and 33 from the annex", () => {
    assert.equal(defaultValueOf(STALENESS_CHECK_POINTS_KEY), "launch, resume and every pass start");
    assert.equal(defaultValueOf(MANIFEST_RELAUNCH_KEY), true, "row 33 is on by default");
    assert.equal(parityValueOf(MANIFEST_RELAUNCH_KEY), false, "and off under `parity`");
  });

  it("gives the configuration of the six owned keys under `parity`", () => {
    assert.deepEqual(parityConfiguration(), {
      "verification.mode": null,
      "verification.testPlan": null,
      "verification.commands": null,
      "verification.generateTests": null,
      "verification.summary.tailLines": 80,
      "verification.summary.tailErrLines": 40,
    });
  });

  it("re-exports the switches from the index of `mode/`", () => {
    assert.equal(modeIndex.verificationSwitches, verificationSwitches);
    assert.equal(modeIndex.manifestIsWritten, manifestIsWritten);
  });
});

describe("T009 a row of another feature is refused by `rowOfThisFeature`", () => {
  it("refuses a row whose owner cell does not name 105", () => {
    for (const [number, key] of [
      [1, "loop.strategy"],
      [6, "verification.step_runner"],
      [7, "verification.parallelism"],
      [31, "integrity.gate_fingerprint"],
    ] as const) {
      const error = caught(() => rowOfThisFeature(number, key));
      assert.equal(error.reason, "not-ours");
      assert.match(error.message, /F100-FR-212/);
    }
  });

  it("refuses a number the profile holds no row for, and a key the row lacks", () => {
    assert.equal(caught(() => rowOfThisFeature(99999, "x")).reason, "no-row");
    assert.equal(caught(() => rowOfThisFeature(123, "verification.mod")).reason, "drift");
  });

  it("accepts the five rows of this feature", () => {
    for (const entry of REGISTERED) {
      assert.equal(rowOfThisFeature(entry.number, entry.key).number, entry.number);
    }
  });
});

describe("T009 rows 1, 6, 7 and 31 are read from their owners", () => {
  it("names the four rows with their owner and the reason", () => {
    assert.deepEqual([...FOREIGN_ROWS], [1, 6, 7, 31]);
    assert.deepEqual(
      [...FOREIGN_KEYS],
      [
        "loop.strategy",
        "verification.step_runner",
        "verification.parallelism",
        "integrity.gate_fingerprint",
      ],
    );
    assert.equal(foreignRow("loop.strategy")?.owner, "115");
    assert.equal(foreignRow("verification.step_runner")?.owner, "148");
    assert.equal(foreignRow("verification.parallelism")?.owner, "148");
    assert.equal(foreignRow("integrity.gate_fingerprint")?.owner, "148, 117");
    for (const row of READ_FROM_THEIR_OWNERS) {
      assert.notEqual(row.readFor, "", `row ${String(row.number)} says why it is read`);
    }
  });

  it("registers none of them, here or in the registry of feature 100", () => {
    for (const key of FOREIGN_KEYS) {
      assert.equal(verificationSwitch(key), undefined, `\`${key}\` is not ours`);
      assert.ok(
        !(REGISTERED_SWITCH_KEYS as readonly string[]).includes(key),
        `\`${key}\` is not in REGISTERED_SWITCH_KEYS`,
      );
    }
  });

  it("marks rows 6, 7 and 31 as READ ONLY, for the manifest rule only", () => {
    assert.deepEqual([...READ_ONLY_ROWS], [6, 7, 31]);
    assert.deepEqual(
      [...READ_ONLY_KEYS],
      ["verification.step_runner", "verification.parallelism", "integrity.gate_fingerprint"],
    );
    for (const key of READ_ONLY_KEYS) {
      assert.equal(foreignRow(key)?.readOnlyForTheManifestRule, true);
      assert.match(foreignRow(key)?.readFor ?? "", /read only/);
      assert.match(foreignRow(key)?.readFor ?? "", /F105-FR-020/);
    }
    // Row 1 is read for more than the manifest rule, so it is not read only.
    assert.equal(foreignRow("loop.strategy")?.readOnlyForTheManifestRule, false);
    assert.ok(!READ_ONLY_ROWS.includes(1));
  });

  it("reads the value of each from the annex, and matches the contracts data", () => {
    const expected = [
      { key: "loop.strategy", parity: "classic", default: "micro" },
      { key: "verification.step_runner", parity: false, default: false },
      { key: "verification.parallelism", parity: 1, default: 1 },
      { key: "integrity.gate_fingerprint", parity: false, default: true },
    ] as const;
    for (const entry of expected) {
      const read = readOnlySwitch(entry.key);
      assert.deepEqual(read.parityValue, entry.parity, `\`${entry.key}\` under parity`);
      assert.deepEqual(read.defaultValue, entry.default, `\`${entry.key}\` by default`);
      assert.deepEqual(
        read.parityValue,
        declaredValue(read.foreign.number, entry.key),
        `\`${entry.key}\` equals data/parity-rows.json`,
      );
    }
  });

  it("refuses a read of a key this feature registers, and of an unrelated key", () => {
    assert.equal(caught(() => readOnlySwitch(VERIFICATION_MODE_KEY)).reason, "not-read-only");
    assert.equal(caught(() => readOnlySwitch("sandbox.level")).reason, "not-ours");
  });

  it("has no setter: a write to one of the four always throws", () => {
    for (const key of FOREIGN_KEYS) {
      const error = caught(() => writeReadOnlySwitch(key, true));
      assert.equal(error.reason, "read-only");
      assert.match(error.message, /reads it and never sets it \(F100-FR-212\)/);
    }
    assert.equal(caught(() => writeReadOnlySwitch("verification.mode", "off")).reason, "read-only");
  });

  it("names rows 6, 7 and 31 read only in `data/parity-rows.json` too", () => {
    const read = (parityRows as { read: { row: number; readOnly?: string }[] }).read;
    for (const number of READ_ONLY_ROWS) {
      const entry = read.find((r) => r.row === number);
      assert.ok(entry !== undefined, `row ${String(number)} is in the data file`);
      assert.match(entry.readOnly ?? "", /manifest/, `row ${String(number)} says why`);
    }
    // Rows 1, 15 and 33 carry no `readOnly` note: they are read and acted on.
    for (const number of [1, 15, 33]) {
      assert.equal(read.find((r) => r.row === number)?.readOnly, undefined);
    }
  });
});

describe("T009 the rule of F105-FR-020 on when a manifest file is written", () => {
  it("writes no manifest under the `parity` profile", () => {
    const input = parityManifestRuleInput();
    assert.deepEqual(input, {
      loopStrategy: "classic",
      stepRunner: false,
      parallelism: 1,
      gateFingerprint: false,
      manifestRelaunch: false,
    });
    assert.equal(PARITY_LOOP_STRATEGY, "classic");
    assert.equal(PARALLELISM_OFF, 1);
    const outcome = manifestIsWritten(input);
    assert.equal(outcome.written, false);
    assert.deepEqual([...outcome.because], []);
    assert.match(outcome.reason, /from the verification plan as at the baseline/);
  });

  it("writes a manifest when the loop strategy is not `classic`", () => {
    const outcome = manifestIsWritten({ ...parityManifestRuleInput(), loopStrategy: "micro" });
    assert.equal(outcome.written, true);
    assert.deepEqual([...outcome.because], [1]);
  });

  it("writes a manifest when a switch of row 6, 7, 31 or 33 is on", () => {
    const base = parityManifestRuleInput();
    assert.deepEqual([...manifestIsWritten({ ...base, stepRunner: true }).because], [6]);
    assert.deepEqual([...manifestIsWritten({ ...base, parallelism: 2 }).because], [7]);
    assert.deepEqual([...manifestIsWritten({ ...base, gateFingerprint: true }).because], [31]);
    assert.deepEqual([...manifestIsWritten({ ...base, manifestRelaunch: true }).because], [33]);
    for (const over of [
      { stepRunner: true },
      { parallelism: 4 },
      { gateFingerprint: true },
      { manifestRelaunch: true },
    ]) {
      assert.equal(manifestIsWritten({ ...base, ...over }).written, true);
    }
  });

  it("names every row that asked, in the order of the annex", () => {
    const outcome = manifestIsWritten({
      loopStrategy: "micro",
      stepRunner: true,
      parallelism: 3,
      gateFingerprint: true,
      manifestRelaunch: true,
    });
    assert.deepEqual([...outcome.because], [1, 6, 7, 31, 33]);
    assert.match(outcome.reason, /rows 1, 6, 7, 31, 33 of annex X §X\.7 ask for it/);
  });

  it("reads row 7 as a count, not a state: 1 is off and 2 is on", () => {
    const base = parityManifestRuleInput();
    assert.equal(manifestIsWritten({ ...base, parallelism: 1 }).written, false);
    assert.equal(manifestIsWritten({ ...base, parallelism: 2 }).written, true);
  });
});

describe("T009 the value a cell of the annex names", () => {
  it("reads `off`, `on`, a count and a reserved literal", () => {
    assert.equal(valueOfCell("off"), false);
    assert.equal(valueOfCell("on"), true);
    assert.equal(valueOfCell("1 (ceiling 4)"), 1);
    assert.equal(valueOfCell("80"), 80);
    assert.equal(valueOfCell("off: the environment of the process is passed"), false);
    assert.equal(valueOfCell("not used"), null);
    assert.equal(valueOfCell("As the fixture sets it"), null);
    assert.equal(valueOfCell("As the fixture sets them"), null);
    assert.equal(valueOfCell("`classic`"), "classic");
    assert.equal(valueOfCell("critic start only"), "critic start only");
  });

  it("reads the raw cells of a row, with the back-ticks feature 100 strips", () => {
    const raw = rawCellsOf(124);
    assert.ok(raw !== undefined);
    assert.match(raw.default, /`testautomation\/<slug>\/TEST_PLAN\.md`/);
    assert.equal(profileRow(124)?.default.includes("`"), false, "feature 100 strips them");
    assert.equal(rawCellsOf(99999), undefined);
  });

  it("splits a cell that names a value per key, in the order of the keys", () => {
    const row126 = profileRow(126);
    assert.ok(row126 !== undefined);
    assert.equal(valueOfCellForKey(row126, TAIL_LINES_KEY, "80; 40"), 80);
    assert.equal(valueOfCellForKey(row126, TAIL_ERR_LINES_KEY, "80; 40"), 40);
    const row124 = profileRow(124);
    assert.ok(row124 !== undefined);
    const raw = rawCellsOf(124)?.default ?? "";
    assert.equal(
      valueOfCellForKey(row124, TEST_PLAN_KEY, raw),
      "testautomation/<slug>/TEST_PLAN.md",
    );
    assert.equal(valueOfCellForKey(row124, COMMANDS_KEY, raw), null, "`none` is no document");
    assert.equal(
      valueOfCellForKey(row124, GENERATE_TESTS_KEY, raw),
      "testautomation/<slug>/generated",
      "the prose after the literal is the consequence, not the value",
    );
  });

  it("gives the whole cell to every key where the cell names no value per key", () => {
    const row = profileRow(126);
    assert.ok(row !== undefined);
    assert.equal(valueOfCellForKey(row, TAIL_LINES_KEY, "off"), false);
    // A key the row does not carry falls back to the whole cell, which
    // `valueOfCell` reads as the count it opens with.
    assert.equal(valueOfCellForKey(row, "not.a.key", "80; 40"), 80);
    assert.equal(valueOfCellForKey(row, "not.a.key", "critic start only"), "critic start only");
  });
});
