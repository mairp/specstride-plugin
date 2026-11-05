// CT for T012 (F125-FR-001) — detection: absolute resolution, the two
// refusals, the version read, the home presence, the tested range.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CLI_FLOOR,
  CLI_PIN,
  EXECUTABLE_NOT_FOUND_CODE,
  HARNESS_STATE,
  VERIFIED_ON,
  detectClaude,
  resolveClaudeExecutable,
  versionIsInRange,
} from "../../src/detect.ts";

const deps = (over: Partial<Parameters<typeof detectClaude>[0]> = {}) => ({
  pathVariable: "/usr/local/bin:/usr/bin",
  workspaceRoot: null,
  statDir: () => ({ worldWritable: false }),
  existsInDir: (dir: string, name: string) => dir === "/usr/local/bin" && name === "claude",
  readVersion: () => "2.1.284 (Claude Code)",
  pathExists: () => true,
  home: "/home/consumer",
  configDirVariable: null,
  ...over,
});

describe("T012 — detection resolves the executable to an absolute path", () => {
  it("the resolved path is absolute, on the consumer's real search path", () => {
    const outcome = detectClaude(deps());
    assert.ok(outcome.ok);
    if (!outcome.ok) return;
    assert.equal(outcome.executablePath, "/usr/local/bin/claude");
    assert.equal(outcome.state, HARNESS_STATE);
  });

  it("an executable not on the search path fails with the result code 127", () => {
    const outcome = detectClaude(deps({ existsInDir: () => false }));
    assert.ok(!outcome.ok);
    if (outcome.ok || !("resultCode" in outcome)) return;
    assert.equal(outcome.resultCode, EXECUTABLE_NOT_FOUND_CODE);
    assert.match(outcome.message, /not found/);
  });

  it("an executable inside the workspace is refused (F125-FR-001)", () => {
    const outcome = detectClaude(
      deps({
        workspaceRoot: "/repo",
        existsInDir: (dir) => dir === "/repo/node_modules/.bin",
      }),
    );
    assert.ok(!outcome.ok);
    if (outcome.ok || !("refusal" in outcome)) return;
    assert.equal(outcome.refusal, "inside-workspace");
    assert.match(outcome.message, /inside the workspace/);
  });

  it("an executable in a world-writable directory is refused (F125-FR-001)", () => {
    const outcome = detectClaude(
      deps({
        statDir: (dir) => ({ worldWritable: dir === "/usr/local/bin" }),
      }),
    );
    assert.ok(!outcome.ok);
    if (outcome.ok || !("refusal" in outcome)) return;
    assert.equal(outcome.refusal, "world-writable-directory");
    assert.match(outcome.message, /writable by everyone/);
  });

  it("a path that changed since the last run gives a warning, not a refusal", () => {
    const resolved = resolveClaudeExecutable(deps({ previousPath: "/opt/claude" }));
    assert.ok(resolved.ok);
    if (!resolved.ok) return;
    assert.match(resolved.changedPathWarning ?? "", /moved from/);
    const same = resolveClaudeExecutable(deps({ previousPath: "/usr/local/bin/claude" }));
    assert.ok(same.ok && same.changedPathWarning === null);
  });
});

describe("T012 — the version read and the home presence", () => {
  it("the version comes from the executable's own version output", () => {
    const outcome = detectClaude(deps());
    assert.ok(outcome.ok && outcome.version === "2.1.284 (Claude Code)");
  });

  it("a probe that does not answer leaves the version null and is not a refusal", () => {
    const outcome = detectClaude(deps({ readVersion: () => null }));
    assert.ok(outcome.ok && outcome.version === null);
  });

  it("the home presence follows CLAUDE_CONFIG_DIR, else <home>/.claude", () => {
    const seen: string[] = [];
    const outcome = detectClaude(
      deps({ configDirVariable: "/tmp/claude-home", pathExists: (p) => (seen.push(p), true) }),
    );
    assert.ok(outcome.ok);
    assert.deepEqual(seen, ["/tmp/claude-home"]);
    assert.equal(outcome.ok && outcome.homePresent, true);

    const defaultHome = detectClaude(deps({ pathExists: () => false }));
    assert.ok(
      defaultHome.ok &&
        defaultHome.configHome === "/home/consumer/.claude" &&
        defaultHome.homePresent === false,
    );
  });
});

describe("T012 — the tested range (F125-FR-003)", () => {
  it("the range is the floor 2.1.259 up to the tested version 2.1.284", () => {
    assert.equal(CLI_FLOOR, "2.1.259");
    assert.equal(CLI_PIN, "2.1.284");
    assert.equal(VERIFIED_ON, "2026-09-29");
    assert.ok(versionIsInRange("2.1.259"));
    assert.ok(versionIsInRange("2.1.284"));
    assert.ok(versionIsInRange("claude 2.1.270"));
    assert.ok(!versionIsInRange("2.1.248"));
    assert.ok(!versionIsInRange("2.2.0"));
  });
});
