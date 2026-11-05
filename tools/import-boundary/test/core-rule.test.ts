/**
 * T012 — contract test CT-100-112 for the import rule for the core
 * (annex A, §A.3, F100-FR-012; the naming part: annex A, §A.4,
 * F100-FR-018).
 *
 * The core packages (the packages of the graph marked `core: true`: the
 * engine with the pass loop and every loop-layer package)
 *
 * - import the contracts package and the kernel package and nothing else
 *   from the product, no provider SDK or any external package, no
 *   `node:fs` or `node:fs/promises` (files go through the kernel and the
 *   ports of the edge packages, F100-FR-234) and no `node:child_process`,
 *   `node:net`, `node:http`, `node:https` or `node:dgram` (no process
 *   started and no connection opened directly) — each failure with the
 *   file, the import and the rule (T013, `src/core-rule.ts`);
 * - name no sample of the test kit and no Wave 1 implementation of any
 *   extension point, in any form — each failure with the file, the name
 *   and the rule (T236, `src/core-names.ts`).
 *
 * The import-boundary check enforces both, and fails when they are
 * broken: the last tests run the entry of the check over a fixture
 * workspace whose core package breaks each rule.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLayerFacts } from "../src/layer-facts.ts";
import {
  CORE_ALLOWED_PACKAGES,
  CORE_FORBIDDEN_BUILTINS,
  coreImportViolation,
} from "../src/core-rule.ts";
import { coreNamingViolations, wave1ImplementationPackages } from "../src/core-names.ts";

const facts = loadLayerFacts();
const graph = facts.graph;
const TOOL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(TOOL_DIR, "src/index.ts");

const corePackages = graph.packages.filter((p) => p.core === true).map((p) => p.name);
const FILE = "packages/core/src/pass-loop.ts";

test("CT-100-112: the graph marks the core packages (the engine and every loop layer)", () => {
  // the engine with the pass loop and every loop-layer package are core
  assert.ok(corePackages.includes("@specstride/core"), "the engine is a core package");
  assert.ok(corePackages.includes("@specstride/layer-micro"), "the micro-loop layer is core");
  assert.ok(
    corePackages.includes("@specstride/layer-parallel"),
    "the parallel units layer is core",
  );
  assert.equal(
    facts.runtimeTree.engine,
    "@specstride/core",
    "the engine of the runtime tree is the core package",
  );
  for (const name of corePackages) {
    assert.ok(
      facts.loopLayerPackages.includes(name),
      `the core package ${name} is a package of the loop layer (L3 or L4)`,
    );
  }
});

test("CT-100-112: a core package may import only the contracts package and the kernel package", () => {
  assert.deepEqual([...CORE_ALLOWED_PACKAGES].sort(), [
    "@specstride/contracts",
    "@specstride/kernel",
  ]);
  for (const core of corePackages) {
    assert.equal(coreImportViolation(graph, core, FILE, 1, "@specstride/contracts"), undefined);
    assert.equal(
      coreImportViolation(graph, core, FILE, 1, "@specstride/contracts/records/compile"),
      undefined,
    );
    assert.equal(coreImportViolation(graph, core, FILE, 1, "@specstride/kernel"), undefined);
    // any other package of the graph: the harness adapters, the sinks,
    // the config loader, the hosts, the CLI, the engine's siblings
    for (const other of graph.packages) {
      if ((CORE_ALLOWED_PACKAGES as readonly string[]).includes(other.name)) continue;
      const violation = coreImportViolation(graph, core, FILE, 1, other.name);
      assert.ok(violation !== undefined, `the core package ${core} must not import ${other.name}`);
      if (violation !== undefined) {
        assert.equal(violation.file, FILE);
        assert.equal(violation.spec, other.name);
        assert.ok(violation.rule.startsWith("core:"), "the failure carries the rule");
      }
    }
  }
});

test("CT-100-112: a core package imports no provider SDK and no external package", () => {
  for (const core of corePackages) {
    for (const spec of ["@anthropic-ai/claude-agent-sdk", "openai", "some-provider-sdk"]) {
      const violation = coreImportViolation(graph, core, FILE, 3, spec);
      assert.ok(
        violation !== undefined,
        `the core package ${core} must not import the provider SDK ${spec}`,
      );
      if (violation !== undefined) {
        assert.equal(violation.file, FILE);
        assert.equal(violation.line, 3);
        assert.equal(violation.spec, spec);
      }
    }
  }
  // a non-core package of the graph is not subject to the core rule: an
  // edge package may touch the file system (F100-FR-234)
  assert.equal(
    coreImportViolation(graph, "@specstride/spec-formats", FILE, 1, "node:fs"),
    undefined,
  );
  assert.equal(
    coreImportViolation(graph, "@specstride/spec-formats", FILE, 1, "some-provider-sdk"),
    undefined,
  );
});

test("CT-100-112: a core package does not import node:fs or node:fs/promises (F100-FR-234)", () => {
  for (const core of corePackages) {
    for (const spec of ["node:fs", "node:fs/promises"]) {
      const violation = coreImportViolation(graph, core, FILE, 5, spec);
      assert.ok(violation !== undefined, `the core package ${core} must not import ${spec}`);
      if (violation !== undefined) {
        assert.equal(violation.rule, "core:no-filesystem");
        assert.equal(violation.file, FILE);
        assert.equal(violation.spec, spec);
      }
    }
  }
});

test("CT-100-112: a core package starts no process and opens no connection directly", () => {
  const processAndConnection = [
    "node:child_process",
    "node:net",
    "node:http",
    "node:https",
    "node:dgram",
  ];
  assert.deepEqual(
    [...CORE_FORBIDDEN_BUILTINS].sort(),
    [...processAndConnection, "node:fs", "node:fs/promises"].sort(),
  );
  for (const core of corePackages) {
    for (const spec of processAndConnection) {
      const violation = coreImportViolation(graph, core, FILE, 7, spec);
      assert.ok(violation !== undefined, `the core package ${core} must not import ${spec}`);
      if (violation !== undefined) {
        assert.equal(violation.rule, "core:no-process-or-connection");
        assert.equal(violation.file, FILE);
        assert.equal(violation.spec, spec);
      }
    }
    // the other node built-ins are not forbidden by the core rule
    for (const spec of ["node:path", "node:url", "node:process"]) {
      assert.equal(coreImportViolation(graph, core, FILE, 1, spec), undefined);
    }
  }
});

test("CT-100-112: a core file names no sample of the test kit and no Wave 1 implementation (F100-FR-018)", () => {
  // the Wave 1 implementations are every package of the graph that is
  // not core and not the shared packages: the harness adapters of L1,
  // the sinks, the hosts of L7, the router rules and prompt blocks among
  // them
  const wave1 = wave1ImplementationPackages(graph);
  const wave1Names = new Set(wave1.map((p) => p.name));
  assert.ok(
    [
      "@specstride/harness",
      "@specstride/adapter-claude",
      "@specstride/observability",
      "@specstride/host-claude-code",
    ].every((name) => wave1Names.has(name)),
    "the Wave 1 implementations hold the harness adapters, the sinks and the hosts",
  );
  for (const core of corePackages) {
    // a core file that names a Wave 1 implementation by its package name
    for (const name of [
      "@specstride/harness",
      "@specstride/adapter-claude",
      "@specstride/host-claude-code",
    ]) {
      const violations = coreNamingViolations(graph, core, FILE, `import { x } from "${name}";`);
      assert.ok(
        violations.some((v) => v.rule === "core:names-wave1" && v.name === name),
        `the core file that names ${name} fails with the file, the name and the rule`,
      );
    }
    // a core file that names a sample of the test kit by its path
    const sample = coreNamingViolations(
      graph,
      core,
      FILE,
      "the sample lives in packages/testkit/src/samples/EP-01/;",
    );
    assert.ok(
      sample.some((v) => v.rule === "core:names-sample"),
      "the core file that names a sample path fails with the file, the name and the rule",
    );
    const sampleDir = coreNamingViolations(graph, core, FILE, "see samples/EP-02/ for the form");
    assert.ok(
      sampleDir.some((v) => v.rule === "core:names-sample"),
      "a sample directory names the sample",
    );
    // a core file that names only the shared packages passes
    assert.deepEqual(
      coreNamingViolations(
        graph,
        core,
        FILE,
        'import { a } from "@specstride/contracts";\nimport { b } from "@specstride/kernel";',
      ),
      [],
    );
    // a file of a non-core package that names a Wave 1 implementation is
    // not subject to the naming rule
    assert.deepEqual(
      coreNamingViolations(
        graph,
        "@specstride/adapter-claude",
        "packages/adapter-claude/src/index.ts",
        'import { x } from "@specstride/harness";',
      ),
      [],
    );
  }
});

/** A fixture workspace whose core package breaks one rule of the core. */
function coreFixtureWorkspace(coreSrc: string): string {
  const root = mkdtempSync(join(tmpdir(), "core-boundary-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "core-fixture-root", private: true, workspaces: ["packages/*"] }),
  );
  const dataDir = join(root, "packages/contracts/data");
  mkdirSync(dataDir, { recursive: true });
  const fixtureGraph = {
    schema: "specstride.package-graph/1",
    packages: [
      { name: "@specstride/contracts", layer: "all", mayImport: [], nodeBuiltins: false },
      { name: "@specstride/kernel", layer: "all", mayImport: ["@specstride/contracts"] },
      {
        name: "@specstride/core",
        layer: "L4",
        core: true,
        mayImport: ["@specstride/contracts", "@specstride/kernel"],
      },
      {
        name: "@specstride/harness",
        layer: "L1",
        mayImport: ["@specstride/contracts", "@specstride/kernel"],
      },
    ],
  };
  writeFileSync(join(dataDir, "package-graph.json"), JSON.stringify(fixtureGraph));
  const coreDir = join(root, "packages/core");
  mkdirSync(join(coreDir, "src"), { recursive: true });
  writeFileSync(
    join(coreDir, "package.json"),
    JSON.stringify({ name: "@specstride/core", private: true }),
  );
  writeFileSync(join(coreDir, "src", "index.ts"), coreSrc);
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

test("CT-100-112: the check fails on a core file that imports node:fs (file, import and rule)", () => {
  const root = coreFixtureWorkspace(
    'import { readFileSync } from "node:fs";\nexport const a = readFileSync;\n',
  );
  try {
    const { code, out } = runEntry(root);
    assert.equal(code, 1, out);
    assert.match(out, /packages\/core\/src\/index\.ts:1 imports "node:fs" \[core:no-filesystem\]/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CT-100-112: the check fails on a core file that imports a harness adapter (file, import and rule)", () => {
  const root = coreFixtureWorkspace(
    'import { x } from "@specstride/harness";\nexport const a = x;\n',
  );
  try {
    const { code, out } = runEntry(root);
    assert.equal(code, 1, out);
    assert.match(
      out,
      /packages\/core\/src\/index\.ts:1 imports "@specstride\/harness" \[core:only-contracts-kernel\]/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CT-100-112: the check fails when a core file names a Wave 1 implementation or a sample (file, name and rule)", () => {
  const root = coreFixtureWorkspace(
    'const wave1 = "@specstride/harness";\nconst sample = "packages/testkit/src/samples/EP-01/";\nexport const a = wave1 + sample;\n',
  );
  try {
    const { code, out } = runEntry(root);
    assert.equal(code, 1, out);
    assert.match(
      out,
      /packages\/core\/src\/index\.ts:1 imports "@specstride\/harness" \[core:names-wave1\]/,
    );
    assert.match(
      out,
      /packages\/core\/src\/index\.ts:2 imports "packages\/testkit\/src\/samples\/" \[core:names-sample\]/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CT-100-112: the check passes on a core file that imports only the shared packages", () => {
  const root = coreFixtureWorkspace(
    'import { a } from "@specstride/contracts";\nimport { b } from "@specstride/kernel";\nexport const c = a + b;\n',
  );
  try {
    const { code, out } = runEntry(root);
    assert.equal(code, 0, out);
    assert.match(out, /0 violation/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
