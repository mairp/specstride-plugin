/**
 * T001 — the package `@specstride/layer-parallel` and the module group
 * `packages/core/src/parallel/` exist, and the import rules of the package
 * graph hold over both.
 *
 * The authority is `packages/contracts/data/package-graph.json`, which the
 * root script `check:imports` reads. This test observes the two places
 * through an independent read path — the file system and that graph, not the
 * command that created them — and records the content hash of every file it
 * judges.
 *
 * The rules checked here, as the graph states them:
 *
 * - LR-1: a package imports only what `mayImport` lists. Both entries list
 *   `@specstride/contracts` and `@specstride/kernel` and nothing else.
 * - The core rule (F100-FR-012, F100-FR-234): a package marked `core` does
 *   not import `node:fs` or `node:fs/promises`, nor `node:child_process`,
 *   `node:net`, `node:http`, `node:https` or a provider SDK, and names no
 *   implementation of an extension point.
 * - A core package reaches an edge package only through its interface in
 *   `@specstride/contracts`, never by importing it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { CORE_MODULE_GROUP, MAY_IMPORT, PACKAGE_LAYER, PACKAGE_NAME } from "../src/index.ts";
import {
  MAY_IMPORT as CORE_MAY_IMPORT,
  MODULE_GROUP,
  MODULE_GROUP_FEATURES,
} from "../../core/src/parallel/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url)); // packages/layer-parallel/test
const PKG = dirname(HERE); // packages/layer-parallel
const ROOT = dirname(dirname(PKG)); // the repository root
const GRAPH = join(ROOT, "packages/contracts/data/package-graph.json");

type GraphEntry = {
  name: string;
  layer?: string;
  owner?: string;
  core?: boolean;
  mayImport?: string[];
  forbidden?: string[];
  edge?: boolean;
  nodeBuiltins?: boolean;
  note?: string;
};

const graph = JSON.parse(readFileSync(GRAPH, "utf8")) as {
  packages: GraphEntry[];
  rules: string[];
};

const entryOf = (name: string): GraphEntry => {
  const entry = graph.packages.find((p) => p.name === name);
  assert.ok(entry !== undefined, `${name} has an entry in the package graph`);
  return entry;
};

const sha256 = (file: string): string =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

/** Every TypeScript source file under a directory, recursively. */
function sources(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string): void => {
    for (const e of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        walk(full);
      } else if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(e.name)) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out.sort();
}

/** The specifier of every static and dynamic import of a source file. */
function importSpecifiers(file: string): string[] {
  const text = readFileSync(file, "utf8");
  // The comments are stripped first, so a module named in prose (this file's
  // own header, for one) is not read as an import.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const out: string[] = [];
  for (const re of [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]) {
    for (const m of code.matchAll(re)) out.push(m[1] as string);
  }
  return out;
}

const rel = (file: string): string => relative(ROOT, file).split(sep).join("/");

/** The built-ins and the package kinds the core rule forbids. */
const FORBIDDEN_BUILTINS = [
  "node:fs",
  "node:fs/promises",
  "node:child_process",
  "node:net",
  "node:http",
  "node:https",
  "node:dgram",
];

/* ------------------------------------------------------------------ *
 * The package
 * ------------------------------------------------------------------ */

