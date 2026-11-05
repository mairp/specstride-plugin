/**
 * Tests of the import-boundary entry (T231, extended by T016). The
 * committed test tree of a permitted and a forbidden import lives in
 * `test/fixtures/`; the remaining tests build the same kind of fixture
 * trees in a temporary directory and run the entry against them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const TOOL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(TOOL_DIR, "src/index.ts");
const FIXTURES = join(TOOL_DIR, "test/fixtures");

type FixtureGraph = {
  source?: string;
  packages: Array<{
    name: string;
    layer?: string;
    mayImport?: string[];
    nodeBuiltins?: boolean;
    forbidden?: string[];
  }>;
};

function makeWorkspace(
  graph: FixtureGraph,
  packages: Record<string, { src: string; deps?: Record<string, string> }>,
): string {
  const root = mkdtempSync(join(tmpdir(), "import-boundary-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "fixture-root", private: true, workspaces: ["packages/*"] }),
  );
  // The entry reads the graph from the package data location
  // (T011: packages/contracts/data/package-graph.json).
  const dataDir = join(root, "packages/contracts/data");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, "package-graph.json"), JSON.stringify(graph));
  for (const [name, body] of Object.entries(packages)) {
    const dir = join(root, "packages", name);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: `@x/${name}`, private: true, dependencies: body.deps ?? {} }),
    );
    writeFileSync(join(dir, "src", "index.ts"), body.src);
  }
  return root;
}

function runEntry(root: string, graph?: string): { code: number; out: string } {
  try {
    const args =
      graph === undefined ? [ENTRY, "--root", root] : [ENTRY, "--root", root, "--graph", graph];
    const out = execFileSync(process.execPath, args, { encoding: "utf8" });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    return { code: e.status ?? -1, out: e.stdout ?? "" };
  }
}

test("a permitted import passes (fixture)", () => {
  const root = makeWorkspace(
    { packages: [{ name: "@x/app", mayImport: ["@x/lib"] }, { name: "@x/lib" }] },
    {
      app: { src: 'import { lib } from "@x/lib";\nexport const a = lib;\n' },
      lib: { src: "export const lib = 1;\n" },
    },
  );
  try {
    const { code, out } = runEntry(root);
    assert.equal(code, 0, out);
    assert.match(out, /0 violation/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a node: built-in is refused where the graph forbids built-ins (fixture)", () => {
  const root = makeWorkspace(
    { packages: [{ name: "@x/app", nodeBuiltins: false }] },
    { app: { src: 'import { readFileSync } from "node:fs";\nexport const a = readFileSync;\n' } },
  );
  try {
    const { code, out } = runEntry(root);
    assert.equal(code, 1, out);
    assert.match(out, /node:fs/);
    assert.match(out, /graph:nodeBuiltins/);
    assert.match(out, /packages\/app\/src\/index\.ts:1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an import outside mayImport fails with the rule LR-1 (fixture)", () => {
  const root = makeWorkspace(
    {
      packages: [
        { name: "@x/app", mayImport: ["@x/lib"] },
        { name: "@x/lib" },
        { name: "@x/other" },
      ],
    },
    {
      app: { src: 'import { o } from "@x/other";\nexport const a = o;\n' },
      lib: { src: "export const lib = 1;\n" },
      other: { src: "export const o = 2;\n" },
    },
  );
  try {
    const { code, out } = runEntry(root);
    assert.equal(code, 1, out);
    assert.match(out, /@x\/other/);
    assert.match(out, /\[LR-1\]/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an undeclared external import fails (fixture)", () => {
  const root = makeWorkspace(
    { packages: [{ name: "@x/app" }] },
    { app: { src: 'import { x } from "some-external-pkg";\nexport const a = x;\n' } },
  );
  try {
    const { code, out } = runEntry(root);
    assert.equal(code, 1, out);
    assert.match(out, /some-external-pkg/);
    assert.match(out, /undeclared-dependency/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a declared external import passes (fixture)", () => {
  const root = makeWorkspace(
    { packages: [{ name: "@x/app" }] },
    {
      app: {
        src: 'import { x } from "some-external-pkg";\nexport const a = x;\n',
        deps: { "some-external-pkg": "1.0.0" },
      },
    },
  );
  try {
    const { code, out } = runEntry(root);
    assert.equal(code, 0, out);
    assert.match(out, /0 violation/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("T016: the committed fixture tree holds a permitted and a forbidden import", () => {
  // edge-a (@specstride/spec-formats) imports @specstride/contracts and
  // @specstride/kernel, both listed in its mayImport: the check must not
  // flag it. edge-b (@specstride/view) imports @specstride/kernel, which
  // its mayImport does not list: the check fails with the file, the
  // import and the rule id LR-1.
  const { code, out } = runEntry(join(FIXTURES, "workspace"), join(FIXTURES, "graph.json"));
  assert.equal(code, 1, out);
  assert.match(out, /1 violation/);
  assert.match(out, /packages\/edge-b\/src\/index\.ts:5 imports "@specstride\/kernel" \[LR-1\]/);
  assert.doesNotMatch(out, /edge-a/);
});

test("the check passes on the real workspace (no violation in Phase 2)", () => {
  const out = execFileSync(process.execPath, [ENTRY], { encoding: "utf8" });
  assert.match(out, /0 violation/);
  assert.match(out, /imports checked/);
});
