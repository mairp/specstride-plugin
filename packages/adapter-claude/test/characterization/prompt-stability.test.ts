// CT-125-16 (T026) — the prompt is handed on unchanged and nothing volatile
// precedes it; the git-instructions switch stays unset (F125-FR-022; DV-094).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GIT_INSTRUCTIONS_SWITCH,
  STDIN_FILE_VARIABLE,
  buildCallEnvironment,
  buildProposerArgv,
  removePromptFile,
  writePromptFile,
} from "../../src/invoke-proposer.ts";

const PROMPT = [
  "You are the proposer of a Specstride pass.",
  "Repair the failing unit; the evidence names the criterion.",
  "",
].join("\n");

describe("CT-125-16 — prompt stability (F125-FR-022)", () => {
  it("the prompt is written to the file unchanged, byte for byte", () => {
    const file = writePromptFile({
      passId: "pass-1",
      prompt: PROMPT,
      profile: "parity",
      tempDir: "/tmp",
    });
    try {
      assert.equal(readFileSync(file.path, "utf8"), PROMPT);
    } finally {
      removePromptFile(file, "normal");
    }
  });

  it("nothing volatile precedes the prompt: the file starts with the prompt itself", () => {
    const file = writePromptFile({
      passId: "pass-2",
      prompt: PROMPT,
      profile: "parity",
      tempDir: "/tmp",
    });
    try {
      const content = readFileSync(file.path, "utf8");
      assert.ok(content.startsWith("You are the proposer"), "no preamble precedes the prompt");
      assert.ok(!/^\s*\{/.test(content), "no volatile record precedes the prompt");
    } finally {
      removePromptFile(file, "normal");
    }
  });

  it("nothing volatile precedes the prompt in what the process reads", () => {
    // Under `parity` the environment carries nothing volatile (no trace
    // parent), so the first thing of the pass the CLI reads is the prompt.
    const env = buildCallEnvironment({
      role: "proposer",
      profile: "parity",
      authTier: 1,
      processEnv: {
        PATH: "/usr/bin:/bin",
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        HOME: "/home/consumer",
        TRACEPARENT: "00-trace-span-01",
        [STDIN_FILE_VARIABLE]: "/tmp/specstride-prompt.abc123",
      },
    });
    assert.ok(!("TRACEPARENT" in env), "the trace parent never precedes the prompt");
    assert.deepEqual(Object.keys(env).sort(), [
      "HOME",
      "LANG",
      "LC_ALL",
      "PATH",
      STDIN_FILE_VARIABLE,
    ]);
  });

  it("the git-instructions switch stays unset for every call (DV-094)", () => {
    assert.equal(GIT_INSTRUCTIONS_SWITCH, null);
    for (const profile of ["parity", "default"] as const) {
      for (const authTier of [1, 2] as const) {
        const argv = buildProposerArgv({
          role: "proposer",
          profile,
          authTier,
          sessionId: "00000000-0000-4000-8000-000000000000",
          allowedTools: ["Read"],
        });
        assert.ok(
          !argv.some((argument) => /git/i.test(argument)),
          `${profile} at tier ${authTier}: no git-instructions argument`,
        );
      }
    }
  });
});
