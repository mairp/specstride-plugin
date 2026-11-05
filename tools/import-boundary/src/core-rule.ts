/**
 * T013 — the first core rule (annex A, §A.3, F100-FR-012).
 *
 * A core package (a package of the graph marked `core: true`: the engine
 * with the pass loop and every loop-layer package) fails the check on an
 * import of
 *
 * - any package of the graph other than `@specstride/contracts` and
 *   `@specstride/kernel` (what one core package may import from another is
 *   the `mayImport` rule of T011),
 * - a provider SDK or any external package,
 * - `node:fs` or `node:fs/promises` (files go through the kernel and the
 *   ports of the edge packages, F100-FR-234),
 * - `node:child_process`, `node:net`, `node:http`, `node:https` or
 *   `node:dgram` (no process started and no connection opened directly),
 *
 * each with the file, the import and the rule.
 */
import type { GraphEntry, PackageGraph } from "./rules.ts";
import { graphPackageOf, namesExplicitly } from "./rules.ts";

/** The only packages of the graph a core package may import (F100-FR-012). */
export const CORE_ALLOWED_PACKAGES = ["@specstride/contracts", "@specstride/kernel"] as const;

/** The node built-ins a core package must not import (F100-FR-012, F100-FR-234). */
export const CORE_FORBIDDEN_BUILTINS = [
  "node:fs",
  "node:fs/promises",
  "node:child_process",
  "node:net",
  "node:http",
  "node:https",
  "node:dgram",
] as const;

export type CoreViolation = {
  file: string;
  line: number;
  spec: string;
  rule: string;
  detail: string;
};

/**
 * Judge one import of a core package. Returns the violation with the file,
 * the import and the rule, or `undefined` when the import is permitted.
 *
 * The permitted set: `@specstride/contracts`, `@specstride/kernel`, and —
 * where the graph's `mayImport` names it explicitly — another core package.
 * Everything else (another package of the graph, a provider SDK, any
 * external package, a forbidden built-in) fails the check.
 */
export function coreImportViolation(
  graph: PackageGraph,
  pkgName: string,
  file: string,
  line: number,
  spec: string,
): CoreViolation | undefined {
  const entry: GraphEntry | undefined = graph.packages.find((p) => p.name === pkgName);
  if (entry === undefined || entry.core !== true) return undefined; // not a core package
  if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/")) return undefined;

  if (spec.startsWith("node:")) {
    if ((CORE_FORBIDDEN_BUILTINS as readonly string[]).includes(spec)) {
      const fsRule = spec === "node:fs" || spec === "node:fs/promises";
      return {
        file,
        line,
        spec,
        rule: fsRule ? "core:no-filesystem" : "core:no-process-or-connection",
        detail: fsRule
          ? `a core package reads and writes files through the kernel and the ports of the edge packages (F100-FR-012, F100-FR-234) and must not import ${spec}`
          : `a core package starts no process and opens no connection directly (F100-FR-012): ${spec} is forbidden`,
      };
    }
    return undefined; // the other built-ins are not forbidden by the core rule
  }

  const target = graphPackageOf(graph, spec);
  if (target !== undefined) {
    const allowed = (CORE_ALLOWED_PACKAGES as readonly string[]).includes(target);
    const otherCore = graph.packages.find((p) => p.name === target)?.core === true;
    if (!allowed && !(otherCore && namesExplicitly(entry, target))) {
      return {
        file,
        line,
        spec,
        rule: "core:only-contracts-kernel",
        detail: `a core package may import ${CORE_ALLOWED_PACKAGES.join(" and ")} and nothing else from the product (F100-FR-012): "${target}" is not permitted`,
      };
    }
    return undefined;
  }

  // an external package: a provider SDK or any other external package
  return {
    file,
    line,
    spec,
    rule: "core:only-contracts-kernel",
    detail: `a core package imports no provider SDK and no external package (F100-FR-012): "${spec}" is not permitted`,
  };
}
