// CT-125-17 (T038) — the auth tier 1 critic COMMAND (F125-FR-023; FX-06):
// the installed CLI as a subprocess, prompt on standard input, NO tool, no
// session persistence, ONE turn, a permission mode that denies and never
// asks, NO flag that allows all tools, and — at auth tier 2 — the CLI is
// NOT a form of the critic at all. Surfaces: transcript (the argument list
// and environment the harness sees), state (the working directory), exit.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CREDENTIAL_VARS,
  buildCriticArgv,
  carriesNoSessionContinuation,
  environmentAllowList,
} from "../../src/invoke-proposer.ts";
import {
  CriticConfigError,
  CriticTransportError,
  assertCriticTransportAllowed,
  callCriticCli,
} from "../../src/critic-cli.ts";
import { runStub } from "../stubs/run-stub.ts";

const MINTED = "0f0e0d0c-0b0a-4918-8276-4561237890ab";
const BASE_ENV: Record<string, string> = { PATH: "/usr/bin:/bin", HOME: "/home/consumer" };

const GOOD_STREAM = [
  JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: MINTED,
    tools: [],
    mcp_servers: [],
    plugins: [],
    model: "claude-opus-4-8",
  }),
  JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "VERDICT: APPROVED" }] },
  }),
].join("\n");

