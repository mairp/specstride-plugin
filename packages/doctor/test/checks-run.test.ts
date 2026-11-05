/**
 * T032 (feature 112) — CT-112-119 (F112-FR-019): the checks of the groups
 * `run` and `sandbox`.
 *
 * The SIX lock probe results; a stale run (running with no live owner); an
 * approval record that does not verify; the containment level per role and
 * why; `protection=detect` where a process of a pass cannot be guaranteed
 * gone; and a critic path that allows all tools.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runLockCheck,
  runStaleCheck,
  sandboxLevelCheck,
  sandboxCriticCheck,
  severityOfLock,
  type LockProbeResult,
} from "../src/checks/run.ts";
import { severityOf, findingOf } from "./helpers.ts";

test("CT-112-119: the six lock probe results map to ok, info, warn and fail", async () => {
  const results: readonly LockProbeResult[] = [
    "free",
    "held-live",
    "held-foreign",
    "stale-owner-dead",
    "owner-dead-group-alive",
    "unknown",
  ];
  assert.deepEqual(results.map(severityOfLock), ["ok", "info", "info", "warn", "warn", "fail"]);
  for (const result of results) {
    const severity = await severityOf(runLockCheck, [["run.lock", { result }]]);
    assert.equal(severity, severityOfLock(result), `lock result ${result}`);
  }
  // A lock without a live holder warns — never removes the lock (F112-FR-004).
  const stale = await findingOf(runLockCheck, [
    ["run.lock", { result: "stale-owner-dead", pid: 4242 }],
  ]);
  assert.match(stale.message, /lock stale-owner-dead/);
});

test("CT-112-119: a run that reads as running with no live owner warns", async () => {
  assert.equal(await severityOf(runStaleCheck, []), "ok");
  assert.equal(
    await severityOf(runStaleCheck, [["run.stale.record", { state: "running", liveOwner: false }]]),
    "warn",
  );
  assert.equal(
    await severityOf(runStaleCheck, [["run.stale.record", { state: "running", liveOwner: true }]]),
    "ok",
  );
  const stale = await findingOf(runStaleCheck, [
    ["run.stale.record", { state: "running", liveOwner: false }],
  ]);
  assert.match(stale.message, /run says running, no live owner/);
});

test("CT-112-119: an approval record that does not verify warns", async () => {
  assert.equal(
    await severityOf(runStaleCheck, [["run.stale.approval", { verifies: false }]]),
    "warn",
  );
  const finding = await findingOf(runStaleCheck, [["run.stale.approval", { verifies: false }]]);
  assert.match(finding.message, /the approval record does not verify/);
});

test("CT-112-119: the containment level per role and why; C0 and C1 warn by choice", async () => {
  const level = (level: string, extra: Record<string, unknown> = {}): [string, unknown][] => [
    ["sandbox.level", { role: "proposer", level, why: "by configuration", ...extra }],
  ];
  assert.equal(await severityOf(sandboxLevelCheck, level("C2")), "ok");
  assert.equal(await severityOf(sandboxLevelCheck, level("C3")), "ok");
  // C0 and C1 warn — by the consumer's choice, never a failure.
  assert.equal(await severityOf(sandboxLevelCheck, level("C0")), "warn");
  assert.equal(await severityOf(sandboxLevelCheck, level("C1")), "warn");
  // A bypass flag the harness would refuse is a failure.
  assert.equal(await severityOf(sandboxLevelCheck, level("C2", { bypassRefused: true })), "fail");
  const shown = await findingOf(sandboxLevelCheck, level("C2"));
  assert.match(shown.message, /proposer containment C2/);
});

test("CT-112-119: protection=detect where a process of a pass cannot be guaranteed gone", async () => {
  const detect = await findingOf(sandboxLevelCheck, [
    [
      "sandbox.level",
      { role: "proposer", level: "C2", why: "shared machine", protection: "detect" },
    ],
  ]);
  assert.match(detect.message, /protection=detect/);
  const enforce = await findingOf(sandboxLevelCheck, [
    ["sandbox.level", { role: "proposer", level: "C2", why: "container", protection: "enforce" }],
  ]);
  assert.ok(!enforce.message.includes("protection=detect"));
});

test("CT-112-119: a critic path that allows all tools fails; tools outside the two forms fail", async () => {
  assert.ok(sandboxCriticCheck.lb, "sandbox.critic is launch-blocking");
  assert.equal(
    await severityOf(sandboxCriticCheck, [
      ["sandbox.critic", { allowsAllTools: true, outsideForms: [] }],
    ]),
    "fail",
  );
  const all = await findingOf(sandboxCriticCheck, [
    ["sandbox.critic", { allowsAllTools: true, outsideForms: [] }],
  ]);
  assert.match(all.message, /critic path allows all tools/);
  assert.equal(
    await severityOf(sandboxCriticCheck, [
      ["sandbox.critic", { allowsAllTools: false, outsideForms: ["computer", "browser"] }],
    ]),
    "fail",
  );
  // Inside the two forms: no finding above ok.
  assert.equal(
    await severityOf(sandboxCriticCheck, [
      ["sandbox.critic", { allowsAllTools: false, outsideForms: [] }],
    ]),
    "ok",
  );
});
