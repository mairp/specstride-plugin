/**
 * T003 — the package `@specstride/tree-store` and the directory
 * `packages/core/src/parallel/` exist, WITH THE IMPORT RULES OF THE PACKAGE
 * GRAPH (research.md D-5; the package graph of feature 100,
 * `packages/contracts/data/package-graph.json`).
 *
 * The general check over every file of the workspace is
 * `tools/import-boundary/src/index.ts`, wired as the root script
 * `check:imports`. This test is the part that check cannot make: it asserts
 * THE RULES THEMSELVES, so that a change to the graph which quietly let the
 * core import the store would fail here rather than simply be allowed.
 *
 * What it observes:
 *
 *  1 the package `@specstride/tree-store` is in the graph as an EDGE of layer
 *    L1, owned by 143, and may import only `@specstride/contracts` and
 *    `@specstride/kernel`;
 *  2 the entry of `@specstride/core` forbids `node:child_process` and the
 *    file-system modules, and does NOT list `@specstride/tree-store` among what
 *    it may import — which is the rule that makes the store an edge;
 *  3 the directory `packages/core/src/parallel/` exists, and NO FILE OF IT
 *    names `@specstride/tree-store` or any forbidden module;
 *  4 the package's own files import nothing outside its `mayImport` list;
 *  5 the workspace really holds both, with a `package.json` whose name matches
 *    the graph.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FORBIDDEN_PLATFORM_MODULES,
  MAY_IMPORT,
  MAY_NOT_IMPORT_RULE,
  MODULE_GROUP_DIRECTORY,
  OWNER,
  THE_INTERFACE,
  THE_STORE_POINT,
  mayImport,
} from "../../core/src/parallel/index.ts";

/**
 * The name of THIS package. It is written here, in the test of the edge
 * package, and NOT in any file of the core: the second core rule of annex A
 * §A.3 (`core:names-wave1`) forbids a core file to name a Wave 1
 * implementation of an extension point in any form, so that adding or removing
 * an implementation changes no core file. The assertions below check that rule
 * over every file of the module group.
 */
const THE_EDGE_PACKAGE = "@specstride/tree-store";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = join(PACKAGE_ROOT, "..", "..");
const GRAPH_FILE = join(REPOSITORY_ROOT, "packages", "contracts", "data", "package-graph.json");
const CORE_PARALLEL = join(REPOSITORY_ROOT, MODULE_GROUP_DIRECTORY);

type GraphEntry = {
  readonly name: string;
  readonly layer: string;
  readonly owner: string;
  readonly mayImport?: readonly string[];
  readonly forbidden?: readonly string[];
  readonly edge?: boolean;
  readonly core?: boolean;
  readonly note?: string;
};

const graph = JSON.parse(readFileSync(GRAPH_FILE, "utf8")) as {
  readonly packages: readonly GraphEntry[];
};

function entryOf(name: string): GraphEntry {
  const found = graph.packages.find((p) => p.name === name);
  assert.ok(found !== undefined, `the graph must hold ${name}`);
  return found;
}

/** Every `.ts` file under a directory. */
function sourcesOf(directory: string): readonly string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) out.push(full);
    }
  };
  walk(directory);
  return out;
}

/** The module specifiers a source file imports or re-exports. */
function importsOf(file: string): readonly string[] {
  const text = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)[^;\n]*?from\s*["']([^"']+)["']/g)) {
    out.push(m[1]);
  }
  for (const m of text.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) out.push(m[1]);
  for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}

test("T003 the package @specstride/tree-store is an edge of L1, owned by 143", () => {
  const entry = entryOf("@specstride/tree-store");
  assert.equal(entry.layer, "L1");
  assert.equal(entry.owner, OWNER);
  assert.equal(entry.edge, true, "the store may start a process; it is an edge");
  assert.notEqual(entry.core, true, "the store is not a core package");
  assert.deepEqual([...(entry.mayImport ?? [])], [...MAY_IMPORT]);

  // The workspace really holds it, under the name the graph gives.
  const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
    name: string;
    dependencies?: Record<string, string>;
  };
  assert.equal(manifest.name, THE_EDGE_PACKAGE);
  assert.deepEqual(Object.keys(manifest.dependencies ?? {}).sort(), [...MAY_IMPORT].sort());
});

