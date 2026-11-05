/**
 * T011 — CT-110-103, CT-110-104 and CT-110-110 (F110-FR-003, F110-FR-004,
 * F110-FR-011).
 *
 * These are integration tests: every case writes real files into a throw-away
 * directory under the system temporary directory and loads them through the real
 * `node:fs` seam. Nothing is asserted from the loader's answer alone — each case
 * reads the durable effect back through an independent path (`readdirSync`,
 * `readFileSync`, a sha-256 of the bytes on disk) and compares. The negative case
 * of the obligation is checked too: a load that looks successful but opened no
 * file is not accepted as proof, so every case asserts the exact paths in
 * `filesRead` and the hash of each.
 *
 * CT-110-103 (F110-FR-003): `schema` with the major 1; the locations of
 * `user:config` and `project:config`; another major refused; no search above the
 * workspace root.
 * CT-110-104 (F110-FR-004): the install-root `.env` is never read; the user file
 * takes its role, which the environment beats.
 * CT-110-110 (F110-FR-011): the control root through `state.dir`.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { rankOfLayer, resolveKey } from "@specstride/contracts/envelope/config";

import {
  CONFIG_SCHEMA_ID,
  CONFIG_SCHEMA_MAJOR,
  ConfigFileError,
  INSTALL_ROOT_ENV_FILE,
  INSTALL_ROOT_ENV_FILE_IS_READ,
  PROJECT_CONFIG_NAME,
  SchemaMajorError,
  USER_CONFIG_NAME,
  environmentBeatsUserFile,
  flattenTree,
  isInstallRootEnvFile,
  loadConfigFiles,
  majorOf,
  projectConfigPath,
  projectSearchDirs,
  userConfigPath,
  type FileEnvironment,
} from "../../src/load/files.ts";
import {
  ControlRootError,
  STATE_DIR_KEY,
  resolveControlRoot,
  stateDirMayBeSetBy,
  stateDirTrustClass,
} from "../../src/load/state-dir.ts";
import { ConfigValueError } from "../../src/schema/types.ts";

const ROOTS: string[] = [];
after(() => {
  for (const root of ROOTS) rmSync(root, { recursive: true, force: true });
});

/** A throw-away machine on disk: a home, a working tree and an install root. */
function machine(): {
  readonly root: string;
  readonly home: string;
  readonly xdgConfigHome: string;
  readonly workspace: string;
  readonly installRoot: string;
  readonly env: FileEnvironment;
} {
  const root = mkdtempSync(join(tmpdir(), "specstride-110-files-"));
  ROOTS.push(root);
  const home = join(root, "home");
  const xdgConfigHome = join(home, "xdg-config");
  const workspace = join(root, "work");
  const installRoot = join(root, "install");
  for (const dir of [home, xdgConfigHome, workspace, installRoot])
    mkdirSync(dir, { recursive: true });
  return {
    root,
    home,
    xdgConfigHome,
    workspace,
    installRoot,
    env: {
      home,
      xdgConfigHome,
      xdgStateHome: join(home, "xdg-state"),
      xdgCacheHome: join(home, "xdg-cache"),
      workspaceRealPath: workspace,
      workspaceId: "ws-1",
      installRoot,
    },
  };
}

/** Write a file, making its directory, and return its path. */
function put(path: string, text: string): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text, "utf8");
  return path;
}

