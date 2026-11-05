/**
 * T086 — the build check that the eight closed sets of
 * `packages/core/src/critic-input/data/closed-sets.json` (the copy of
 * `specs/117-critic-grounding-and-prompt/contracts/closed-sets.json`) are the
 * rows 115 to 122 of annex X §X.6, in members and unknown-value rule, against
 * the registrations of the `@specstride/contracts` package, which are
 * generated from the table of the annex. THE ANNEX STANDS WHERE THEY DIFFER:
 * the table of §X.6 is the oracle, so this check reads the rows through
 * `rowOf` and asserts the data file matches them — a difference is a fault of
 * the data file, never of the annex.
 *
 * covers: F117-FR-018; F117-FR-024; F117-FR-029
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { closedSetRows, rowOf } from "@specstride/contracts/enums";
import {
  kindsOfPresenceLineOfTheGroundingSnapshot,
  refusedRootsOfGrounding,
  kindsOfExcerpt,
  blocksOfTheCriticSPrompt,
  orderOfShrinkingOfTheCriticSPrompt,
  valuesOfPromptCriticOverwindow,
  waysACriticCallEndsForTheReturnOfTheHiddenFiles,
} from "@specstride/contracts/enums/all-sets";
import { promptBlockSets } from "@specstride/contracts/enums/pass-loop";

const DATA = fileURLToPath(
  new URL("../../src/critic-input/data/closed-sets.json", import.meta.url),
);

type DataFile = Record<string, readonly string[]>;

/** Row number → the key of the data file, with the export of the registration. */
const ROWS: readonly (readonly [number, string, readonly string[]])[] = [
  [115, "presenceLineKinds", kindsOfPresenceLineOfTheGroundingSnapshot.members],
  [116, "refusedRoots", refusedRootsOfGrounding.members],
  [117, "excerptKinds", kindsOfExcerpt.members],
  [118, "criticBlocks", blocksOfTheCriticSPrompt.members],
  [119, "shrinkOrder", orderOfShrinkingOfTheCriticSPrompt.members],
  [120, "overWindow", valuesOfPromptCriticOverwindow.members],
  [121, "blockSet", promptBlockSets.members],
  [122, "callEnds", waysACriticCallEndsForTheReturnOfTheHiddenFiles.members],
];

const data = JSON.parse(readFileSync(DATA, "utf8")) as DataFile;

test("the data file holds exactly the eight sets of rows 115 to 122", () => {
  assert.deepEqual(Object.keys(data).sort(), ROWS.map(([, key]) => key).sort());
});

test("every set matches its row of annex X §X.6, members in order", () => {
  for (const [number, key, members] of ROWS) {
    const row = rowOf(number);
    assert.ok(row !== undefined, `row ${number} is in the table of §X.6`);
    assert.deepEqual(
      [...data[key]!],
      [...members],
      `set ${key} differs from row ${number} of the annex — the annex stands`,
    );
    // The literals cell of the table is the same list the registration holds.
    assert.deepEqual(
      row.literals.filter((l) => l !== ""),
      [...members].filter((m) => row.literals.includes(m)),
      `row ${number}: the literals of the table agree with the registration`,
    );
  }
});

test("every row carries its unknown-value rule, which the data file takes from the annex", () => {
  const rules: Record<number, string> = {
    115: "The line is not written; the path counts as `not-shown`",
    116: "Refused",
    117: "`omitted`",
    118: "The block is left out and recorded",
    119: "Not applicable",
    120: "Configuration error",
    121: "Configuration error",
    122: "The files are returned",
  };
  for (const [number] of ROWS) {
    const row = rowOf(number)!;
    assert.equal(
      row.unknownValue,
      rules[number]!,
      `row ${number}: the unknown-value rule is the annex's`,
    );
    assert.ok(row.unknownValue.length > 0);
  }
});

test("the owners of the eight rows name feature 117 (row 121 with 103)", () => {
  assert.equal(rowOf(115)!.owner, "117");
  assert.equal(rowOf(116)!.owner, "117");
  assert.equal(rowOf(121)!.owner, "103; 117");
  assert.equal(closedSetRows.length > 122, true, "the table is the full annex table");
});