test("T003 the core may not import the store, and reaches it through the interface", () => {
  const core = entryOf("@specstride/core");
  assert.equal(core.core, true);
  assert.deepEqual([...(core.mayImport ?? [])], [...MAY_IMPORT]);
  assert.ok(
    !(core.mayImport ?? []).includes(THE_EDGE_PACKAGE),
    "a core package never imports the edge; it takes its interface",
  );
  for (const forbidden of ["node:child_process", "node:fs", "node:fs/promises"]) {
    assert.ok(
      (core.forbidden ?? []).includes(forbidden),
      `the core entry must forbid ${forbidden}`,
    );
  }
  // The graph entry of the core names this feature's module group.
  assert.match(core.owner, /143/);
  assert.match(String(core.note ?? ""), /parallel/);
});

test("T003 the directory packages/core/src/parallel exists and imports nothing it may not", () => {
  assert.ok(existsSync(CORE_PARALLEL), `${MODULE_GROUP_DIRECTORY} must exist`);
  assert.ok(statSync(CORE_PARALLEL).isDirectory());
  const sources = sourcesOf(CORE_PARALLEL);
  assert.ok(sources.length > 0, "the module group must hold at least one source file");
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    for (const specifier of importsOf(file)) {
      assert.ok(
        !(FORBIDDEN_PLATFORM_MODULES as readonly string[]).includes(specifier),
        `${file} must not import ${specifier}`,
      );
      assert.equal(
        mayImport(specifier),
        true,
        `${file} imports ${specifier}, which the graph does not allow the core`,
      );
    }
    // The second core rule of annex A §A.3 (`core:names-wave1`): a core file
    // names a Wave 1 implementation in NO form, not even in prose.
    assert.ok(
      !new RegExp(`(?<![\\w@-])${THE_EDGE_PACKAGE}(?![\\w-])`).test(text),
      `${file} must not name ${THE_EDGE_PACKAGE}, in an import or in prose`,
    );
  }
  // The one way in is the interface, named by its point id.
  const index = readFileSync(join(CORE_PARALLEL, "index.ts"), "utf8");
  assert.match(index, /@specstride\/contracts\/ep\/tree-store/);
  assert.equal(THE_INTERFACE, "@specstride/contracts/ep/tree-store");
  assert.equal(THE_STORE_POINT, "specstride.tree-store/1");
  assert.match(MAY_NOT_IMPORT_RULE, /not marked `core: true`/);
});

test("T003 the files of the tree-store package import nothing outside its mayImport list", () => {
  const entry = entryOf("@specstride/tree-store");
  const allowed = entry.mayImport ?? [];
  for (const file of sourcesOf(join(PACKAGE_ROOT, "src"))) {
    for (const specifier of importsOf(file)) {
      if (specifier.startsWith(".")) continue;
      if (specifier.startsWith("node:")) continue; // an edge may use the platform
      assert.ok(
        allowed.some((a) => specifier === a || specifier.startsWith(a + "/")),
        `${file} imports ${specifier}, which ${THE_EDGE_PACKAGE} may not import`,
      );
    }
  }
});

test("T003 mayImport of the module group is the rule of the graph, in both directions", () => {
  for (const allowed of MAY_IMPORT) {
    assert.equal(mayImport(allowed), true);
    assert.equal(mayImport(allowed + "/ep/tree-store"), true);
  }
  for (const forbidden of FORBIDDEN_PLATFORM_MODULES) assert.equal(mayImport(forbidden), false);
  assert.equal(mayImport(THE_EDGE_PACKAGE), false, "the core never imports the edge");
  assert.equal(mayImport("./group-executor.ts"), true, "a sibling module of the group");
  assert.equal(mayImport("@specstride/layer-parallel"), false, "a layer package of 142");
});
