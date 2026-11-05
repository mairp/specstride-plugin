// CT-125-14 (T027) — the environment is an allow-list; no other provider's
// key is ever carried; the credentials of the critic are never in the
// proposer's environment (and the reverse); the scrub option is behind its
// switch (F125-FR-020).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CREDENTIAL_VARS,
  PARITY_ENV_ALLOW,
  buildCallEnvironment,
  environmentAllowList,
} from "../../src/invoke-proposer.ts";

const FULL_ENV: Record<string, string> = {
  PATH: "/usr/bin:/bin",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  HOME: "/home/consumer",
  SPECSTRIDE_STDIN_FILE: "/tmp/specstride-prompt.abc123",
  TRACEPARENT: "00-trace-span-01",
  ANTHROPIC_API_KEY: "sk-critic-side-key",
  SPECSTRIDE_CLAUDE_CRITIC_API_KEY: "sk-critic-side-key",
  CLAUDE_CODE_OAUTH_TOKEN: "oauth-subscription-token",
  SOME_CONSUMER_SECRET: "never inherited",
  ANOTHER_PROVIDER_API_KEY: "sk-other-provider",
};

describe("CT-125-14 — the environment allow-list (F125-FR-020)", () => {
  it("the environment is an allow-list: nothing outside the list is inherited", () => {
    const built = buildCallEnvironment({
      role: "proposer",
      profile: "default",
      authTier: 1,
      processEnv: FULL_ENV,
    });
    for (const name of Object.keys(built)) {
      assert.ok(
        environmentAllowList({ role: "proposer", profile: "default", authTier: 1 }).includes(name),
        `the name ${name} is on the allow-list`,
      );
    }
    assert.ok(!("SOME_CONSUMER_SECRET" in built));
  });

  it("no other provider's key is ever carried", () => {
    for (const role of ["proposer", "critic"] as const) {
      for (const authTier of [1, 2] as const) {
        const built = buildCallEnvironment({
          role,
          profile: "default",
          authTier,
          processEnv: FULL_ENV,
        });
        assert.ok(!("ANOTHER_PROVIDER_API_KEY" in built), `${role} at tier ${authTier}`);
        const keys = Object.keys(built).filter((name) => /API_KEY|TOKEN|SECRET/.test(name));
        for (const name of keys) {
          assert.ok(
            (CREDENTIAL_VARS[role] as readonly string[]).includes(name),
            `the only key variables are the role's own: ${name}`,
          );
        }
      }
    }
  });

  it("the critic's credentials are never in the proposer's environment, and the reverse", () => {
    const proposer = buildCallEnvironment({
      role: "proposer",
      profile: "default",
      authTier: 1,
      processEnv: FULL_ENV,
    });
    for (const name of CREDENTIAL_VARS.critic) {
      assert.ok(!(name in proposer), `${name} never reaches the proposer`);
    }
    const critic = buildCallEnvironment({
      role: "critic",
      profile: "default",
      authTier: 2,
      processEnv: FULL_ENV,
    });
    for (const name of CREDENTIAL_VARS.proposer) {
      assert.ok(!(name in critic), `${name} never reaches the critic`);
    }
    assert.ok("SPECSTRIDE_CLAUDE_CRITIC_API_KEY" in critic);
  });

  it("the scrub option is behind its switch (harnesses.claude.subprocessEnvScrub)", () => {
    const off = buildCallEnvironment({
      role: "proposer",
      profile: "default",
      authTier: 1,
      processEnv: FULL_ENV,
    });
    assert.ok(!("CLAUDE_CODE_SUBPROCESS_ENV_SCRUB" in off));
    const on = buildCallEnvironment({
      role: "proposer",
      profile: "default",
      authTier: 1,
      processEnv: FULL_ENV,
      subprocessEnvScrub: true,
    });
    assert.equal(on.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, "1");
  });

  it("under `parity` the scrub stays off and the names are exactly the baseline's set", () => {
    const built = buildCallEnvironment({
      role: "proposer",
      profile: "parity",
      authTier: 1,
      processEnv: FULL_ENV,
      subprocessEnvScrub: true,
    });
    assert.deepEqual(Object.keys(built).sort(), [...PARITY_ENV_ALLOW].sort());
    assert.ok(!("CLAUDE_CODE_SUBPROCESS_ENV_SCRUB" in built));
  });
});
