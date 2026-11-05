/**
 * T002 of `specs/113-host-claude-code/tasks.md` — the package exists in the
 * workspace with the layout of plan.md.
 *
 * The declaration of `src/layout.ts` is held against the directory tree ON
 * DISK, read back with `node:fs`: the declaration is not the witness, the tree
 * is. A directory plan.md draws that is missing, and a directory of the
 * package that the declaration does not name, are both failures.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTAINER_DIRECTORIES,
  EVERY_DIRECTORY,
  LAYOUT_PATHS,
  PACKAGE_DIRECTORY,
  PACKAGE_LAYER,
  PACKAGE_LAYOUT,
  PACKAGE_NAME,
  PACKAGE_OWNER,
  SHIM_DIRECTORY,
  directoryAt,
} from "../src/layout.ts";

/** The package directory: two levels up from this file. */
const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "../..");

/** The directories plan.md draws under `src/`, which hold TypeScript modules. */
const SOURCE_DIRECTORIES = ["src/describe", "src/render", "src/shim", "src/evals"] as const;

test("T002: every directory of the layout of plan.md is on disk", () => {
  assert.equal(PACKAGE_LAYOUT.length, 10, "plan.md draws ten directories");
  for (const directory of PACKAGE_LAYOUT) {
    const path = join(PKG, directory.path);
    assert.equal(existsSync(path), true, `${PACKAGE_DIRECTORY}/${directory.path} is missing`);
    assert.equal(
      statSync(path).isDirectory(),
      true,
      `${PACKAGE_DIRECTORY}/${directory.path} is not a directory`,
    );
    assert.ok(directory.holds.length > 0, `${directory.path} records nothing it holds`);
    assert.match(directory.filledBy, /^T\d{3}(, T\d{3})*$/, `${directory.path}: filledBy`);
  }
  // The four directories plan.md draws under `plugin/` are the ones that ship.
  assert.deepEqual(
    PACKAGE_LAYOUT.filter((d) => d.shipped).map((d) => d.path),
    ["src/shim", "plugin/.claude-plugin", "plugin/skills", "plugin/hooks", "plugin/bin"],
  );
  assert.equal(directoryAt("src/shim")?.shipped, true);
  assert.equal(directoryAt("no/such/directory"), undefined);
});

test("T002: the declaration names every directory the package holds, and no other", () => {
  // Read the tree back: every directory of `src/` and of `plugin/`, and the two
  // directories at the root of the package that plan.md draws.
  const found: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(PKG, relative), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules") continue;
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      // `test/` holds this file; it is not part of the layout plan.md draws.
      if (path === "test") continue;
      found.push(path);
      walk(path);
    }
  };
  walk("");
  // Every directory of the package is named by the layout or is one of its
  // three branches; and every directory the layout names is on disk.
  assert.deepEqual(
    found.filter((p) => !EVERY_DIRECTORY.includes(p)).sort(),
    [],
    `directories of the package that \`src/layout.ts\` does not name: ${found.join(", ")}`,
  );
  assert.deepEqual([...found].sort(), [...EVERY_DIRECTORY]);
  // The branches carry no file of their own beyond what the layout names.
  assert.deepEqual([...CONTAINER_DIRECTORIES], ["src", "plugin", "tests"]);
  for (const container of CONTAINER_DIRECTORIES) {
    assert.ok(!LAYOUT_PATHS.includes(container), `${container} is a branch, not a leaf`);
  }
});

test("T002: each directory under src/ holds its module, and the shim directory is named", () => {
  for (const directory of SOURCE_DIRECTORIES) {
    const file = join(PKG, directory, "index.ts");
    assert.equal(existsSync(file), true, `${directory}/index.ts is missing`);
    assert.ok(readFileSync(file, "utf8").length > 0, `${directory}/index.ts is empty`);
  }
  // The one directory of `src/` whose modules ship, and therefore import
  // nothing (the rule file RF-113-01 of the import-boundary check).
  assert.equal(SHIM_DIRECTORY, "src/shim");
  assert.ok(LAYOUT_PATHS.includes(SHIM_DIRECTORY));
});

test("T002: the manifest and the package graph agree on name, layer and owner", () => {
  const manifest = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")) as {
    name: string;
    exports: Record<string, string>;
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
  };
  assert.equal(manifest.name, PACKAGE_NAME);
  assert.equal(manifest.name, "@specstride/host-claude-code");
  // The one package it may import (at build time only).
  assert.deepEqual(Object.keys(manifest.dependencies), ["@specstride/contracts"]);
  assert.ok("test" in manifest.scripts, "the package has no test script");
  assert.ok("typecheck" in manifest.scripts, "the package has no typecheck script");

  const graph = JSON.parse(
    readFileSync(join(ROOT, "packages/contracts/data/package-graph.json"), "utf8"),
  ) as { packages: { name: string; layer?: string; owner?: string }[] };
  const entry = graph.packages.find((p) => p.name === PACKAGE_NAME);
  assert.ok(entry !== undefined, `the package graph holds no ${PACKAGE_NAME}`);
  assert.equal(entry.layer, PACKAGE_LAYER);
  assert.equal(entry.layer, "L7");
  assert.equal(entry.owner, PACKAGE_OWNER);
  assert.equal(entry.owner, "113");

  // The package is a workspace package of the root manifest.
  const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    workspaces: string[];
  };
  assert.ok(root.workspaces.includes("packages/*"));
  assert.equal(PACKAGE_DIRECTORY, "packages/host-claude-code");
});
