// CT-116-7 (F116-FR-007): protection prevent and detect.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  protectionFor,
  applyProtectionToRunRecord,
  PROTECTION_CLOSED_SET,
} from "../../src/protected/protection.ts";

test("CT-116-7 protection is the closed set {prevent, detect}", () => {
  assert.deepEqual([...PROTECTION_CLOSED_SET], ["prevent", "detect"]);
});

test("CT-116-7 prevent only at containment C2 or above with a confirmed sandbox", () => {
  assert.equal(protectionFor("C2", true), "prevent");
  assert.equal(protectionFor("C3", true), "prevent");
});

test("CT-116-7 every other case reads detect", () => {
  assert.equal(protectionFor("C0", true), "detect");
  assert.equal(protectionFor("C1", true), "detect");
  assert.equal(protectionFor("C2", false), "detect"); // sandbox not confirmed
  assert.equal(protectionFor("C3", false), "detect");
});

test("CT-116-7 the value is handed to the run record field containment", () => {
  const record: Record<string, unknown> = { containment: { level: "C2" } };
  applyProtectionToRunRecord(record, protectionFor("C2", true));
  assert.equal((record.containment as { protection: string }).protection, "prevent");
});
