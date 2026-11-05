// PT-125-C-058-argument-table (T018) — the argument list is produced through
// the argument table: under `parity` exactly the as-is list (F125-FR-009;
// B-0689, B-0740, B-0742), and the default list maps onto it through the
// same table (DV-031; FX-01, FX-26).
// Surface: transcript.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ARGUMENT_TABLE_PIN,
  STDIN_FILE_VARIABLE,
  argumentTable,
  buildCallEnvironment,
  buildProposerArgv,
} from "../../src/invoke-proposer.ts";
import { runStub } from "../stubs/run-stub.ts";

const AS_IS_LIST = [
  "-p",
  "--dangerously-skip-permissions",
  "--verbose",
  "--disable-slash-commands",
  "--output-format",
  "stream-json",
  "--model",
  "claude-sonnet-4-5",
];

describe("PT-125-C-058-argument-table — the as-is list through the table (F125-FR-009)", () => {
  it("the parity list is exactly the as-is list, in the fixed order", () => {
    const argv = buildProposerArgv({
      role: "proposer",
      profile: "parity",
      authTier: 1,
      streamOn: true,
      model: "claude-sonnet-4-5",
    });
    assert.deepEqual([...argv], AS_IS_LIST);
  });

  it("the table data holds the pin the parity binds (FX-01)", () => {
    assert.deepEqual(ARGUMENT_TABLE_PIN, {
      cli: "2.1.284",
      floor: "2.1.259",
      verifiedOn: "2026-09-29",
    });
    assert.equal(argumentTable.stdinFileVariable, STDIN_FILE_VARIABLE);
  });

  it("the shared flags are added for Claude and only through the table (B-0740)", () => {
    const parity = argumentTable.profiles.parity.entries;
    assert.ok(parity.some((e) => e.argv.includes("--dangerously-skip-permissions")));
    assert.ok(parity.some((e) => e.argv.includes("--verbose")));
  });

  it("the stream flag appears exactly when the stream tap or the JSON output is on (B-0742)", () => {
    const on = buildProposerArgv({
      role: "proposer",
      profile: "parity",
      authTier: 1,
      streamOn: true,
    });
    const off = buildProposerArgv({
      role: "proposer",
      profile: "parity",
      authTier: 1,
      streamOn: false,
    });
    assert.ok(on.includes("--output-format"));
    assert.ok(!off.includes("--output-format"));
  });

  it("the default list maps onto the as-is list through the table (DV-031, FX-26)", () => {
    const parity = buildProposerArgv({
      role: "proposer",
      profile: "parity",
      authTier: 1,
      streamOn: true,
      model: "claude-sonnet-4-5",
    });
    const fallback = buildProposerArgv({
      role: "proposer",
      profile: "default",
      authTier: 1,
      streamOn: true,
      model: "claude-sonnet-4-5",
      sessionId: "00000000-0000-4000-8000-000000000000",
      allowedTools: ["Read", "Grep"],
    });
    // DV-031: the default list maps onto the as-is list through the table.
    // Every entry of the parity section appears in the default list, except
    // the two shared flags, which map to the default profile's own
    // statements: `--dangerously-skip-permissions` maps to the contained
    // mode the default profile states instead, `--output-format stream-json`
    // and `--verbose` are stated there as well.
    const mapped = parity.filter((argument) => argument !== "--dangerously-skip-permissions");
    assert.ok(mapped.every((argument) => fallback.includes(argument)));
    assert.equal(fallback[fallback.indexOf("--permission-mode") + 1], "acceptEdits");
    // The default list adds only what the table's default section states.
    assert.ok(fallback.includes("--permission-mode"));
    assert.ok(fallback.includes("--session-id"));
  });

  it("the transcript of the stub carries the parity list under FX-01", async () => {
    const recordDir = mkdtempSync(path.join(tmpdir(), "pt-c058-"));
    const env = buildCallEnvironment({
      role: "proposer",
      profile: "parity",
      authTier: 1,
      processEnv: {
        PATH: "/usr/bin:/bin",
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        HOME: "/home/consumer",
        [STDIN_FILE_VARIABLE]: "/tmp/specstride-prompt.abc123",
      },
    });
    const transcript = await runStub({
      argv: [
        ...buildProposerArgv({
          role: "proposer",
          profile: "parity",
          authTier: 1,
          streamOn: true,
          model: "claude-sonnet-4-5",
        }),
      ],
      env,
      recordDir,
    });
    assert.deepEqual(transcript.argv, AS_IS_LIST);
  });
});
