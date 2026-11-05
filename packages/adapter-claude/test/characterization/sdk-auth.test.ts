// CT-125-26 (T062) — with a subscription credential in the environment the
// SDK transport does NOT use it; no call carries a credential other than the
// key of its secret reference (F125-FR-035, ruling 70). Surfaces: the
// environment of the call, the one captured SDK call (options).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SDK_SUBSCRIPTION_CREDENTIAL_VARS,
  runSdkCriticCall,
  sdkApiKey,
  sdkAuthEnvironment,
} from "../../src/index.ts";
import type { QueryImpl } from "../../src/index.ts";

const SUBSCRIPTION_TOKEN = "sk-ant-oat01-subscription-token-000111";

/** The consumer's environment WITH a subscription credential in it. */
const ENV_WITH_SUBSCRIPTION: Record<string, string | undefined> = {
  PATH: "/usr/bin",
  HOME: "/home/consumer",
  CLAUDE_CODE_OAUTH_TOKEN: SUBSCRIPTION_TOKEN,
  CLAUDE_CODE_SESSION_TOKEN: "session-token-42",
};

/** A fake `query` that records the ONE call it receives. */
function fakeQuery(): {
  query: QueryImpl;
  seen: { prompt: string; options: Record<string, unknown> };
} {
  const seen: { prompt: string; options: Record<string, unknown> } = { prompt: "", options: {} };
  const query: QueryImpl = async function* (args) {
    seen.prompt = args.prompt;
    seen.options = args.options;
    yield {
      type: "system",
      subtype: "init",
      session_id: "minted-critic-1",
      tools: [],
      mcp_servers: [],
      plugins: [],
      model: "claude-haiku",
    };
    yield { type: "result", subtype: "success", session_id: "minted-critic-1", num_turns: 1 };
  };
  return { query, seen };
}

/** Every string value nested anywhere under a value. */
function* stringsUnder(value: unknown): Iterable<string> {
  if (typeof value === "string") yield value;
  else if (Array.isArray(value)) for (const item of value) yield* stringsUnder(item);
  else if (value !== null && typeof value === "object")
    for (const item of Object.values(value as Record<string, unknown>)) yield* stringsUnder(item);
}

describe("CT-125-26 — the SDK transport never carries a subscription credential (F125-FR-035)", () => {
  it("the environment of an SDK call has EVERY subscription credential removed", () => {
    const env = sdkAuthEnvironment(ENV_WITH_SUBSCRIPTION);
    for (const name of SDK_SUBSCRIPTION_CREDENTIAL_VARS) {
      assert.equal(env[name], undefined, name);
    }
    assert.equal(env["PATH"], "/usr/bin");
    assert.equal(env["HOME"], "/home/consumer");
  });

  it("no call carries a credential other than the key of its secret reference", async () => {
    const { query } = fakeQuery();
    const resolved = "sk-ant-api-key-of-the-reference";
    const call = await runSdkCriticCall({
      queryImpl: query,
      mintedSessionId: "minted-critic-1",
      prompt: "CRITIC",
      maxBudgetUsd: 0.5,
      emptyDir: "/tmp/empty-critic-dir",
      apiKey: sdkApiKey({ key: "specstride.claude.critic" }, (name) =>
        name === "specstride.claude.critic" ? resolved : undefined,
      ),
      env: ENV_WITH_SUBSCRIPTION,
    });
    // The reference resolved to exactly the API key.
    assert.equal(call.options["apiKey"], resolved);
    // The environment of the call carries NO credential.
    const env = call.options["env"] as Record<string, string | undefined>;
    for (const name of SDK_SUBSCRIPTION_CREDENTIAL_VARS) assert.equal(env[name], undefined);
    assert.equal(env["ANTHROPIC_API_KEY"], undefined);
    assert.equal(env["SPECSTRIDE_CLAUDE_CRITIC_API_KEY"], undefined);
    // The subscription token appears NOWHERE in the captured call.
    for (const value of stringsUnder(call.options)) {
      assert.notEqual(value, SUBSCRIPTION_TOKEN);
      assert.notEqual(value, "session-token-42");
    }
    assert.ok(!JSON.stringify(call.options).includes(SUBSCRIPTION_TOKEN));
  });

  it("no secret reference means NO credential on the call at all — no fallback is read", async () => {
    const { query } = fakeQuery();
    const call = await runSdkCriticCall({
      queryImpl: query,
      mintedSessionId: "minted-critic-2",
      prompt: "CRITIC",
      maxBudgetUsd: 0.5,
      emptyDir: "/tmp/empty-critic-dir",
      env: ENV_WITH_SUBSCRIPTION,
    });
    assert.equal("apiKey" in call.options, false);
    assert.ok(!JSON.stringify(call.options).includes(SUBSCRIPTION_TOKEN));
  });

  it("a reference the host cannot resolve puts no credential on the call", () => {
    assert.equal(
      sdkApiKey({ key: "missing.ref" }, () => undefined),
      undefined,
    );
    assert.equal(
      sdkApiKey(undefined, () => "whatever"),
      undefined,
    );
  });
});
