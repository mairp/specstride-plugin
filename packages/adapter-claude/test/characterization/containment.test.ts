// CT-125-13 (T051) — the containment ceiling (C2 where the platform offers
// the sandbox of the harness for shell commands, else C1), the capability
// `concurrentSessions` null, and parallel units off with the reason stated
// (F125-FR-019).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  concurrentSessionsCapability,
  containmentCeiling,
  descriptor,
  parallelUnitsSetting,
} from "../../src/index.ts";

describe("CT-125-13 — the containment ceiling and concurrentSessions (F125-FR-019)", () => {
  it("the ceiling is C2 where the platform offers the sandbox, with the provenance `adapter`", () => {
    const c2 = containmentCeiling({ sandboxOfferedByPlatform: true });
    assert.equal(c2.ceiling, "C2");
    assert.equal(c2.provenance, "adapter");
    assert.match(c2.basis, /platform offers the sandbox/);
  });

  it("the ceiling is C1 where the platform offers no sandbox", () => {
    const c1 = containmentCeiling({ sandboxOfferedByPlatform: false });
    assert.equal(c1.ceiling, "C1");
    assert.equal(c1.provenance, "adapter");
    assert.match(c1.basis, /offers no sandbox/);
  });

  it("the adapter never asserts a sandbox by itself: the ceiling follows the observed platform fact", () => {
    // The same consumer on two platforms gets two ceilings: the claim of
    // the adapter is never the input, only the observation is.
    const input = { sandboxOfferedByPlatform: false };
    assert.equal(containmentCeiling(input).ceiling, "C1");
    assert.equal(containmentCeiling({ ...input, sandboxOfferedByPlatform: true }).ceiling, "C2");
  });

  it("`concurrentSessions` is null (unverified) until capture B, and never guessed", () => {
    const capability = concurrentSessionsCapability();
    assert.equal(capability.concurrentSessions, null);
    assert.equal(capability.status, "unverified");
    assert.match(capability.decidedBy, /capture-b-concurrent-sessions\.md/);
    // The descriptor field agrees, as data.
    assert.equal(descriptor.concurrentSessions, null);
  });

  it("parallel units are off for this harness, with the reason stated", () => {
    const units = parallelUnitsSetting();
    assert.equal(units.enabled, false);
    assert.match(units.reason, /concurrentSessions is null/);
    assert.match(units.reason, /F125-FR-019/);
  });

  it("capture B records the pending state of the capability as a fixture", () => {
    const capture = readFileSync(
      new URL("../../test/fixtures/capture-b-concurrent-sessions.md", import.meta.url),
      "utf8",
    );
    assert.match(capture, /`concurrentSessions`/);
    assert.match(capture, /the field stays `null` with no/);
  });
});
