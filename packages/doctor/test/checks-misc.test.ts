/**
 * T034 (feature 112) — CT-112-120 (F112-FR-020): the checks of the groups
 * `ui`, `telemetry`, `events` and `memory`.
 *
 * `ui.endpoint` reports "not running" while no viewer exists, fails on a
 * listener bound outside the loopback address, and warns for a recorded dead
 * process. `telemetry.endpoint` shows the collector and content capture,
 * warns when content capture is on, and never fails. `events.schema` warns
 * when a reader or a record meets a major outside its range. `memory.native`
 * warns for the critic and informs for the proposer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  uiEndpointCheck,
  telemetryEndpointCheck,
  eventsSchemaCheck,
  memoryNativeCheck,
} from "../src/checks/misc.ts";
import { severityOf, findingOf } from "./helpers.ts";

test("CT-112-120: ui.endpoint — not running, a dead process, a listener outside loopback", async () => {
  // The state until a viewer exists: an info, never a failure.
  const idle = await findingOf(uiEndpointCheck, []);
  assert.equal(idle.severity, "info");
  assert.match(idle.message, /ui not running/);
  assert.equal(
    await severityOf(uiEndpointCheck, [
      ["ui.endpoint", { running: true, outsideLoopback: false, deadProcess: false }],
    ]),
    "info",
  );
  assert.equal(
    await severityOf(uiEndpointCheck, [
      ["ui.endpoint", { running: false, outsideLoopback: false, deadProcess: true }],
    ]),
    "warn",
  );
  // A listener bound outside the loopback address is a failure.
  assert.equal(
    await severityOf(uiEndpointCheck, [
      ["ui.endpoint", { running: true, outsideLoopback: true, deadProcess: false }],
    ]),
    "fail",
  );
  const outside = await findingOf(uiEndpointCheck, [
    ["ui.endpoint", { running: true, outsideLoopback: true, deadProcess: false }],
  ]);
  assert.match(outside.message, /bound outside the loopback address/);
});

test("CT-112-120: telemetry.endpoint — content capture on warns; the check never fails", async () => {
  const off = await findingOf(telemetryEndpointCheck, [
    ["telemetry.endpoint", { collector: "reachable", capture: false }],
  ]);
  assert.equal(off.severity, "info");
  assert.match(off.message, /collector reachable; content capture off/);
  const on = await severityOf(telemetryEndpointCheck, [
    ["telemetry.endpoint", { collector: "reachable", capture: true }],
  ]);
  assert.equal(on, "warn");
  // Never fail: even a collector that cannot be reached is an info.
  assert.equal(
    await severityOf(telemetryEndpointCheck, [
      ["telemetry.endpoint", { collector: "unreachable", capture: false }],
    ]),
    "info",
  );
  assert.equal(
    await severityOf(telemetryEndpointCheck, [
      ["telemetry.endpoint", { collector: "unreachable", capture: true }],
    ]),
    "warn",
  );
});

test("CT-112-120: events.schema — a major outside the reader's range warns", async () => {
  assert.equal(
    await severityOf(eventsSchemaCheck, [
      ["events.schema", { readerRange: { from: 1, to: 1 }, recordMajor: 1 }],
    ]),
    "info",
  );
  const finding = await findingOf(eventsSchemaCheck, [
    ["events.schema", { readerRange: { from: 1, to: 1 }, recordMajor: 2 }],
  ]);
  assert.equal(finding.severity, "warn");
  assert.match(finding.message, /reader accepts event v1, run wrote v2/);
  // A major below the reader's range warns as well.
  assert.equal(
    await severityOf(eventsSchemaCheck, [
      ["events.schema", { readerRange: { from: 2, to: 2 }, recordMajor: 1 }],
    ]),
    "warn",
  );
});

test("CT-112-120: memory.native — warn for the critic, info for the proposer", async () => {
  const off = await findingOf(memoryNativeCheck, [
    ["memory.native", { role: "critic", on: false }],
  ]);
  assert.equal(off.severity, "info");
  assert.match(off.message, /critic: native memory off/);
  assert.equal(
    await severityOf(memoryNativeCheck, [["memory.native", { role: "critic", on: true }]]),
    "warn",
  );
  const proposerOn = await findingOf(memoryNativeCheck, [
    ["memory.native", { role: "proposer", on: true }],
  ]);
  assert.equal(proposerOn.severity, "info");
  assert.match(proposerOn.message, /proposer: native memory on/);
});
