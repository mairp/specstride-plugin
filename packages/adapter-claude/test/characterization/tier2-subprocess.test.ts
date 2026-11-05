// CT-125-11 (T049, fixture FX-39) — auth tier 2 (F125-FR-017): the key by
// reference at the moment of use and never in an argument list, the
// throwaway home built from the overlay `specstride-overlay/v1` with its
// scope and its removal — even after a kill — the minimal mode only at auth
// tier 2, and no subscription token in the environment.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CRITIC_KEY_VARIABLES,
  OVERLAY_SCHEMA,
  SessionRun,
  buildCallEnvironment,
  buildCriticArgv,
  buildOverlayHome,
  buildProposerArgv,
  minimalModeAllowed,
  overlayScope,
  removeOverlayHome,
  resolveCriticAliases,
  type OverlayHome,
} from "../../src/index.ts";

describe("CT-125-11 — auth tier 2: key by reference, throwaway home, minimal mode (F125-FR-017)", () => {
  it("the API key is resolved from its secret reference at the moment of use, by name", () => {
    // The environment carries the NAME of the reference; the value is read
    // from it when the call needs it, never earlier and never copied into
    // an argument or a second home (F125-FR-017).
    const aliases = resolveCriticAliases({
      SPECSTRIDE_CLAUDE_CRITIC_API_KEY: "sk-live-key-value",
    });
    assert.equal(aliases.key, "sk-live-key-value");
    assert.ok(CRITIC_KEY_VARIABLES.includes("SPECSTRIDE_CLAUDE_CRITIC_API_KEY"));
  });

  it("the key never appears in an argument list of either role", () => {
    const key = "sk-secret-critic-key-42";
    const argvs = [
      JSON.stringify(buildProposerArgv({ role: "proposer", profile: "default", authTier: 2 })),
      JSON.stringify(
        buildCriticArgv({
          role: "critic",
          profile: "default",
          authTier: 1,
          sessionId: "33333333-3333-4333-8333-333333333333",
          budgetUsd: 2,
        }),
      ),
    ];
    for (const argv of argvs) {
      assert.ok(!argv.includes(key), "no argument carries the key value");
    }
  });

  it("the throwaway home is built from the overlay specstride-overlay/v1, outside the real home", () => {
    const home = buildOverlayHome({
      overlayRoot: "/var/tmp/specstride-overlays",
      attemptId: "att-t49",
      realConfigHome: "/home/consumer/.claude",
    });
    assert.equal(home.schema, OVERLAY_SCHEMA);
    assert.equal(home.schema, "specstride-overlay/v1");
    assert.equal(home.envName, "CLAUDE_CONFIG_DIR");
    assert.equal(home.adapterOwned, true);
    assert.ok(!home.path.startsWith("/home/consumer/.claude"));
  });

  it("the scope is `attempt` while a session is continued, else `pass`", () => {
    assert.equal(overlayScope({ sessionContinued: true }), "attempt");
    assert.equal(overlayScope({ sessionContinued: false }), "pass");
    const home = buildOverlayHome({
      overlayRoot: "/var/tmp/overlays",
      attemptId: "att-scope",
      scope: overlayScope({ sessionContinued: true }),
    });
    assert.equal(home.scope, "attempt");
  });

  it("the home is removed when its scope ends, even after a kill", () => {
    const home = buildOverlayHome({
      overlayRoot: "/var/tmp/overlays",
      attemptId: "att-kill",
      scope: "attempt",
    });
    const removed: string[] = [];
    // Nothing about the removal reads the pass state: a killed pass leaves
    // the same overlay record, so the removal happens all the same.
    const ended = removeOverlayHome({
      home,
      realConfigHome: "/home/consumer/.claude",
      rm: (dir) => removed.push(dir),
    });
    assert.deepEqual(removed, [home.path]);
    assert.equal(ended.removed, home.path);
  });

  it("the removal refuses a home the adapter did not build and the real home", () => {
    assert.throws(
      () =>
        removeOverlayHome({
          home: {
            path: "/var/tmp/foreign",
            adapterOwned: false,
            scope: "pass",
            schema: OVERLAY_SCHEMA,
            envName: "CLAUDE_CONFIG_DIR",
          } as unknown as OverlayHome,
          rm: () => {
            throw new Error("must not be reached");
          },
        }),
      /did not build/,
    );
    assert.throws(
      () =>
        removeOverlayHome({
          home: buildOverlayHome({
            overlayRoot: "/home/consumer/.claude",
            attemptId: "att-real",
            mkdir: () => {},
          }),
          realConfigHome: "/home/consumer/.claude",
          rm: () => {
            throw new Error("must not be reached");
          },
        }),
      /real configuration home/,
    );
  });

  it("the minimal mode is allowed at auth tier 2 and refused at auth tier 1", () => {
    assert.equal(minimalModeAllowed({ authTier: 2 }), true);
    assert.equal(minimalModeAllowed({ authTier: 1 }), false);
  });

  it("CLAUDE_CONFIG_DIR names the throwaway home only at auth tier 2", () => {
    const home = buildOverlayHome({
      overlayRoot: "/var/tmp/overlays",
      attemptId: "att-env",
    });
    const tier2 = buildCallEnvironment({
      role: "proposer",
      profile: "default",
      authTier: 2,
      processEnv: {
        PATH: "/usr/bin",
        HOME: "/home/consumer",
        CLAUDE_CODE_OAUTH_TOKEN: "sub-token",
      },
      throwawayHome: home.path,
    });
    assert.equal(tier2.CLAUDE_CONFIG_DIR, home.path);
    const tier1 = buildCallEnvironment({
      role: "proposer",
      profile: "default",
      authTier: 1,
      processEnv: {
        PATH: "/usr/bin",
        HOME: "/home/consumer",
        CLAUDE_CODE_OAUTH_TOKEN: "sub-token",
      },
      throwawayHome: home.path,
    });
    assert.ok(!("CLAUDE_CONFIG_DIR" in tier1), "never at auth tier 1");
  });

  it("no subscription token in the environment at auth tier 2", () => {
    const run = new SessionRun("att-token");
    run.recordFresh("sess", 2, null);
    for (const role of ["proposer", "critic"] as const) {
      const built = buildCallEnvironment({
        role,
        profile: "default",
        authTier: 2,
        processEnv: {
          PATH: "/usr/bin",
          HOME: "/home/consumer",
          CLAUDE_CODE_OAUTH_TOKEN: "oauth-subscription-token",
        },
        throwawayHome: "/var/tmp/overlays/claude-home-att-token",
      });
      assert.ok(!("CLAUDE_CODE_OAUTH_TOKEN" in built), `${role}: no subscription token`);
    }
  });
});
