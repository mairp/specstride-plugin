/**
 * T108 — the static test of the import rules of this feature (F142-FR-006;
 * rules PU-06 and PU-07).
 *
 * PU-06: "Withheld from the layer by construction: every gate writer; every
 * outer counter; a harness handle; the event writer and the ledger writer;
 * raw git; any path of the workspace or of a worker tree as a writable
 * handle. **Static: the module graph of the layer package imports `contracts`
 * and `kernel` only, and neither `node:child_process` nor `node:fs` write
 * calls.**"
 *
 * PU-07: "The engine, not the layer, owns the group executor, the tree store
 * and integration. … the package rule of architecture section 6 applies to
 * `@specstride/layer-parallel` as to `@specstride/layer-micro`."
 *
 * The three statements this file proves, each by reading the source tree from
 * disk and never by asking the code about itself:
 *
 *  1. every import of `packages/layer-parallel/src/` resolves to
 *     `@specstride/contracts`, to `@specstride/kernel` or to a relative module
 *     of the package itself — nothing else, dynamic imports and `require`
 *     included;
 *  2. neither `packages/layer-parallel/src/` nor `packages/core/src/parallel/`
 *     imports `node:fs` or `node:fs/promises`, and neither holds a call of the
 *     file-system API under another name;
 *  3. no file under `packages/core/` names the layer package
 *     `@specstride/layer-parallel` — in code or in prose. The engine reaches
 *     the layer through EP-04 and never by its name.
 *
 * `test/package-graph.test.ts` (T001) proves that the *graph* states these
 * rules. This file proves that the *tree* keeps them, and keeps them for the
 * modules every later phase added.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url)); // packages/layer-parallel/test
const PKG = dirname(HERE); // packages/layer-parallel
const ROOT = dirname(dirname(PKG)); // the repository root

/** The two packages `mayImport` allows, which is the whole of rule LR-1 here. */
const MAY_IMPORT = ["@specstride/contracts", "@specstride/kernel"] as const;

/** The name of the layer package, which no file under `packages/core/` may hold. */
const LAYER_PACKAGE = "@specstride/layer-parallel" as const;

/** The two file-system modules PU-06 names, and the rest of the core rule. */
const FORBIDDEN_FILE_SYSTEM_MODULES = ["node:fs", "node:fs/promises"] as const;
const FORBIDDEN_OTHER_MODULES = [
  "node:child_process",
  "node:net",
  "node:http",
  "node:https",
  "node:dgram",
  "node:worker_threads",
  "fs",
  "fs/promises",
  "child_process",
] as const;

/** The two places of this feature that are under the core rule. */
const PLACES = [
  { label: "packages/layer-parallel/src", dir: join(PKG, "src") },
  { label: "packages/core/src/parallel", dir: join(ROOT, "packages/core/src/parallel") },
] as const;

const rel = (file: string): string => relative(ROOT, file).split(sep).join("/");

/** Every source file under a directory, recursively, sorted. */
function sources(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(full);
      } else if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out.sort();
}

/** Every file of a directory, of whatever kind, recursively. */
function everyFile(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(full);
      } else {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out.sort();
}

