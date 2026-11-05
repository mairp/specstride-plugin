// PT-125-C-058-tap-label and PT-125-C-058-no-metadata (T020) — the label the
// reader and the compatibility projection are given is
// `SPECSTRIDE_BACKEND_LABEL` where set, else `claude`; a pass gets an
// invocation directory and NEVER an invocation metadata record
// (F125-FR-011; B-0744, B-0745; FX-01, FX-26; DV-064 waives the locally
// registered backend).
// Surfaces: events (the label handed to the reader), state (the invocation
// context), stdout (the environment the stub records).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BACKEND_LABEL_VARIABLE,
  DEFAULT_BACKEND_LABEL,
  INVOCATION_METADATA_RECORD,
  STDIN_FILE_VARIABLE,
  backendLabel,
  buildCallEnvironment,
  invocationDirectory,
} from "../../src/invoke-proposer.ts";
import { runStub } from "../stubs/run-stub.ts";

describe("PT-125-C-058-tap-label — the harness label (F125-FR-011)", () => {
  it("the label defaults to `claude` (B-0744)", () => {
    assert.equal(backendLabel({}), DEFAULT_BACKEND_LABEL);
    assert.equal(DEFAULT_BACKEND_LABEL, "claude");
  });

  it("the as-is variable overrides the label where set", () => {
    assert.equal(backendLabel({ [BACKEND_LABEL_VARIABLE]: "prime" }), "prime");
    assert.equal(backendLabel({ [BACKEND_LABEL_VARIABLE]: "" }), "claude");
  });

  it("the label reaches the started process through the environment (FX-26)", async () => {
    const recordDir = mkdtempSync(path.join(tmpdir(), "pt-c058-label-"));
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
      argv: ["-p", "--dangerously-skip-permissions", "--verbose"],
      env: { ...env, [BACKEND_LABEL_VARIABLE]: DEFAULT_BACKEND_LABEL },
      recordDir,
    });
    // events: the reader of the pass is told the label `claude`.
    assert.equal(transcript.env.SPECSTRIDE_BACKEND_LABEL, "claude");
  });
});

describe("PT-125-C-058-no-metadata — no invocation metadata record (F125-FR-011)", () => {
  it("the invocation context carries a directory and no metadata record (B-0745)", () => {
    const invocation = invocationDirectory("/workspace/run");
    assert.equal(invocation.cwd, "/workspace/run");
    assert.equal(invocation.metadataRecord, INVOCATION_METADATA_RECORD);
    assert.equal(INVOCATION_METADATA_RECORD, null);
  });

  it("no metadata-record variable is ever in the environment of a pass", async () => {
    const recordDir = mkdtempSync(path.join(tmpdir(), "pt-c058-meta-"));
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
        SPECSTRIDE_INVOCATION_METADATA: "/should/never/be/inherited",
      },
    });
    const transcript = await runStub({
      argv: ["-p"],
      env,
      recordDir,
    });
    const metadataNames = transcript.envNames.filter((name) =>
      name.startsWith("SPECSTRIDE_INVOCATION"),
    );
    assert.deepEqual(metadataNames, [], "the finalizer path must never be taken for Claude");
  });
});
