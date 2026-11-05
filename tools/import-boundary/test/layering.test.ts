/**
 * T010 — contract tests CT-100-101 to CT-100-104 for the layering rules
 * LR-1 to LR-4 (annex A, §A.2).
 *
 * - CT-100-101 (LR-1, F100-FR-001): the graph refuses an import from a
 *   lower to a higher layer and from L3 or L4 to an L1 package.
 * - CT-100-102 (LR-2, F100-FR-002): a host package may import nothing of
 *   the product but the CLI protocol (the contracts package).
 * - CT-100-103 (LR-3, F100-FR-003): the packages of L6 and L5 share no
 *   import — between the CLI and the runtime root there are only files.
 * - CT-100-104 (LR-4, F100-FR-004): the writers of the control plane in
 *   `layout.json` are packages of the runtime tree only, with the
 *   exceptions the table itself names.
 *
 * The tests run over the data files of the package
 * (`packages/contracts/data/`), the machine-readable form of the annexes,
 * and over the import-permission rule of T011 (`src/rules.ts`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLayerFacts } from "../src/layer-facts.ts";
import { entryOf, expandMayImport, judgeImport, parseLayer } from "../src/rules.ts";
import type { LayoutName } from "../src/layer-facts.ts";

const facts = loadLayerFacts();
const graph = facts.graph;

/** The graph packages of one layer (the layer number, 1–7). */
function packagesOfLayer(layer: number): string[] {
  return graph.packages.filter((p) => parseLayer(p.layer) === layer).map((p) => p.name);
}

test("CT-100-101: the graph refuses an import from a lower to a higher layer (LR-1)", () => {
  for (const from of graph.packages) {
    const lf = parseLayer(from.layer);
    if (lf === null || lf === 8) continue; // no layer, or dev: the list decides
    for (const to of graph.packages) {
      const lt = parseLayer(to.layer);
      if (lt === null || lt === 0) continue; // "all" is below every layer
      if (lt > lf) {
        const verdict = judgeImport(graph, from.name, to.name);
        assert.equal(
          verdict.ok,
          false,
          `the graph must refuse ${from.name} (layer ${lf}) importing ${to.name} (layer ${lt})`,
        );
        if (!verdict.ok) assert.equal(verdict.rule, "LR-1");
      }
    }
  }
});

test("CT-100-101: the graph refuses an import from L3 or L4 to an L1 package (LR-1)", () => {
  const l1 = packagesOfLayer(1);
  assert.ok(l1.length > 0, "the graph holds L1 packages");
  for (const from of [...packagesOfLayer(3), ...packagesOfLayer(4)]) {
    for (const to of l1) {
      const verdict = judgeImport(graph, from, to);
      assert.equal(
        verdict.ok,
        false,
        `the graph must refuse ${from} (L3/L4) importing the L1 package ${to}`,
      );
      if (!verdict.ok) assert.equal(verdict.rule, "LR-1");
    }
  }
});

test("CT-100-101: the layer rule stands on top of the prose of mayImport (LR-1)", () => {
  // The runtime root lists "every package above"; the prose names the L6
  // packages, but the layer rule of LR-1 refuses every one of them.
  for (const to of [...packagesOfLayer(6), ...packagesOfLayer(7)]) {
    const verdict = judgeImport(graph, facts.runtimeRootPackage, to);
    assert.equal(verdict.ok, false, `the runtime root must not import ${to}`);
  }
  // A same-layer import that mayImport does not name explicitly is refused.
  const verdict = judgeImport(graph, facts.cliPackage, "@specstride/view");
  assert.equal(verdict.ok, false);
  // A same-layer import that mayImport names explicitly is permitted.
  const named = judgeImport(graph, "@specstride/adapter-pi", "@specstride/adapter-prime");
  assert.equal(named.ok, true, "the graph rule names the pi/prime JSONL reader explicitly");
});