test("T001: packages/layer-parallel is a package of the workspace, filled by this feature", () => {
  const manifestPath = join(PKG, "package.json");
  assert.ok(existsSync(manifestPath), "packages/layer-parallel/package.json exists");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    name?: string;
    private?: boolean;
    type?: string;
    exports?: Record<string, string>;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    description?: string;
    specstride?: { skeleton?: unknown; skeletonNote?: unknown };
  };

  assert.equal(manifest.name, PACKAGE_NAME);
  assert.equal(manifest.type, "module");
  assert.equal(manifest.private, true);
  // The package has content of its own, not the two-line skeleton the campaign
  // scaffolding left: a described manifest, the data of the feature and tests.
  assert.ok(
    (manifest.description ?? "").includes("loop layer"),
    "the manifest describes the layer, not a scaffolding skeleton",
  );
  assert.ok(
    !(manifest.description ?? "").includes("skeleton from the campaign scaffolding"),
    "the description of the scaffolding skeleton is gone",
  );
  // The scaffolding marker `specstride.skeleton` is still set, on purpose, and
  // the manifest says why: feature 100's CT-100-322 asserts that the set of
  // core packages under test is exactly the two shared packages, which is the
  // state in which no core package is filled. That test belongs to feature
  // 100; dropping the marker here without repairing it fails the root
  // `npm test`. The note keeps the reason next to the marker.
  if (manifest.specstride?.skeleton === true) {
    assert.ok(
      typeof manifest.specstride.skeletonNote === "string" &&
        manifest.specstride.skeletonNote.includes("CT-100-322"),
      "while the scaffolding marker stands, the manifest names the check that holds it",
    );
  }
  // The package is in the workspace of the root manifest.
  const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    workspaces: string[];
  };
  assert.ok(root.workspaces.includes("packages/*"), "packages/* is a workspace of the root");
  // Its own tests run under the root script `test`, which calls every
  // workspace that has one.
  assert.ok(
    (manifest.scripts?.test ?? "").includes("node --test"),
    "the package has a test script, so the root `npm test` runs it",
  );
  assert.ok(manifest.scripts?.typecheck !== undefined, "the package has a typecheck script");
  // The entry and the data are reachable.
  assert.equal(manifest.exports?.["."], "./src/index.ts");
  assert.equal(manifest.exports?.["./data/*"], "./data/*");
  assert.ok(existsSync(join(PKG, "src/index.ts")));
  assert.ok(statSync(join(PKG, "data")).isDirectory(), "data/ is a directory");
  assert.ok(statSync(join(PKG, "test")).isDirectory(), "test/ is a directory");
});

test("T001: the directory packages/core/src/parallel exists and holds the module group", () => {
  const dir = join(ROOT, "packages/core/src/parallel");
  assert.ok(existsSync(dir), "packages/core/src/parallel exists");
  assert.ok(statSync(dir).isDirectory(), "packages/core/src/parallel is a directory");
  const files = sources(dir);
  assert.ok(files.length > 0, "the directory holds at least one source file");
  assert.ok(
    files.some((f) => rel(f) === "packages/core/src/parallel/index.ts"),
    "the module group has an entry module",
  );
  // The module group names itself and the two features that place a group
  // here, as the note of the graph entry of @specstride/core says.
  assert.equal(MODULE_GROUP, "packages/core/src/parallel");
  assert.equal(CORE_MODULE_GROUP, MODULE_GROUP, "the layer names the same module group");
  assert.deepEqual([...MODULE_GROUP_FEATURES], ["142", "143"]);
  const coreEntry = entryOf("@specstride/core");
  assert.ok(
    (coreEntry.note ?? "").includes("packages/core/src/parallel/"),
    "the graph entry of the core names this module group",
  );
  // A durable content hash of every file of the group.
  for (const file of files) assert.match(sha256(file), /^[0-9a-f]{64}$/);
});

/* ------------------------------------------------------------------ *
 * The import rules
 * ------------------------------------------------------------------ */

test("T001: the graph entry of @specstride/layer-parallel is the one the rules assume", () => {
  const entry = entryOf(PACKAGE_NAME);
  assert.equal(entry.layer, PACKAGE_LAYER);
  assert.equal(entry.layer, "L3");
  assert.equal(entry.owner, "142");
  assert.equal(entry.core, true, "the package is under the core rule");
  assert.deepEqual(entry.mayImport, [...MAY_IMPORT]);
  assert.deepEqual(entry.mayImport, ["@specstride/contracts", "@specstride/kernel"]);
  for (const builtin of [
    "node:child_process",
    "node:net",
    "node:http",
    "node:https",
    "node:fs",
    "node:fs/promises",
  ]) {
    assert.ok((entry.forbidden ?? []).includes(builtin), `the entry forbids ${builtin}`);
  }
  // The core entry, which the module group lives in, carries the same rule.
  const core = entryOf("@specstride/core");
  assert.equal(core.core, true);
  assert.deepEqual(core.mayImport, [...CORE_MAY_IMPORT]);
  assert.deepEqual(core.mayImport, ["@specstride/contracts", "@specstride/kernel"]);
});

