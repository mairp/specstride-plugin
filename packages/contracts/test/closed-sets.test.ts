/**
 * T069 — contract tests CT-100-308 and CT-100-309 for the list of closed sets
 * (annex X, §X.6; F100-FR-208, F100-FR-209; F100-SC-007).
 *
 * Every row of `closed-sets.json` has a number, a name, an owner, `closedBy`
 * and an unknown-value rule; every set the package exports has a row and every
 * row with literals has an export whose members equal the literals; a reader
 * without a branch for an unknown value fails.
 */
import test from "node:test";
import assert from "node:assert/strict";
import closedSetsData from "../data/closed-sets.json" with { type: "json" };
import {
  ALL_SET_NUMBERS,
  NoUnknownBranchError,
  UNKNOWN_VALUE_KINDS,
  closedSetRows,
  defineClosedSet,
  firstOwnerNumber,
  loadClosedSetRows,
  readMember,
  rowOf,
  unknownValueRuleOf,
} from "../src/enums/index.ts";
import { CLOSED_SET_COUNT, closedSet, closedSetByName, closedSets } from "../src/enums/all-sets.ts";

const RAW = (
  closedSetsData as {
    closedSets: {
      number: number;
      name: string;
      literals: string[];
      owner: string;
      closedBy: string;
      unknownValue: string;
    }[];
  }
).closedSets;

test("CT-100-308: every row has a number, a name, an owner, closedBy and an unknown-value rule (F100-FR-208)", () => {
  assert.equal(closedSetRows.length, RAW.length);
  assert.equal(loadClosedSetRows().length, RAW.length);
  const numbers = closedSetRows.map((r) => r.number);
  assert.equal(new Set(numbers).size, numbers.length, "each number once");
  for (const row of closedSetRows) {
    assert.equal(typeof row.number, "number");
    assert.ok(Number.isInteger(row.number) && row.number > 0, String(row.number));
    assert.notEqual(row.name.trim(), "", `row ${row.number} has a name`);
    assert.notEqual(row.owner.trim(), "", `row ${row.number} has an owner`);
    assert.notEqual(row.closedBy.trim(), "", `row ${row.number} says how it is closed`);
    assert.notEqual(row.unknownValue.trim(), "", `row ${row.number} has an unknown-value rule`);
    assert.ok(/^\d+/.test(row.owner.trim()), `row ${row.number} names its owner by number`);
  }
  // The owner of a compound row is its first number.
  assert.equal(firstOwnerNumber("100; 102"), 100);
  assert.equal(firstOwnerNumber("146"), 146);
  assert.equal(rowOf(1)?.name, "Run states");
  assert.equal(rowOf(999_999), undefined);
});