test("CT-100-102: a host package may import nothing of the product but the CLI protocol (LR-2)", () => {
  assert.ok(facts.hostPackages.length > 0, "the graph holds host packages (layer L7)");
  for (const host of facts.hostPackages) {
    const entry = entryOf(graph, host);
    assert.ok(entry !== undefined, `the graph holds ${host}`);
    // The only package the host may import is @specstride/contracts, the
    // package that holds the CLI protocol (data/cli-protocol.json,
    // annex G).
    const expanded = [...expandMayImport(graph, entry)];
    for (const named of expanded) {
      assert.equal(
        named,
        "@specstride/contracts",
        `the host ${host} may import only the contracts package; found ${named}`,
      );
    }
    for (const to of graph.packages) {
      if (to.name === "@specstride/contracts") continue;
      const verdict = judgeImport(graph, host, to.name);
      assert.equal(
        verdict.ok,
        false,
        `the host ${host} must not import ${to.name}: a host reaches the product only through the CLI protocol of annex G`,
      );
    }
  }
});

test("CT-100-103: the packages of L6 and L5 share no import (LR-3)", () => {
  const l6 = packagesOfLayer(6);
  const l5 = packagesOfLayer(5);
  assert.ok(l6.length > 0, "the graph holds L6 packages");
  assert.ok(l5.length > 0, "the graph holds L5 packages");
  for (const a of l6) {
    for (const b of l5) {
      assert.equal(
        judgeImport(graph, a, b).ok,
        false,
        `${a} (L6) and ${b} (L5) share an import: between the CLI and the runtime root there are only files (F100-FR-003)`,
      );
      assert.equal(
        judgeImport(graph, b, a).ok,
        false,
        `${b} (L5) and ${a} (L6) share an import: between the CLI and the runtime root there are only files (F100-FR-003)`,
      );
    }
  }
});

/**
 * The writer domains of the control plane (F100-FR-004, the table of
 * annex B §B.5): the runtime tree — the runtime root and the engine, with
 * the aliases the table names — and the exceptions the table itself names
 * (the writer domain of learning, the lock provider, the compatibility
 * projection, the stream adapter, the exporters, the harness and its
 * adapter, the job through the engine, and the CLI where F100-FR-003 gives
 * it the file as writer).
 */
function allowedControlWriter(writer: string, name: LayoutName): string | undefined {
  if (
    /^(runtime root|runtime$|engine|the one event writer|the job, through the engine)/i.test(writer)
  ) {
    return undefined; // the runtime tree
  }
  const exceptions = [
    "Learning (own writer domain)",
    "Lock provider",
    "Compatibility projection",
    "Stream adapter",
    "Exporter",
    "Harness adapter",
    "Harness",
  ];
  if (exceptions.includes(writer)) return undefined;
  if (writer.startsWith("— (resolves")) return undefined; // a resolver, not a writer
  if (writer.startsWith("CLI at launch")) return undefined; // the records written before a runtime exists (F100-FR-003)
  if (writer.startsWith("CLI") && !name.logicalName.startsWith("run:")) return undefined; // the inbox and launch records (F100-FR-003)
  return `writer "${writer}" of ${name.logicalName} is not a package of the runtime tree`;
}

test("CT-100-104: the writers of the control plane are packages of the runtime tree only (LR-4)", () => {
  const control = facts.layout.logicalNames.filter((n) =>
    n.root.toLowerCase().startsWith("control"),
  );
  assert.ok(control.length > 0, "the layout holds control plane logical names");
  for (const name of control) {
    const whole = name.writer.trim();
    if (allowedControlWriter(whole, name) === undefined) continue;
    // a compound writer: every token must be of the runtime tree or a
    // named exception
    const tokens = whole.split(/;\s*|,\s*(?=engine|runtime|learning)/i);
    for (const token of tokens) {
      const problem = allowedControlWriter(token.trim(), name);
      assert.equal(problem, undefined, problem ?? "");
    }
  }
  // no process writes the liveness conditions as a state: no logical name
  // of the control plane is named dead, stale or launch-abandoned
  for (const name of control) {
    assert.ok(!/^run:<runId>:(dead|stale|launch-abandoned)$/.test(name.logicalName));
  }
});