/** The source with its comments removed, so prose is never read as code. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** The specifier of every static import, dynamic import, re-export and `require`. */
function importSpecifiers(file: string): string[] {
  const text = code(readFileSync(file, "utf8"));
  const out: string[] = [];
  for (const re of [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]) {
    for (const m of text.matchAll(re)) out.push(m[1] as string);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 1. The layer package imports `contracts` and `kernel` only (PU-06).
 * ------------------------------------------------------------------ */

test("T108: every bare import of the layer package is `contracts` or `kernel`", () => {
  const files = sources(join(PKG, "src"));
  assert.ok(files.length >= 10, "the test reads the whole of src/, not a part of it");
  let bare = 0;
  for (const file of files) {
    for (const spec of importSpecifiers(file)) {
      if (spec.startsWith(".") || spec.startsWith("/")) continue;
      if (spec.startsWith("node:")) continue;
      bare++;
      assert.ok(
        MAY_IMPORT.some((name) => spec === name || spec.startsWith(`${name}/`)),
        `${rel(file)} imports "${spec}": the layer package imports ${MAY_IMPORT.join(" and ")} only (PU-06)`,
      );
    }
  }
  assert.ok(bare > 0, "the layer does import the two packages, so the rule is exercised");
});

test("T108: a relative import of the layer package never climbs out of it", () => {
  for (const file of sources(join(PKG, "src"))) {
    for (const spec of importSpecifiers(file)) {
      if (!spec.startsWith(".")) continue;
      assert.ok(
        !spec.includes("../../"),
        `${rel(file)} imports "${spec}": a relative import stays inside the package (PU-07)`,
      );
    }
  }
});

test("T108: the manifest of the layer package depends on those two packages only", () => {
  const manifest = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.deepEqual(Object.keys(manifest.dependencies ?? {}).sort(), [...MAY_IMPORT].sort());
  assert.deepEqual(Object.keys(manifest.devDependencies ?? {}), []);
});

/* ------------------------------------------------------------------ *
 * 2. Neither place imports `node:fs` or `node:fs/promises` (PU-06).
 * ------------------------------------------------------------------ */

test("T108: neither the layer package nor packages/core/src/parallel imports node:fs", () => {
  for (const place of PLACES) {
    const files = sources(place.dir);
    assert.ok(files.length > 0, `${place.label} holds source files`);
    for (const file of files) {
      for (const spec of importSpecifiers(file)) {
        assert.ok(
          !(FORBIDDEN_FILE_SYSTEM_MODULES as readonly string[]).includes(spec),
          `${rel(file)} imports "${spec}": a core place imports neither node:fs nor node:fs/promises (PU-06)`,
        );
        assert.ok(
          !(FORBIDDEN_OTHER_MODULES as readonly string[]).includes(spec),
          `${rel(file)} imports "${spec}": the core rule forbids it`,
        );
      }
    }
  }
});

test("T108: neither place reaches the file system or a process under another name", () => {
  // A module read through `createRequire`, `process.binding` or a global
  // `require` would pass the specifier test above; none of them appears.
  const forbiddenCalls = [
    /\bcreateRequire\s*\(/,
    /\bprocess\s*\.\s*binding\s*\(/,
    /\bnode:fs\b/,
    /\breadFileSync\s*\(/,
    /\bwriteFileSync\s*\(/,
    /\bmkdirSync\s*\(/,
    /\brmSync\s*\(/,
    /\bspawnSync\s*\(/,
    /\bexecSync\s*\(/,
  ];
  for (const place of PLACES) {
    for (const file of sources(place.dir)) {
      const body = code(readFileSync(file, "utf8"));
      for (const re of forbiddenCalls) {
        assert.ok(
          !re.test(body),
          `${rel(file)} holds ${String(re)}: a core place touches no file and starts no process (PU-06)`,
        );
      }
    }
  }
});

/* ------------------------------------------------------------------ *
 * 3. No core file names the layer package (PU-07).
 * ------------------------------------------------------------------ */

test("T108: no file under packages/core/ names @specstride/layer-parallel", () => {
  const files = everyFile(join(ROOT, "packages/core"));
  assert.ok(files.length > 0, "the core package holds files");
  const naming = files.filter((file) => readFileSync(file, "utf8").includes(LAYER_PACKAGE));
  assert.deepEqual(
    naming.map(rel),
    [],
    `no core file names ${LAYER_PACKAGE}: the engine reaches the layer through EP-04 and never by its name (PU-07)`,
  );
});

test("T108: the manifest of @specstride/core does not depend on the layer package", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "packages/core/package.json"), "utf8")) as {
    name?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.equal(manifest.name, "@specstride/core");
  assert.ok(!Object.keys(manifest.dependencies ?? {}).includes(LAYER_PACKAGE));
  assert.ok(!Object.keys(manifest.devDependencies ?? {}).includes(LAYER_PACKAGE));
  assert.deepEqual(Object.keys(manifest.dependencies ?? {}).sort(), [...MAY_IMPORT].sort());
});

test("T108: the rule is falsifiable — the same walk does find the name where it is", () => {
  // The grep of the test above returns nothing. That is worth nothing unless
  // the same walk would find the name if a core file held it, so the walk is
  // pointed at a tree that does hold it: the layer package itself, whose
  // `src/index.ts` declares `PACKAGE_NAME`.
  const naming = everyFile(join(PKG, "src")).filter((file) =>
    readFileSync(file, "utf8").includes(LAYER_PACKAGE),
  );
  assert.ok(
    naming.map(rel).includes("packages/layer-parallel/src/index.ts"),
    "the walk finds the name where the name is",
  );
});
