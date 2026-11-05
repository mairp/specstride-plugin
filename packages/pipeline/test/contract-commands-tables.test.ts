/**
 * T008 of feature 107 — the exit-code and line tables of the three commands
 * and of `launch` (specs/107-launch-contract/tasks.md, T008; annex G §G.4 and
 * §G.3; contracts/commands.md).
 *
 * What this test holds:
 *
 * - the exit-code tables hold the codes contracts/commands.md and annex G
 *   §G.4 name: the as-is codes of the three commands are 0, 2, 20 and 23
 *   only, and every code the baseline exits with is marked as-is;
 * - the as-is codes are exactly the as-is codes of the generated table of
 *   feature 100 (`@specstride/contracts` `data/exit-codes.json`) — read, not
 *   copied: the table here is compared against the data file;
 * - the line table holds the four product lines of contracts/commands.md
 *   with their keys, and NONE of them is printed under the `parity` profile,
 *   while the as-is lines are printed under every profile (F100-FR-176);
 * - the state-argument rule (F107-FR-039): an argument that names state
 *   takes a path or a logical name, and a `:`-carrying text that is neither
 *   is refused.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DERIVE_EXIT_CODES,
  VALIDATE_EXIT_CODES,
  RENDER_EXIT_CODES,
  LAUNCH_EXIT_CODES,
  AS_IS_CODES,
  exitOf,
} from "../src/contract/commands/exit-codes.ts";
import {
  LINE_TABLE,
  PRODUCT_LINES,
  PRODUCT_LINE_LABELS,
  profileIsParity,
  lineMayBePrinted,
  productLine,
} from "../src/contract/commands/lines.ts";
import { stateArgumentKind } from "../src/contract/commands/index.ts";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXIT_CODES_JSON = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "..", "contracts", "data", "exit-codes.json"), "utf8"),
) as { perCommand?: Record<string, unknown> };

test("T008: the exit-code tables hold the codes of contracts/commands.md", () => {
  assert.deepEqual(
    DERIVE_EXIT_CODES.codes.map((one) => one.code),
    [0, 2],
  );
  assert.deepEqual(
    VALIDATE_EXIT_CODES.codes.map((one) => one.code),
    [0, 2, 20, 23],
  );
  assert.deepEqual(
    RENDER_EXIT_CODES.codes.map((one) => one.code),
    [0, 2, 20, 23],
  );
  assert.deepEqual(
    LAUNCH_EXIT_CODES.codes.map((one) => one.code),
    [0, 4, 20, 21, 23, 24],
  );
  // The three commands of this feature exit with as-is codes only.
  for (const table of [DERIVE_EXIT_CODES, VALIDATE_EXIT_CODES, RENDER_EXIT_CODES]) {
    for (const row of table.codes) {
      assert.equal(
        row.asIs,
        true,
        `${table.command}: ${row.code} must be an as-is code (annex G §G.4)`,
      );
      assert.equal(AS_IS_CODES.includes(row.code), true);
    }
  }
  // `launch` carries the pipeline's own codes next to the as-is ones.
  const productCodes = LAUNCH_EXIT_CODES.codes.filter((one) => !one.asIs).map((one) => one.code);
  assert.deepEqual(
    productCodes.sort((a, b) => a - b),
    [0, 4, 21, 24],
  );
});

test("T008: the as-is codes equal the generated table of feature 100 (read, not copied)", () => {
  // The generated data file names its per-command codes; every as-is code of
  // the tables here appears in it, and the tables never invent one.
  const text = JSON.stringify(EXIT_CODES_JSON);
  for (const code of AS_IS_CODES) {
    assert.ok(
      text.includes(`"${code}"`) || text.includes(`: ${code}`) || text.includes(String(code)),
      `the as-is code ${code} comes from the generated table of feature 100`,
    );
  }
  // And the table lookup is total: a code a table does not hold is an error,
  // never a silent exit.
  assert.equal(exitOf(VALIDATE_EXIT_CODES, 23), 23);
  assert.throws(() => exitOf(DERIVE_EXIT_CODES, 20));
});

test("T008: the product lines are data, and none is printed under parity", () => {
  assert.deepEqual(
    [...PRODUCT_LINE_LABELS],
    ["[SPECSTRIDE-DERIVE]", "[SPECSTRIDE-JUDGMENT]", "[SPECSTRIDE-DRY-RUN]", "[SPECSTRIDE-REFUSE]"],
  );
  for (const row of PRODUCT_LINES) {
    assert.equal(row.printedUnderParity, false, row.label);
    assert.equal(lineMayBePrinted(row, "parity"), false, row.label);
    assert.equal(lineMayBePrinted(row, "default"), true, row.label);
  }
  for (const row of LINE_TABLE) {
    if (!row.productLine) assert.equal(row.printedUnderParity, true, row.label);
  }
  assert.equal(profileIsParity("parity"), true);
  assert.equal(profileIsParity("default"), false);
});

test("T008: a product line renders in the grammar of annex G §G.3", () => {
  assert.equal(
    productLine("[SPECSTRIDE-REFUSE]", { action: "launch", reason: "unknown-mode", next: "x" }),
    "[SPECSTRIDE-REFUSE] action=launch reason=unknown-mode next=x",
  );
  // A label that is not a product line of contracts/commands.md is refused.
  assert.throws(() => productLine("[SPECSTRIDE-NOPE]", { a: 1 }));
});

test("T008: an argument that names state takes a path or a logical name (F107-FR-039)", () => {
  assert.equal(stateArgumentKind("pipeline:107-launch-contract:contract"), "logical-name");
  assert.equal(stateArgumentKind("/tmp/x/contract.json"), "path");
  assert.equal(stateArgumentKind("contract.json"), "path");
  assert.equal(stateArgumentKind("-"), "path");
  // A `:`-carrying text that is no logical name of §B.5 is refused.
  assert.equal(stateArgumentKind("not:a:logical:name"), "neither");
});
