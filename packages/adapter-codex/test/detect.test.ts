/**
 * T011 / CT-131-2 — detection (F131-FR-002).
 *
 * Presence, version and the configuration home are established free of
 * charge: the version command of the harness and nothing that changes state.
 * The executable resolves to an absolute path and is recorded with its
 * version; a version outside the tested range `>=0.153.4 <0.154` warns; each
 * pass records the version and a change between two passes of one run warns;
 * nothing is downloaded to reach a pin.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import {
  CODEX_VERSION_COMMAND,
  CODEX_VERSION_RANGE,
  detectCodex,
  parseCodexVersion,
  resolveOnPath,
  versionChangeWarning,
  VERSION_CHANGE_WARNING,
  codexVersionInRange,
} from "../src/detect.ts";

/** A runner that answers `codex --version` without starting a process. */
function fakeRunner(version: string | null) {
  const invocations: { path: string; args: readonly string[] }[] = [];
  return {
    invocations,
    run: (path: string, args: readonly string[]) => {
      invocations.push({ path, args });
      if (version === null) return { code: 1, stdout: "" };
      return { code: 0, stdout: `codex-cli ${version}\n` };
    },
  };
}

test("CT-131-2: detection resolves the executable to an absolute path with its version", () => {
  const fake = fakeRunner("0.153.4");
  const dir = "/usr/local/bin";
  const detection = detectCodex({
    env: { PATH: dir, HOME: "/home/consumer" },
    runVersion: fake.run,
    resolve: (name) => join(dir, name),
    configHomeExists: () => true,
  });
  assert.equal(detection.present, true);
  assert.equal(detection.path, join(dir, "codex"));
  assert.ok(detection.path !== null && (detection.path as string).startsWith("/"));
  assert.equal(detection.version, "0.153.4");
  assert.equal(detection.inRange, true);
  assert.equal(detection.configHome, "/home/consumer/.codex");
  assert.equal(detection.versionWarning, null);
});

test("CT-131-2: detection reads the configuration home from CODEX_HOME when it is set", () => {
  const fake = fakeRunner("0.153.4");
  const detection = detectCodex({
    env: { PATH: "/usr/bin", HOME: "/home/consumer", CODEX_HOME: "/home/consumer/state/codex" },
    runVersion: fake.run,
    resolve: () => "/usr/bin/codex",
    configHomeExists: () => true,
  });
  assert.equal(detection.configHome, "/home/consumer/state/codex");
});

test("CT-131-2: a version outside the tested range is flagged for the doctor's warning", () => {
  for (const outside of ["0.152.9", "0.154.0", "1.0.0"]) {
    const detection = detectCodex({
      env: { PATH: "/usr/bin" },
      runVersion: fakeRunner(outside).run,
      resolve: () => "/usr/bin/codex",
      configHomeExists: () => false,
    });
    assert.equal(detection.inRange, false, outside);
    assert.match(detection.versionWarning ?? "", new RegExp(outside.replace(".", "\\.")));
    assert.match(
      detection.versionWarning ?? "",
      new RegExp(CODEX_VERSION_RANGE.replace(".", "\\.")),
    );
  }
});

test("CT-131-2: the version is recorded per pass and a change between two passes warns", () => {
  assert.equal(versionChangeWarning("0.153.4", "0.153.4"), null);
  assert.equal(versionChangeWarning(null, "0.153.4"), null);
  assert.equal(versionChangeWarning("0.153.4", null), null);
  assert.equal(versionChangeWarning("0.153.4", "0.153.5"), VERSION_CHANGE_WARNING);
});

test("CT-131-2: no download — detection starts the version command and nothing else", () => {
  const fake = fakeRunner("0.153.4");
  const detection = detectCodex({
    env: { PATH: "/usr/bin" },
    runVersion: fake.run,
    resolve: () => "/usr/bin/codex",
    configHomeExists: () => true,
  });
  assert.deepEqual(
    fake.invocations.map((invocation) => invocation.args),
    [["--version"]],
  );
  assert.deepEqual(detection.invocations, [{ path: "/usr/bin/codex", args: ["--version"] }]);
  assert.deepEqual([...CODEX_VERSION_COMMAND], ["--version"]);
  // The version command is a read-only call of the harness, not an install:
  // no argument of the one recorded invocation downloads or installs anything.
  for (const invocation of fake.invocations) {
    for (const arg of invocation.args) {
      assert.match(arg, /^--version$/, `unexpected argument: ${arg}`);
    }
  }
});

test("CT-131-2: a missing executable, a failed version read and an unknown version are not a pin", () => {
  const absent = detectCodex({
    env: { PATH: "/nonexistent" },
    runVersion: fakeRunner("0.153.4").run,
  });
  assert.equal(absent.present, false);
  assert.equal(absent.path, null);
  assert.equal(absent.version, null);
  assert.equal(absent.inRange, false);

  const silent = detectCodex({
    env: { PATH: "/usr/bin" },
    runVersion: () => null,
    resolve: () => "/usr/bin/codex",
  });
  assert.equal(silent.version, null);
  assert.equal(silent.inRange, false);

  const unparseable = detectCodex({
    env: { PATH: "/usr/bin" },
    runVersion: () => ({ code: 0, stdout: "codex, some build" }),
    resolve: () => "/usr/bin/codex",
  });
  assert.equal(unparseable.version, null);
});

test("CT-131-2: the range comparator and the search-path resolver behave as recorded", () => {
  assert.equal(codexVersionInRange("0.153.4"), true);
  assert.equal(codexVersionInRange("0.153.99"), true);
  assert.equal(codexVersionInRange("v0.153.4"), true);
  assert.equal(codexVersionInRange("0.153.3"), false);
  assert.equal(codexVersionInRange("0.154.0"), false);
  assert.equal(codexVersionInRange(null), false);
  assert.deepEqual(parseCodexVersion("0.153"), [0, 153, 0]);

  const seen: string[] = [];
  const found = resolveOnPath("codex", { PATH: "/a:/b" }, (candidate) => {
    seen.push(candidate);
    return candidate === "/b/codex";
  });
  assert.equal(found, "/b/codex");
  assert.deepEqual(seen, ["/a/codex", "/b/codex"]);
});
