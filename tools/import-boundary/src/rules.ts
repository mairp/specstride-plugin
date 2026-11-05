/**
 * T011 — the graph loader and the import-permission rule of the
 * import-boundary check (annex A, §A.2, F100-FR-001; research.md D-4).
 *
 * The graph is `packages/contracts/data/package-graph.json` (the
 * machine-readable form of annex A §A.1–§A.3, synced into the package by
 * `packages/contracts/scripts/sync.mjs`). A package holds its `layer` and
 * its `mayImport` list; the prose items of a `mayImport` list
 * (`"anything"`, `"every package above"`, `"<pkg> (at build time only)"`)
 * are expanded against the graph, and the layer rule of LR-1 is applied on
 * top of the list.
 *
 * The import statements of every source file are read with the TypeScript
 * compiler (research.md D-4): `import ... from`, `export ... from` and a
 * dynamic `import("…")` — the content of string literals is never an
 * import.
 *
 * A violation is reported with the file, the import and the rule id LR-1
 * (F100-FR-001):
 *
 * - the import is not listed in `mayImport` (after expanding the prose);
 * - the import goes to a higher layer;
 * - an L3 or L4 package imports an L1 package (the engine and the pass loop
 *   import interfaces of L2 and never an implementation of L1);
 * - an L6 package imports an L5 package, or an L5 package imports an L6
 *   package (between the CLI and the runtime root there are only files,
 *   F100-FR-003);
 * - a same-layer import that `mayImport` does not name explicitly.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";

export type GraphEntry = {
  name: string;
  layer?: string;
  owner?: string;
  mayImport?: string[];
  external?: string[];
  optionalExternal?: string[];
  nodeBuiltins?: boolean;
  core?: boolean;
  forbidden?: string[];
  compositionRoot?: boolean;
  /** An edge package: it may touch the file system or start a process (F100-FR-234). */
  edge?: boolean;
  shipped?: string;
  note?: string;
};

export type PackageGraph = {
  schema?: string;
  note?: string;
  annex?: string;
  source?: string;
  published?: string[];
  builtByFeature100?: string[];
  packages: GraphEntry[];
  rules?: string[];
};

/**
 * The layer of a package, as a number: `all` is the bottom (0), L1–L7 are
 * 1–7 (a package of `"L5, L4"` holds the highest, 5), `dev` is above the
 * product (8). A package with no layer yields `null` (the layer rule does
 * not apply to it; the `mayImport` rule still does).
 */
export function parseLayer(layer: string | undefined): number | null {
  if (!layer) return null;
  if (layer === "all") return 0;
  if (layer === "dev") return 8;
  const numbers = [...layer.matchAll(/L(\d)/g)].map((m) => Number(m[1]));
  return numbers.length > 0 ? Math.max(...numbers) : null;
}

/** The graph entry of a package name, or `undefined`. */
export function entryOf(graph: PackageGraph, name: string): GraphEntry | undefined {
  return graph.packages.find((p) => p.name === name);
}

/**
 * The package of the graph that an import specifier targets: the exact
 * name, or the longest graph name that is a prefix followed by `/`
 * (`@specstride/contracts/records/compile` → `@specstride/contracts`).
 */
export function graphPackageOf(graph: PackageGraph, spec: string): string | undefined {
  let best: string | undefined;
  for (const p of graph.packages) {
    if (spec === p.name || spec.startsWith(p.name + "/")) {
      if (best === undefined || p.name.length > best.length) best = p.name;
    }
  }
  return best;
}

/** A concrete `mayImport` item with trailing prose in parentheses stripped. */
function bareItem(item: string): string {
  return item.replace(/\s*\(.*\)\s*$/, "").trim();
}

/** True when the item is a prose list, not a concrete package name. */
export function isProseItem(item: string): boolean {
  return item === "anything" || item === "every package above";
}

/**
 * The set of packages of the graph that the `mayImport` list of an entry
 * names, with the prose lists expanded:
 *
 * - `"anything"` → every package of the graph;
 * - `"every package above"` → every package listed above the entry in the
 *   graph (the layer rule of LR-1 is applied on top of this list);
 * - `"<pkg> (…)"` → the package (the parenthetical is prose).
 */
export function expandMayImport(graph: PackageGraph, entry: GraphEntry): Set<string> {
  const names = graph.packages.map((p) => p.name);
  const out = new Set<string>();
  for (const item of entry.mayImport ?? []) {
    if (item === "anything") {
      for (const n of names) out.add(n);
    } else if (item === "every package above") {
      const index = names.indexOf(entry.name);
      for (let i = 0; i < index; i++) out.add(names[i]);
    } else {
      out.add(bareItem(item));
    }
  }
  return out;
}

