/**
 * T235 — the layer facts of `layers.json` and of the package graph,
 * exported as data for the contract tests of LR-2 to LR-11 (annex A, §A.2).
 *
 * The facts:
 *
 * - the layer of every package (`layerOf`), and the table of the layers
 *   (`layers.json`, annex A §A.1);
 * - the packages of the runtime tree (the runtime root and the engine,
 *   F100-FR-004);
 * - the host packages (the packages of layer L7, F100-FR-002);
 * - the ingress package (the one package that redacts text from outside the
 *   runtime and cuts it to a size cap, F100-FR-009);
 * - the writer of each logical name (the `writer` column of
 *   `layout.json`);
 * - the five pure tables of F100-FR-007 and their evaluator — the one
 *   table evaluator of the kernel, the only evaluator named in the graph;
 * - the package of role resolution (the harness layer, F100-FR-008);
 * - the packages of the loop layer (L3 and L4) that must not call role
 *   resolution (F100-FR-008).
 *
 * Every fact is derived from the data files of `packages/contracts/data/`
 * (the machine-readable form of the annexes, synced by
 * `packages/contracts/scripts/sync.mjs`); where the derivation is ambiguous
 * the loader fails, because the annexes stand.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGraph, parseLayer } from "./rules.ts";
import type { GraphEntry, PackageGraph } from "./rules.ts";

export type LayerRow = {
  Layer: string;
  Name: string;
  "What it holds": string;
  Lifetime: string;
};

export type LayersDoc = {
  schema?: string;
  note?: string;
  annex?: string;
  layers: LayerRow[];
  extensionPoints?: Array<Record<string, unknown>>;
};

export type LayoutName = {
  logicalName: string;
  root: string;
  writer: string;
  readers?: string;
  content?: string;
  path?: string;
};

export type LayoutDoc = {
  schema?: string;
  note?: string;
  annex?: string;
  layoutVersion?: string;
  roots?: Record<string, string>;
  locations?: Array<Record<string, unknown>>;
  logicalNames: LayoutName[];
};

export type LayerFacts = {
  root: string;
  graph: PackageGraph;
  layers: LayersDoc;
  layout: LayoutDoc;
  /** The layer of every package of the graph (`null` where the graph holds none). */
  layerOf: Record<string, number | null>;
  /** The runtime tree: the runtime root and the engine (F100-FR-004). */
  runtimeTree: { runtimeRoot: string; engine: string };
  /** The host packages (layer L7, F100-FR-002). */
  hostPackages: string[];
  /** The one ingress package (F100-FR-009). */
  ingressPackage: string;
  /** The writer of each logical name (`layout.json`, the `writer` column). */
  writers: Record<string, string>;
  /** The five pure tables of F100-FR-007, each mapped to its evaluator. */
  pureTables: Record<string, string>;
  /** The one table evaluator named in the graph (F100-FR-007, F100-FR-204). */
  tableEvaluator: string;
  /** The package of role resolution (the harness layer, F100-FR-008). */
  roleResolutionPackage: string;
  /** The packages of the loop layer: L3 and L4 (F100-FR-008). */
  loopLayerPackages: string[];
  /** The CLI package (L6) and the runtime root package (L5) of F100-FR-003. */
  cliPackage: string;
  runtimeRootPackage: string;
};

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

/** The repository root: four levels up from this file (tools/import-boundary/src). */
export function defaultRoot(): string {
  const file = dirname(fileURLToPath(import.meta.url)); // …/tools/import-boundary/src
  return dirname(dirname(dirname(file))); // the repository root
}

function dataDir(root: string): string {
  return join(root, "packages/contracts/data");
}

/** The owner number the kernel entry gives to the redactor (`111 (redactor)`). */
function redactorOwner(graph: PackageGraph): string {
  const kernel = graph.packages.find((p) => p.name === "@specstride/kernel");
  if (kernel === undefined) throw new Error("the graph holds no @specstride/kernel package");
  const match = /(\d+)\s*\(([^)]*redactor[^)]*)\)/i.exec(kernel.owner ?? "");
  if (match === null) {
    throw new Error(`the owner field of @specstride/kernel names no redactor: ${kernel.owner}`);
  }
  return match[1];
}

/**
 * The layer facts of `layers.json` and of the package graph over the
 * package data of `root` (default: the repository root).
 */
