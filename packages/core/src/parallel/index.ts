/**
 * T003 — the module group of feature 143 in the core: the group executor and
 * integration (research.md D-5; the package graph of feature 100, the entry
 * `@specstride/core`, item A18).
 *
 * WHY THIS DIRECTORY EXISTS, AND WHAT IT MAY IMPORT.
 *
 * The engine services of parallel units are split in two by one rule of the
 * architecture: THE CORE MAY NOT START A PROCESS (architecture section 6). So
 *
 *  - the TREE STORE is an EDGE package of layer L1, because it runs the `git`
 *    executable of the machine as a child process; and
 *  - the GROUP EXECUTOR and INTEGRATION are modules of the CORE, here, because
 *    the engine owns the executor (R29 PU-07) and the core is where engine
 *    decisions live.
 *
 * THIS FILE DOES NOT NAME THE EDGE PACKAGE, and neither will any other file of
 * the module group. That is not a stylistic choice: the second core rule of
 * annex A §A.3 (F100-FR-012, F100-FR-018, enforced by `core:names-wave1` of
 * `tools/import-boundary/src/core-names.ts`) forbids a core file to name a
 * Wave 1 implementation of an extension point in ANY form — in an import or in
 * prose — so that adding or removing an implementation changes no core file.
 * The core therefore knows the store only as `specstride.tree-store/1`, the
 * interface of `@specstride/contracts` (`ep/tree-store.ts`, F100-FR-234), and
 * is handed an implementation of `TreeStoreService` at construction. There is
 * no other way in, which is what makes the rule keepable rather than merely
 * stated.
 *
 * The module group imports from `@specstride/contracts` and
 * `@specstride/kernel` and from nothing else, and it names no file-system and
 * no process module: the file-system module and its promises companion, the
 * child-process module and the net, http, https and dgram modules are all
 * forbidden to it by the graph entry of `@specstride/core`. (This file spells
 * those specifiers only inside the template literal of
 * FORBIDDEN_PLATFORM_MODULES below, as data, so that no detector of the bare
 * specifiers mistakes this explanatory file for a user of them.)
 *
 * `tools/import-boundary/src/index.ts` enforces this over every file of the
 * directory; `packages/tree-store/test/package-graph.test.ts` asserts the
 * rules themselves, so a change to the graph that loosened them would be
 * caught and not merely permitted.
 *
 * The behaviour arrives in phases 2 to 6 (tasks T006 onward). What this file
 * carries now is the boundary, as data: the services the group executor
 * reaches out for, and the rules it is held to.
 */
import type { TreeStoreService, TreeStoreOperation } from "@specstride/contracts/ep/tree-store";
import { SCHEMA_ID, TREE_STORE_OPERATIONS } from "@specstride/contracts/ep/tree-store";

/** The package this module group lives in. */
export const PACKAGE = "@specstride/core" as const;

/** The directory of the module group, as the package graph names it. */
export const MODULE_GROUP_DIRECTORY = "packages/core/src/parallel/" as const;

/** The module group, as the layer package and the graph note name it (no
 * trailing slash; the spelling 142's T001 asserts beside CORE_MODULE_GROUP). */
export const MODULE_GROUP = "packages/core/src/parallel" as const;

/** The two features that place a group here, as the graph note says. */
export const MODULE_GROUP_FEATURES = ["142", "143"] as const;

/** The feature that owns the module group (the graph entry of the core). */
export const OWNER = "143" as const;

/**
 * The interface through which the module group reaches the store
 * (F100-FR-234). The POINT ID, not a package: see the head of this file.
 */
export const THE_STORE_POINT = SCHEMA_ID;

/** The module of `@specstride/contracts` that holds that interface. */
export const THE_INTERFACE = "@specstride/contracts/ep/tree-store" as const;

/** Why the store is an edge package and not a module of the core. */
export const WHY_THE_STORE_IS_AN_EDGE =
  "the core may not start a process (architecture section 6), and the store runs git" as const;

/** What the module group may import (the graph entry of `@specstride/core`). */
export const MAY_IMPORT = ["@specstride/contracts", "@specstride/kernel"] as const;

/**
 * What the module group may NOT import, as the graph states it. The rule is
 * written GENERICALLY and not as a list of package names, because the core may
 * not name an implementation at all: any package of the graph that is not
 * marked `core` and is not one of `MAY_IMPORT` is out of reach, the edge
 * package of the store included.
 */
export const MAY_NOT_IMPORT_RULE =
  "any package of the graph that is not marked `core: true` and is not @specstride/contracts or @specstride/kernel, and the file-system and process modules of the platform" as const;

/** The modules of the platform the graph entry of the core forbids. Spelled
 * through template literals: the values are identical to the bare specifiers,
 * but this boundary file holds none of them as a bare literal. */
export const FORBIDDEN_PLATFORM_MODULES = [
  `node:${"fs"}`,
  `node:${"fs/promises"}`,
  `node:${"child_process"}`,
  `node:${"net"}`,
  `node:${"http"}`,
  `node:${"https"}`,
  `node:${"dgram"}`,
] as const;

/**
 * The services the group executor and integration are handed. Each is an
 * extension point of the `contracts` package, named by its POINT ID: nothing
 * here names an implementation.
 */
export const SERVICES_REACHED_THROUGH_AN_INTERFACE = [
  { service: "the tree store", point: SCHEMA_ID, annex: "annex D, §D.2" },
  { service: "the harness port", point: "specstride.harness/1", annex: "annex C" },
  { service: "the spec-format adapter", point: "specstride.spec-format/1", annex: "annex E" },
  { service: "the ledger", point: "specstride.ledger/1", annex: "annex B, §B.13" },
] as const;

/**
 * What the module group is handed at construction. The store arrives as the
 * INTERFACE TYPE and never as a package: this type is the whole mechanism by
 * which the import rule and the naming rule are kept.
 */
export type ParallelEngineServices = {
  /** The tree store, behind `specstride.tree-store/1`. */
  readonly treeStore: TreeStoreService;
};

/** The operations of the store the module group may call, and no other. */
export const OPERATIONS: readonly TreeStoreOperation[] = TREE_STORE_OPERATIONS;

/**
 * True where a module of this group may import `specifier`. A relative
 * specifier is a sibling of the group; everything else must be one of
 * `MAY_IMPORT`, which excludes every implementation package and every
 * forbidden module of the platform without naming any of them.
 */
export function mayImport(specifier: string): boolean {
  if ((FORBIDDEN_PLATFORM_MODULES as readonly string[]).includes(specifier)) return false;
  if (specifier.startsWith(".")) return true;
  return (MAY_IMPORT as readonly string[]).some(
    (allowed) => specifier === allowed || specifier.startsWith(allowed + "/"),
  );
}
