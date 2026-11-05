/**
 * T024 — characterization tests of the state resolver: CT-146-17, CT-146-18
 * and CT-146-19 (F146-FR-017, F146-FR-018, F146-FR-019).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isStoredVerification,
  outcomeOfStoredResult,
  resolveHarnessState,
  stateOfUnknownValue,
  VERIFICATION_SCHEMA_CONSTANT,
} from "../../src/discovery/state.ts";

const SCHEMA = VERIFICATION_SCHEMA_CONSTANT;

/** A stored result of harness verification, `specstride.harness-verify/1`. */
function storedResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: SCHEMA,
    harness: "fake-cli",
    version: "1.2.3",
    descriptorHash: "hash-1",
    at: "2026-09-30T00:00:00Z",
    outcome: "passed",
    cases: [{ id: "c1", outcome: "passed" }],
    budget: {
      stated: { modelCalls: 2, timeLimitSeconds: 30 },
      used: { modelCalls: 2, seconds: 9 },
    },
    ...overrides,
  };
}

function resolve(overrides: Record<string, unknown> = {}) {
  return resolveHarnessState({
    id: "fake-cli",
    baseState: "detected",
    version: "1.2.3",
    descriptorHash: "hash-1",
    shippedAdapterIds: [],
    verification: null,
    ...overrides,
  });
}

describe("CT-146-17: the four states and the rule for an unknown value (F146-FR-017)", () => {
  it("a harness a source found and nothing else confirmed is `detected`", () => {
    assert.equal(resolve().state, "detected");
  });

  it("a harness whose descriptor the consumer wrote is `declared`", () => {
    assert.equal(resolve({ baseState: "declared" }).state, "declared");
  });

  it("a passed result of the same version and hash promotes to `locally-verified`", () => {
    assert.equal(
      resolve({ baseState: "declared", verification: storedResult() }).state,
      "locally-verified",
    );
  });

  it("the id of a shipped tested harness adapter is `tested`", () => {
    assert.equal(resolve({ shippedAdapterIds: ["fake-cli"] }).state, "tested");
  });

  it("an unknown state value reads as `detected`", () => {
    assert.equal(stateOfUnknownValue("activated"), "detected");
    assert.equal(stateOfUnknownValue("TESTED"), "detected");
    assert.equal(stateOfUnknownValue(undefined), "detected");
    assert.equal(stateOfUnknownValue(null), "detected");
  });

  it("a known state value passes through unchanged", () => {
    for (const state of ["tested", "locally-verified", "declared", "detected"] as const) {
      assert.equal(stateOfUnknownValue(state), state);
    }
  });
});

describe("CT-146-18: `locally-verified` only with a passed result of the same version and hash (F146-FR-018)", () => {
  it("promotes from `detected` too: the transition is open to declared and detected", () => {
    assert.equal(resolve({ verification: storedResult() }).state, "locally-verified");
  });

  it("a result naming another version is not used, and a doctor finding says so", () => {
    const resolution = resolve({
      baseState: "declared",
      verification: storedResult({ version: "1.0.0" }),
    });
    assert.equal(resolution.state, "declared");
    assert.equal(resolution.findings.length, 1);
    assert.match(resolution.findings[0]!.code, /harness-verify-result-unused/);
    assert.match(resolution.findings[0]!.message, /1\.0\.0/);
  });

  it("a result naming another descriptor hash is not used, and a doctor finding says so", () => {
    const resolution = resolve({
      baseState: "declared",
      verification: storedResult({ descriptorHash: "hash-old" }),
    });
    assert.equal(resolution.state, "declared");
    assert.match(resolution.findings[0]!.message, /hash/);
  });

  it("a result whose outcome is `failed` never promotes", () => {
    const resolution = resolve({
      baseState: "declared",
      verification: storedResult({ outcome: "failed" }),
    });
    assert.equal(resolution.state, "declared");
    assert.match(resolution.findings[0]!.message, /not `passed`/);
  });

  it("an unknown outcome is read as `failed`, so it never promotes", () => {
    assert.equal(outcomeOfStoredResult("succeeded"), "failed");
    assert.equal(outcomeOfStoredResult(undefined), "failed");
    const resolution = resolve({
      baseState: "declared",
      verification: storedResult({ outcome: "succeeded" }),
    });
    assert.equal(resolution.state, "declared");
    assert.equal(resolution.findings.length, 1);
  });

  it("a value without the schema constant is not a result of verification at all", () => {
    assert.equal(isStoredVerification({ schema: "specstride.something-else/9" }), false);
    assert.equal(isStoredVerification({}), false);
    assert.equal(isStoredVerification(null), false);
    const resolution = resolve({
      baseState: "declared",
      verification: { schema: "nope/1", outcome: "passed" },
    });
    assert.equal(resolution.state, "declared");
    assert.equal(resolution.findings.length, 0);
  });

  it("no stored result, no promotion", () => {
    assert.equal(resolve({ baseState: "declared", verification: null }).state, "declared");
  });

  it("a change of version or hash ends a `locally-verified` state: it falls back to the base", () => {
    const before = resolve({ baseState: "declared", verification: storedResult() });
    assert.equal(before.state, "locally-verified");
    const after = resolve({
      baseState: "declared",
      version: "2.0.0",
      verification: storedResult(),
    });
    assert.equal(after.state, "declared");
    assert.equal(after.findings.length, 1);
  });
});

describe("CT-146-19: nothing but a shipped tested harness adapter gives `tested` (F146-FR-019)", () => {
  it("a declared harness with a passed result is `locally-verified`, never `tested`", () => {
    assert.equal(
      resolve({ baseState: "declared", verification: storedResult() }).state,
      "locally-verified",
    );
  });

  it("a declaration cannot name the state `tested` into being: the unknown value reads `detected`", () => {
    assert.equal(stateOfUnknownValue("tested-from-declaration"), "detected");
  });

  it("a stored result alone never gives `tested`", () => {
    assert.notEqual(resolve({ verification: storedResult() }).state, "tested");
  });

  it("a shipped adapter keeps `tested` whatever the base state says", () => {
    assert.equal(
      resolve({ baseState: "declared", shippedAdapterIds: ["fake-cli"] }).state,
      "tested",
    );
  });

  it("a harness that no shipped adapter names is never `tested`", () => {
    assert.equal(resolve({ shippedAdapterIds: ["other-cli"] }).state, "detected");
  });
});