export function loadLayerFacts(root?: string): LayerFacts {
  const base = root ?? defaultRoot();
  const dir = dataDir(base);
  for (const name of ["layers.json", "package-graph.json", "layout.json"]) {
    if (!existsSync(join(dir, name))) {
      throw new Error(`the package data is missing: ${join(dir, name)} (run the sync script)`);
    }
  }
  const graph = loadGraph(join(dir, "package-graph.json"));
  const layers = readJson<LayersDoc>(join(dir, "layers.json"));
  const layout = readJson<LayoutDoc>(join(dir, "layout.json"));

  const layerOf: Record<string, number | null> = {};
  for (const p of graph.packages) layerOf[p.name] = parseLayer(p.layer);

  // The runtime tree (F100-FR-004): the runtime root is the composition
  // root of the graph; the engine is the core package of layer L4.
  const roots = graph.packages.filter((p) => p.compositionRoot === true);
  if (roots.length !== 1) {
    throw new Error(
      `the graph must name exactly one composition root (runtime root); found: ${roots.map((p) => p.name).join(", ") || "none"}`,
    );
  }
  const engines = graph.packages.filter((p) => p.core === true && (p.layer ?? "").includes("L4"));
  if (engines.length !== 1) {
    throw new Error(
      `the graph must name exactly one engine (the core package of L4); found: ${engines.map((p) => p.name).join(", ") || "none"}`,
    );
  }

  // The host packages (F100-FR-002): the packages of layer L7.
  const hostPackages = graph.packages.filter((p) => layerOf[p.name] === 7).map((p) => p.name);

  // The ingress package (F100-FR-009): the one package that owns the
  // redactor named by the kernel entry, besides the kernel itself.
  const owner = redactorOwner(graph);
  const candidates = graph.packages
    .filter((p) => p.name !== "@specstride/kernel")
    .filter((p) => {
      const own = p.owner ?? "";
      return own
        .split(/[,;]/)
        .map((part) => part.trim().split(" ")[0])
        .includes(owner);
    });
  if (candidates.length !== 1) {
    throw new Error(
      `exactly one package must own the redactor (owner ${owner}) beside the kernel; found: ${candidates.map((p) => p.name).join(", ") || "none"}`,
    );
  }

  // The writers of the logical names (the `writer` column of layout.json).
  const writers: Record<string, string> = {};
  for (const name of layout.logicalNames) writers[name.logicalName] = name.writer;

  // The one table evaluator named in the graph (F100-FR-007, F100-FR-204):
  // the package whose owner field names the table evaluator.
  const evaluators = graph.packages.filter((p) => (p.owner ?? "").includes("table evaluator"));
  if (evaluators.length !== 1) {
    throw new Error(
      `exactly one package of the graph must name the table evaluator; found: ${evaluators.map((p) => p.name).join(", ") || "none"}`,
    );
  }
  const tableEvaluator = evaluators[0].name;
  const pureTables: Record<string, string> = {};
  for (const table of [
    "router",
    "quota classifier",
    "relaunch classifier",
    "lane derivation",
    "terms gate",
  ]) {
    pureTables[table] = tableEvaluator;
  }

  // The package of role resolution (F100-FR-008): the harness layer — the
  // package of the graph that is named `@specstride/harness`, of layer L1.
  const harness = graph.packages.filter((p) => p.name === "@specstride/harness");
  if (harness.length !== 1 || layerOf["@specstride/harness"] !== 1) {
    throw new Error(
      "role resolution lives in the harness layer: @specstride/harness must be a package of layer L1",
    );
  }
  const roleResolutionPackage = "@specstride/harness";

  // The loop layer (F100-FR-008): the packages of L3 and L4.
  const loopLayerPackages = graph.packages
    .filter((p) => layerOf[p.name] === 3 || layerOf[p.name] === 4)
    .map((p) => p.name);

  // The CLI (L6) and the runtime root (L5) of F100-FR-003.
  const cli = graph.packages.find((p) => p.name === "@specstride/cli");
  if (cli === undefined || layerOf["@specstride/cli"] !== 6) {
    throw new Error("@specstride/cli must be a package of layer L6");
  }

  return {
    root: base,
    graph,
    layers,
    layout,
    layerOf,
    runtimeTree: { runtimeRoot: roots[0].name, engine: engines[0].name },
    hostPackages,
    ingressPackage: candidates[0].name,
    writers,
    pureTables,
    tableEvaluator,
    roleResolutionPackage,
    loopLayerPackages,
    cliPackage: "@specstride/cli",
    runtimeRootPackage: roots[0].name,
  };
}

/** The graph entry of a package name (re-exported for the contract tests). */
export function entryOf(graph: PackageGraph, name: string): GraphEntry | undefined {
  return graph.packages.find((p) => p.name === name);
}
