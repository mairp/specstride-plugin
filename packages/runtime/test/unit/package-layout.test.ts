/**
 * T006 — the layout of `@specstride/runtime` and its manifest.
 *
 * An independent read path for the effect T006 asks for: the test does not take
 * the word of whoever created the tree, it reads the file system and the
 * manifest back and names what is missing.
 *
 *   1. every directory of plan.md, "Project Structure", exists under
 *      `packages/runtime/src/` (root, detach, lock, lease, procs, inbox, state,
 *      doctor, and `data/` for T007) and under `packages/runtime/test/` (unit,
 *      characterization, contention, crash, and `helpers/` for T008), and each
 *      is a directory and not a file;
 *   2. each one is durable — it holds at least one tracked file, because a
 *      directory with nothing in it does not survive a clone;
 *   3. `packages/runtime/package.json` declares no dependency outside the
 *      workspace: every entry of `dependencies`, `devDependencies`,
 *      `peerDependencies` and `optionalDependencies` is an `@specstride/*`
 *      package that exists under `packages/` of this repository. An external
 *      package — anything from the registry — fails here;
 *   4. the manifest says what the package is: its name, that it is private, its
 *      module type, its engine, and the scripts the quickstart calls
 *      (`test`, `test:contention`, `test:crash`, `typecheck`);
 *   5. every target of its `exports` map that is not a pattern exists on disk.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** `packages/runtime/test/unit` → the repository root. */
const REPO = resolve(HERE, "..", "..", "..", "..");
const PKG_DIR = join(REPO, "packages", "runtime");
const MANIFEST = join(PKG_DIR, "package.json");

/** The directories of plan.md under `src/`. */
export const SRC_DIRS = Object.freeze([
  "root",
  "detach",
  "lock",
  "lease",
  "procs",
  "inbox",
  "state",
  "doctor",
  "data",
]);

/** The directories of plan.md under `test/`. */
export const TEST_DIRS = Object.freeze([
  "unit",
  "characterization",
  "contention",
  "crash",
  "helpers",
]);

/** The fields a manifest may declare a dependency in. */
const DEPENDENCY_FIELDS = Object.freeze([
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]);

type Manifest = {
  name?: string;
  private?: boolean;
  type?: string;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  exports?: Record<string, string>;
} & Record<string, unknown>;

function manifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
}

/** Is this name a package of this workspace, on disk under `packages/`? */
function isWorkspacePackage(name: string): boolean {
  if (!name.startsWith("@specstride/")) return false;
  const dir = join(REPO, "packages", name.slice("@specstride/".length));
  return existsSync(join(dir, "package.json"));
}

test("T006 — every directory of plan.md exists under packages/runtime/src/", () => {
  for (const name of SRC_DIRS) {
    const dir = join(PKG_DIR, "src", name);
    assert.ok(existsSync(dir), `packages/runtime/src/${name}/ is missing`);
    assert.ok(statSync(dir).isDirectory(), `packages/runtime/src/${name} is not a directory`);
  }
});

test("T006 — every directory of plan.md exists under packages/runtime/test/", () => {
  for (const name of TEST_DIRS) {
    const dir = join(PKG_DIR, "test", name);
    assert.ok(existsSync(dir), `packages/runtime/test/${name}/ is missing`);
    assert.ok(statSync(dir).isDirectory(), `packages/runtime/test/${name} is not a directory`);
  }
});

test("T006 — no directory of the layout is empty, so each one survives a clone", () => {
  for (const [parent, names] of [
    ["src", SRC_DIRS],
    ["test", TEST_DIRS],
  ] as const) {
    for (const name of names) {
      const entries = readdirSync(join(PKG_DIR, parent, name));
      assert.ok(
        entries.length > 0,
        `packages/runtime/${parent}/${name}/ holds no file; an empty directory is not tracked ` +
          `by git and would not survive a clone`,
      );
    }
  }
});

test("T006 — packages/runtime/package.json has no dependency outside the workspace", () => {
  const pkg = manifest();
  const outside: string[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const block = pkg[field];
    if (block === undefined) continue;
    assert.ok(
      block !== null && typeof block === "object",
      `${field} of packages/runtime/package.json is not an object`,
    );
    for (const name of Object.keys(block as Record<string, string>)) {
      if (!isWorkspacePackage(name)) outside.push(`${field}: ${name}`);
    }
  }
  assert.deepEqual(
    outside,
    [],
    "packages/runtime/package.json declares a dependency that is not a package of this " +
      "workspace; the runtime takes nothing from outside it",
  );
});

test("T006 — the manifest says what the package is, with the scripts the quickstart calls", () => {
  const pkg = manifest();
  assert.equal(pkg.name, "@specstride/runtime");
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, "module");
  assert.equal(pkg.engines?.node, ">=22");
  for (const script of ["test", "test:contention", "test:crash", "typecheck"]) {
    assert.ok(
      typeof pkg.scripts?.[script] === "string" && pkg.scripts[script].length > 0,
      `the script ${script} is missing from packages/runtime/package.json`,
    );
  }
});

test("T006 — every target of the exports map exists", () => {
  const pkg = manifest();
  const exports = pkg.exports ?? {};
  assert.ok(Object.keys(exports).length > 0, "the manifest exports nothing");
  for (const [entry, target] of Object.entries(exports)) {
    if (entry.includes("*")) {
      // A pattern names a directory; check that the directory is there.
      const dir = join(PKG_DIR, dirname(target.replace("*", "x")));
      assert.ok(existsSync(dir), `the export ${entry} points at ${dir}, which is missing`);
      continue;
    }
    assert.ok(
      existsSync(join(PKG_DIR, target)),
      `the export ${entry} points at ${target}, which is missing`,
    );
  }
});