/** True when the entry names the package explicitly (a concrete list item). */
export function namesExplicitly(entry: GraphEntry, target: string): boolean {
  return (entry.mayImport ?? []).some((item) => !isProseItem(item) && bareItem(item) === target);
}

export type ImportVerdict = { ok: true } | { ok: false; rule: string; reason: string };

/**
 * The import-permission rule of LR-1 (annex A, §A.2): judge an import of
 * `spec` by the package `fromName`. Returns the violation with the rule id
 * LR-1 when the graph does not permit the import.
 *
 * The rule holds for an import that targets a package of the graph; an
 * external import is judged elsewhere (the undeclared-dependency rule and,
 * for a core package, the core rule of F100-FR-012).
 */
export function judgeImport(graph: PackageGraph, fromName: string, spec: string): ImportVerdict {
  const from = entryOf(graph, fromName);
  if (from === undefined) return { ok: true }; // not a package of the graph
  const target = graphPackageOf(graph, spec);
  if (target === undefined) return { ok: true }; // an external import
  const to = entryOf(graph, target);
  if (to === undefined) return { ok: true };

  const expanded = expandMayImport(graph, from);
  if (!expanded.has(target)) {
    const listed = (from.mayImport ?? []).join(", ") || "(nothing)";
    return {
      ok: false,
      rule: "LR-1",
      reason: `${from.name} may import only: ${listed} — "${target}" is not listed`,
    };
  }

  const lf = parseLayer(from.layer);
  const lt = parseLayer(to.layer);
  if (lf === null || lt === null || lf === 8) return { ok: true }; // dev: the list decides
  if (lt === 8) {
    return {
      ok: false,
      rule: "LR-1",
      reason: `${from.name} may not import the dev package ${target}`,
    };
  }
  if (lt > lf) {
    return {
      ok: false,
      rule: "LR-1",
      reason: `${from.name} (${layerName(from.layer)}) imports ${target} (${layerName(
        to.layer,
      )}): a layer imports only from layers below it and from the contracts package`,
    };
  }
  if (lt === lf && lf !== 0 && !namesExplicitly(from, target)) {
    return {
      ok: false,
      rule: "LR-1",
      reason: `${from.name} imports ${target} of the same layer without naming it in mayImport`,
    };
  }
  if (lf === 3 || lf === 4) {
    if (lt === 1) {
      return {
        ok: false,
        rule: "LR-1",
        reason: `${from.name} (the engine or the pass loop) imports the L1 package ${target}: the engine and the pass loop import interfaces of L2 and never an implementation of L1`,
      };
    }
  }
  if (lf === 6 && lt === 5) {
    return {
      ok: false,
      rule: "LR-1",
      reason: `${from.name} (L6) imports ${target} (L5): between the CLI and the runtime root there are only files (F100-FR-003)`,
    };
  }
  if (lf === 5 && lt === 6) {
    return {
      ok: false,
      rule: "LR-1",
      reason: `${from.name} (L5) imports ${target} (L6): between the CLI and the runtime root there are only files (F100-FR-003)`,
    };
  }
  return { ok: true };
}

function layerName(layer: string | undefined): string {
  return layer ?? "(no layer)";
}

export type ImportStatement = { line: number; spec: string };

/**
 * The import statements of one source file, read with the TypeScript
 * compiler (research.md D-4): static `import` declarations, `export … from`
 * declarations and dynamic `import("…")` calls with a string literal.
 * Duplicates (same line and specifier) are removed.
 */
export function importsOfSource(file: string): ImportStatement[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ES2023,
    true,
  );
  const found: ImportStatement[] = [];
  const record = (node: ts.Node, spec: string): void => {
    found.push({ line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, spec });
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      record(node, node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      record(node, node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "import" &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      record(node, node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const seen = new Set<string>();
  return found.filter((s) => {
    const key = `${s.line}:${s.spec}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Read and parse the package graph. */
export function loadGraph(file: string): PackageGraph {
  const graph = JSON.parse(readFileSync(file, "utf8")) as PackageGraph;
  if (!Array.isArray(graph.packages) || graph.packages.length === 0) {
    throw new Error(`the package graph ${file} holds no packages`);
  }
  const names = new Set<string>();
  for (const p of graph.packages) {
    if (typeof p.name !== "string" || p.name.length === 0)
      throw new Error(`the package graph ${file} holds a package without a name`);
    if (names.has(p.name)) throw new Error(`the package graph ${file} names ${p.name} twice`);
    names.add(p.name);
  }
  return graph;
}
