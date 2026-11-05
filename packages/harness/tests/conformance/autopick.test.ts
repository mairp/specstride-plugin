/**
 * T029 — the conformance test of the automatic pick (F124-SC-001).
 *
 * On the extended descriptor-only fixture of T001
 * (`tests/conformance/fixtures/descriptor-only/`): the announcement line,
 * the event `critic.selected` and the digest field name the fake endpoint.
 * Nothing here calls a model or a host other than loopback.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pickCritic } from "../../src/roles/critic-order.ts";
import { candidate, defaultHarness, orderInput } from "../roles/critic-fixtures.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function readJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(HERE, "fixtures/descriptor-only", name), "utf8")) as Record<
    string,
    unknown
  >;
}

/**
 * The candidate the fixture's user configuration describes: the fake
 * endpoint, entirely declared, a declared window, a cost class that is not
 * `metered`, no critic configured.
 */
function fixtureCandidate(): ReturnType<typeof candidate> {
  const config = readJson("user-config.json");
  const descriptor = (config.harnesses as Array<Record<string, unknown>>)[0]!;
  const models = descriptor.models as Record<string, unknown>;
  const window = models.contextWindow as Record<string, unknown>;
  const cost = descriptor.cost as Record<string, unknown>;
  return candidate({
    id: descriptor.id as string,
    state: "declared",
    kind: descriptor.kind as string,
    version: null,
    completionForm: { value: "tool-less", provenance: "declared" },
    costClass: { value: cost.class as "subscription", provenance: "declared" },
    contextWindow: { tokens: window.tokens as number, source: window.source as string },
    modelId: models.default as string,
    providerId: "fixture-provider",
  });
}

/** The launch of the fixture: the default harness proposes, no critic configured. */
function fixtureInput(autoPick: boolean) {
  const config = readJson("user-config.json");
  const critic = config.critic as Record<string, unknown>;
  return orderInput({
    discovered: [fixtureCandidate()],
    defaultHarness: defaultHarness({ id: "default-harness" }),
    autoPick: autoPick && (critic.autoPick as boolean),
    capUsd: (critic.autoPickMaxUsd as number | null) ?? null,
    warnSameModel: true,
    phases: ["1"],
    surface: "launch",
  });
}

test("F124-SC-001 the announcement line names the fake endpoint, as the fixture expects", () => {
  const expected = readJson("expected.json");
  const announcement = (expected.announcement as Record<string, unknown>).expected as Record<
    string,
    unknown
  >;
  const result = pickCritic(fixtureInput(true));
  assert.equal(result.outcome, "picked");
  if (result.outcome !== "picked") return;
  const line = result.lines[0]!;
  assert.match(line, /^SPECSTRIDE-CRITIC /);
  assert.match(line, new RegExp(`harness=${announcement.harness as string}`));
  assert.match(line, new RegExp(`step=${announcement.step as string}`));
  assert.match(line, /window-source=declared/);
  assert.match(line, /auto=true/);
});

test("F124-SC-001 the event `critic.selected` and the digest field name the fake endpoint", () => {
  const expected = readJson("expected.json");
  const eventExpected = (expected.event as Record<string, unknown>).expected as Record<
    string,
    unknown
  >;
  const digest = expected.digest as Record<string, unknown>;
  const registry = expected.registry as Record<string, unknown>;
  const registryPick = registry.criticPick as Record<string, unknown>;

  const result = pickCritic(fixtureInput(true));
  assert.equal(result.outcome, "picked");
  if (result.outcome !== "picked") return;

  // The event of the catalogue names the fake endpoint.
  assert.equal(result.event.type, "critic.selected");
  assert.equal(result.event.harness, eventExpected.harness);
  assert.equal(result.event.why, eventExpected.why);
  assert.equal(result.event.diversity, eventExpected.diversity);
  assert.equal(result.event.sameModelWarning, eventExpected.sameModelWarning);

  // The digest field names the same harness, and the record holds the pick.
  assert.equal(digest.field, "critic");
  assert.equal(result.pick.harness, digest.names);
  assert.equal(result.pick.automatic, registryPick.automatic);
  assert.equal(result.pick.window, registryPick.window);
  assert.equal(result.pick.windowSource, registryPick.windowSource);
  assert.equal(result.pick.cap, registryPick.cap);
});

test("F124-SC-001 with the automatic pick off the launch falls to step 4", () => {
  const expected = readJson("expected.json");
  const withOff = expected.withAutoPickOff as Record<string, unknown>;
  const result = pickCritic(fixtureInput(false));
  assert.equal(result.outcome, "picked");
  if (result.outcome !== "picked") return;
  assert.equal(result.pick.step, withOff.step);
  assert.equal(result.pick.harness, "default-harness");
});
