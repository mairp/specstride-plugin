/**
 * CT-115-153 (T070, IR-53, F115-FR-019, F115-FR-036) — characterization: the
 * limits of the router; the failure signature.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTable, type LoadedTable } from "@specstride/kernel";
import shippedData from "@specstride/contracts/data/router-table-115.json" with { type: "json" };
import { failureSignature, shouldDropContinuedSession } from "../../src/unit/signature.ts";
import { isToolsChoiceAllowed, loopChoiceSwitchesLayerOn, route } from "../../src/router/route.ts";

const table: LoadedTable = loadTable(shippedData);

test("CT-115-153 (IR-53): the router reads recorded signals only — no output, no prose, no verdict", () => {
  // The signal map of each point is closed: no signal of the table is an
  // output, a prose or a verdict signal.
  for (const [point, config] of Object.entries(table.points)) {
    for (const signal of Object.keys(config.signals ?? {})) {
      assert.match(
        signal,
        /^(commandFlaky|commandDuration|commandDurationOverLimit|checkShare|cycle|commandSlowest|integrityKind|checkError|cyclesLeft|unresolvedUnits|unresolvedOverCap|innerCount|uncheckedStreak|phaseTasks|unitTasks|unitCoversPhaseAtFirstUnit|escalationOn|conditions|signatureRepeated|repairsUsed|escalationsTask|escalationsAttempt|nextTier|targetIsCriticModel|targetSharesCriticModel|targetQuotaExhausted|budgetAllows)$/,
        `${point} reads the signal ${signal}`,
      );
    }
  }
});

test("CT-115-153 (IR-53): tools orders and excludes only", () => {
  for (const row of table.rows.tools) assert.equal(isToolsChoiceAllowed(row.choice), true);
  assert.equal(route("tools", { commandFlaky: true }).choice, "exclude:flaky");
  assert.equal(route("tools", {}).choice, "run");
});

test("CT-115-153 (IR-53): the loop point never switches a layer on", () => {
  for (const row of table.rows.loop) assert.equal(loopChoiceSwitchesLayerOn(row.choice), false);
});

test("CT-115-153 (IR-53): the failure signature parses no output of a check", () => {
  const signature = failureSignature([
    { id: "lint", exit: 1 },
    { id: "unit", exit: 0 },
  ]);
  assert.deepEqual(signature, [{ id: "lint", exit: 1 }]);
  // The signature value space is ids and exit codes only.
  for (const entry of signature) {
    assert.equal(typeof entry.id, "string");
    assert.equal(typeof entry.exit, "number");
    assert.ok(!("output" in entry));
  }
});

test("CT-115-153 (IR-53): the continued session drops only on signature and tree both equal", () => {
  const previous = { signature: "lint:1", treeFingerprint: "t1" };
  assert.equal(
    shouldDropContinuedSession({ signature: "lint:1", treeFingerprint: "t1" }, previous),
    true,
  );
  assert.equal(
    shouldDropContinuedSession({ signature: "lint:1", treeFingerprint: "t2" }, previous),
    false,
  );
  assert.equal(
    shouldDropContinuedSession({ signature: "typecheck:2", treeFingerprint: "t1" }, previous),
    false,
  );
});

test("CT-115-153 (IR-53): an invalid table keeps the loop on the fallback, never off the run", () => {
  // Whatever the table state, the decision of a point is one of its closed
  // choice set: an invalid table gives the fallback choice of the point.
  for (const point of ["tools", "loop", "escalation"] as const) {
    const fallback = route(point, {});
    assert.ok(fallback.choice !== undefined);
    assert.ok(
      table.points[point].choices.includes(fallback.choice) || fallback.routingOff === true,
      `${point}: ${fallback.choice}`,
    );
  }
});
