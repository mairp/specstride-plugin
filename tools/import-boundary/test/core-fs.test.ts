/**
 * T227 — test of the import-boundary check for `node:fs` (annex A, §A.3;
 * F100-FR-012, with its assumption CQ-185; F100-FR-234).
 *
 * The rule, as §A.3 holds it after the repairs of the cross-feature review: a
 * core package reads and writes no file itself. Files go through the kernel and
 * through the ports of the edge packages, so a core package that imports
 * `node:fs` or `node:fs/promises` fails the check — and an edge package that
 * imports either one passes, because touching the file system on behalf of a
 * core package is exactly what an edge package is for (the note of each edge
 * package in the graph; F100-FR-234).
 *
 * Both halves are tested twice over: on the rule of T013
 * (`coreImportViolation`, `src/core-rule.ts`) and, end to end, on the entry of
 * the check (`src/index.ts`) over a scratch workspace whose core package and
 * whose edge package each import `node:fs`. The end-to-end half is what proves
 * the asymmetry is in the shipped check and not only in one function: the
 * violation it reports names the file, the import and the rule, and the edge
 * package appears in no violation.
 *
 * CQ-185 is the assumption under the rule: the ports through which a core
 * package reaches the file system are the kernel services of T222 and the three
 * edge packages of T296, and nothing else. The last test holds the graph to it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLayerFacts } from "../src/layer-facts.ts";
import { CORE_FORBIDDEN_BUILTINS, coreImportViolation } from "../src/core-rule.ts";

const facts = loadLayerFacts();
const graph = facts.graph;
const TOOL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(TOOL_DIR, "src/index.ts");

/** The two file-system built-ins of F100-FR-012. */
const FS_BUILTINS = ["node:fs", "node:fs/promises"] as const;

/** The rule id the check reports for a core package that imports one of them. */
const FS_RULE = "core:no-filesystem";

const corePackages = graph.packages.filter((p) => p.core === true).map((p) => p.name);
const edgePackages = graph.packages.filter((p) => p.edge === true).map((p) => p.name);

test("T227: both file-system built-ins are forbidden to a core package by name", () => {
  for (const builtin of FS_BUILTINS) {
    assert.ok(
      (CORE_FORBIDDEN_BUILTINS as readonly string[]).includes(builtin),
      `${builtin} is forbidden to a core package (F100-FR-012)`,
    );
  }
  assert.ok(corePackages.length > 0, "the graph marks at least one core package");
  assert.ok(edgePackages.length > 0, "the graph marks the edge packages of T296");
});

test("T227: a core package that imports node:fs or node:fs/promises fails the rule, with the file, the import and the rule", () => {
  for (const core of corePackages) {
    for (const builtin of FS_BUILTINS) {
      const file = `packages/${core.replace("@specstride/", "")}/src/pass-loop.ts`;
      const violation = coreImportViolation(graph, core, file, 12, builtin);
      assert.ok(violation !== undefined, `${core} importing ${builtin} must fail the check`);
      assert.equal(violation.file, file, "the violation names the file");
      assert.equal(violation.line, 12);
      assert.equal(violation.spec, builtin, "the violation names the import");
      assert.equal(violation.rule, FS_RULE, "the violation names the rule");
      assert.match(violation.detail, /F100-FR-012/);
      assert.match(violation.detail, /through the kernel and the ports of the edge packages/);
    }
  }
});

test("T227: an edge package that imports node:fs or node:fs/promises passes the rule", () => {
  for (const edge of edgePackages) {
    for (const builtin of FS_BUILTINS) {
      const file = `packages/${edge.replace("@specstride/", "")}/src/index.ts`;
      assert.equal(
        coreImportViolation(graph, edge, file, 3, builtin),
        undefined,
        `${edge} may import ${builtin}: an edge package may touch the file system (F100-FR-234)`,
      );
    }
    // The graph says so of each edge package, so that the asymmetry is in the
    // data and not only in the code of the check.
    const entry = graph.packages.find((p) => p.name === edge);
    assert.ok(entry !== undefined);
    assert.notEqual(entry.core, true, `${edge} is no core package`);
    assert.notEqual(
      entry.nodeBuiltins,
      false,
      `${edge} may use node built-ins: it is the port through which a core package reaches files`,
    );
    assert.match(
      String(entry.note ?? ""),
      /may touch the file system or start a process/,
      `the graph note of ${edge} states what an edge package may do`,
    );
  }
});

