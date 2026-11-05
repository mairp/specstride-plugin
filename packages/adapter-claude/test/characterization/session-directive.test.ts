// CT-125-7 (T023) — the session directive (F125-FR-013): the first pass of a
// phase attempt is fresh with a minted id; a later pass continues BY ID
// where continuation is in force; every fresh case (new attempt, relaunch,
// watchdog kill, second repair, escalation) starts fresh; and under `parity`
// no invocation carries a session or continuation argument (FX-01, FX-02).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FRESH_CASES,
  continueDirective,
  directiveForPass,
  freshDirective,
} from "../../src/session.ts";
import { buildProposerArgv, carriesNoSessionContinuation } from "../../src/invoke-proposer.ts";

const FIRST = freshDirective();

describe("CT-125-7 — the session directive (F125-FR-013)", () => {
  it("the first pass of an attempt is fresh, with an id the adapter minted", () => {
    const directive = directiveForPass({ passNumber: 1, authTier: 2 });
    assert.equal(directive.mode, "fresh");
    assert.match(directive.sessionId, /^[0-9a-f-]{36}$/);
    assert.notEqual(directive.sessionId, FIRST.sessionId, "each mint is its own");
  });

  it("a later pass continues by its id where continuation is in force", () => {
    const directive = directiveForPass({
      passNumber: 2,
      authTier: 2,
      sessionId: FIRST.sessionId,
    });
    assert.equal(directive.mode, "continue");
    assert.equal(directive.sessionId, FIRST.sessionId);
  });

  it("at auth tier 1 every pass is fresh (F125-FR-014)", () => {
    const directive = directiveForPass({
      passNumber: 3,
      authTier: 1,
      sessionId: FIRST.sessionId,
    });
    assert.equal(directive.mode, "fresh");
  });

  it("every fresh case starts fresh with a new minted id, even at auth tier 2", () => {
    for (const freshCase of FRESH_CASES) {
      const directive = directiveForPass({
        passNumber: 2,
        authTier: 2,
        freshCase,
        sessionId: FIRST.sessionId,
      });
      assert.equal(directive.mode, "fresh", `the fresh case ${freshCase}`);
      assert.notEqual(directive.sessionId, FIRST.sessionId);
    }
  });

  it("a continuation with an empty id is refused (F125-FR-004)", () => {
    assert.throws(
      () => continueDirective(""),
      (error: Error) => error.name === "SessionRefusedError",
    );
    assert.throws(
      () => continueDirective("  "),
      (error: Error) => error.name === "SessionRefusedError",
    );
  });

  it("under `parity` no invocation carries a session or continuation argument", () => {
    for (const streamOn of [true, false]) {
      for (const skills of [undefined, true]) {
        const argv = buildProposerArgv({
          role: "proposer",
          profile: "parity",
          authTier: 1,
          streamOn,
          proposerSkills: skills,
          model: "claude-sonnet-4-5",
        });
        assert.ok(carriesNoSessionContinuation([...argv]));
        assert.ok(!argv.includes("--session-id"));
      }
    }
  });
});
