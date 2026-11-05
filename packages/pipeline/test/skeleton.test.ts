/**
 * T001 — the skeleton of `@specstride/pipeline` holds what Phase 1 requires:
 *
 *   - every source directory of the skeleton exists, each with its
 *     placeholder `index.ts`;
 *   - the declared dependencies of the package are EXACTLY the packages the
 *     package graph allows (`packages/contracts/data/package-graph.json`,
 *     the entry of `@specstride/pipeline`, layer L5): none missing, none
 *     beyond `mayImport` — "with the imports the package graph allows and no
 *     others".
 *
 * The dependency check is the durable form of that clause: when the graph or
 * the manifest drifts, this test fails before the import-boundary check of
 * the whole workspace does.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const PACKAGE_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");

const SOURCE_DIRS = [
  "entry",
  "executor",
  "kinds",
  "checks",
  "output",
  "launch-checks",
  "relaunch",
  "supervisor",
] as const;

test("T001: every skeleton source directory exists with its placeholder index", () => {
  for (const dir of SOURCE_DIRS) {
    const index = join(PACKAGE_ROOT, "src", dir, "index.ts");
    assert.ok(existsSync(index), `packages/pipeline/src/${dir}/index.ts exists`);
    const source = readFileSync(index, "utf8");
    assert.match(source, /@specstride\/pipeline/, `the placeholder names the package (${dir})`);
    assert.match(source, /T001/, `the placeholder names the task that wrote it (${dir})`);
  }
});

test("T001: the data directory and the test directory of the skeleton exist", () => {
  assert.ok(existsSync(join(PACKAGE_ROOT, "data")), "packages/pipeline/data/ exists");
  assert.ok(existsSync(join(PACKAGE_ROOT, "test")), "packages/pipeline/test/ exists");
});

test("T001: the declared dependencies are exactly what the package graph allows", () => {
  const graph = JSON.parse(
    readFileSync(join(REPO_ROOT, "packages", "contracts", "data", "package-graph.json"), "utf8"),
  ) as { packages: { name: string; mayImport: string[] }[] };
  const entry = graph.packages.find((pkg) => pkg.name === "@specstride/pipeline");
  assert.ok(entry, "the graph holds an entry for @specstride/pipeline");

  const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  const declared = Object.keys(manifest.dependencies).sort();
  const allowed = [...entry.mayImport].sort();

  assert.deepEqual(
    declared,
    allowed,
    "the manifest declares exactly the packages mayImport lists, and no other",
  );
});
