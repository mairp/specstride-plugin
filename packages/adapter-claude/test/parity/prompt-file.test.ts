// PT-125-C-056-prompt-file (T017) — the prompt file: the logical name, the
// owner-only mode, the as-is name pattern under `parity`, and the removal on
// EVERY ending — normal, error and kill (F125-FR-008; FX-01, FX-06; B-0625).
// Surfaces: transcript (the file name the stub is told), state (the file
// system after the pass).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  PROMPT_FILE_PATTERN,
  STDIN_FILE_VARIABLE,
  promptFileDirectory,
  promptTransferLogicalName,
  removePromptFile,
  writePromptFile,
} from "../../src/invoke-proposer.ts";

describe("PT-125-C-056-prompt-file — the prompt file and its removal (F125-FR-008)", () => {
  it("the logical name is pass:<passId>:prompt-transfer", () => {
    assert.equal(promptTransferLogicalName("pass-7"), "pass:pass-7:prompt-transfer");
  });

  it("the file is written owner-only, with the as-is name pattern, in TMPDIR", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "pt-c056-"));
    const file = writePromptFile({
      passId: "pass-7",
      prompt: "the prompt",
      profile: "parity",
      tempDir,
    });
    assert.equal(path.dirname(file.path), tempDir);
    assert.match(path.basename(file.path), /^specstride-prompt\.[a-z0-9]{6}$/);
    const mode = statSync(file.path).mode & 0o777;
    assert.equal(mode, 0o600, "readable by its owner only");
    removePromptFile(file, "normal");
  });

  it("the name pattern is the as-is pattern of the baseline (B-0625)", () => {
    assert.equal(PROMPT_FILE_PATTERN, "specstride-prompt.XXXXXX");
    assert.equal(promptFileDirectory(null), "/tmp");
    assert.equal(promptFileDirectory("/custom-tmp"), "/custom-tmp");
  });

  it("the removal covers every ending: normal, error and kill", () => {
    for (const ending of ["normal", "error", "kill"] as const) {
      const tempDir = mkdtempSync(path.join(tmpdir(), "pt-c056-end-"));
      const file = writePromptFile({
        passId: "pass-1",
        prompt: "prompt",
        profile: "parity",
        tempDir,
      });
      const result = removePromptFile(file, ending);
      assert.equal(result.ending, ending);
      assert.equal(result.removed, file.path);
      assert.equal(existsSync(file.path), false, `the file survives a ${ending} ending`);
      assert.equal(file.removed, true);
    }
  });

  it("the removal is idempotent: a second call removes nothing", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "pt-c056-idem-"));
    const file = writePromptFile({
      passId: "pass-1",
      prompt: "prompt",
      profile: "parity",
      tempDir,
    });
    removePromptFile(file, "normal");
    const second = removePromptFile(file, "kill");
    assert.equal(second.removed, null);
  });

  it("an empty prompt is refused, never written", () => {
    assert.throws(
      () => writePromptFile({ passId: "p", prompt: "", profile: "parity", tempDir: "/tmp" }),
      (error: Error) => error.name === "PromptFileRefusedError",
    );
  });

  it("the variable the process is told is SPECSTRIDE_STDIN_FILE (parity, FX-06)", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "pt-c056-var-"));
    const file = writePromptFile({
      passId: "pass-2",
      prompt: "prompt",
      profile: "parity",
      tempDir,
    });
    assert.equal(file.variable, STDIN_FILE_VARIABLE);
    assert.equal(STDIN_FILE_VARIABLE, "SPECSTRIDE_STDIN_FILE");
    removePromptFile(file, "normal");
  });
});
