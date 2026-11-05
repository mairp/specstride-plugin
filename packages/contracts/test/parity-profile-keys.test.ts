/**
 * T226 — contract test of the keys of the `parity` profile (annex X, §X.7;
 * F100-FR-127, F100-FR-211; F100-SC-006).
 *
 * Three things the cross-feature review asked for, each a test:
 *
 *  1. the rows 130 and 131 of the profile exist — the ceiling of the workers of
 *     a group (`loop.parallel.workersMax`, ruling P5) and the customisations of
 *     a harness that are loaded into a proposer pass by themselves
 *     (`harnesses.<id>.proposerCustomisations`). Both were added by the repairs
 *     of the cross-feature review and both are read by other features, so their
 *     absence must fail here and not in a feature that cites them;
 *  2. the field `keys` of every row holds configuration keys only. The `Key`
 *     cell of the annex is prose: it carries remarks in parentheses, short
 *     forms (`.tokens`), flags and verbs in back-ticks, and a dash where the
 *     switch has no key. `keys` is the machine-readable part of that cell, and
 *     the cell itself stays in `keyNote` (contracts/README.md, the row
 *     `data/parity-profile.json` of the table "Data"). A row of prose in `keys`
 *     would make every reader of the profile — `rowOfKey`, `applyProfile`, the
 *     static test "Profile" of T259 — set a key that no configuration holds;
 *  3. a worker count above `loop.parallel.workersMax` is named as a
 *     configuration error in the data of row 21. Row 21 is the switch
 *     `loop.parallel.workers`; its ceiling is row 130, and the data of the row
 *     must say what a value above the ceiling is. Feature 110 holds the same
 *     rule in its key catalogue (`config-keys.tsv`, `loop.parallel.workers`:
 *     "1 to the value of loop.parallel.workersMax") and in F110-FR-007, so the
 *     two must agree.
 *
 * The test reads the shipped data file through the loader of T072 and asserts
 * over it; it reads no specification and starts no process.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadProfile,
  profileRow,
  profileRows,
  rowOfKey,
  rowsWithKeys,
  type ProfileRow,
} from "../src/profile/parity.ts";

/**
 * A configuration key of the product: dotted segments, the first a lower-case
 * word, a later one possibly the placeholder of an identifier (`<id>`). The
 * same grammar the static test "Profile" of T259 uses.
 */
const CONFIGURATION_KEY = /^[a-z][A-Za-z0-9_]*(?:\.[a-z<][A-Za-z0-9_<>-]*)*$/;

/** The two rows the repairs of the cross-feature review added. */
const REPAIR_ROWS = [
  { number: 130, key: "loop.parallel.workersMax", owner: "142" },
  { number: 131, key: "harnesses.<id>.proposerCustomisations", owner: "131, 134" },
] as const;

test("T226: the rows 130 and 131 of the profile exist, with their key and owner", () => {
  for (const expected of REPAIR_ROWS) {
    const row: ProfileRow | undefined = profileRow(expected.number);
    assert.ok(
      row !== undefined,
      `annex X §X.7 holds a row ${expected.number}; data/parity-profile.json does not`,
    );
    assert.deepEqual(
      [...row.keys],
      [expected.key],
      `row ${expected.number} carries the key ${expected.key}`,
    );
    assert.equal(row.owner, expected.owner, `row ${expected.number} is owned by ${expected.owner}`);
    assert.notEqual(row.switch.trim(), "", `row ${expected.number} names its switch`);
    assert.notEqual(row.parity.trim(), "", `row ${expected.number} has a value under \`parity\``);
    // The row is reachable by its key, which is what every other feature does.
    assert.equal(
      rowOfKey(expected.key)?.number,
      expected.number,
      `the key ${expected.key} resolves to row ${expected.number}`,
    );
  }
});

test("T226: row 130 is the ceiling of the workers of a group, and row 131 the customisations of a harness", () => {
  const ceiling = profileRow(130);
  assert.ok(ceiling !== undefined);
  assert.match(ceiling.switch, /ceiling of the workers of a group/i);
  assert.equal(ceiling.default, "4", "the default of the ceiling is 4 (ruling P5)");

  const customisations = profileRow(131);
  assert.ok(customisations !== undefined);
  assert.match(customisations.switch, /[Cc]ustomisations of a harness/);
  // Row 29 covers harness-native memory only; row 131 says so itself, so that
  // the two switches are not read as one.
  assert.match(customisations.switch, /[Rr]ow 29 covers harness-native memory only/);
  assert.match(
    customisations.default,
    /never loaded into a critic-class call/,
    "a customisation is never loaded into a critic-class call",
  );
});

test("T226: the field `keys` of every row holds configuration keys only (F100-FR-211)", () => {
  // The loader is read again here, so that the assertion holds over the file
  // and not over a value another test may have touched.
  const rows = loadProfile();
  assert.equal(rows.length, profileRows.length);
  for (const row of rows) {
    for (const key of row.keys) {
      assert.match(
        key,
        CONFIGURATION_KEY,
        `row ${row.number}: "${key}" of \`keys\` is not a configuration key`,
      );
      // Prose, and the forms the `Key` cell of the annex carries beside a key:
      // a remark in parentheses, a back-tick, a dash for "no key", a short
      // form that was not written out, a flag or a verb.
      assert.doesNotMatch(key, /\s/, `row ${row.number}: "${key}" holds white space`);
      assert.doesNotMatch(key, /[`()[\]—,;]/, `row ${row.number}: "${key}" holds prose`);
      assert.doesNotMatch(key, /^[.-]/, `row ${row.number}: "${key}" is a short form or a dash`);
      assert.doesNotMatch(key, /^--/, `row ${row.number}: "${key}" is a flag, not a key`);
      // Every key of `keys` comes from the cell of the annex, which stays in
      // `keyNote`: `keys` adds nothing the annex does not name.
      assert.ok(
        row.keyNote.includes(key) || row.keyNote.includes("." + key.split(".").slice(-1)[0]),
        `row ${row.number}: "${key}" is not in the cell of the annex (${row.keyNote})`,
      );
    }
  }
  // A row with a key also names its first key in `key`, and a row without a
  // key has an empty list (contracts/README.md, the row of the table "Data").
  for (const row of rowsWithKeys()) {
    assert.ok(row.keys.length > 0);
  }
  assert.ok(
    rowsWithKeys().length < rows.length,
    "some rows of §X.7 name no configuration key; `keys` is empty for those",
  );
});

test("T226: a worker count above `loop.parallel.workersMax` is a configuration error in the data of row 21 (F100-FR-127)", () => {
  const row = profileRow(21);
  assert.ok(row !== undefined, "annex X §X.7 holds a row 21, the workers of a group");
  assert.deepEqual([...row.keys], ["loop.parallel.workers"]);
  // The ceiling, by its key and by the number of its row.
  assert.match(row.default, /row 130/, "the data of row 21 names the row of the ceiling");
  assert.match(
    row.default,
    /loop\.parallel\.workersMax/,
    "the data of row 21 names the key of the ceiling",
  );
  // What a value above the ceiling is: a configuration error, as the key
  // catalogue of feature 110 holds it for the same key.
  assert.match(
    row.default,
    /above the ceiling is a configuration error/,
    "the data of row 21 names a value above the ceiling as a configuration error",
  );
  // The ceiling of row 21 is the key of row 130 and of no other row.
  assert.equal(rowOfKey("loop.parallel.workersMax")?.number, 130);
});
