/**
 * T001 — the extended descriptor-only fixture (F124-SC-001).
 *
 * The fixture extends the descriptor-only fixture of the harness port of
 * feature 109 with the user configuration of a launch that configures no
 * critic: the fake endpoint of the test kit is described entirely in the
 * user configuration, with a declared context window and a cost class that
 * is not `metered`. This test checks the fixture is well formed and that
 * its expectations name the members of the closed sets of feature 124
 * (annex X §X.6, rows 180 to 183). Nothing here calls a model or a host
 * other than loopback.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resultsOfTheDiversityTest,
  sourcesOfTheProposer,
  stepsOfTheCriticOrder,
} from "../../../../../../packages/contracts/src/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function readJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(HERE, name), "utf8")) as Record<string, unknown>;
}

test("descriptor-only/124: the user configuration describes the fake endpoint", () => {
  const config = readJson("user-config.json");
  const harnesses = config.harnesses as Array<Record<string, unknown>>;
  assert.equal(harnesses.length, 1);
  const descriptor = harnesses[0];
  assert.equal(descriptor.id, "fixture-fake-endpoint");
  assert.equal(descriptor.kind, "openai-chat");
  const models = descriptor.models as Record<string, unknown>;
  const window = models.contextWindow as Record<string, unknown>;
  assert.equal(window.source, "declared", "the context window is declared");
  assert.equal(typeof window.tokens, "number");
  assert.ok((window.tokens as number) > 0);
  const cost = descriptor.cost as Record<string, unknown>;
  assert.notEqual(cost.class, "metered", "the cost class is not `metered`");
  assert.ok(
    ["subscription", "local", "unknown"].includes(cost.class as string),
    "the cost class is a member of the closed set of the cost classes",
  );
  const roles = descriptor.roles as Record<string, unknown>;
  assert.ok((roles.critic as Record<string, unknown>).supported === true);
});

test("descriptor-only/124: no critic is configured", () => {
  const config = readJson("user-config.json");
  assert.equal(config.criticConfigured, false);
  const critic = config.critic as Record<string, unknown>;
  assert.equal(critic.autoPick, true);
  assert.equal((config.roles as Record<string, unknown>).critic, undefined);
});

test("descriptor-only/124: the expected announcement, event and digest field", () => {
  const expected = readJson("expected.json");
  const announcement = expected.announcement as Record<string, unknown>;
  assert.equal(announcement.label, "SPECSTRIDE-CRITIC");
  assert.deepEqual(announcement.keys, [
    "harness",
    "model",
    "step",
    "state",
    "form",
    "window-source",
    "cap",
    "auto",
  ]);
  const values = announcement.expected as Record<string, unknown>;
  assert.ok(stepsOfTheCriticOrder.has(values.step as string));
  assert.equal(values.step, "discovered");
  assert.equal(values.harness, "fixture-fake-endpoint");

  const event = expected.event as Record<string, unknown>;
  assert.equal(event.type, "critic.selected");
  assert.deepEqual(event.fields, ["harness", "model", "why", "diversity", "sameModelWarning"]);
  const eventExpected = event.expected as Record<string, unknown>;
  assert.ok(resultsOfTheDiversityTest.has(eventExpected.diversity as string));

  const digest = expected.digest as Record<string, unknown>;
  assert.equal(digest.field, "critic");
  assert.equal(digest.names, "fixture-fake-endpoint");
});

test("descriptor-only/124: the registry expectation carries the pick", () => {
  const expected = readJson("expected.json");
  const registry = expected.registry as Record<string, unknown>;
  const pick = registry.criticPick as Record<string, unknown>;
  assert.equal(pick.automatic, true);
  assert.equal(pick.step, "discovered");
  assert.equal(pick.harness, "fixture-fake-endpoint");
  assert.equal(pick.window, 128000);
  assert.equal(pick.windowSource, "declared");
  assert.equal(pick.cap, null, "a cost class that is not `metered` needs no cap");
  const withOff = expected.withAutoPickOff as Record<string, unknown>;
  assert.ok(stepsOfTheCriticOrder.has(withOff.step as string));
  assert.equal(withOff.step, "default-model-tier");
});

test("descriptor-only/124: the proposer source of the fixture is the configuration", () => {
  const config = readJson("user-config.json");
  const roles = config.roles as Record<string, unknown>;
  const proposer = roles.proposer as Record<string, unknown>;
  assert.ok(sourcesOfTheProposer.has("configuration"));
  assert.equal(proposer.harness, "fixture-fake-endpoint");
});
