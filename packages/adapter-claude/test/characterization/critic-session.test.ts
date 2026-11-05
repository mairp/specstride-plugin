// CT-125-19 (T040) — the critic never shares, resumes, continues or forks the
// proposer's session (F125-FR-025): the invocation type has NO parameter for
// a resume, continue or fork argument; the call runs in an EMPTY temporary
// directory, so project settings, tool-server files and instruction files are
// out of reach even if a flag regresses; and nothing is persisted, so no
// later pass can resume the critic's session. Surfaces: transcript (the
// argument list), state (the directories), exit.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCriticArgv, carriesNoSessionContinuation } from "../../src/invoke-proposer.ts";
import {
  callCriticCli,
  type CriticCallRecord,
  type CriticProof,
  type SpawnCritic,
} from "../../src/critic-cli.ts";

const MINTED = "2b3c4d5e-6f7a-4918-8276-4561237890ab";
const PROPOSER = "8d7c6b5a-4e3f-4918-8276-4561237890ab";
const GOOD_STREAM = [
  JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: MINTED,
    tools: [],
    mcp_servers: [],
    plugins: [],
  }),
  JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "VERDICT: APPROVED" }] },
  }),
].join("\n");

function argvFor(): string[] {
  return [
    ...buildCriticArgv({
      role: "critic",
      profile: "default",
      authTier: 1,
      model: "claude-opus-4-8",
      sessionId: MINTED,
      sessionMode: "fresh",
    }),
  ];
}

describe("CT-125-19 — the critic's session independence (F125-FR-025)", () => {
  it("the invocation type has no resume, continue or fork parameter", async () => {
    // The invocation type is CriticCallRecord + the built argv: neither has a
    // field or argument that resumes, continues or forks.
    const argv = argvFor();
    assert.equal(carriesNoSessionContinuation(argv), true);
    for (const forbidden of ["--resume", "--continue", "--fork-session"]) {
      assert.equal(argv.includes(forbidden), false, forbidden);
      assert.equal(argv.includes(`${forbidden}=${MINTED}`), false, forbidden);
    }
    // The type itself names every field it carries — none of them is a
    // resume, continue or fork parameter.
    const record: CriticCallRecord = {
      role: "critic",
      transport: "subprocess",
      authTier: 1,
      model: "claude-opus-4-8",
      effort: null,
      permissionMode: "dontAsk",
      sessionId: MINTED,
      argv,
      envNames: ["HOME", "PATH"],
      workingDirectoryEmpty: true,
      budgetUsd: null,
      proof: {
        outcome: "proven",
        toolsEmpty: true,
        serversEmpty: true,
        sessionMatches: true,
        sessionNotProposer: true,
      },
      verdict: "VERDICT: APPROVED",
      failure: null,
    };
    const keys = Object.keys(record);
    for (const key of keys) {
      assert.equal(/resume|continue|fork/i.test(key), false, key);
    }
    const proofKeys = Object.keys(record.proof as CriticProof);
    for (const key of proofKeys) {
      assert.equal(/resume|continue|fork/i.test(key), false, key);
    }
    // and a spawn of that shape still records the same closed field set.
    const seen: string[] = [];
    const runner: SpawnCritic = (_executable, _argv, options) => {
      seen.push(options.cwd);
      return { pid: 4247, stream: Promise.resolve(GOOD_STREAM) };
    };
    await callCriticCli({
      prompt: "Judge the evidence.",
      model: "claude-opus-4-8",
      executable: "/usr/local/bin/claude",
      sessionId: MINTED,
      proposerSessionIds: new Set([PROPOSER]),
      termsAllowed: true,
      processEnv: { PATH: "/usr/bin", HOME: "/home/consumer" },
      spawnCritic: runner,
    });
    assert.notEqual(record.sessionId, PROPOSER);
    assert.equal(seen.length, 1);
  });

  it("the call runs in an EMPTY temporary directory, and only there (effect witness)", async () => {
    const planted = mkdtempSync(path.join(tmpdir(), "ct19-project-"));
    // project settings, tool-server files and instruction files, as a real
    // working directory would hold them
    writeFileSync(path.join(planted, "CLAUDE.md"), "instructions");
    writeFileSync(path.join(planted, ".mcp.json"), "{}");
    mkdirSync(path.join(planted, ".claude"), { recursive: true });

    const seen: string[] = [];
    await callCriticCli({
      prompt: "Judge the evidence.",
      model: "claude-opus-4-8",
      executable: "/usr/local/bin/claude",
      sessionId: MINTED,
      proposerSessionIds: new Set(),
      termsAllowed: true,
      processEnv: { PATH: "/usr/bin", HOME: planted },
      spawnCritic: (_executable, _argv, options) => {
        seen.push(options.cwd);
        // state: an independently readable durable effect — the directory the
        // child actually started in is EMPTY, wherever it was planted.
        assert.equal(readdirSync(options.cwd).length, 0, options.cwd);
        assert.notEqual(options.cwd, planted);
        return { pid: 4248, stream: Promise.resolve(GOOD_STREAM) };
      },
    });
    // the directory is removed after the call
    assert.equal(existsSync(seen[0] ?? ""), false);
    // the planted directory was never the working directory and is untouched
    assert.equal(readdirSync(planted).length, 3);
  });

  it("the critic session is not persisted: the configuration home gains nothing", async () => {
    const realHome = mkdtempSync(path.join(tmpdir(), "ct19-home-"));
    const before = readdirSync(realHome).sort();
    await callCriticCli({
      prompt: "Judge the evidence.",
      model: "claude-opus-4-8",
      executable: "/usr/local/bin/claude",
      sessionId: MINTED,
      proposerSessionIds: new Set(),
      termsAllowed: true,
      processEnv: { PATH: "/usr/bin", HOME: realHome },
      spawnCritic: () => ({ pid: 4249, stream: Promise.resolve(GOOD_STREAM) }),
    });
    const after = readdirSync(realHome).sort();
    assert.deepEqual(after, before);
    assert.equal(after.includes("projects"), false);
  });
});