test("T227: end to end — the check fails on the core package and says nothing of the edge package", () => {
  const root = fsFixtureWorkspace();
  try {
    const { code, out } = runEntry(root);
    assert.equal(code, 1, "the check fails (exit 1) when a core package imports node:fs");
    // Both imports of the core package are reported, each with its file, its
    // import and the rule.
    assert.match(out, /packages\/core\/src\/index\.ts/);
    assert.match(out, /node:fs\b/);
    assert.match(out, /node:fs\/promises/);
    assert.match(out, new RegExp(FS_RULE));
    // The edge package imports the same two built-ins and is in no violation.
    assert.doesNotMatch(
      out,
      /packages\/tree-store/,
      "an edge package that imports node:fs appears in no violation",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("T227: end to end — with the import removed from the core package only, the same workspace passes", () => {
  const root = fsFixtureWorkspace({ coreTouchesFiles: false });
  try {
    const { code, out } = runEntry(root);
    assert.equal(code, 0, `the check passes; output was:\n${out}`);
    assert.match(out, /0 violation\(s\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("T227 (CQ-185): the ports through which a core package reaches files are the kernel and the edge packages", () => {
  // The assumption of F100-FR-012: a core package may import the contracts
  // package and the kernel package and nothing else of the product, so the
  // kernel services of T222 and the interfaces of the edge packages are the
  // only ports to the file system.
  for (const core of corePackages) {
    const entry = graph.packages.find((p) => p.name === core);
    assert.ok(entry !== undefined);
    const mayImport = entry.mayImport ?? [];
    for (const name of mayImport) {
      assert.ok(
        name === "@specstride/contracts" ||
          name === "@specstride/kernel" ||
          graph.packages.find((p) => p.name === name)?.core === true,
        `${core} may import ${name}: only the contracts package, the kernel and another core package`,
      );
    }
    assert.ok(
      !mayImport.some((name) => edgePackages.includes(name)),
      `${core} names no edge package in mayImport: it reaches one through its interface only`,
    );
  }
});

/**
 * A scratch workspace of three packages: the contracts package, a core package
 * and an edge package. The edge package always imports both file-system
 * built-ins; the core package does so unless told not to.
 */
function fsFixtureWorkspace(options: { coreTouchesFiles?: boolean } = {}): string {
  const coreTouchesFiles = options.coreTouchesFiles !== false;
  const root = mkdtempSync(join(tmpdir(), "core-fs-boundary-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "core-fs-fixture-root", private: true, workspaces: ["packages/*"] }),
  );
  const dataDir = join(root, "packages/contracts/data");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "package-graph.json"),
    JSON.stringify({
      schema: "specstride.package-graph/1",
      packages: [
        { name: "@specstride/contracts", layer: "all", mayImport: [] },
        { name: "@specstride/kernel", layer: "all", mayImport: ["@specstride/contracts"] },
        {
          name: "@specstride/core",
          layer: "L4",
          core: true,
          mayImport: ["@specstride/contracts", "@specstride/kernel"],
          forbidden: ["node:fs", "node:fs/promises"],
        },
        {
          name: "@specstride/tree-store",
          layer: "L1",
          owner: "143",
          edge: true,
          mayImport: ["@specstride/contracts", "@specstride/kernel"],
          note: "Edge package of the kernel services of parallel units: the tree store. An edge package may touch the file system or start a process on behalf of a core package, behind its interface in @specstride/contracts (annex A §A.3, F100-FR-234).",
        },
      ],
    }),
  );
  writeFileSync(
    join(root, "packages/contracts/package.json"),
    JSON.stringify({ name: "@specstride/contracts", private: true }),
  );
  mkdirSync(join(root, "packages/contracts/src"), { recursive: true });
  writeFileSync(join(root, "packages/contracts/src/index.ts"), "export const ok = true;\n");

  const coreDir = join(root, "packages/core");
  mkdirSync(join(coreDir, "src"), { recursive: true });
  writeFileSync(
    join(coreDir, "package.json"),
    JSON.stringify({ name: "@specstride/core", private: true }),
  );
  writeFileSync(
    join(coreDir, "src", "index.ts"),
    coreTouchesFiles
      ? 'import { readFileSync } from "node:fs";\nimport { readFile } from "node:fs/promises";\nexport const read = [readFileSync, readFile];\n'
      : "export const read = [] as const;\n",
  );

  const edgeDir = join(root, "packages/tree-store");
  mkdirSync(join(edgeDir, "src"), { recursive: true });
  writeFileSync(
    join(edgeDir, "package.json"),
    JSON.stringify({ name: "@specstride/tree-store", private: true }),
  );
  writeFileSync(
    join(edgeDir, "src", "index.ts"),
    'import { readFileSync } from "node:fs";\nimport { readFile } from "node:fs/promises";\nexport const read = [readFileSync, readFile];\n',
  );
  return root;
}

function runEntry(root: string): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [ENTRY, "--root", root], { encoding: "utf8" });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    return { code: e.status ?? -1, out: e.stdout ?? "" };
  }
}
