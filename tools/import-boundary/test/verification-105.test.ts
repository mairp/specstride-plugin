/**
 * T002 of feature 105 — the verification package is registered in the
 * import-boundary check with the imports `@specstride/contracts` and
 * `@specstride/kernel` ONLY.
 *
 * The registration is the entry of `@specstride/verification` in
 * `packages/contracts/data/package-graph.json`, which the check reads
 * (`../src/index.ts`, `../src/rules.ts`). This file is what BINDS that entry
 * for feature 105: it fails when the entry gains a third import, when the
 * layer or the owner changes, and when the check stops reporting a third
 * import as a violation. The last two tests run the entry of the check — over
 * a fixture workspace whose verification package imports a third package, and
 * over the real workspace — so the rule is proved by the check itself and not
 * only by its data.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLayerFacts } from "../src/layer-facts.ts";
import {
  entryOf,
  expandMayImport,
  judgeImport,
  namesExplicitly,
  parseLayer,
} from "../src/rules.ts";

/** The package feature 105 owns. */
export const VERIFICATION = "@specstride/verification";

/** The two packages of the product it may import — and nothing else (T002). */
export const VERIFICATION_MAY_IMPORT = ["@specstride/contracts", "@specstride/kernel"] as const;

const facts = loadLayerFacts();
const graph = facts.graph;
const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = resolve(HERE, "..", "src", "index.ts");

test("T002: the graph registers the verification package at L1, owned by 105", () => {
  const entry = entryOf(graph, VERIFICATION);
  assert.ok(entry !== undefined, `the package graph registers ${VERIFICATION}`);
  assert.equal(entry.layer, "L1", "the verification package is of layer L1");
  assert.equal(parseLayer(entry.layer), 1);
  assert.match(entry.owner ?? "", /105/, "feature 105 owns it");
  // It is not core: a core package may not read the file system, which
  // discovery, the data files and the safe writes of this package need.
  assert.notEqual(entry.core, true, "the verification package is no core package");
});

test("T002: the registered imports are exactly @specstride/contracts and @specstride/kernel", () => {
  const entry = entryOf(graph, VERIFICATION);
  assert.ok(entry !== undefined);
  // The list as it is written: no prose item, so nothing is expanded.
  assert.deepEqual([...(entry.mayImport ?? [])], [...VERIFICATION_MAY_IMPORT]);
  // And the list after the prose items of LR-1 are expanded, which is what
  // the rule judges against: still exactly the two.
  assert.deepEqual([...expandMayImport(graph, entry)].sort(), [...VERIFICATION_MAY_IMPORT].sort());
  for (const allowed of VERIFICATION_MAY_IMPORT) {
    assert.equal(namesExplicitly(entry, allowed), true, `${allowed} is named explicitly`);
  }
});

test("T002: the manifest of the package declares the same two dependencies", () => {
  const manifest = JSON.parse(
    readFileSync(join(facts.root, "packages/verification/package.json"), "utf8"),
  ) as { name: string; dependencies: Record<string, string> };
  assert.equal(manifest.name, VERIFICATION);
  // The graph and the manifest must agree: a dependency the graph does not
  // register would install and resolve, and the check would never see it.
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), [...VERIFICATION_MAY_IMPORT].sort());
});

test("T002: the check permits the two imports and refuses every other package", () => {
  for (const allowed of VERIFICATION_MAY_IMPORT) {
    const verdict = judgeImport(graph, VERIFICATION, allowed);
    assert.equal(verdict.ok, true, `${allowed} is permitted`);
    // A sub-path of a permitted package is permitted too.
    const subpath = judgeImport(graph, VERIFICATION, `${allowed}/records/compile`);
    assert.equal(subpath.ok, true, `${allowed}/records/compile is permitted`);
  }

  // EVERY other package of the graph is a violation of LR-1, named with the
  // rule. This is derived from the graph, so a package added later is covered
  // without touching this test.
  const others = graph.packages
    .map((entry) => entry.name)
    .filter((name) => name !== VERIFICATION && !VERIFICATION_MAY_IMPORT.includes(name as never));
  assert.ok(others.length > 10, `the graph holds other packages (${others.length})`);
  for (const other of others) {
    const verdict = judgeImport(graph, VERIFICATION, other);
    assert.equal(verdict.ok, false, `${other} is refused`);
    if (!verdict.ok) {
      assert.equal(verdict.rule, "LR-1", `${other} is refused with the rule LR-1`);
      assert.match(verdict.reason, /@specstride\/verification/);
    }
  }
});

test("T002: the check reports a third import of the verification package over a fixture workspace", () => {
  const root = mkdtempSync(join(tmpdir(), "verification-105-"));
  try {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "w", private: true, workspaces: ["packages/*"] }),
    );
    const graphFile = join(root, "graph.json");
    // The entries of the real graph that the rule needs, copied so the
    // fixture judges the same registration.
    writeFileSync(
      graphFile,
      JSON.stringify({
        packages: [
          { name: "@specstride/contracts", layer: "all", mayImport: [] },
          { name: "@specstride/kernel", layer: "all", mayImport: ["@specstride/contracts"] },
          {
            name: "@specstride/check-runner",
            layer: "L1",
            mayImport: ["@specstride/contracts", "@specstride/kernel"],
          },
          {
            name: VERIFICATION,
            layer: "L1",
            owner: "105",
            mayImport: [...VERIFICATION_MAY_IMPORT],
          },
        ],
      }),
    );
    const pkg = join(root, "packages/verification");
    mkdirSync(join(pkg, "src"), { recursive: true });
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({
        name: VERIFICATION,
        private: true,
        dependencies: { "@specstride/contracts": "0.0.0", "@specstride/kernel": "0.0.0" },
      }),
    );
    // The two permitted imports, and one that is not registered. The check
    // runner is the telling case: this feature CALLS it (annex C §C.8) and
    // still may not import it — the call goes through the interface types of
    // the contracts package.
    writeFileSync(
      join(pkg, "src/ok.ts"),
      'import "@specstride/contracts";\nimport "@specstride/kernel";\n',
    );
    writeFileSync(join(pkg, "src/bad.ts"), 'import "@specstride/check-runner";\n');

    let status = 0;
    let out = "";
    try {
      out = execFileSync(process.execPath, [CHECK, "--root", root, "--graph", graphFile], {
        encoding: "utf8",
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: string };
      status = e.status ?? -1;
      out = e.stdout ?? "";
    }
    assert.equal(status, 1, "the check fails on the third import");
    assert.match(out, /VIOLATION packages\/verification\/src\/bad\.ts:1/);
    assert.match(out, /@specstride\/check-runner/);
    assert.match(out, /\[LR-1\]/);
    // The two permitted imports are reported as no violation.
    assert.doesNotMatch(out, /src\/ok\.ts/);
    assert.match(out, /1 violation\(s\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("T002: the real workspace passes the check for the files of the verification package", () => {
  // The check over the repository reports no violation whose file is of the
  // verification package: the extracted modules of Lisa and the folder
  // indexes respect the registration.
  let out = "";
  try {
    out = execFileSync(process.execPath, [CHECK], { encoding: "utf8", cwd: facts.root });
  } catch (err) {
    const e = err as { stdout?: string };
    out = e.stdout ?? "";
  }
  const ofVerification = out
    .split("\n")
    .filter((line) => line.startsWith("VIOLATION packages/verification/"));
  assert.deepEqual(ofVerification, [], "no violation of the verification package");
});