/** The sha-256 of the bytes of a file, read independently of the loader. */
function hashOf(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("CT-110-103 — the locations and the `schema` major of the two files (F110-FR-003)", () => {
  it("the user file is `<user-config>/config.yaml`, honouring the variable of the platform", () => {
    const m = machine();
    assert.equal(userConfigPath(m.env), join(m.xdgConfigHome, "specstride", "config.yaml"));
    // With the variable unset, the same location under the home of the platform.
    const bare: FileEnvironment = { ...m.env, xdgConfigHome: undefined };
    assert.equal(userConfigPath(bare), join(m.home, ".config", "specstride", "config.yaml"));
  });

  it("the project file is `<workspace>/specstride.yaml`", () => {
    const m = machine();
    assert.equal(projectConfigPath(m.env), join(m.workspace, "specstride.yaml"));
  });

  it("reads a user file whose `schema` is the major 1, and the bytes on disk are what was read", () => {
    const m = machine();
    const path = put(
      userConfigPath(m.env),
      [
        "schema: 1",
        "loop:",
        "  maxIter: 10",
        "roles:",
        "  proposer:",
        "    timeoutSec: 60",
        "",
      ].join("\n"),
    );
    const load = loadConfigFiles(m.env);
    assert.ok(load.user !== undefined);
    assert.equal(load.user.major, CONFIG_SCHEMA_MAJOR);
    assert.equal(load.user.logicalName, USER_CONFIG_NAME);
    assert.equal(load.user.layer, "U");
    assert.deepEqual(load.user.errors, []);
    assert.equal(load.user.values.get("loop.maxIter"), 10);
    assert.equal(load.user.values.get("roles.proposer.timeoutSec"), 60);
    // The independent read path: the file the loader says it read exists, is the
    // one at the logical name, and has the bytes the test wrote.
    assert.deepEqual(load.filesRead, [path]);
    assert.ok(readdirSync(join(m.xdgConfigHome, "specstride")).includes("config.yaml"));
    assert.equal(hashOf(path), createHash("sha256").update(readFileSync(path)).digest("hex"));
    assert.match(readFileSync(path, "utf8"), /^schema: 1$/m);
  });

  it("reads the schema id with its major as well as the bare number", () => {
    assert.equal(majorOf(1), 1);
    assert.equal(majorOf("1"), 1);
    assert.equal(majorOf(CONFIG_SCHEMA_ID), 1);
    assert.equal(majorOf("specstride.config/2"), 2);
    assert.equal(majorOf("specstride.lease/1"), undefined);
    assert.equal(majorOf("one"), undefined);
    const m = machine();
    put(userConfigPath(m.env), `schema: ${CONFIG_SCHEMA_ID}\nloop:\n  maxIter: 4\n`);
    const load = loadConfigFiles(m.env);
    assert.equal(load.user?.major, 1);
    assert.equal(load.user?.values.get("loop.maxIter"), 4);
  });

  it("refuses a file with another major, naming the logical name, the major found and the one supported", () => {
    const m = machine();
    const path = put(userConfigPath(m.env), "schema: 2\nloop:\n  maxIter: 10\n");
    assert.throws(
      () => loadConfigFiles(m.env),
      (error: unknown) => {
        assert.ok(error instanceof SchemaMajorError);
        assert.equal(error.logicalName, USER_CONFIG_NAME);
        assert.equal(error.path, path);
        assert.equal(error.found, 2);
        assert.equal(error.supported, 1);
        assert.match(error.message, /`user:config`/);
        assert.match(error.message, /major 1/);
        assert.match(error.message, /major 2/);
        return true;
      },
    );
    // The file is still on disk, untouched: the loader refuses, it does not repair.
    assert.match(readFileSync(path, "utf8"), /^schema: 2$/m);
  });

  it("refuses a file with no `schema` field at all", () => {
    const m = machine();
    put(projectConfigPath(m.env), "loop:\n  maxIter: 3\n");
    assert.throws(
      () => loadConfigFiles(m.env),
      (error: unknown) => {
        assert.ok(error instanceof SchemaMajorError);
        assert.equal(error.logicalName, PROJECT_CONFIG_NAME);
        assert.equal(error.found, undefined);
        assert.match(error.message, /carries no `schema` field/);
        return true;
      },
    );
  });

  it("refuses a file that is not a mapping of keys", () => {
    const m = machine();
    put(userConfigPath(m.env), "- one\n- two\n");
    assert.throws(() => loadConfigFiles(m.env), ConfigFileError);
  });

  it("the project file is never searched above the workspace root", () => {
    const m = machine();
    // A project file above the working tree, which must never be found.
    const above = put(join(m.root, "specstride.yaml"), "schema: 1\nloop:\n  maxIter: 99\n");
    const nested = join(m.workspace, "a", "b");
    mkdirSync(nested, { recursive: true });
    const env: FileEnvironment = { ...m.env, startDir: nested };
    const dirs = projectSearchDirs(env);
    assert.deepEqual(dirs, [nested, join(m.workspace, "a"), m.workspace]);
    for (const dir of dirs) {
      assert.ok(
        dir === m.workspace || dir.startsWith(`${m.workspace}/`),
        `${dir} is above the workspace root`,
      );
    }
    const load = loadConfigFiles(env);
    assert.equal(load.project, undefined, "a file above the working tree was read");
    for (const path of load.filesConsidered) {
      assert.notEqual(path, above, "the loader asked for a file above the working tree");
    }
    // The file above the tree is still there and still says 99: it was simply never read.
    assert.match(readFileSync(above, "utf8"), /maxIter: 99/);
    assert.deepEqual(load.filesRead, []);
  });

  it("finds the project file in a directory between the starting directory and the root", () => {
    const m = machine();
    const middle = join(m.workspace, "a");
    const nested = join(middle, "b");
    mkdirSync(nested, { recursive: true });
    const path = put(join(middle, "specstride.yaml"), "schema: 1\nloop:\n  maxIter: 5\n");
    const load = loadConfigFiles({ ...m.env, startDir: nested });
    assert.ok(load.project !== undefined);
    assert.equal(load.project.path, path);
    assert.equal(load.project.layer, "P");
    assert.equal(load.project.rankLayer, "project-configuration");
    assert.equal(load.project.values.get("loop.maxIter"), 5);
    assert.deepEqual(load.filesRead, [path]);
    assert.equal(hashOf(path), hashOf(load.project.path));
  });

  it("ignores a key under `x-` and refuses an unknown key, naming the file", () => {
    const m = machine();
    const path = put(
      userConfigPath(m.env),
      ["schema: 1", "x-mine:", "  anything: 1", "loop:", "  maxIters: 3", ""].join("\n"),
    );
    const load = loadConfigFiles(m.env);
    assert.ok(load.user !== undefined);
    assert.deepEqual(load.user.ignoredKeys, ["x-mine"]);
    assert.equal(load.user.errors.length, 1);
    assert.match(load.user.errors[0]!.message, /`loop\.maxIters`/);
    assert.match(load.user.errors[0]!.message, /`loop\.maxIter`/);
    assert.match(
      load.user.errors[0]!.message,
      new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });

  it("flattens a nested mapping into the dotted paths of §K.1, keeping a table whole", () => {
    const { values, ignored } = flattenTree({
      loop: { maxIter: 3, parallel: { units: true } },
      budget: { rates: { "claude-opus": 1.5 } },
      "x-mine": { deep: { thing: 1 } },
    });
    assert.equal(values.get("loop.maxIter"), 3);
    assert.equal(values.get("loop.parallel.units"), true);
    assert.deepEqual(values.get("budget.rates"), { "claude-opus": 1.5 });
    assert.deepEqual(ignored, ["x-mine"]);
  });
});

describe("CT-110-104 — the install-root `.env` is never read, and the environment beats the user file (F110-FR-004)", () => {
  it("the loader never asks for the install-root `.env`, even when one is there", () => {
    const m = machine();
    const envFile = put(
      join(m.installRoot, INSTALL_ROOT_ENV_FILE),
      ["SPECSTRIDE_MAX_ITER=99", "SPECSTRIDE_PROPOSER_TIMEOUT=99", ""].join("\n"),
    );
    // One in the working tree too, which the baseline would also have read.
    const inTree = put(join(m.workspace, INSTALL_ROOT_ENV_FILE), "SPECSTRIDE_MAX_ITER=98\n");
    put(userConfigPath(m.env), "schema: 1\nloop:\n  maxIter: 10\n");

    const load = loadConfigFiles(m.env);
    assert.equal(INSTALL_ROOT_ENV_FILE_IS_READ, false);
    // Not read, and not even asked for: the independent record of every path the
    // loader touched holds neither file.
    for (const path of load.filesConsidered) {
      assert.equal(
        isInstallRootEnvFile(path, m.installRoot),
        false,
        `${path} is the install-root .env`,
      );
      assert.doesNotMatch(path, /\.env$/, `${path} is an .env file`);
    }
    assert.equal(load.filesRead.includes(envFile), false);
    assert.equal(load.filesRead.includes(inTree), false);
    // And nothing of theirs reached the values: 10 from the user file, not 99.
    assert.equal(load.user?.values.get("loop.maxIter"), 10);
    assert.equal(load.user?.values.get("roles.proposer.timeoutSec"), undefined);
    // The two files are still on disk with their own bytes: untouched, just unread.
    assert.equal(readFileSync(envFile, "utf8").includes("99"), true);
    assert.deepEqual(load.filesRead, [userConfigPath(m.env)]);
    assert.ok(readdirSync(m.installRoot).includes(INSTALL_ROOT_ENV_FILE));
  });

  it("recognises the install-root `.env` whether the install root is known or not", () => {
    assert.equal(isInstallRootEnvFile("/opt/specstride/.env", "/opt/specstride"), true);
    assert.equal(isInstallRootEnvFile("/opt/specstride/config.yaml", "/opt/specstride"), false);
    assert.equal(isInstallRootEnvFile("/anywhere/.env", undefined), true);
  });

  it("the user file is a machine-wide default that the environment beats", () => {
    assert.equal(environmentBeatsUserFile(), true);
    assert.ok(rankOfLayer["environment"] < rankOfLayer["user-configuration"]);
    const m = machine();
    put(userConfigPath(m.env), "schema: 1\nloop:\n  maxIter: 10\n");
    const load = loadConfigFiles(m.env);
    const fromFile = load.user?.values.get("loop.maxIter");
    assert.equal(fromFile, 10);
    const resolved = resolveKey(
      "loop.maxIter",
      [
        { layer: "user-configuration", value: fromFile },
        { layer: "environment", value: 7 },
      ],
      { class: "tunable" },
    );
    assert.equal(resolved?.value, 7);
    assert.equal(resolved?.source, "environment");
    // With nothing in the environment the user file's value stands.
    const alone = resolveKey("loop.maxIter", [{ layer: "user-configuration", value: fromFile }], {
      class: "tunable",
    });
    assert.equal(alone?.value, 10);
    assert.equal(alone?.source, "user-configuration");
  });

  it("a key of a file that holds a secret value in clear is an error, and the value is not repeated", () => {
    const m = machine();
    put(
      userConfigPath(m.env),
      [
        "schema: 1",
        "roles:",
        "  critic:",
        "    credential: sk-canary-9f3a-not-a-reference",
        "",
      ].join("\n"),
    );
    const load = loadConfigFiles(m.env);
    assert.equal(load.user?.values.get("roles.critic.credential"), undefined);
    assert.equal(load.user?.errors.length, 1);
    const error = load.user?.errors[0];
    assert.ok(error instanceof ConfigValueError);
    assert.equal(error.reason, "inline-secret");
    assert.equal(error.key, "roles.critic.credential");
    assert.doesNotMatch(error.message, /sk-canary/, "the message repeated the secret");
    assert.equal(error.value, "(withheld)");
  });

  it("a reference of §K.7 is accepted where a value in clear is not", () => {
    const m = machine();
    put(
      userConfigPath(m.env),
      ["schema: 1", "roles:", "  critic:", "    credential: env:CANARY_KEY", ""].join("\n"),
    );
    const load = loadConfigFiles(m.env);
    assert.deepEqual(load.user?.errors, []);
    assert.equal(load.user?.values.get("roles.critic.credential"), "env:CANARY_KEY");
  });
});

describe("CT-110-110 — the control root through `state.dir` (F110-FR-011)", () => {
  it("`state.dir` is widening and settable by a flag, the environment and the user file only", () => {
    assert.equal(STATE_DIR_KEY, "state.dir");
    assert.equal(stateDirTrustClass(), "W");
    assert.equal(stateDirMayBeSetBy("F"), true);
    assert.equal(stateDirMayBeSetBy("E"), true);
    assert.equal(stateDirMayBeSetBy("U"), true);
    assert.equal(stateDirMayBeSetBy("P"), false);
  });

  it("a project file that sets `state.dir` is refused", () => {
    const m = machine();
    put(projectConfigPath(m.env), `schema: 1\nstate:\n  dir: ${join(m.root, "elsewhere")}\n`);
    const load = loadConfigFiles(m.env);
    assert.equal(load.project?.values.get("state.dir"), undefined);
    assert.equal(load.project?.errors.length, 1);
    assert.equal((load.project?.errors[0] as ConfigValueError).reason, "layer-not-allowed");
  });

  it("with nothing set, the control root is the user's state directory, keyed by the workspace", () => {
    const m = machine();
    const decision = resolveControlRoot({ env: m.env });
    assert.equal(decision.source, "default");
    assert.equal(decision.path, join(m.home, "xdg-state", "specstride", "workspaces", "ws-1"));
    assert.equal(decision.insideWorkingTree, false);
    assert.equal(decision.protection, "prevent");
    assert.equal(decision.requiresDenyRule, false);
  });

  it("the user file sets it, and the directory it names is the one that is created and read back", () => {
    const m = machine();
    const wanted = join(m.root, "control");
    put(userConfigPath(m.env), `schema: 1\nstate:\n  dir: ${wanted}\n`);
    const load = loadConfigFiles(m.env);
    assert.equal(load.user?.values.get("state.dir"), wanted);
    const decision = resolveControlRoot({
      env: m.env,
      stateDir: { value: load.user?.values.get("state.dir"), layer: "U" },
    });
    assert.equal(decision.path, wanted);
    assert.equal(decision.source, "override");
    assert.equal(decision.setBy, "U");
    // The durable effect, read back independently: the run can make that root and
    // it is the directory the key named, not the default one.
    mkdirSync(decision.path, { recursive: true });
    writeFileSync(
      join(decision.path, "workspace.json"),
      '{"schema":"specstride.layout/1"}\n',
      "utf8",
    );
    assert.ok(readdirSync(wanted).includes("workspace.json"));
    assert.equal(readdirSync(m.root).includes("control"), true);
  });

  it("the environment and a flag set it too", () => {
    const m = machine();
    for (const layer of ["E", "F"] as const) {
      const wanted = join(m.root, `control-${layer}`);
      const decision = resolveControlRoot({ env: m.env, stateDir: { value: wanted, layer } });
      assert.equal(decision.path, wanted);
      assert.equal(decision.setBy, layer);
    }
  });

  it("a value of the wrong type is refused, naming the key, the value and the layer", () => {
    const m = machine();
    assert.throws(
      () => resolveControlRoot({ env: m.env, stateDir: { value: 7, layer: "E" } }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigValueError);
        assert.equal(error.key, "state.dir");
        assert.equal(error.value, 7);
        assert.equal(error.layer, "environment");
        return true;
      },
    );
  });

  it("a control root inside the working tree is refused without the deny rule annex B names", () => {
    const m = machine();
    const inside = join(m.workspace, ".specstride-control");
    assert.throws(
      () => resolveControlRoot({ env: m.env, stateDir: { value: inside, layer: "F" } }),
      (error: unknown) => {
        assert.ok(error instanceof ControlRootError);
        assert.equal(error.path, inside);
        assert.match(error.message, /deny rule for the proposer's harness/);
        return true;
      },
    );
  });

  it("and accepted with it, recording `protection=detect` until the adapter confirms the denial", () => {
    const m = machine();
    const inside = join(m.workspace, ".specstride-control");
    const withRule = resolveControlRoot({
      env: m.env,
      stateDir: { value: inside, layer: "F" },
      denyRuleForProposerHarness: true,
    });
    assert.equal(withRule.path, inside);
    assert.equal(withRule.insideWorkingTree, true);
    assert.equal(withRule.requiresDenyRule, true);
    assert.equal(withRule.protection, "detect");
    const confirmed = resolveControlRoot({
      env: m.env,
      stateDir: { value: inside, layer: "F" },
      denyRuleForProposerHarness: true,
      sandboxDeniesControlPlane: true,
    });
    assert.equal(confirmed.protection, "prevent");
    // The durable effect: with the rule in place the root is usable, and it really
    // does lie inside the working tree that the test made.
    mkdirSync(withRule.path, { recursive: true });
    assert.ok(readdirSync(m.workspace).includes(".specstride-control"));
  });

  it("a file read through the real file system is the only source of the values asserted here", () => {
    // The negative case of the obligation: a load that opened nothing proves
    // nothing, so the suite refuses to accept an empty `filesRead` as evidence.
    const m = machine();
    const empty = loadConfigFiles(m.env);
    assert.deepEqual(empty.filesRead, []);
    assert.equal(empty.user, undefined);
    assert.equal(empty.project, undefined);
    const path = put(userConfigPath(m.env), "schema: 1\nloop:\n  maxIter: 11\n");
    const full = loadConfigFiles(m.env);
    assert.deepEqual(full.filesRead, [path]);
    assert.equal(full.user?.values.get("loop.maxIter"), 11);
    assert.equal(hashOf(path).length, 64);
  });
});
