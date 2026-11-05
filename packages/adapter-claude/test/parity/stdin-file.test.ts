// PT-125-C-052-stdin-file (T016) — under `parity` the prompt reaches the CLI
// on standard input from a file, named by `SPECSTRIDE_STDIN_FILE`, exactly as
// the baseline names it (F125-FR-007; FX-01 `harness-claude`; B-0522).
// Surfaces: transcript (argument list, environment names, stdin file), exit.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  PARITY_ENV_ALLOW,
  STDIN_FILE_VARIABLE,
  buildCallEnvironment,
  buildProposerArgv,
  removePromptFile,
  writePromptFile,
} from "../../src/invoke-proposer.ts";
import { runStub } from "../stubs/run-stub.ts";

const BASE_ENV: Record<string, string> = {
  PATH: "/usr/bin:/bin",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  HOME: "/home/consumer",
};

const PROMPT = "Repair the failing unit; the evidence file names the criterion.";
const AS_IS_LIST = [
  "-p",
  "--dangerously-skip-permissions",
  "--verbose",
  "--disable-slash-commands",
  "--model",
  "claude-sonnet-4-5",
];

describe("PT-125-C-052-stdin-file — the stdin file under `parity` (F125-FR-007)", () => {
  it("the argument list is exactly the as-is list, in order, through the argument table", () => {
    const argv = buildProposerArgv({
      role: "proposer",
      profile: "parity",
      authTier: 1,
      model: "claude-sonnet-4-5",
    });
    assert.deepEqual([...argv], AS_IS_LIST);
  });

  it("the transcript of the stub carries the variable and the file with the prompt (FX-01)", async () => {
    const recordDir = mkdtempSync(path.join(tmpdir(), "pt-052-record-"));
    const tempDir = mkdtempSync(path.join(tmpdir(), "pt-052-tmp-"));
    const file = writePromptFile({
      passId: "pass-1",
      prompt: PROMPT,
      profile: "parity",
      tempDir,
    });
    const env = buildCallEnvironment({
      role: "proposer",
      profile: "parity",
      authTier: 1,
      processEnv: { ...BASE_ENV, [STDIN_FILE_VARIABLE]: file.path },
    });
    const transcript = await runStub({
      argv: [
        ...buildProposerArgv({
          role: "proposer",
          profile: "parity",
          authTier: 1,
          model: "claude-sonnet-4-5",
        }),
      ],
      env,
      recordDir,
    });

    // exit: the stub ended 0, as the baseline's exit surface reads.
    // transcript: the as-is list, byte for byte, in order.
    assert.deepEqual(transcript.argv, AS_IS_LIST);
    assert.equal(transcript.env.SPECSTRIDE_STDIN_FILE, file.path);
    assert.ok(transcript.stdinFile, "the stub was told the stdin file");
    assert.equal(transcript.stdinFile?.variable, STDIN_FILE_VARIABLE);
    assert.equal(transcript.stdinFile?.exists, true);
    assert.equal(transcript.stdinFile?.content, PROMPT);
    // state: the environment names are exactly the parity allow-list plus
    // the recorder's own variable — nothing else leaks (F125-FR-020).
    const names = transcript.envNames.filter((n) => n !== "CLAUDE_STUB_RECORD_DIR");
    assert.deepEqual(names.sort(), [...PARITY_ENV_ALLOW].sort());
  });

  it("the prompt file is gone after the pass ends (F125-FR-008)", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "pt-052-rm-"));
    const file = writePromptFile({
      passId: "pass-1",
      prompt: PROMPT,
      profile: "parity",
      tempDir,
    });
    assert.equal(existsSync(file.path), true);
    removePromptFile(file, "normal");
    assert.equal(existsSync(file.path), false);
  });
});
