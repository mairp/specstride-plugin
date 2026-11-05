/**
 * `@specstride/layer-parallel` — the loop layer `parallel` (feature 142, T001).
 *
 * The layer sits at L3 above `micro`, behind the loop-layer interface of
 * EP-04. It is a pure decision component: it returns directives and the
 * engine executes them. The option is off by default and off under the
 * `parity` profile (owner ruling 56).
 *
 * Import rules, from `packages/contracts/data/package-graph.json` (the
 * authority; LR-1 and the core rule of F100-FR-012, F100-FR-234):
 *
 * - the entry of this package is `layer: "L3"`, `owner: "142"`,
 *   `core: true`, `mayImport: ["@specstride/contracts",
 *   "@specstride/kernel"]`;
 * - being marked `core`, no module of `src/` imports `node:fs`,
 *   `node:fs/promises`, `node:child_process`, `node:net`, `node:http`,
 *   `node:https` or a provider SDK. Files, processes and git are reached
 *   through the kernel services and through the ports of the edge packages
 *   — the tree store (owner 143), the check runner (owner 148) and the
 *   integrity package (owner 116) — behind their interfaces in
 *   `@specstride/contracts`, never by importing them. The second core rule
 *   forbids a core file to name those packages at all, so this file names
 *   them by their role;
 * - the kernel services of annex A §A.3 arrive as arguments from the
 *   composition root; no module reads them from a platform module.
 *
 * The modules the later phases add under `src/` are named in
 * `specs/142-parallel-units/plan.md`, "Source Code": `types.ts`,
 * `register.ts`, `preconditions.ts`, `scope.ts`, `admission.ts`, `plan.ts`,
 * `decide.ts`, `blocks.ts`, `facts.ts`, `doctor.ts`. The engine-side module
 * group of this feature is `packages/core/src/parallel/`.
 */

/** The name of this package in the package graph. */
export const PACKAGE_NAME = "@specstride/layer-parallel" as const;

/** The layer of this package in the package graph (annex A §A.1). */
export const PACKAGE_LAYER = "L3" as const;

/**
 * The only packages a module of `src/` may import, as `mayImport` of the
 * package graph lists them for this package (LR-1).
 */
export const MAY_IMPORT = ["@specstride/contracts", "@specstride/kernel"] as const;

/**
 * The data this feature owns, copied from
 * `specs/142-parallel-units/contracts/` into `data/` (T002). The copy is
 * byte-identical to the specification's and is compared with `spec.md` by
 * `test/data.test.ts`. Where a file and `spec.md` differ, `spec.md` stands.
 */
export const DATA_FILES = [
  "closed-sets.json",
  "loop-fields.json",
  "vocabulary.json",
  "fx-par.json",
] as const;

/** The engine-side module group of this feature, inside `@specstride/core`. */
export const CORE_MODULE_GROUP = "packages/core/src/parallel" as const;

/**
 * The types of the plan, the scope, the group, the verdict of the audits and
 * the five closed sets this feature owns (T003, `src/types.ts`).
 */
export * from "./types.ts";

/**
 * The write scope: its normalisation, its comparison at path boundaries, and
 * the two sources it may come from (T018, T019, `src/scope.ts`).
 */
export * from "./scope.ts";

/**
 * Candidates, the eight admission checks and the groups of 2 to `workers`
 * consecutive admitted tasks (T016, T017, T020, `src/admission.ts`).
 */
export * from "./admission.ts";

/**
 * The worker count of a group: the default, the ceiling in force and the
 * halving after two transient rate limits (T022, `src/plan.ts`).
 */
export * from "./plan.ts";

/**
 * The decisions that start and integrate a group: the clean pass boundary, the
 * reservation, and the group directives through which — with the tree-store
 * service — every worker tree and every write to the workspace is obtained
 * (T021, T025, `src/decide.ts`).
 */
export * from "./decide.ts";

/**
 * The registration of the layer behind `loop.parallel.units`, and its
 * inertness with the option off or with no group started (T041, T045,
 * `src/register.ts`).
 */
export * from "./register.ts";

/**
 * The eight preconditions and the fallback reason each announces, containment
 * C2 with `loop.parallel.allow_detect`, and what the registry is read for
 * (T042, T043, T052, `src/preconditions.ts`).
 */
export * from "./preconditions.ts";

/**
 * The three blocks a proposer is told about parallel work: the worker block, the
 * reserved-tasks block and the neutral handoff (T088, `src/blocks.ts`).
 */
export * from "./blocks.ts";

/**
 * What a critic-class call is given: one unit per integrated group, the two
 * neutral integrity kinds, and what is withheld (T084 to T086, `src/facts.ts`).
 */
export * from "./facts.ts";

/**
 * The doctor checks of this feature, registered through EP-14: the plan with
 * the option on, the resources it cannot check, and the five breach
 * invariants (T104, `src/doctor.ts`).
 */
export * from "./doctor.ts";
