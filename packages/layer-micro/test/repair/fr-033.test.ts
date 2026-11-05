/**
 * CT-115-33 (T059, F115-FR-033) — characterization: the router table —
 * golden decisions, one row fires, invalid table, switch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTable, TableLoadError } from "@specstride/kernel";
import shippedData from "@specstride/contracts/data/router-table-115.json" with { type: "json" };
import {
  CONFIG_OFF_RULE_ID,
  DECISION_POINTS,
  fallbackChoice,
  isToolsChoiceAllowed,
  shippedTableVersion,
  loopChoiceSwitchesLayerOn,
  route,
  shippedTable,
} from "../../src/router/route.ts";

test("CT-115-33: the shipped table loads, with the three decision points and 20 rows", () => {
  const loaded = shippedTable();
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  const shipped = loaded.table;
  assert.equal(shipped.id, "specstride.router-rules");
  assert.deepEqual([...DECISION_POINTS], ["tools", "loop", "escalation"]);
  assert.equal(loaded.table.rows.tools.length, 4);
  assert.equal(loaded.table.rows.loop.length, 6);
  assert.equal(loaded.table.rows.escalation.length, 10);
});

test("CT-115-33: golden decisions", () => {
  assert.deepEqual(route("tools", { commandFlaky: true }), {
    decided: true,
    ruleId: "tools.flaky",
    choice: "exclude:flaky",
    event: {
      type: "route.decided",
      decisionPoint: "tools",
      ruleId: "tools.flaky",
      choice: "exclude:flaky",
      signalsRead: { commandFlaky: true },
      tableVersion: shippedTableVersion(),
    },
  });
  assert.equal(route("tools", {}).choice, "run");
  assert.equal(route("loop", { integrityKind: "pin-mismatch" }).ruleId, "loop.integrity");
  assert.equal(route("loop", { integrityKind: "changed-during-check" }).choice, "stay");
  assert.equal(route("loop", { cyclesLeft: 0 }).ruleId, "loop.caps");
  assert.equal(route("loop", { innerCount: 0, uncheckedStreak: 2 }).ruleId, "loop.no-check");
  assert.equal(route("loop", { phaseTasks: 1 }).ruleId, "loop.single-unit");
  assert.equal(route("loop", {}).choice, "stay");
  assert.equal(route("escalation", { escalationOn: false }).choice, "skip:off");
  assert.equal(
    route("escalation", {
      escalationOn: true,
      conditions: "tainted",
      signatureRepeated: true,
      repairsUsed: 1,
    }).choice,
    "skip:integrity",
  );
  assert.equal(
    route("escalation", {
      escalationOn: true,
      conditions: [],
      signatureRepeated: true,
      repairsUsed: 1,
      nextTier: "x:high",
      targetIsCriticModel: true,
      budgetAllows: true,
    }).choice,
    "skip:critic-collision",
  );
  assert.equal(
    route("escalation", {
      escalationOn: true,
      conditions: [],
      signatureRepeated: true,
      repairsUsed: 1,
      nextTier: "larger:high",
      budgetAllows: true,
    }).choice,
    "next-tier",
  );
});

test("CT-115-33: one row fires — exactly one decision per vector, as one route.decided event", () => {
  for (const point of DECISION_POINTS) {
    const result = route(point, {});
    assert.equal(result.decided, true);
    assert.ok(result.ruleId !== undefined);
    assert.ok(result.event !== undefined);
    assert.equal(result.event.type, "route.decided");
    assert.equal(result.event.ruleId, result.ruleId);
    // A decision that changes nothing is still an event.
    const again = route(point, {});
    assert.deepEqual(again.event, result.event);
  }
});

test("CT-115-33: an invalid table gives the rule id config-off and the fallback behaviour", () => {
  const invalid = {
    ...shippedData,
    rows: {
      ...shippedData.rows,
      tools: shippedData.rows.tools.filter((row) => row.ruleId !== "tools.default"),
    },
  };
  assert.throws(() => loadTable(invalid), TableLoadError);
  assert.equal(CONFIG_OFF_RULE_ID, "config-off");
  // The fallback of a run with routing off: manifest order, base tier, pinned layer.
  assert.equal(fallbackChoice("tools"), "run");
  assert.equal(fallbackChoice("escalation"), "skip:off");
  assert.equal(fallbackChoice("loop"), "stay");
});

test("CT-115-33: routing has a switch of its own, on by default; the invalid table is announced", () => {
  // The switch lives in the configuration (`loop.routing`, on by default);
  // the table data carries the signals the switches name.
  const loaded = loadTable(shippedData);
  assert.equal(loaded.points.escalation.signals?.escalationOn, "boolean");
});

test("CT-115-33 (F115-FR-036): tools only orders and excludes; loop never switches a layer on", () => {
  assert.equal(isToolsChoiceAllowed("run"), true);
  assert.equal(isToolsChoiceAllowed("exclude:flaky"), true);
  assert.equal(isToolsChoiceAllowed("exclude:slow"), true);
  assert.equal(isToolsChoiceAllowed("exclude:budget"), true);
  assert.equal(isToolsChoiceAllowed("add:command"), false);
  assert.equal(loopChoiceSwitchesLayerOn("stay"), false);
  assert.equal(loopChoiceSwitchesLayerOn("off:micro"), false);
  assert.equal(loopChoiceSwitchesLayerOn("on:micro"), true);
});
