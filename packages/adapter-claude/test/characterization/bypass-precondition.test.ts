// CT-125-33 (T080) — the precondition of the bypass mode (F125-FR-012,
// CQ-183): under the default profile the bypass mode is used ONLY when
// `sandbox.permissionMode` names it in USER configuration; the same value
// from the environment, a flag or project configuration is NOT taken; with
// the value set and no sandbox detected, or with the user root, the launch
// is refused with the reason; the harness adapter never selects the mode by
// itself. Surfaces: transcript (the argument list), state (the refusal).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BYPASS_PERMISSION_MODE,
  InvokeRefusedError,
  buildCriticArgv,
  buildProposerArgv,
  resolveBypassModeChoice,
} from "../../src/invoke-proposer.ts";

const BASE = {
  role: "proposer",
  profile: "default",
  authTier: 1,
} as const;

const OK_PRECONDITION = { sandbox: true, userIsRoot: false };

describe("CT-125-33 — the bypass precondition (F125-FR-012, CQ-183)", () => {
  it("the bypass mode is used when `sandbox.permissionMode` names it in USER configuration and the precondition holds", () => {
    const choice = resolveBypassModeChoice({
      userConfiguration: { sandbox: { permissionMode: BYPASS_PERMISSION_MODE } },
    });
    assert.equal(choice.bypass, true);
    assert.equal(choice.source, "user-configuration");
    const argv = buildProposerArgv({
      ...BASE,
      consumerBypass: choice.bypass,
      bypassPrecondition: OK_PRECONDITION,
      sessionId: "2f1d3c5e-8a9b-4918-8276-4561237890ab",
    });
    assert.ok(argv.includes("--dangerously-skip-permissions"));
  });

  it("the same value in the environment is NOT taken", () => {
    const choice = resolveBypassModeChoice({
      environment: {
        SANDBOX_PERMISSION_MODE: BYPASS_PERMISSION_MODE,
        SPECSTRIDE_SANDBOX_PERMISSION_MODE: BYPASS_PERMISSION_MODE,
        CLAUDE_PERMISSION_MODE: BYPASS_PERMISSION_MODE,
      },
    });
    assert.equal(choice.bypass, false);
    assert.equal(choice.source, "none");
    assert.equal(choice.mode, "acceptEdits");
  });

  it("the same value on a flag of the command line is NOT taken", () => {
    const choice = resolveBypassModeChoice({
      flag: `--sandbox.permissionMode=${BYPASS_PERMISSION_MODE}`,
    });
    assert.equal(choice.bypass, false);
  });

  it("the same value in project configuration is NOT taken", () => {
    const choice = resolveBypassModeChoice({
      projectConfiguration: { sandbox: { permissionMode: BYPASS_PERMISSION_MODE } },
    });
    assert.equal(choice.bypass, false);
    assert.equal(choice.mode, "acceptEdits");
  });

  it("a value that does not name the bypass mode in user configuration is not taken either", () => {
    for (const value of ["acceptEdits", "dontAsk", "default", ""]) {
      const choice = resolveBypassModeChoice({
        userConfiguration: { sandbox: { permissionMode: value } },
      });
      assert.equal(choice.bypass, false);
    }
  });

  it("the environment, a flag and project configuration together still produce acceptEdits in the argument list", () => {
    const choice = resolveBypassModeChoice({
      environment: { SANDBOX_PERMISSION_MODE: BYPASS_PERMISSION_MODE },
      flag: `--sandbox.permissionMode=${BYPASS_PERMISSION_MODE}`,
      projectConfiguration: { sandbox: { permissionMode: BYPASS_PERMISSION_MODE } },
    });
    const argv = buildProposerArgv({
      ...BASE,
      consumerBypass: choice.bypass,
      bypassPrecondition: OK_PRECONDITION,
      sessionId: "2f1d3c5e-8a9b-4918-8276-4561237890ab",
    });
    assert.ok(!argv.includes("--dangerously-skip-permissions"));
    const modeAt = argv.indexOf("--permission-mode");
    assert.notEqual(modeAt, -1);
    assert.equal(argv[modeAt + 1], "acceptEdits");
  });

  it("with the value set in user configuration and NO sandbox detected, the launch is refused with the reason", () => {
    assert.throws(
      () =>
        buildProposerArgv({
          ...BASE,
          consumerBypass: true,
          bypassPrecondition: { sandbox: false, userIsRoot: false },
          sessionId: "2f1d3c5e-8a9b-4918-8276-4561237890ab",
        }),
      (error: unknown) => {
        assert.ok(error instanceof InvokeRefusedError);
        assert.equal(error.reason, "bypass-precondition");
        assert.match(error.message, /no sandbox detected/);
        return true;
      },
    );
  });

  it("with the value set in user configuration and the user root, the launch is refused with the reason", () => {
    assert.throws(
      () =>
        buildProposerArgv({
          ...BASE,
          consumerBypass: true,
          bypassPrecondition: { sandbox: true, userIsRoot: true },
          sessionId: "2f1d3c5e-8a9b-4918-8276-4561237890ab",
        }),
      (error: unknown) => {
        assert.ok(error instanceof InvokeRefusedError);
        assert.equal(error.reason, "bypass-precondition");
        assert.match(error.message, /the user is root/);
        return true;
      },
    );
  });

  it("no silent fallback: the refusal happens even where a sandbox fact is missing entirely", () => {
    assert.throws(
      () =>
        buildProposerArgv({
          ...BASE,
          consumerBypass: true,
          sessionId: "2f1d3c5e-8a9b-4918-8276-4561237890ab",
        }),
      (error: unknown) => {
        assert.ok(error instanceof InvokeRefusedError);
        assert.equal(error.reason, "bypass-precondition");
        return true;
      },
    );
  });

  it("the harness adapter never selects the mode by itself: the default profile carries acceptEdits, never the bypass flag", () => {
    // No consumer choice, containment on, a valid precondition: still no
    // bypass flag, because only the consumer's user configuration turns the
    // mode on (F125-FR-012).
    const argv = buildProposerArgv({
      ...BASE,
      containmentC2: true,
      bypassPrecondition: OK_PRECONDITION,
      sessionId: "2f1d3c5e-8a9b-4918-8276-4561237890ab",
    });
    assert.ok(!argv.includes("--dangerously-skip-permissions"));
    const modeAt = argv.indexOf("--permission-mode");
    assert.equal(argv[modeAt + 1], "acceptEdits");

    // The critic-class call NEVER carries the bypass flag (the contract's
    // never list), whatever the consumer set.
    const criticArgv = buildCriticArgv({
      role: "critic",
      profile: "default",
      authTier: 1,
      consumerBypass: true,
      bypassPrecondition: OK_PRECONDITION,
      sessionId: "3a2b4c6d-8e9f-4918-8276-4561237890ab",
    });
    assert.ok(!criticArgv.includes("--dangerously-skip-permissions"));
  });
});
