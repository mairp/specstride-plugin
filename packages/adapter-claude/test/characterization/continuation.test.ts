// CT-125-8 (T024) — continuation (F125-FR-014): it requires that the harness
// keeps the session; the per-pass instructions travel in the user prompt,
// never in the system prompt; at auth tier 1 continuation is off and no
// session state is persisted; at auth tier 2 the session state lives in the
// throwaway home of the attempt and ends with it; a continued session
// records only its cost delta.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildProposerArgv } from "../../src/invoke-proposer.ts";
import { buildThrowawayHome, endPhaseAttempt } from "../../src/session.ts";
import { SessionRun, continuedSessionDelta, continuationIsInForce } from "../../src/session.ts";

describe("CT-125-8 — continuation (F125-FR-014)", () => {
  it("continuation requires persistence: it is in force at auth tier 2 only", () => {
    assert.equal(continuationIsInForce(1), false);
    assert.equal(continuationIsInForce(2), true);
  });

  it("at auth tier 1 no session state is persisted, and nothing lives in the real home", () => {
    const run = new SessionRun("attempt-1");
    const record = run.recordFresh("pass-1", 1, null);
    assert.equal(record.persisted, false);
    assert.equal(record.throwawayHome, null);
    // A fresh call at auth tier 1 carries --no-session-persistence.
    const argv = buildProposerArgv({
      role: "proposer",
      profile: "default",
      authTier: 1,
      sessionId: record.sessionId,
      allowedTools: ["Read"],
    });
    assert.ok(argv.includes("--no-session-persistence"));
  });

  it("at auth tier 2 the session state ends with the throwaway home of the attempt", () => {
    const overlayRoot = mkdtempSync(path.join(tmpdir(), "ct-125-8-overlay-"));
    const home = buildThrowawayHome({ overlayRoot, attemptId: "attempt-9" });
    const run = new SessionRun("attempt-9");
    const record = run.record("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "pass-1", 2, home.path);
    assert.equal(record.persisted, true);
    assert.equal(record.throwawayHome, home.path);
    assert.equal(existsSync(home.path), true);
    const result = endPhaseAttempt({ home, realConfigHome: "/home/consumer/.claude" });
    assert.equal(result.removed, home.path);
    assert.equal(existsSync(home.path), false, "the state goes with the throwaway home");
  });

  it("the real configuration home is never a removal target", () => {
    const realHome = mkdtempSync(path.join(tmpdir(), "ct-125-8-real-"));
    const inside = buildThrowawayHome({ overlayRoot: realHome, attemptId: "attempt-x" });
    assert.throws(
      () => endPhaseAttempt({ home: inside, realConfigHome: realHome }),
      (error: Error) => error.name === "SessionRefusedError",
    );
  });

  it("the per-pass instructions stay out of the system prompt", () => {
    for (const authTier of [1, 2] as const) {
      const argv = buildProposerArgv({
        role: "proposer",
        profile: "default",
        authTier,
        sessionId: "00000000-0000-4000-8000-000000000000",
        allowedTools: ["Read"],
      });
      assert.ok(!argv.includes("--system-prompt-file"));
      assert.ok(!argv.includes("--append-system-prompt"));
      assert.ok(!argv.some((a) => /system-prompt/.test(a)));
    }
  });

  it("a continued session records the delta, never the whole conversation cost", () => {
    assert.equal(continuedSessionDelta(null, 1.5), null, "an unknown figure is null, not zero");
    assert.equal(continuedSessionDelta(2.0, null), null);
    const delta = continuedSessionDelta(2.0, 2.75);
    assert.equal(delta, 0.75);
  });
});
