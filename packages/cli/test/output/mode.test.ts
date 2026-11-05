/**
 * T006 — the mode selector (`output.compat`, profile `parity`, F119-FR-029).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  OUTPUT_COMPAT_KEY,
  PARITY_PROFILE,
  isCompatValue,
  selectMode,
  isCompatibilityMode,
} from "../../src/output/mode.ts";

test("T006: the key and the profile are the ones of the spec", () => {
  assert.equal(OUTPUT_COMPAT_KEY, "output.compat");
  assert.equal(PARITY_PROFILE, "parity");
});

test("T006: output.compat selects compatibility output", () => {
  assert.equal(selectMode({ compat: true }), "compat");
  assert.equal(selectMode({ compat: "on" }), "compat");
  assert.equal(selectMode({ compat: false }), "default");
  assert.equal(selectMode({ compat: "off" }), "default");
  assert.equal(selectMode({}), "default");
});

test("T006: the profile parity always selects compatibility output", () => {
  assert.equal(selectMode({ profile: "parity" }), "compat");
  assert.equal(selectMode({ profile: "parity", compat: "off" }), "compat");
  assert.equal(selectMode({ profile: "strict", compat: false }), "default");
});

test("T006: the catalogue cell of the parity table reads as on", () => {
  assert.equal(isCompatValue("on (compatibility output)"), true);
  assert.equal(isCompatValue("on"), true);
  assert.equal(isCompatValue("off"), false);
  assert.equal(isCompatValue(undefined), false);
});

test("T006: compatibility mode is the baseline and nothing else (§G.2)", () => {
  assert.equal(isCompatibilityMode("compat"), true);
  assert.equal(isCompatibilityMode("default"), false);
});
