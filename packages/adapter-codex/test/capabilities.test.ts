/**
 * T017 / CT-131-4 — the capabilities (F131-FR-004).
 *
 * Every capability carries its provenance or is null; `concurrentSessions`,
 * the spending limit and the model-tier ladder are null; `betweenPasses`
 * returns `continue`; a capability no run has shown is `unverified`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BETWEEN_PASSES_DIRECTIVE,
  codexCapabilities,
  criticIdentity,
  costClassAtTier,
} from "../src/capabilities.ts";

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..");
const DESCRIPTOR_PATH = join(PACKAGE, "data", "descriptor.json");

function load() {
  return JSON.parse(readFileSync(DESCRIPTOR_PATH, "utf8")) as Parameters<
    typeof codexCapabilities
  >[0];
}

test("CT-131-4: the containment ceiling is C2 with the adapter's provenance", () => {
  const map = codexCapabilities(load());
  assert.ok(map.containmentCeiling !== null);
  assert.equal(map.containmentCeiling?.value, "C2");
  assert.equal(map.containmentCeiling?.provenance, "adapter");
});

test("CT-131-4: continuation by session id is declared and betweenPasses continues", () => {
  const map = codexCapabilities(load());
  assert.equal(map.continuation?.value, true);
  assert.equal(map.continuation?.provenance, "declared");
  assert.equal(BETWEEN_PASSES_DIRECTIVE, "continue");
});

test("CT-131-4: concurrentSessions, the spending limit and the ladder are null", () => {
  const map = codexCapabilities(load());
  assert.equal(map.concurrentSessions, null);
  assert.equal(map.spendLimit, null);
  assert.equal(map.modelTierLadder, null);
});

test("CT-131-4: the identity of the provider and the model is reported for the diversity test", () => {
  assert.deepEqual(criticIdentity("gpt-5"), { provider: "openai", model: "gpt-5" });
  assert.deepEqual(criticIdentity(null), { provider: "openai", model: null });
});

test("CT-131-4: the cost class is subscription at tier 1 and metered at tier 2", () => {
  const descriptor = load();
  assert.equal(costClassAtTier(descriptor, 1), "subscription");
  assert.equal(costClassAtTier(descriptor, 2), "metered");
});

test("CT-131-4: the critic modes and the transports are reported with provenance", () => {
  const map = codexCapabilities(load());
  // The tool-less mechanism of the subprocess transport is `none`; read-only
  // tools are supported for the subprocess transport of the critic.
  assert.equal(map.toollessMode?.value, "none");
  assert.equal(map.readOnlyCriticMode?.value, true);
  const transports = map.transports?.value as string[];
  assert.deepEqual(transports, ["subprocess", "direct-call"]);
  assert.equal(map.transports?.provenance, "declared");
});

test("CT-131-4: a capability no run has shown is marked unverified", () => {
  const map = codexCapabilities(load());
  assert.equal(map.containmentCeiling?.unverified, true);
  const shown = codexCapabilities(load(), { shown: ["containmentCeiling"] });
  assert.equal(shown.containmentCeiling?.unverified, false);
});
