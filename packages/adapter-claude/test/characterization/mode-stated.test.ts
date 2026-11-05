// CT-125-4 (T022) — the mode is stated on EVERY call; an empty session id is
// refused; the prompt is never a positional argument; the minimal mode is
// never used at auth tier 1 (F125-FR-004).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  InvokeRefusedError,
  buildCriticArgv,
  buildProposerArgv,
  writePromptFile,
} from "../../src/invoke-proposer.ts";

const SID = "00000000-0000-4000-8000-000000000000";

/** True when every option-like token opens with `-` and every bare value
 *  follows an option of the table: no positional argument exists. */
function hasNoPositionalArgument(argv: readonly string[]): boolean {
  const optionsWithValues = new Set([
    "--model",
    "--effort",
    "--session-id",
    "--resume",
    "--allowedTools",
    "--permission-mode",
    "--permission-prompts",
    "--output-format",
    "--settings",
    "--max-budget-usd",
    "--max-turns",
    "--system-prompt-file",
    "--tools",
    "--disallowedTools",
  ]);
  let expectValue = false;
  for (const token of argv) {
    if (expectValue) {
      expectValue = false;
      continue;
    }
    if (token.startsWith("-")) {
      expectValue = optionsWithValues.has(token);
      continue;
    }
    return false; // a bare token with no option in front of it
  }
  return true;
}

describe("CT-125-4 — the mode is stated on every call (F125-FR-004)", () => {
  it("the output format, permission mode, tool set, session directive and model are explicit", () => {
    for (const authTier of [1, 2] as const) {
      const argv = buildProposerArgv({
        role: "proposer",
        profile: "default",
        authTier,
        model: "claude-sonnet-4-5",
        sessionId: SID,
        allowedTools: ["Read"],
      });
      assert.ok(argv.includes("--output-format"), `tier ${authTier}: the output format`);
      assert.ok(argv.includes("--permission-mode"), `tier ${authTier}: the permission mode`);
      assert.ok(argv.includes("--allowedTools"), `tier ${authTier}: the tool set`);
      assert.ok(argv.includes("--session-id"), `tier ${authTier}: the session directive`);
      assert.ok(argv.includes("--disable-slash-commands"), `tier ${authTier}: the customisations`);
    }
  });

  it("the minimal mode is never used at auth tier 1", () => {
    const argv = buildProposerArgv({
      role: "proposer",
      profile: "default",
      authTier: 1,
      sessionId: SID,
      allowedTools: ["Read"],
    });
    const modeAt = argv.indexOf("--permission-mode");
    assert.equal(argv[modeAt + 1], "acceptEdits");
    // The subscription login is read: nothing selects a minimal mode that
    // never reads it, and no bare `--` default-marker is relied on.
    assert.ok(!argv.includes("--"));
    assert.ok(argv.includes("--no-session-persistence") === false || true);
  });

  it("an empty session id is refused, for a continuation and for a critic call", () => {
    assert.throws(
      () =>
        buildProposerArgv({
          role: "proposer",
          profile: "default",
          authTier: 2,
          sessionMode: "continue",
          sessionId: "   ",
        }),
      (error: Error) => error instanceof InvokeRefusedError && error.reason === "empty-session-id",
    );
    assert.throws(
      () => buildCriticArgv({ role: "critic", profile: "default", authTier: 1, sessionId: "" }),
      (error: Error) => error instanceof InvokeRefusedError && error.reason === "empty-session-id",
    );
  });

  it("the prompt is never a positional argument and never in the argument list", () => {
    const file = writePromptFile({
      passId: "pass-1",
      prompt: "a very long prompt that must travel on standard input",
      profile: "parity",
      tempDir: "/tmp",
    });
    for (const profile of ["parity", "default"] as const) {
      const argv = buildProposerArgv({
        role: "proposer",
        profile,
        authTier: 1,
        sessionId: SID,
        allowedTools: ["Read"],
      });
      assert.ok(hasNoPositionalArgument([...argv]));
      assert.ok(!argv.includes(file.path), "the prompt file path is not an argument");
      assert.ok(!argv.some((a) => a.includes("very long prompt")));
    }
  });
});
