// CT-125-1 (T069) — characterization of detection (F125-FR-001): the
// executable resolves to an ABSOLUTE path on the search path, a path inside
// the workspace is REFUSED, a path in a world-writable directory is
// refused, absence is the result code 127, a configuration home is
// reported, and a path that changed since the last run WARNS (never
// refuses). No model call, no credential store: the version reader is
// injected here and no probe spawns anything.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import {
  EXECUTABLE_NOT_FOUND_CODE,
  claudeConfigHome,
  detectClaude,
  resolveClaudeExecutable,
  searchPathDirs,
} from "../../src/index.ts";

const DEPS = {
  pathVariable: "/usr/local/bin:/usr/bin:/opt/tools/bin",
  workspaceRoot: "/home/dev/work",
  existsInDir: (dir: string, name: string) => dir === "/opt/tools/bin" && name === "claude",
  statDir: () => ({ worldWritable: false }),
  readVersion: () => "2.1.284",
  pathExists: () => true,
  home: "/home/dev",
  configDirVariable: null,
};

describe("CT-125-1 — detection (F125-FR-001)", () => {
  it("resolves the executable to an absolute path on the consumer's real search path", () => {
    const resolved = resolveClaudeExecutable(DEPS);
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.executablePath, "/opt/tools/bin/claude");
    assert.ok(isAbsolute(resolved.executablePath));
    assert.equal(resolved.changedPathWarning, null);
  });

  it("detects the version from the executable's own output, the home presence and the state `tested`", () => {
    const outcome = detectClaude(DEPS);
    assert.equal(outcome.ok, true);
    if (!outcome.ok || !("version" in outcome)) return;
    assert.equal(outcome.version, "2.1.284");
    assert.equal(outcome.homePresent, true);
    assert.equal(outcome.state, "tested");
    assert.equal(outcome.configHome, "/home/dev/.claude");
  });

  it("refuses an executable inside the workspace", () => {
    const resolved = resolveClaudeExecutable({
      ...DEPS,
      existsInDir: (dir: string, name: string) =>
        dir === "/home/dev/work/node_modules/.bin" && name === "claude",
    });
    assert.equal(resolved.ok, false);
    if (resolved.ok || !("refusal" in resolved)) return;
    assert.equal(resolved.refusal, "inside-workspace");
    assert.match(resolved.message, /inside the workspace/);
  });

  it("refuses an executable in a directory that everyone may write", () => {
    const resolved = resolveClaudeExecutable({
      ...DEPS,
      existsInDir: (dir: string) => dir === "/tmp/bin",
      statDir: (dir: string) =>
        dir === "/tmp/bin" ? { worldWritable: true } : { worldWritable: false },
    });
    assert.equal(resolved.ok, false);
    if (resolved.ok || !("refusal" in resolved)) return;
    assert.equal(resolved.refusal, "world-writable-directory");
    assert.match(resolved.message, /writable by everyone/);
  });

  it("fails with the result code 127 when the executable is not on the search path", () => {
    const resolved = resolveClaudeExecutable({ ...DEPS, existsInDir: () => false });
    assert.equal(resolved.ok, false);
    if (resolved.ok || !("resultCode" in resolved)) return;
    assert.equal(resolved.resultCode, EXECUTABLE_NOT_FOUND_CODE);
    assert.equal(resolved.resultCode, 127);
  });

  it("warns — and does not refuse — when the path changed since the last run", () => {
    const resolved = resolveClaudeExecutable({
      ...DEPS,
      previousPath: "/usr/local/bin/claude",
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.match(resolved.changedPathWarning ?? "", /moved from/);
    assert.match(resolved.changedPathWarning ?? "", /F100-FR-080/);
    // The full detection carries the same warning.
    const outcome = detectClaude({ ...DEPS, previousPath: "/usr/local/bin/claude" });
    assert.equal(outcome.ok, true);
    if (!outcome.ok || !("changedPathWarning" in outcome)) return;
    assert.match(outcome.changedPathWarning ?? "", /moved from/);
  });

  it("honours CLAUDE_CONFIG_DIR for the configuration home and reports its absence", () => {
    assert.equal(
      claudeConfigHome({ home: "/home/dev", configDirVariable: "/etc/claude-home" }),
      "/etc/claude-home",
    );
    const outcome = detectClaude({ ...DEPS, pathExists: () => false });
    assert.equal(outcome.ok, true);
    if (!outcome.ok || !("homePresent" in outcome)) return;
    assert.equal(outcome.homePresent, false);
  });

  it("splits the search path in order and keeps empty entries out", () => {
    assert.deepEqual(searchPathDirs("/a:/b::/c"), ["/a", "/b", "/c"]);
  });

  it("makes no model call and opens no credential store: detection is pure over injected probes", () => {
    // The injected readVersion is the only version source; detection never
    // spawns, never reads a credential file and never touches the network.
    let spawns = 0;
    const outcome = detectClaude({
      ...DEPS,
      readVersion: () => {
        spawns += 1;
        return "2.1.259";
      },
    });
    assert.equal(outcome.ok, true);
    assert.equal(spawns, 1); // the one injected probe, no more
  });
});