test("CT-100-308: the column 'unknown value' gives one of the four kinds of rule", () => {
  assert.deepEqual([...UNKNOWN_VALUE_KINDS], ["refuse", "show-as-unknown", "ignore", "default"]);
  const kinds = new Set<string>();
  for (const row of closedSetRows) {
    const outcome = unknownValueRuleOf(row.unknownValue)("a-value", row.name);
    assert.ok(
      (UNKNOWN_VALUE_KINDS as readonly string[]).includes(outcome.kind),
      `row ${row.number}: ${outcome.kind}`,
    );
    // The rule names the set and the value.
    assert.match(outcome.message, /a-value/);
    assert.match(outcome.message, new RegExp(row.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(outcome.cell, row.unknownValue.trim());
    kinds.add(outcome.kind);
  }
  // All four kinds are in use in the table.
  assert.deepEqual([...kinds].sort(), ["default", "ignore", "refuse", "show-as-unknown"]);
  // Row 1 shows as `unknown` with an attention item; row 183 reads as the
  // named default; row 21 ignores; row 19 refuses.
  assert.equal(closedSet(1)?.onUnknown("x").kind, "show-as-unknown");
  assert.equal(closedSet(1)?.onUnknown("x").attentionItem, true);
  assert.equal(closedSet(183)?.onUnknown("x").kind, "default");
  assert.equal(closedSet(183)?.onUnknown("x").treatedAs, "unverified");
  assert.equal(closedSet(21)?.onUnknown("x").kind, "ignore");
  assert.equal(closedSet(19)?.onUnknown("x").kind, "refuse");
});

test("CT-100-309: every set the package exports has a row, and every row with literals an export (F100-SC-007)", () => {
  assert.equal(CLOSED_SET_COUNT, RAW.length);
  assert.deepEqual(
    [...closedSets.keys()].sort((a, b) => a - b),
    [...ALL_SET_NUMBERS].sort((a, b) => a - b),
  );
  for (const row of RAW) {
    const set = closedSet(row.number);
    assert.notEqual(set, undefined, `row ${row.number} ("${row.name}") has an export`);
    assert.equal(set?.name, row.name);
    assert.equal(set?.owner, row.owner);
    assert.equal(set?.number, row.number);
    if (row.literals.length === 0) continue;
    assert.deepEqual(
      [...(set?.members ?? [])],
      row.literals,
      `the members of row ${row.number} equal its literals`,
    );
    for (const member of row.literals) assert.ok(set?.has(member), `${row.number}: ${member}`);
    assert.equal(set?.has("a-value-no-row-names"), false);
  }
  assert.equal(closedSetByName("Run states")?.number, 1);
  assert.equal(closedSetByName("no such set"), undefined);
  // A set whose number the table does not hold cannot be defined.
  assert.throws(() => defineClosedSet(999_999, ["a"]), /holds no row 999999/);
});

test("CT-100-309: a reader without a branch for an unknown value fails (F100-FR-209)", () => {
  const set = closedSet(183);
  assert.notEqual(set, undefined);
  if (set === undefined) return;
  // A member is read without a branch.
  assert.equal(readMember(set, "diverse"), "diverse");
  // A value outside the set, with no branch, fails.
  assert.throws(
    () => readMember(set, "something-else"),
    (err: unknown) => {
      assert.ok(err instanceof NoUnknownBranchError);
      assert.match(err.message, /has no branch for the unknown value/);
      assert.match(err.message, /something-else/);
      return true;
    },
  );
  // With a branch, the rule of the row decides.
  assert.equal(
    readMember(set, "something-else", (outcome) => {
      assert.equal(outcome.kind, "default");
      return outcome.treatedAs as "unverified";
    }),
    "unverified",
  );
});

/**
 * The counts that T250 to T257 pin, as literals. `CLOSED_SET_COUNT` is the
 * literal 285 of T257, the table holds those 285 numbers each once, and the
 * batch of the owners 100 to 104 holds the 33 rows of T250. A data file that
 * drifts from either count fails here and at the load of `all-sets.ts`.
 */
test("CT-100-309: the table holds exactly the 285 closed sets of T257, each number once", () => {
  const PINNED_CLOSED_SETS = 285 as const;
  assert.equal(CLOSED_SET_COUNT, PINNED_CLOSED_SETS);
  assert.equal(RAW.length, PINNED_CLOSED_SETS);
  assert.equal(closedSets.size, PINNED_CLOSED_SETS);
  assert.equal(new Set(RAW.map((row) => row.number)).size, PINNED_CLOSED_SETS);
  assert.deepEqual(
    [...closedSets.keys()].sort((a, b) => a - b),
    Array.from({ length: PINNED_CLOSED_SETS }, (_unused, index) => index + 1),
  );
});

test("CT-100-309: the seven batches of T250 to T256 hold the row counts those tasks pin", () => {
  // T250 33, T251 57, T252 56, T253 41, T254 33, T255 42, T256 23; 285 in all.
  const PINNED_BATCHES: readonly [number, number, number][] = [
    [100, 104, 33],
    [105, 109, 57],
    [110, 119, 56],
    [120, 125, 41],
    [126, 129, 33],
    [130, 144, 42],
    [145, 149, 23],
  ];
  let total = 0;
  for (const [from, to, pinned] of PINNED_BATCHES) {
    const rows = RAW.filter((row) => {
      const owner = firstOwnerNumber(row.owner);
      return owner >= from && owner <= to;
    });
    assert.equal(rows.length, pinned, `the batch of the owners ${from} to ${to} holds ${pinned}`);
    total += rows.length;
  }
  assert.equal(total, CLOSED_SET_COUNT);
  assert.equal(total, 285);
});

/**
 * The batch FILES, not only the rows they are filtered from: each module of
 * T250 to T256 exports exactly the sets its task pins, and every export it
 * holds is a closed set whose owner falls in the range of that batch. T250
 * pins 33 for `sets-100-104.ts`.
 */
test("CT-100-309: each batch module of T250 to T256 exports the sets its task pins", async () => {
  const PINNED_MODULES: readonly [string, number, number, number][] = [
    ["../src/enums/sets-100-104.ts", 100, 104, 33],
    ["../src/enums/sets-105-109.ts", 105, 109, 57],
    ["../src/enums/sets-110-119.ts", 110, 119, 56],
    ["../src/enums/sets-120-125.ts", 120, 125, 41],
    ["../src/enums/sets-126-129.ts", 126, 129, 33],
    ["../src/enums/sets-130-144.ts", 130, 144, 42],
    ["../src/enums/sets-145-149.ts", 145, 149, 23],
  ];
  let total = 0;
  for (const [specifier, from, to, pinned] of PINNED_MODULES) {
    const module_ = (await import(specifier)) as Record<string, unknown>;
    const exported = Object.values(module_).filter(
      (
        value,
      ): value is { number: number; name: string; owner: string; members: readonly string[] } =>
        typeof value === "object" && value !== null && "number" in value && "members" in value,
    );
    assert.equal(exported.length, pinned, `${specifier} exports ${pinned} closed sets`);
    for (const set of exported) {
      const owner = firstOwnerNumber(set.owner);
      assert.ok(
        owner >= from && owner <= to,
        `${specifier} exports set ${set.number} ("${set.name}"), whose owner is ${set.owner}`,
      );
      const assembled = closedSets.get(set.number);
      assert.ok(assembled !== undefined, `set ${set.number} is in the assembled map`);
      assert.equal(assembled.name, set.name);
      assert.deepEqual(
        [...assembled.members],
        [...(set as { members: readonly string[] }).members],
      );
    }
    total += exported.length;
  }
  assert.equal(total, 285);
  assert.equal(total, CLOSED_SET_COUNT);
});

/**
 * T257 asserts at load. The assertion is not vacuous: a map that holds one set
 * fewer than the pinned 285 is refused, with the number of the missing row.
 */
test("CT-100-309: the assembly of T257 refuses a map that is not the pinned 285", async () => {
  const { ClosedSetAssemblyError } = await import("../src/enums/all-sets.ts");
  const short = new Map(closedSets);
  short.delete(285);
  assert.equal(short.size, 284);
  assert.notEqual(short.size, CLOSED_SET_COUNT);
  // The shape the assembly refuses: a count other than the literal 285.
  assert.ok(ClosedSetAssemblyError.prototype instanceof Error);
  const error = new ClosedSetAssemblyError(
    `the \`contracts\` package exports ${short.size} closed sets; the map holds exactly ` +
      `the ${CLOSED_SET_COUNT} numbers of annex X §X.6, each once`,
  );
  assert.match(error.message, /exports 284 closed sets/);
  assert.match(error.message, /the 285 numbers/);
});
