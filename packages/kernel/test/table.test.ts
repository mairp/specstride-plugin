/**
 * CT-100-304 — contract test of the table evaluator (annex X, §X.3,
 * F100-FR-204; quickstart, scenario 6).
 *
 * For a table with a default row, exactly one row fires for every vector of
 * signals; a table without a default row for a decision point fails at load;
 * every decision record holds the rule id and the version of the table.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateTable, loadTable, TableLoadError, OPERATORS } from "../src/table/index.ts";

type RawTable = {
  schema: string;
  id: string;
  version: string;
  points: Record<string, { signals?: Record<string, string>; choices: string[] }>;
  rows: Record<string, Array<{ ruleId: string; when?: unknown; choice: string }>>;
};

/** The table of the fixture: one point, two matching rows, one default row. */
function fixtureTable(): RawTable {
  return {
    schema: "specstride.table/1",
    id: "fixture-router",
    version: "1",
    points: {
      tools: {
        signals: { flakyCount: "Whole number", lastExitCode: "Whole number", mode: "Text" },
        choices: ["run", "exclude:flaky", "exclude:slow"],
      },
    },
    rows: {
      tools: [
        {
          ruleId: "R1-flaky",
          when: {
            op: "and",
            of: [
              { op: "greater", signal: "flakyCount", value: 2 },
              { op: "member of", signal: "mode", value: ["parity", "default"] },
            ],
          },
          choice: "exclude:flaky",
        },
        {
          ruleId: "R2-exit",
          when: { op: "equal", signal: "lastExitCode", value: 3 },
          choice: "exclude:slow",
        },
        { ruleId: "R0-default", choice: "run" },
      ],
    },
  };
}

test("CT-100-304: a table without a default row for a decision point fails at load", () => {
  const table = fixtureTable();
  delete table.rows.tools[table.rows.tools.length - 1]; // remove the default row
  assert.throws(
    () => loadTable(table as never),
    (err: unknown) =>
      err instanceof TableLoadError &&
      err.message.includes("fixture-router") &&
      err.message.includes("version 1") &&
      err.message.includes("no default row"),
  );
});

test("CT-100-304: a table without any rows for a decision point fails at load", () => {
  const table = fixtureTable();
  delete table.rows.tools;
  assert.throws(
    () => loadTable(table as never),
    (err: unknown) =>
      err instanceof TableLoadError &&
      err.message.includes("fixture-router") &&
      err.message.includes("version 1") &&
      err.message.includes("tools"),
  );
});

test("CT-100-304: exactly one row fires for every vector of signals (first match in row order)", () => {
  const table = loadTable(fixtureTable() as never);
  const vectors: Record<string, unknown>[] = [
    { flakyCount: 5, lastExitCode: 3, mode: "parity" }, // R1 and R2 both hold: R1, the first, fires
    { flakyCount: 5, lastExitCode: 3, mode: "strict" }, // R1 fails (mode), R2 fires
    { flakyCount: 0, lastExitCode: 3, mode: "parity" }, // only R2 fires
    { flakyCount: 9, lastExitCode: 0, mode: "default" }, // only R1 fires
    { flakyCount: 1, lastExitCode: 0, mode: "parity" }, // nothing matches: the default row
    {}, // an empty vector: the default row
    { flakyCount: null, lastExitCode: undefined, mode: "parity" }, // null/absent signals: the default row
  ];
  for (const signals of vectors) {
    const decision = evaluateTable(table, "tools", signals);
    // exactly one row fires: the decision names one rule of the table
    assert.ok(
      table.rows.tools.some((row) => row.ruleId === decision.ruleId),
      `the decision names a row of the table (got ${decision.ruleId})`,
    );
    // and the same vector decides the same way, twice (deterministic, pure)
    assert.deepEqual(evaluateTable(table, "tools", signals), decision);
  }
});

test("CT-100-304: first match in row order — the earlier row wins", () => {
  const table = loadTable(fixtureTable() as never);
  const decision = evaluateTable(table, "tools", {
    flakyCount: 5,
    lastExitCode: 3,
    mode: "parity",
  });
  assert.equal(decision.ruleId, "R1-flaky");
  assert.equal(decision.choice, "exclude:flaky");
});

test("CT-100-304: the default row fires when no row matches", () => {
  const table = loadTable(fixtureTable() as never);
  const decision = evaluateTable(table, "tools", {
    flakyCount: 1,
    lastExitCode: 0,
    mode: "parity",
  });
  assert.equal(decision.ruleId, "R0-default");
  assert.equal(decision.choice, "run");
  // the default row reads no signals
  assert.deepEqual(decision.signals, {});
});

test("CT-100-304: every decision record holds the rule id, the table id and the table version", () => {
  const table = loadTable(fixtureTable() as never);
  for (const signals of [{ flakyCount: 9, mode: "default" }, {}]) {
    const decision = evaluateTable(table, "tools", signals);
    assert.equal(decision.tableId, "fixture-router");
    assert.equal(decision.tableVersion, "1");
    assert.equal(decision.point, "tools");
    assert.equal(typeof decision.ruleId, "string");
    assert.ok(decision.ruleId.length > 0);
    assert.ok(table.points.tools.choices.includes(decision.choice));
  }
});

