/**
 * T018 — CT-109-4: the capability map (F109-FR-004).
 *
 * Every capability carries its provenance (`declared`, `probed`, `adapter`,
 * `catalogue`) or is null; the seam never guesses. A capability that no run
 * has shown is `unverified`. Where a declared and an effective context window
 * differ, the smaller is used. `concurrentSessions` and the process-level
 * spending limit are null unless a TESTED harness adapter declares them. A
 * harness that does not declare continuation receives `fresh` on every pass.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAPABILITY_NAMES,
  CAPABILITY_PROVENANCE,
  buildCapabilityMap,
  sessionDirectiveFor,
  type DeclaredCapabilities,
} from "../../src/port/capabilities.ts";

const TESTED: DeclaredCapabilities = {
  origin: "adapter",
  versionRange: ">=1.0.0 <2",
  verifiedOn: "2026-09-15",
  concurrentSessions: { value: true, provenance: "adapter" },
  spendLimit: { value: { usd: 5 }, provenance: "declared" },
};

test("CT-109-4: the map holds every capability of annex C §C.1, and only provenance of the closed set or null", () => {
  const map = buildCapabilityMap({
    containmentCeiling: { level: "C2", provenance: "probed" },
    transports: [{ transport: "subprocess" }],
  });
  assert.deepEqual(Object.keys(map).sort(), [...CAPABILITY_NAMES].sort());
  for (const name of CAPABILITY_NAMES) {
    const capability = map[name];
    if (capability === null) {
      continue;
    }
    assert.ok(
      capability.provenance === null ||
        (CAPABILITY_PROVENANCE as readonly string[]).includes(capability.provenance),
      `${name} carries provenance ${String(capability.provenance)}`,
    );
  }
  assert.equal(map.containmentCeiling!.provenance, "probed");
  assert.equal(map.transports!.provenance, "declared");
});

test("CT-109-4: nothing is guessed — an undeclared capability is null", () => {
  const map = buildCapabilityMap(null);
  for (const name of CAPABILITY_NAMES) {
    assert.equal(map[name], null, `${name} is null for no descriptor at all`);
  }
  const empty = buildCapabilityMap({});
  assert.equal(empty.contextWindow, null);
  assert.equal(empty.containmentCeiling, null);
  assert.equal(empty.concurrentSessions, null);
  assert.equal(empty.spendLimit, null);
});

test("CT-109-4: a capability no run has shown is `unverified`", () => {
  const map = buildCapabilityMap(
    { containmentCeiling: { level: "C2", provenance: "probed" } },
    { shown: ["containmentCeiling"] },
  );
  assert.equal(map.containmentCeiling!.unverified, false, "shown in a run");
  assert.equal(map.transports, null);
  const allUntested = buildCapabilityMap(
    { containmentCeiling: { level: "C1", provenance: "declared" } },
    {},
  );
  assert.equal(allUntested.containmentCeiling!.unverified, true);
});

test("CT-109-4: where a declared and an effective context window differ, the smaller is used", () => {
  const descriptor = { models: { contextWindow: { tokens: 200_000, source: "vendor" } } };
  const bigger = buildCapabilityMap(descriptor, { effectiveContextWindowTokens: 400_000 });
  assert.equal((bigger.contextWindow!.value as { tokens: number }).tokens, 200_000);
  const smaller = buildCapabilityMap(descriptor, { effectiveContextWindowTokens: 32_000 });
  assert.equal(
    (smaller.contextWindow!.value as { tokens: number }).tokens,
    32_000,
    "the smaller window wins",
  );
  const onlyDeclared = buildCapabilityMap(descriptor, {});
  assert.equal((onlyDeclared.contextWindow!.value as { tokens: number }).tokens, 200_000);
  assert.equal(onlyDeclared.contextWindow!.provenance, "declared");
  assert.equal((onlyDeclared.contextWindow!.value as { source: string }).source, "vendor");
});

test("CT-109-4: `concurrentSessions` and the spending limit are null unless a TESTED adapter declares them", () => {
  const tested = buildCapabilityMap(TESTED, { shown: ["concurrentSessions", "spendLimit"] });
  assert.equal(tested.concurrentSessions!.value, true);
  assert.equal(tested.concurrentSessions!.provenance, "adapter");
  assert.equal(tested.spendLimit!.provenance, "declared");

  const untestedSameDeclarations: DeclaredCapabilities = {
    concurrentSessions: { value: true, provenance: "adapter" },
    spendLimit: { value: { usd: 5 }, provenance: "declared" },
  };
  const untested = buildCapabilityMap(untestedSameDeclarations);
  assert.equal(untested.concurrentSessions, null, "not a tested adapter: null");
  assert.equal(untested.spendLimit, null, "not a tested adapter: null");

  const unverifiedOrigin: DeclaredCapabilities = {
    origin: "adapter", // origin alone: no range, no date — not tested
    concurrentSessions: { value: true, provenance: "adapter" },
    spendLimit: { value: { usd: 5 }, provenance: "declared" },
  };
  const stillNull = buildCapabilityMap(unverifiedOrigin);
  assert.equal(stillNull.concurrentSessions, null);
  assert.equal(stillNull.spendLimit, null);
});

test("CT-109-4: a harness that does not declare continuation receives `fresh` on every pass", () => {
  assert.equal(sessionDirectiveFor(null), "fresh");
  assert.equal(sessionDirectiveFor({}), "fresh");
  assert.equal(sessionDirectiveFor({ continuation: null }), "fresh");
  assert.equal(sessionDirectiveFor({ continuation: { supported: false } }), "fresh");
  assert.equal(sessionDirectiveFor({ continuation: { supported: true } }), "continue");
});

test("CT-109-4: a provenance outside the closed set is read as null", () => {
  const map = buildCapabilityMap({
    containmentCeiling: { level: "C1", provenance: "because-i-say-so" },
  });
  assert.equal(map.containmentCeiling!.provenance, null);
  assert.equal(map.containmentCeiling!.value, "C1", "the value itself is kept");
});
