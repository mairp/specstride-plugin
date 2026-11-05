// CT-116-138 (IR-38; F116-FR-002): class A as patterns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classAPatternsOf, matchClassA } from "../../src/protected/set.ts";
import type { ToolchainProfile } from "../../src/protected/set.ts";

function profileWith(classA: string[], id = "t", version = "1"): ToolchainProfile {
  return {
    schema: "specstride.toolchain/1",
    id,
    version,
    detect: {},
    classA,
  };
}

test("IR-38 class A is a pattern set, not a frozen file list", () => {
  const patterns = classAPatternsOf([profileWith(["**/*.config.js"])]);
  // a file that did not exist at phase entry still matches at comparison time
  assert.equal(matchClassA(patterns, "deeply/nested/new.config.js"), true);
});

test("IR-38 patterns include the files by which a runner changes what it collects", () => {
  const patterns = classAPatternsOf([profileWith([".nycrc", "jest.config.*"], "cov")]);
  assert.equal(matchClassA(patterns, "jest.config.ts"), true);
  assert.equal(matchClassA(patterns, ".nycrc"), true);
});

test("IR-38 the pattern set is versioned data per toolchain", () => {
  const a = classAPatternsOf([profileWith(["a/**"], "t", "1")]);
  const b = classAPatternsOf([profileWith(["a/**", "b/**"], "t", "2")]);
  assert.notDeepEqual(a, b);
});