describe("CT-125-17 — the auth tier 1 critic command (F125-FR-023)", () => {
  it("the argument list carries no tool, one turn, a denying permission mode and no allow-all flag", () => {
    const argv = [
      ...buildCriticArgv({
        role: "critic",
        profile: "default",
        authTier: 1,
        model: "claude-opus-4-8",
        sessionId: MINTED,
        sessionMode: "fresh",
      }),
    ];
    // transcript: no tool is enabled — the empty tools list and the wildcard
    // disallow, the strict server config.
    assert.ok(argv.includes("--tools"), JSON.stringify(argv));
    assert.equal(argv[argv.indexOf("--tools") + 1], "");
    assert.ok(argv.includes("--disallowedTools"));
    assert.equal(argv[argv.indexOf("--disallowedTools") + 1], "mcp__*");
    assert.ok(argv.includes("--strict-mcp-config"));
    // ONE turn.
    assert.ok(argv.includes("--max-turns"));
    assert.equal(argv[argv.indexOf("--max-turns") + 1], "1");
    // a permission mode that denies and never asks — never an allow-all.
    assert.ok(argv.includes("--permission-mode"));
    assert.equal(argv[argv.indexOf("--permission-mode") + 1], "dontAsk");
    assert.ok(argv.includes("--permission-prompts"));
    assert.equal(argv[argv.indexOf("--permission-prompts") + 1], "none");
    assert.equal(argv.includes("--dangerously-skip-permissions"), false);
    assert.equal(argv.includes("--allowedTools"), false);
    // no session persistence, minted fresh session id.
    assert.ok(argv.includes("--no-session-persistence"));
    assert.equal(argv[argv.indexOf("--session-id") + 1], MINTED);
    // and never a resume, continue or fork argument (F125-FR-025).
    assert.equal(carriesNoSessionContinuation(argv), true);
  });

  it("the call runs in an empty temporary working directory and persists nothing", async () => {
    const seen: { cwd: string; env: Record<string, string | undefined> }[] = [];
    const realHome = mkdtempSync(path.join(tmpdir(), "ct17-home-"));
    const homeBefore = readdirSync(realHome).length;
    const record = await callCriticCli({
      prompt: "Judge the evidence.",
      model: "claude-opus-4-8",
      executable: "/usr/local/bin/claude",
      sessionId: MINTED,
      proposerSessionIds: new Set(),
      termsAllowed: true,
      processEnv: { ...BASE_ENV, HOME: realHome },
      spawnCritic: (executable, argv, options) => {
        seen.push({ cwd: options.cwd, env: options.env });
        return { pid: 4242, stream: Promise.resolve(GOOD_STREAM) };
      },
    });
    // state: the working directory was EMPTY at the start of the call
    // (F125-FR-025) and is gone after it.
    assert.equal(record.workingDirectoryEmpty, true);
    assert.equal(existsSync(seen[0]?.cwd ?? ""), false, "the temporary directory is removed");
    // no persistence: the real configuration home gained nothing.
    assert.equal(readdirSync(realHome).length, homeBefore);
  });

  it("the critic's environment never carries the proposer's credential (F125-FR-030)", async () => {
    const seen: { env: Record<string, string | undefined> }[] = [];
    await callCriticCli({
      prompt: "Judge the evidence.",
      model: "claude-opus-4-8",
      executable: "/usr/local/bin/claude",
      sessionId: MINTED,
      proposerSessionIds: new Set(),
      termsAllowed: true,
      processEnv: {
        ...BASE_ENV,
        CLAUDE_CODE_OAUTH_TOKEN: "oauth-subscription-token",
        ANTHROPIC_API_KEY: "sk-critic",
      },
      spawnCritic: (executable, argv, options) => {
        seen.push({ env: options.env });
        return { pid: 4243, stream: Promise.resolve(GOOD_STREAM) };
      },
    });
    const envNames = Object.keys(seen[0]?.env ?? {});
    for (const name of CREDENTIAL_VARS.proposer) {
      assert.equal(envNames.includes(name), false, name);
    }
    // the allow-list of the critic role never names the proposer's variables
    assert.equal(
      environmentAllowList({ role: "critic", profile: "default", authTier: 1 }).includes(
        "CLAUDE_CODE_OAUTH_TOKEN",
      ),
      false,
    );
  });

  it("at auth tier 2 the CLI is NOT a form of the critic (F125-FR-023)", () => {
    assert.throws(
      () => assertCriticTransportAllowed({ transport: "subprocess", authTier: 2 }),
      (error: unknown) =>
        error instanceof CriticConfigError &&
        error.reason === "cli-at-auth-tier-2" &&
        error.stopReason === "critic_config",
    );
    assert.doesNotThrow(() =>
      assertCriticTransportAllowed({ transport: "direct-call", authTier: 2 }),
    );
    assert.doesNotThrow(() =>
      assertCriticTransportAllowed({ transport: "subprocess", authTier: 1 }),
    );
  });

  it("the transcript of the stub shows the command exactly as the harness receives it (FX-06)", async () => {
    const recordDir = mkdtempSync(path.join(tmpdir(), "ct17-record-"));
    const transcript = await runStub({
      argv: [
        ...buildCriticArgv({
          role: "critic",
          profile: "default",
          authTier: 1,
          model: "claude-opus-4-8",
          sessionId: MINTED,
          sessionMode: "fresh",
        }),
      ],
      env: { ...BASE_ENV },
      recordDir,
    });
    assert.equal(transcript.argv.includes("--dangerously-skip-permissions"), false);
    assert.equal(transcript.argv.includes("--max-turns"), true);
    assert.equal(transcript.argv[transcript.argv.indexOf("--permission-mode") + 1], "dontAsk");
    assert.equal(transcript.argv.includes("--no-session-persistence"), true);
  });

  it("a failed call is a typed failure of the port, never a verdict (F125-FR-030)", async () => {
    await assert.rejects(
      callCriticCli({
        prompt: "Judge the evidence.",
        model: "claude-opus-4-8",
        executable: "/usr/local/bin/claude",
        sessionId: MINTED,
        proposerSessionIds: new Set(),
        termsAllowed: true,
        processEnv: BASE_ENV,
        spawnCritic: () => ({
          pid: 4244,
          stream: Promise.reject(new CriticTransportError("non-zero-exit", "exit 1")),
        }),
      }),
      (error: unknown) => error instanceof CriticTransportError && error.kind === "non-zero-exit",
    );
  });
});
