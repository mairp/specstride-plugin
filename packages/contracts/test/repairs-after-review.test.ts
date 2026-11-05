/**
 * T228 — the three repairs of the cross-feature review that land in the
 * `contracts` package (F100-FR-227, F100-FR-234; annex B §B.20, annex A §A.3,
 * annex X §X.6).
 *
 *  1. `specstride.span-state/1` is a row of the registry of the further schema
 *     ids (T212): the open spans of a run, read at `run:<runId>:span-state`,
 *     owner 128 (review item B-8.2c-009, worklist item W-100-09);
 *  2. the package graph holds a package of owner 116 and a package of owner
 *     143 — the two edge packages the splits of the former micro-loop and
 *     parallel-units features created (W-100-02, W-100-03);
 *  3. the batches of closed sets hold the rows of those two owners: T252
 *     (`sets-110-119.ts`) the five rows of 116, T255 (`sets-130-144.ts`) the
 *     three rows of 143.
 *
 * Each of the three is asserted through an independent read path: the test
 * reads the shipped data files and the one registry, never the value a writer
 * returned.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import packageGraph from "../data/package-graph.json" with { type: "json" };
import {
  ANNEX_SECTION,
  FURTHER_SCHEMA_IDS,
  SPAN_STATE_LOGICAL_NAME,
  SPAN_STATE_OWNER,
  SPAN_STATE_SCHEMA_ID,
  followsTheCommonRulesOfB4,
  holdsSchemaId,
  logicalNameOfSchemaId,
  majorOfSchemaId,
  ownerOf,
  readByLogicalName,
  rowOfLogicalName,
  rowOfSchemaId,
} from "../src/ids/further-schema-ids.ts";
import { holdsLogicalName } from "../src/ids/logical-names.ts";
import { closedSetRows, firstOwnerNumber } from "../src/enums/index.ts";
import { closedSets } from "../src/enums/all-sets.ts";
import { ROWS_OF_OWNER_116 } from "../src/enums/sets-110-119.ts";
import { ROWS_OF_OWNER_143 } from "../src/enums/sets-130-144.ts";

type GraphPackage = {
  name: string;
  layer: string;
  owner?: string;
  core?: boolean;
  edge?: boolean;
  mayImport?: string[];
  note?: string;
};

const graphPackages = (packageGraph as { packages: GraphPackage[] }).packages;

test("T228: `specstride.span-state/1` is a row of the registry of the further schema ids", () => {
  assert.equal(SPAN_STATE_SCHEMA_ID, "specstride.span-state/1");
  assert.ok(
    holdsSchemaId(SPAN_STATE_SCHEMA_ID),
    `${ANNEX_SECTION} must hold the schema id of the span state (W-100-09)`,
  );
  assert.ok(FURTHER_SCHEMA_IDS.includes(SPAN_STATE_SCHEMA_ID));
  const row = rowOfSchemaId(SPAN_STATE_SCHEMA_ID);
  assert.equal(row.logicalName, SPAN_STATE_LOGICAL_NAME);
  assert.equal(row.logicalName, "run:<runId>:span-state");
  assert.equal(row.owner, SPAN_STATE_OWNER);
  assert.equal(row.owner, "128");
  assert.equal(row.major, 1, "the id carries its major, as F100-FR-048 requires");
  assert.equal(majorOfSchemaId(SPAN_STATE_SCHEMA_ID), 1);
  assert.equal(row.internal, false, "it is a record of the control plane, not an internal one");
  assert.match(row.record, /open spans of a run/i);
});

test("T228: the span state is read by its logical name, which the layout holds, and follows §B.4", () => {
  assert.equal(readByLogicalName(SPAN_STATE_SCHEMA_ID), SPAN_STATE_LOGICAL_NAME);
  assert.equal(logicalNameOfSchemaId(SPAN_STATE_SCHEMA_ID), SPAN_STATE_LOGICAL_NAME);
  assert.equal(ownerOf(SPAN_STATE_SCHEMA_ID), "128");
  assert.ok(
    holdsLogicalName(SPAN_STATE_LOGICAL_NAME),
    "the logical name of the span state is a name of the table of §B.5",
  );
  assert.equal(rowOfLogicalName(SPAN_STATE_LOGICAL_NAME)?.schemaId, SPAN_STATE_SCHEMA_ID);
  assert.equal(followsTheCommonRulesOfB4(SPAN_STATE_SCHEMA_ID), true);
});

test("T228: the package graph holds the packages of owners 116 and 143, as edge packages", () => {
  for (const [owner, name] of [
    ["116", "@specstride/integrity"],
    ["143", "@specstride/tree-store"],
  ] as const) {
    const ofOwner = graphPackages.filter((p) => (p.owner ?? "").split(/[;,]/)[0]?.trim() === owner);
    assert.ok(
      ofOwner.length > 0,
      `the package graph must hold a package of owner ${owner} (W-100-02, W-100-03)`,
    );
    const pkg = ofOwner.find((p) => p.name === name);
    assert.ok(pkg !== undefined, `the package of owner ${owner} is ${name}`);
    assert.equal(pkg.layer, "L1", `${name} is a package of the edge layer`);
    assert.equal(pkg.edge, true, `${name} is marked as an edge package`);
    assert.notEqual(pkg.core, true, `${name} is no core package`);
    assert.deepEqual(
      pkg.mayImport,
      ["@specstride/contracts", "@specstride/kernel"],
      `${name} imports the contracts package and the kernel and nothing else`,
    );
    assert.match(
      String(pkg.note ?? ""),
      /may touch the file system or start a process/,
      `the note of ${name} states what an edge package may do (F100-FR-234)`,
    );
  }
});

test("T228: the batch of T252 holds the five rows of owner 116, the batch of T255 the three rows of owner 143", () => {
  const rowsOf = (owner: number): number[] =>
    closedSetRows.filter((row) => firstOwnerNumber(row.owner) === owner).map((row) => row.number);

  assert.deepEqual([...ROWS_OF_OWNER_116], rowsOf(116));
  assert.deepEqual([...ROWS_OF_OWNER_116], [27, 65, 66, 142, 143]);
  assert.deepEqual([...ROWS_OF_OWNER_143], rowsOf(143));
  assert.deepEqual([...ROWS_OF_OWNER_143], [62, 64, 184]);

  // Every pinned row is in the one map of T257, with the owner of its row.
  for (const [owner, numbers] of [
    ["116", ROWS_OF_OWNER_116],
    ["143", ROWS_OF_OWNER_143],
  ] as const) {
    for (const number of numbers) {
      const set = closedSets.get(number);
      assert.ok(set !== undefined, `row ${number} is registered in the map of T257`);
      assert.equal(
        firstOwnerNumber(set.owner),
        Number(owner),
        `row ${number} ("${set.name}") is owned by ${owner}`,
      );
      assert.equal(set.number, number);
      assert.notEqual(set.name.trim(), "");
    }
  }
  // The rows 60, 61 and 63 stay with 142 (W-100-03): 143 did not take them.
  for (const number of [60, 61, 63]) {
    assert.equal(firstOwnerNumber(closedSets.get(number)?.owner ?? ""), 142);
  }
});
