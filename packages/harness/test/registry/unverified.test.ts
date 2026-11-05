/**
 * T014 — CT-109-13: an unverified harness (F109-FR-013).
 *
 * An unverified harness has no version pin and runs at auth tier 1 or 2
 * only. Auth tier 3 MUST NOT be a valid value of a descriptor or of a
 * registry entry, and a descriptor that names it MUST be refused with the
 * reason.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  UNVERIFIED_ALLOWED_PROVENANCE,
  UNVERIFIED_ALLOWED_TIERS,
  checkAuthTiers,
  isTestedHarnessAdapter,
  unverifiedRules,
} from "../../src/registry/unverified.ts";

const TESTED = {
  origin: "adapter",
  versionRange: ">=1.2.0 <2",
  verifiedOn: "2026-09-15",
} as const;

test("CT-109-13: a tested harness adapter is recognized, and keeps its pin", () => {
  assert.equal(isTestedHarnessAdapter(TESTED), true);
  const rules = unverifiedRules(TESTED);
  assert.equal(rules.tested, true);
  assert.equal(rules.pin, ">=1.2.0 <2");
});

test("CT-109-13: an unverified harness has no version pin", () => {
  for (const entry of [
    { origin: "user" },
    { origin: "bundled" },
    { origin: "detected" },
    { origin: "adapter" }, // origin alone does not make it tested
    { origin: "adapter", versionRange: ">=1" }, // the date is missing
  ]) {
    const rules = unverifiedRules(entry);
    assert.equal(rules.tested, false, JSON.stringify(entry));
    assert.equal(rules.pin, null, "an unverified harness has NO version pin");
  }
});

test("CT-109-13: an unverified harness runs at auth tier 1 or 2, and its capabilities are declared or probed", () => {
  const rules = unverifiedRules({ origin: "user" });
  assert.deepEqual([...rules.allowedTiers], [1, 2]);
  assert.equal(UNVERIFIED_ALLOWED_TIERS.length, 2);
  assert.deepEqual([...rules.allowedProvenance], ["declared", "probed"]);
  assert.deepEqual([...UNVERIFIED_ALLOWED_PROVENANCE], ["declared", "probed"]);
});

test("CT-109-13: auth tier 3 is refused with the reason, in a descriptor and in an entry", () => {
  const finding = checkAuthTiers([1, 3]);
  assert.ok(finding !== null);
  assert.equal(finding.refused, true);
  assert.match(finding.reason, /auth tier 3 is not a valid value/);
});

test("CT-109-13: auth tiers 1 and 2 are valid, in any order and alone", () => {
  assert.equal(checkAuthTiers([1]), null);
  assert.equal(checkAuthTiers([2]), null);
  assert.equal(checkAuthTiers([1, 2]), null);
  assert.equal(checkAuthTiers([2, 1]), null);
  assert.equal(checkAuthTiers([]), null);
  assert.equal(checkAuthTiers(undefined), null);
});

test("CT-109-13: a tier that is not a whole number in 1 to 3 is refused too", () => {
  assert.ok(checkAuthTiers([0]) !== null);
  assert.ok(checkAuthTiers([1.5]) !== null);
  assert.ok(checkAuthTiers(["1"]) !== null);
});