test("T001: the dependencies of the package are exactly what mayImport allows", () => {
  const manifest = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.deepEqual(
    Object.keys(manifest.dependencies ?? {}).sort(),
    [...MAY_IMPORT].sort(),
    "the package depends on the two packages mayImport lists, and on nothing else",
  );
  assert.deepEqual(
    Object.keys(manifest.devDependencies ?? {}),
    [],
    "no development dependency widens the rule",
  );
});

test("T001: no source of either place imports outside mayImport or a forbidden module", () => {
  const edgeAndOther = graph.packages
    .filter((p) => p.name !== "@specstride/contracts" && p.name !== "@specstride/kernel")
    .map((p) => p.name);

  const places: { label: string; dir: string; owner: string }[] = [
    { label: "@specstride/layer-parallel", dir: join(PKG, "src"), owner: PACKAGE_NAME },
    {
      label: "packages/core/src/parallel",
      dir: join(ROOT, "packages/core/src/parallel"),
      owner: "@specstride/core",
    },
  ];

  let checked = 0;
  for (const place of places) {
    for (const file of sources(place.dir)) {
      for (const spec of importSpecifiers(file)) {
        checked++;
        const where = `${rel(file)} imports "${spec}"`;
        // A relative import stays inside the package: it is allowed, but it
        // must not climb out of the package it belongs to.
        if (spec.startsWith(".") || spec.startsWith("/")) {
          assert.ok(!spec.includes("../../"), `${where}: a relative import stays in the package`);
          continue;
        }
        if (spec.startsWith("node:")) {
          assert.ok(
            !FORBIDDEN_BUILTINS.includes(spec),
            `${where}: the core rule forbids this built-in`,
          );
          continue;
        }
        // Any other bare specifier must be one of the two shared packages.
        assert.ok(
          (MAY_IMPORT as readonly string[]).includes(spec) ||
            MAY_IMPORT.some((n) => spec.startsWith(n + "/")),
          `${where}: only ${MAY_IMPORT.join(" and ")} may be imported (LR-1)`,
        );
        assert.ok(
          !edgeAndOther.some((n) => spec === n || spec.startsWith(n + "/")),
          `${where}: a core place reaches another package only through its interface in @specstride/contracts`,
        );
      }
    }
  }
  assert.ok(checked >= 0);

  // The rule this test enforces is a rule the graph states.
  assert.ok(
    graph.rules.some((r) => r.includes("mayImport")),
    "the graph states LR-1",
  );
  assert.ok(
    graph.rules.some((r) => r.includes("does not import node:fs")),
    "the graph states the core rule on node:fs",
  );
  assert.ok(
    graph.rules.some((r) => r.includes("only through its interface")),
    "the graph states that a core package reaches an edge package through its interface",
  );
});

test("T001: the edge packages this feature consumes stay edge packages it never imports", () => {
  // The services this feature consumes (F142-FR-074): the tree store and the
  // check runner. Both are edge packages of L1, reached through their
  // interfaces in @specstride/contracts.
  for (const name of ["@specstride/tree-store", "@specstride/check-runner"]) {
    const entry = entryOf(name);
    assert.equal(entry.edge, true, `${name} is an edge package`);
    assert.equal(entry.layer, "L1");
    assert.notEqual(entry.core, true, `${name} is not core`);
  }
  // The interface of the tree store lives in the contracts package, which is
  // what a core place imports instead.
  assert.ok(
    existsSync(join(ROOT, "packages/contracts/src/ep/tree-store.ts")),
    "the interface of the tree store is in @specstride/contracts",
  );
  assert.ok(
    existsSync(join(ROOT, "packages/contracts/src/ep/check-runner.ts")),
    "the interface of the check runner is in @specstride/contracts",
  );
  assert.ok(
    existsSync(join(ROOT, "packages/contracts/src/ep/loop-layer.ts")),
    "the loop-layer interface of EP-04 is in @specstride/contracts",
  );
});
