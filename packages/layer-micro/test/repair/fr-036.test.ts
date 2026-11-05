/**
 * CT-115-36 (T062, F115-FR-036) — characterization: `tools` orders and
 * excludes only; the loop never switches a layer on; no decision unless the
 * layer is engaged.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateTable, loadTable } from "@specstride/kernel";
import shippedData from "@specstride/contracts/data/router-table-115.json" with { type: "json" };
import {
  fallbackChoice,
  isToolsChoiceAllowed,
  loopChoiceSwitchesLayerOn,
  route,
  routeIfEngaged,
} from "../../src/router/route.ts";

const table = loadTable(shippedData);

test("CT-115-36: tools only orders and excludes — its choice set holds no other verb", () => {
  assert.deepEqual(table.points.tools.choices, [
    "run",
    "exclude:flaky",
    "exclude:slow",
    "exclude:budget",
  ]);
  for (const row of table.rows.tools) {
    assert.equal(isToolsChoiceAllowed(row.choice), true, row.ruleId);
  }
  // The exclude choices carry only a reason; no command is added and no
  // argument list is built.
  assert.equal(isToolsChoiceAllowed("exclude:flaky"), true);
  assert.equal(isToolsChoiceAllowed("add:pre-command"), false);
});

test("CT-115-36: the loop point never switches a layer on — every non-default choice is off:", () => {
  assert.deepEqual(table.points.loop.choices, ["stay", "off:micro"]);
  for (const row of table.rows.loop) {
    assert.equal(loopChoiceSwitchesLayerOn(row.choice), false, row.ruleId);
  }
});

test("CT-115-36: no decision unless the layer is engaged", () => {
  // The gated entrypoint `routeIfEngaged` refuses the consultation without
  // engagement: no decision, no rule id, no choice and no `route.decided`
  // event — for all three decision points.
  for (const point of ["tools", "loop", "escalation"] as const) {
    const unengaged = routeIfEngaged(point, { engaged: false, phase: 2 });
    assert.equal(unengaged.decided, false);
    assert.equal(unengaged.ruleId, undefined);
    assert.equal(unengaged.choice, undefined);
    assert.equal(unengaged.event, undefined);
    assert.equal("event" in unengaged, false); // no event key at all
    assert.equal(unengaged.announcement, undefined);
    assert.ok(!("routingOff" in unengaged));
  }
  // The same refusal when the engagement signal is absent.
  assert.equal(routeIfEngaged("tools", { phase: 2 }).decided, false);
  // With engagement the same call produces a real decision and one
  // `route.decided` event through the real code path.
  const engaged = routeIfEngaged("tools", { engaged: true, phase: 2 });
  assert.equal(engaged.decided, true);
  assert.equal(engaged.event?.type, "route.decided");
  assert.equal(engaged.event?.decisionPoint, "tools");
  assert.equal(typeof engaged.ruleId, "string");
  // The ungated `route` is unchanged: it always decides.
  assert.equal(route("tools", {}).decided, true);
});

test("CT-115-36: with routing off, the loop runs in manifest order, on the base tier, with the pinned layer", () => {
  assert.equal(fallbackChoice("tools"), "run");
  assert.equal(fallbackChoice("escalation"), "skip:off");
  assert.equal(fallbackChoice("loop"), "stay");
  // `run` is manifest order: the layer orders the commands by the manifest.
  const decision = evaluateTable(table, "tools", {});
  assert.equal(decision.choice, "run");
});
