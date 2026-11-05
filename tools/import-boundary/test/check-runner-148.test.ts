/**
 * T002 of feature 148 — the check runner is registered in the
 * import-boundary check with the imports `@specstride/contracts` and
 * `@specstride/kernel` ONLY.
 *
 * The registration is the entry of `@specstride/check-runner` in
 * `packages/contracts/data/package-graph.json`, which the check reads
 * (`../src/index.ts`, `../src/rules.ts`). This file is what BINDS that entry
 * for feature 148: it fails when the entry gains a third import, when the
 * layer or the edge mark changes, and when the check stops reporting a third
 * import as a violation. The last test runs the entry of the check over a
 * fixture workspace whose check-runner package imports a third package, so
 * the rule is proved by the check itself and not only by its data.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

/** The package feature 148 owns. */
export const CHECK_RUNNER = "@specstride/check-runner";

/** The two packages of the product it may import — and nothing else (T002). */
export const CHECK_RUNNER_MAY_IMPORT = ["@specstride/contracts", "@specstride/kernel"] as const;

const facts = loadLayerFacts();
const graph = facts.graph;
const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = resolve(HERE, "..", "src", "index.ts");

test("T002: the graph registers the check runner at L1, owned by 148, as an edge package", () => {
  const entry = entryOf(graph, CHECK_RUNNER);
  assert.ok(entry !== undefined, `the package graph registers ${CHECK_RUNNER}`);
  assert.equal(entry.layer, "L1", "the check runner is of layer L1");
  assert.equal(parseLayer(entry.layer), 1);
  assert.match(entry.owner ?? "", /148/, "feature 148 owns it");
  // An edge package may touch the file system or start a process on behalf of
  // a core package, behind its interface in the contracts package (annex A
  // §A.3, F100-FR-234). The check runner starts processes, so it is one.
  assert.equal(entry.edge, true, "the check runner is an edge package");
  // It is not core: a core package may not use `node:child_process`, which
  // the kind `command` needs.
  assert.notEqual(entry.core, true, "the check runner is no core package");
});

test("T002: the registered imports are exactly @specstride/contracts and @specstride/kernel", () => {
  const entry = entryOf(graph, CHECK_RUNNER);
  assert.ok(entry !== undefined);
  // The list as it is written: no prose item, so nothing is expanded.
  assert.deepEqual([...(entry.mayImport ?? [])], [...CHECK_RUNNER_MAY_IMPORT]);
  // And the list after the prose items of LR-1 are expanded, which is what
  // the rule judges against: still exactly the two.
  assert.deepEqual([...expandMayImport(graph, entry)].sort(), [...CHECK_RUNNER_MAY_IMPORT].sort());
  for (const allowed of CHECK_RUNNER_MAY_IMPORT) {
    assert.equal(namesExplicitly(entry, allowed), true, `${allowed} is named explicitly`);
  }
});

test("T002: the check permits the two imports and refuses every other package", () => {
  for (const allowed of CHECK_RUNNER_MAY_IMPORT) {
    const verdict = judgeImport(graph, CHECK_RUNNER, allowed);
    assert.equal(verdict.ok, true, `${allowed} is permitted`);
    // A sub-path of a permitted package is permitted too.
    const subpath = judgeImport(graph, CHECK_RUNNER, `${allowed}/records/compile`);
    assert.equal(subpath.ok, true, `${allowed}/records/compile is permitted`);
  }

  // EVERY other package of the graph is a violation of LR-1, named with the
  // rule. This is derived from the graph, so a package added later is covered
  // without touching this test.
  const others = graph.packages
    .map((entry) => entry.name)
    .filter((name) => name !== CHECK_RUNNER && !CHECK_RUNNER_MAY_IMPORT.includes(name as never));
  assert.ok(others.length > 10, `the graph holds other packages (${others.length})`);
  for (const other of others) {
    const verdict = judgeImport(graph, CHECK_RUNNER, other);
    assert.equal(verdict.ok, false, `${other} is refused`);
    if (!verdict.ok) {
      assert.equal(verdict.rule, "LR-1", `${other} is refused with the rule LR-1`);
      assert.match(verdict.reason, /@specstride\/check-runner/);
    }
  }
});

test("T002: the check reports a third import of the check runner over a fixture workspace", () => {
  const root = mkdtempSync(join(tmpdir(), "check-runner-148-"));
  try {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "w", private: true, workspaces: ["packages/*"] }),
    );
    const graphFile = join(root, "graph.json");
    // The three entries of the real graph that the rule needs, copied so the
    // fixture judges the same registration.
    writeFileSync(
      graphFile,
      JSON.stringify({
        packages: [
          { name: "@specstride/contracts", layer: "all", mayImport: [] },
          { name: "@specstride/kernel", layer: "all", mayImport: ["@specstride/contracts"] },
          { name: "@specstride/verification", layer: "L2", mayImport: ["@specstride/contracts"] },
          {
            name: CHECK_RUNNER,
            layer: "L1",
            owner: "148",
            edge: true,
            mayImport: [...CHECK_RUNNER_MAY_IMPORT],
          },
        ],
      }),
    );
    const pkg = join(root, "packages/check-runner");
    mkdirSync(join(pkg, "src"), { recursive: true });
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({
        name: CHECK_RUNNER,
        private: true,
        dependencies: { "@specstride/contracts": "0.0.0", "@specstride/kernel": "0.0.0" },
      }),
    );
    // The two permitted imports, and one that is not registered.
    writeFileSync(
      join(pkg, "src/ok.ts"),
      'import "@specstride/contracts";\nimport "@specstride/kernel";\n',
    );
    writeFileSync(join(pkg, "src/bad.ts"), 'import "@specstride/verification";\n');

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
    assert.match(out, /VIOLATION packages\/check-runner\/src\/bad\.ts:1/);
    assert.match(out, /@specstride\/verification/);
    assert.match(out, /\[LR-1\]/);
    // The two permitted imports are reported as no violation.
    assert.doesNotMatch(out, /src\/ok\.ts/);
    assert.match(out, /1 violation\(s\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("T002: the real workspace passes the check for the files of the check runner", () => {
  // The check over the repository reports no violation whose file is of the
  // check runner: the extracted executor and the folder indexes respect the
  // registration.
  let out = "";
  try {
    out = execFileSync(process.execPath, [CHECK], { encoding: "utf8", cwd: facts.root });
  } catch (err) {
    const e = err as { stdout?: string };
    out = e.stdout ?? "";
  }
  const ofCheckRunner = out
    .split("\n")
    .filter((line) => line.startsWith("VIOLATION packages/check-runner/"));
  assert.deepEqual(ofCheckRunner, [], "no violation of the check runner");
});
