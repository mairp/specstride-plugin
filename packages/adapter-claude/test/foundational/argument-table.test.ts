// CT for T013 (F125-FR-009, F125-FR-012 to F125-FR-014, F125-FR-023) — the
// argument table as data and the builders for `parity`, the default profile
// and the roles.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  InvokeRefusedError,
  argumentTable,
  buildCriticArgv,
  buildProposerArgv,
  carriesNoSessionContinuation,
} from "../../src/invoke-proposer.ts";

const base = {
  role: "proposer" as const,
  profile: "default" as const,
  authTier: 1 as const,
  model: "claude-sonnet-4-5",
  effort: "medium",
  sessionId: "11111111-1111-4111-8111-111111111111",
  allowedTools: ["Read", "Edit"],
};

describe("T013 — the profile `parity` builds the as-is list (F125-FR-009)", () => {
  it("the order and content are exactly the baseline's, when every condition holds", () => {
    const argv = buildProposerArgv({
      role: "proposer",
      profile: "parity",
      authTier: 1,
      model: "claude-sonnet-4-5",
      streamOn: true,
      proposerSkills: false,
    });
    assert.deepEqual(argv, [
      "-p",
      "--dangerously-skip-permissions",
      "--verbose",
      "--disable-slash-commands",
      "--output-format",
      "stream-json",
      "--model",
      "claude-sonnet-4-5",
    ]);
  });

  it("`--disable-slash-commands` drops out when the consumer opted the skills in", () => {
    const argv = buildProposerArgv({
      role: "proposer",
      profile: "parity",
      authTier: 1,
      proposerSkills: true,
    });
    assert.ok(!argv.includes("--disable-slash-commands"));
  });

  it("no model named: no `--model` entry; no stream asked: no `--output-format`", () => {
    const argv = buildProposerArgv({ role: "proposer", profile: "parity", authTier: 1 });
    assert.ok(!argv.includes("--model"));
    assert.ok(!argv.includes("--output-format"));
  });

  it("the parity list carries no session argument and no memory or trace addition", () => {
    const argv = buildProposerArgv({
      role: "proposer",
      profile: "parity",
      authTier: 1,
      sessionId: "x",
      sessionMode: "continue",
    });
    assert.ok(!argv.some((a) => a === "--session-id" || a === "--resume" || a === "--continue"));
    assert.equal(argumentTable.profiles.parity.sessionArgv, null);
    assert.equal(argumentTable.profiles.parity.memoryEnv, null);
  });
});

describe("T013 — the default profile, proposer (F125-FR-012 to F125-FR-014)", () => {
  it("at auth tier 1 the call states accept-edits, the allow list, no prompts, safe mode and a minted session id, and persists no session", () => {
    const argv = buildProposerArgv(base);
    for (const expected of [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      "claude-sonnet-4-5",
      "--effort",
      "medium",
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      "Read,Edit",
      "--permission-prompts",
      "none",
      "--safe-mode",
      "--strict-mcp-config",
      "--session-id",
      base.sessionId,
      "--no-session-persistence",
    ]) {
      assert.ok(argv.includes(expected), `expected ${expected} in ${JSON.stringify(argv)}`);
    }
  });

  it("at auth tier 1 a continuation is refused: continuation is not in force there", () => {
    assert.throws(
      () => buildProposerArgv({ ...base, sessionMode: "continue" }),
      (err: unknown) => err instanceof InvokeRefusedError && err.reason === "empty-session-id",
    );
  });

  it("at auth tier 2 a later pass continues by its minted id, never by the newest conversation", () => {
    const argv = buildProposerArgv({ ...base, authTier: 2, sessionMode: "continue" });
    const at = argv.indexOf("--resume");
    assert.notEqual(at, -1);
    assert.equal(argv[at + 1], base.sessionId);
    assert.ok(carriesNoSessionContinuation(argv.filter((a, i) => i < at || i > at + 1)));
    assert.ok(!argv.includes("--continue"));
    assert.ok(!argv.includes("--no-session-persistence"));
  });

  it("an empty session id for a continuation is refused (F125-FR-004)", () => {
    assert.throws(
      () => buildProposerArgv({ ...base, authTier: 2, sessionMode: "continue", sessionId: "  " }),
      (err: unknown) => err instanceof InvokeRefusedError && err.reason === "empty-session-id",
    );
  });

  it("the bypass mode is refused without the detected precondition, with no silent fallback", () => {
    assert.throws(
      () =>
        buildProposerArgv({
          ...base,
          consumerBypass: true,
          bypassPrecondition: { sandbox: true, userIsRoot: true },
        }),
      (err: unknown) => err instanceof InvokeRefusedError && err.reason === "bypass-precondition",
    );
    assert.throws(() => buildProposerArgv({ ...base, consumerBypass: true }), InvokeRefusedError);
    // with the precondition it is built, and never by the adapter alone
    const argv = buildProposerArgv({
      ...base,
      consumerBypass: true,
      bypassPrecondition: { sandbox: true, userIsRoot: false },
    });
    assert.ok(argv.includes("--dangerously-skip-permissions"));
    const withoutChoice = buildProposerArgv(base);
    assert.ok(!withoutChoice.includes("--dangerously-skip-permissions"));
  });

  it("at containment C2 the sandbox settings travel with the call; below it they do not", () => {
    const withSandbox = buildProposerArgv({ ...base, containmentC2: true });
    const at = withSandbox.indexOf("--settings");
    assert.notEqual(at, -1);
    assert.match(withSandbox[at + 1] ?? "", /"enabled"\s*:\s*true/);
    assert.ok(!buildProposerArgv(base).includes("--settings"));
  });
});

describe("T013 — the critic role at auth tier 1 (F125-FR-023)", () => {
  const critic = {
    role: "critic" as const,
    profile: "default" as const,
    authTier: 1 as const,
    model: "claude-opus-4-5",
    sessionId: "22222222-2222-4222-8222-222222222222",
    budgetUsd: 0.5,
  };

  it("the critic call carries no tool, one turn, a mode that denies and never asks, and a minted session id", () => {
    const argv = buildCriticArgv(critic);
    for (const expected of [
      "--tools",
      "",
      "--disallowedTools",
      "mcp__*",
      "--strict-mcp-config",
      "--safe-mode",
      "--session-id",
      critic.sessionId,
      "--no-session-persistence",
      "--max-budget-usd",
      "0.5",
      "--max-turns",
      "1",
      "--permission-mode",
      "dontAsk",
      "--permission-prompts",
      "none",
    ]) {
      assert.ok(argv.includes(expected), `expected ${expected}`);
    }
    assert.ok(carriesNoSessionContinuation(argv));
  });

  it("no argument of the never list ever appears on a critic call", () => {
    const argv = buildCriticArgv(critic);
    for (const forbidden of argumentTable.never) {
      assert.ok(!argv.includes(forbidden), forbidden);
    }
    assert.ok(!argv.includes("--dangerously-skip-permissions"));
  });

  it("a critic call without its minted session id is refused", () => {
    assert.throws(
      () => buildCriticArgv({ ...critic, sessionId: null as unknown as string }),
      InvokeRefusedError,
    );
  });

  it("the critic's system prompt file is on the call only where feature 117 supplies one", () => {
    const withPrompt = buildCriticArgv({ ...critic, criticSystemPromptFile: "/tmp/critic.md" });
    const at = withPrompt.indexOf("--system-prompt-file");
    assert.equal(withPrompt[at + 1], "/tmp/critic.md");
    assert.ok(!buildCriticArgv(critic).includes("--system-prompt-file"));
  });
});
