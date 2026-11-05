// CT for T015 (F125-FR-020, F125-FR-021) — the environment allow-list of
// every call and the process group of every call, with the three stops.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  PARITY_ENV_ALLOW,
  POLITE_STOP_SIGNAL,
  PROCESS_GROUP_SPAWN_OPTIONS,
  ProcessGroupRefusedError,
  buildCallEnvironment,
  environmentAllowList,
  pgidIsValid,
  stopCall,
} from "../../src/invoke-proposer.ts";

const env = {
  PATH: "/usr/bin:/bin",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  HOME: "/home/consumer",
  SPECSTRIDE_STDIN_FILE: "/tmp/specstride-prompt.XXXXXX",
  TRACEPARENT: "00-trace-span-01",
  ANTHROPIC_API_KEY: "sk-proposer-should-never-see-critic-key",
  SPECSTRIDE_CLAUDE_CRITIC_API_KEY: "sk-critic-key",
  CLAUDE_CODE_OAUTH_TOKEN: "oauth-subscription-token",
  SOME_CONSUMER_SECRET: "never inherited",
};

describe("T015 — the environment of every call is an allow-list (F125-FR-020)", () => {
  it("under `parity` the names are exactly the baseline's set", () => {
    const built = buildCallEnvironment({
      role: "proposer",
      profile: "parity",
      authTier: 1,
      processEnv: env,
    });
    assert.deepEqual(Object.keys(built).sort(), [...PARITY_ENV_ALLOW].sort());
    assert.ok(!("TRACEPARENT" in built), "nothing about trace parent under parity");
    assert.equal(built.SPECSTRIDE_STDIN_FILE, "/tmp/specstride-prompt.XXXXXX");
  });

  it("the consumer's other variables are never inherited", () => {
    const built = buildCallEnvironment({
      role: "proposer",
      profile: "default",
      authTier: 1,
      processEnv: env,
    });
    assert.ok(!("SOME_CONSUMER_SECRET" in built));
    assert.equal(built.PATH, "/usr/bin:/bin");
  });

  it("the critic's credentials are never in the proposer's environment, and the reverse", () => {
    const proposer = buildCallEnvironment({
      role: "proposer",
      profile: "default",
      authTier: 1,
      processEnv: env,
    });
    const critic = buildCallEnvironment({
      role: "critic",
      profile: "default",
      authTier: 1,
      processEnv: env,
      memoryOff: true,
    });
    assert.ok(!("SPECSTRIDE_CLAUDE_CRITIC_API_KEY" in proposer));
    assert.ok(!("ANTHROPIC_API_KEY" in proposer));
    assert.ok(!("CLAUDE_CODE_OAUTH_TOKEN" in critic));
    // the critic DOES carry its own key
    assert.equal(critic.SPECSTRIDE_CLAUDE_CRITIC_API_KEY, "sk-critic-key");
  });

  it("every addition of the table sits behind its switch", () => {
    const off = buildCallEnvironment({
      role: "proposer",
      profile: "default",
      authTier: 2,
      processEnv: env,
      throwawayHome: "/tmp/overlay/home",
    });
    assert.ok(!("CLAUDE_CODE_DISABLE_AUTO_MEMORY" in off));
    assert.ok(!("CLAUDE_CODE_SUBPROCESS_ENV_SCRUB" in off));

    const on = buildCallEnvironment({
      role: "proposer",
      profile: "default",
      authTier: 2,
      processEnv: env,
      throwawayHome: "/tmp/overlay/home",
      memoryOff: true,
      subprocessEnvScrub: true,
      traceparent: "00-t-s-01",
    });
    assert.equal(on.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "1");
    assert.equal(on.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, "1");
    assert.equal(on.TRACEPARENT, "00-t-s-01");
  });

  it("the throwaway home travels only at auth tier 2, and never a subscription token there (F125-FR-017)", () => {
    const tier1 = buildCallEnvironment({
      role: "proposer",
      profile: "default",
      authTier: 1,
      processEnv: env,
      throwawayHome: "/tmp/overlay/home",
    });
    assert.ok(!("CLAUDE_CONFIG_DIR" in tier1), "never at auth tier 1");

    const tier2 = buildCallEnvironment({
      role: "proposer",
      profile: "default",
      authTier: 2,
      processEnv: env,
      throwawayHome: "/tmp/overlay/home",
    });
    assert.equal(tier2.CLAUDE_CONFIG_DIR, "/tmp/overlay/home");
    assert.ok(!("CLAUDE_CODE_OAUTH_TOKEN" in tier2));
  });

  it("the allow-list never carries the other role's credentials, even via the descriptor", () => {
    const names = environmentAllowList({ role: "proposer", profile: "default", authTier: 2 });
    assert.ok(!names.includes("SPECSTRIDE_CLAUDE_CRITIC_API_KEY"));
    assert.ok(!names.includes("ANTHROPIC_API_KEY"));
    assert.ok(names.includes("TRACEPARENT"));
  });
});

describe("T015 — every call runs in a process group of its own (F125-FR-021)", () => {
  it("the spawn options put the call into its own group (detached)", () => {
    assert.equal(PROCESS_GROUP_SPAWN_OPTIONS.detached, true);
  });

  it("a group id that is not an integer above one is refused", () => {
    for (const bad of [0, 1, -1, -5, 1.5, Number.NaN]) {
      assert.ok(!pgidIsValid(bad), `pgid ${bad} must be refused`);
      assert.throws(() => stopCall(bad, "polite"), ProcessGroupRefusedError);
    }
    assert.ok(pgidIsValid(42));
  });

  it("the polite stop sends the interrupt, the termination the TERM, the kill the KILL", () => {
    const sent: Array<[number, NodeJS.Signals]> = [];
    const record = (pgid: number, signal: NodeJS.Signals) => void sent.push([pgid, signal]);
    assert.equal(stopCall(42, "polite", { signal: record }), POLITE_STOP_SIGNAL);
    assert.equal(stopCall(42, "terminate", { signal: record }), "SIGTERM");
    assert.equal(stopCall(42, "kill", { signal: record }), "SIGKILL");
    assert.deepEqual(sent, [
      [42, "SIGINT"],
      [42, "SIGTERM"],
      [42, "SIGKILL"],
    ]);
  });

  it("a real call runs in its own group: the group id is the child's pid, and the kill reaches it", async () => {
    const child = spawn(
      process.execPath,
      ["-e", 'process.stdout.write("ready\\n"); setInterval(() => {}, 1000);'],
      { ...PROCESS_GROUP_SPAWN_OPTIONS, stdio: ["ignore", "pipe", "ignore"] },
    );
    const output = await new Promise<string>((resolve, reject) => {
      child.stdout?.on("data", (chunk: Buffer) => resolve(`${chunk}`));
      child.once("error", reject);
    });
    assert.equal(output.trim(), "ready");
    const pgid = child.pid;
    assert.ok(pgid !== undefined && pgidIsValid(pgid), "the child's pid is its group id");
    // the group exists, then the stop of the port ends it
    process.kill(-pgid, 0);
    stopCall(pgid, "kill");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    assert.throws(() => process.kill(-pgid!, 0));
  });
});
