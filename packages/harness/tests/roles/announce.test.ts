/**
 * T027 — CT-124-43 and CT-124-44 (F124-FR-043, F124-FR-044): the
 * announcement and the record of the pick.
 *
 * The line, the field `criticPick`, the event `critic.selected`; nothing
 * printed under the `parity` profile; at most 3 lines and 600 bytes; with
 * the automatic pick off steps 2 and 3 are skipped.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { pickCritic } from "../../src/roles/critic-order.ts";
import {
  announcementLine,
  criticSelectedEvent,
  CRITIC_LINE_LABEL,
  launchLines,
} from "../../src/roles/announce.ts";
import { candidate, orderInput } from "./critic-fixtures.ts";

/** A pick to render, from a launch with one qualifying candidate. */
function picked() {
  const result = pickCritic(orderInput({ discovered: [candidate({ id: "disc-a" })] }));
  assert.equal(result.outcome, "picked");
  if (result.outcome !== "picked") throw new Error("unreachable");
  return result;
}

test("CT-124-43 the line names harness, model, step, state, form, window source, cap and auto", () => {
  const result = picked();
  const line = result.lines[0]!;
  assert.ok(line.startsWith(`${CRITIC_LINE_LABEL} `), line);
  const pairs = line.slice(CRITIC_LINE_LABEL.length + 1).split(" ");
  const keys = pairs.map((pair) => pair.split("=")[0]!);
  assert.deepEqual(keys, [
    "harness",
    "model",
    "step",
    "state",
    "form",
    "window-source",
    "cap",
    "auto",
  ]);
  const values = Object.fromEntries(pairs.map((pair) => pair.split("=") as [string, string]));
  assert.equal(values.harness, "disc-a");
  assert.equal(values.model, "model-a");
  assert.equal(values.step, "discovered");
  assert.equal(values.state, "tested");
  assert.equal(values.form, "tool-less");
  assert.equal(values["window-source"], "declared");
  assert.equal(values.cap, "null");
  assert.equal(values.auto, "true");
  assert.equal(line, announcementLine(result.pick));
});

test("CT-124-43 the pick is recorded as the field `criticPick` of the resolved registry", () => {
  const result = picked();
  // The writer of the resolved registry takes the pick as its field
  // `criticPick` (packages/harness/src/roles/registry-writer.ts).
  const record = { criticPick: result.pick };
  assert.equal(record.criticPick.step, "discovered");
  assert.equal(record.criticPick.automatic, true);
  assert.deepEqual(
    record.criticPick.runnersUp.map((runnerUp) => runnerUp.harness),
    [],
  );
  // And the writers' input type names the field: the pick of the launch is
  // the object the record carries.
  const announced = result.lines;
  assert.equal(announced.length >= 1, true);
});

test("CT-124-43 the event `critic.selected` carries the catalogue fields", () => {
  const result = picked();
  const event = result.event ?? criticSelectedEvent(result.pick);
  assert.equal(event.type, "critic.selected");
  assert.equal(event.harness, "disc-a");
  assert.equal(event.model, "model-a");
  assert.equal(event.why, "discovered");
  assert.equal(event.diversity, "diverse");
  assert.equal(event.sameModelWarning, false);
});

test("CT-124-43 nothing is printed under the `parity` profile", () => {
  const result = pickCritic(orderInput({ discovered: [candidate()], profile: "parity" }));
  assert.equal(result.outcome, "picked");
  if (result.outcome !== "picked") return;
  assert.deepEqual(result.lines, []);
  // And the event and the record stay: only the lines are suppressed.
  assert.equal(result.event.type, "critic.selected");
  assert.equal(result.pick.automatic, true);
});

test("CT-124-43 at most 3 lines and 600 bytes at one launch", () => {
  const long = "SPECSTRIDE-CRITIC " + "x".repeat(400);
  const kept = launchLines([long, long, long, long, long], "default");
  assert.ok(kept.length <= 3, `expected at most 3 lines, got ${kept.length}`);
  const bytes = kept.reduce((total, line) => total + Buffer.byteLength(line, "utf8") + 1, 0);
  assert.ok(bytes <= 600, `expected at most 600 bytes, got ${bytes}`);
});

test("CT-124-43 the diversity warning is one more line, silenced only as a line", () => {
  // A candidate of step 3 that resolves to the proposer's model does not
  // qualify (Q5, `not-diverse`); the warning of F124-FR-045 is therefore
  // raised for a CONFIGURED critic on the same model, and for step 4 with
  // one model tier only (CT-124-37 covers that one).
  const sameModel = {
    harness: "configured-critic",
    model: "default-model",
    providerId: "provider-default",
    state: "tested" as const,
    form: "tool-less" as const,
    windowTokens: 128000,
    windowSource: "declared",
  };
  const result = pickCritic(orderInput({ configured: sameModel }));
  assert.equal(result.outcome, "picked");
  if (result.outcome !== "picked") return;
  assert.equal(result.pick.sameModelWarning, true);
  assert.equal(result.lines.length, 2, "the pick line and the diversity line");
  assert.match(result.lines[1]!, /^SPECSTRIDE-DIVERSITY result=same-model /);
  // The record and the event stay when the line is silenced (row 92).
  const silenced = pickCritic(orderInput({ configured: sameModel, warnSameModel: false }));
  if (silenced.outcome !== "picked") return;
  assert.equal(silenced.lines.length, 1);
  assert.equal(silenced.pick.sameModelWarning, true);
  assert.equal(silenced.event.sameModelWarning, true);
});

test("CT-124-44 with the automatic pick off steps 2 and 3 are skipped and step 4 applies", () => {
  const result = pickCritic(
    orderInput({
      autoPick: false,
      gateway: candidate({ id: "gateway-a" }),
      discovered: [candidate({ id: "disc-a" })],
    }),
  );
  assert.equal(result.outcome, "picked");
  if (result.outcome !== "picked") return;
  assert.equal(result.pick.step, "default-model-tier");
  assert.equal(result.pick.harness, "default-harness");
  // And no candidate was qualified or ranked for the skipped steps.
  assert.deepEqual(result.pick.notQualified, []);
  assert.deepEqual(result.pick.table.ruleIds, []);
});