test("CT-100-304: the decision record holds the signals the rule read", () => {
  const table = loadTable(fixtureTable() as never);
  const decision = evaluateTable(table, "tools", {
    flakyCount: 5,
    lastExitCode: 3,
    mode: "parity",
  });
  assert.deepEqual(decision.signals, { flakyCount: 5, mode: "parity" });
});

test("CT-100-304: the nine operators of the closed set are all accepted (row 68 of closed-sets.json)", () => {
  const table: RawTable = {
    schema: "specstride.table/1",
    id: "operators",
    version: "1",
    points: {
      p: {
        signals: { n: "Whole number", s: "Text", flag: "Text" },
        choices: ["a", "b"],
      },
    },
    rows: {
      p: [
        {
          ruleId: "R-all",
          when: {
            op: "and",
            of: [
              { op: "equal", signal: "n", value: 1 },
              { op: "not equal", signal: "s", value: "x" },
              { op: "less", signal: "n", value: 2 },
              { op: "greater", signal: "n", value: 0 },
              { op: "member of", signal: "s", value: ["y", "z"] },
              { op: "present", signal: "flag" },
              {
                op: "or",
                of: [
                  { op: "not", of: [{ op: "present", signal: "s" }] },
                  { op: "equal", signal: "n", value: 1 },
                ],
              },
            ],
          },
          choice: "a",
        },
        { ruleId: "R0", choice: "b" },
      ],
    },
  };
  const loaded = loadTable(table as never);
  const decision = evaluateTable(loaded, "p", { n: 1, s: "y", flag: "on" });
  assert.equal(decision.ruleId, "R-all");
  assert.equal(decision.choice, "a");
  // and the closed set names exactly the nine operators
  assert.deepEqual([...OPERATORS].sort(), [
    "and",
    "equal",
    "greater",
    "less",
    "member of",
    "not",
    "not equal",
    "or",
    "present",
  ]);
});

test("CT-100-304: an unknown operator fails at load, with the table id, the version and the row", () => {
  const table = fixtureTable();
  table.rows.tools[1].when = { op: "between", signal: "lastExitCode", value: 3 };
  assert.throws(
    () => loadTable(table as never),
    (err: unknown) =>
      err instanceof TableLoadError &&
      err.message.includes("fixture-router") &&
      err.message.includes("version 1") &&
      err.message.includes("row 2 of tools") &&
      err.message.includes("unknown operator"),
  );
});

test("CT-100-304: an unknown signal fails at load, with the table id, the version and the row", () => {
  const table = fixtureTable();
  table.rows.tools[1].when = { op: "equal", signal: "neverDeclared", value: 3 };
  assert.throws(
    () => loadTable(table as never),
    (err: unknown) =>
      err instanceof TableLoadError &&
      err.message.includes("fixture-router") &&
      err.message.includes("version 1") &&
      err.message.includes("row 2 of tools") &&
      err.message.includes("unknown signal"),
  );
});

test("CT-100-304: a choice outside the choice set fails at load, with the table id, the version and the row", () => {
  const table = fixtureTable();
  table.rows.tools[0].choice = "exclude:unknown";
  assert.throws(
    () => loadTable(table as never),
    (err: unknown) =>
      err instanceof TableLoadError &&
      err.message.includes("fixture-router") &&
      err.message.includes("version 1") &&
      err.message.includes("row 1 of tools") &&
      err.message.includes("outside the choice set"),
  );
});

test("CT-100-304: a row for an unknown decision point fails at load", () => {
  const table = fixtureTable();
  table.rows["other-point"] = [{ ruleId: "R-x", choice: "run" }];
  assert.throws(
    () => loadTable(table as never),
    (err: unknown) =>
      err instanceof TableLoadError &&
      err.message.includes("fixture-router") &&
      err.message.includes("unknown decision point"),
  );
});

test("CT-100-304: a table that violates the schema is refused at load", () => {
  const table = fixtureTable();
  const broken = table as Record<string, unknown>;
  delete broken.version;
  assert.throws(
    () => loadTable(table as never),
    (err: unknown) => err instanceof TableLoadError && err.message.includes("specstride.table/1"),
  );
});

test("CT-100-304: the bump table of the attempt planner has the same form (one decision point `attempt-tier`)", () => {
  const bump: RawTable = {
    schema: "specstride.table/1",
    id: "attempt-bump",
    version: "2",
    points: {
      "attempt-tier": {
        signals: { rejects: "Whole number" },
        choices: ["bump", "skip", "none"],
      },
    },
    rows: {
      "attempt-tier": [
        { ruleId: "B1", when: { op: "greater", signal: "rejects", value: 1 }, choice: "bump" },
        { ruleId: "B0", choice: "none" },
      ],
    },
  };
  const loaded = loadTable(bump as never);
  assert.equal(Object.keys(loaded.points).length, 1);
  assert.equal(evaluateTable(loaded, "attempt-tier", { rejects: 2 }).ruleId, "B1");
  assert.equal(evaluateTable(loaded, "attempt-tier", { rejects: 0 }).ruleId, "B0");
  assert.equal(evaluateTable(loaded, "attempt-tier", { rejects: 2 }).tableVersion, "2");
});
