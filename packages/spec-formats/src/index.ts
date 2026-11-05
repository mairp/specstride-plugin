/**
 * `@specstride/spec-formats` — the one owner of the spec grammar (feature 104,
 * principle IV). This module is the package's whole public surface: the engine,
 * the critic, the derivation of the launch contract, the command line, the
 * doctor and the run view read what is re-exported here and parse no phase
 * heading and no task line themselves (F104-FR-008).
 *
 * T002 (phase 1) creates the package with strict TypeScript. The modules the
 * later phases add, each named by `specs/104-spec-input/plan.md` under
 * "Source Code (repository root)", are re-exported from here as they land.
 * Phase 2 landed the first two:
 *
 *  - `model.ts` (T006) — the canonical model, the source record and the closed
 *    sets, which every other module of the package speaks in;
 *  - `registry.ts` (T008) — the registry of adapters, with its priority bands
 *    and the detection order of F104-FR-005.
 *
 * Phase 3 landed four more, the resolution and detection of User Story 1:
 *
 *  - `resolve.ts` (T014) — the resolution order, the explicit path and the
 *    listings of a failed resolution;
 *  - `slug.ts` (T015) — feature selection and the one slug rule;
 *  - `errors.ts` (T017) — the four caller errors of F104-FR-018;
 *  - and `registry.ts` gained the built-in detection rules of steps 2 to 6 and
 *    the inputs `spec.format` and `spec.feature` (T016).
 *
 * Phase 4 landed the ONE GRAMMAR and the operations the model carries:
 *
 *  - `adapters/native.ts` (T024), `adapters/speckit-tasks.ts` (T025) and
 *    `adapters/openspec-change.ts` (T026) — the three grammars of Wave 1, each
 *    the as-is grammar of its format (F104-FR-011 to F104-FR-013), joined to
 *    their detection halves by `adapters/index.ts`;
 *  - `model.ts` gained the structured tasks and the checkbox syntax every
 *    format shares (T027);
 *  - `validate.ts` (T028) — `parse`, phase access and the findings;
 *  - `context.ts` (T029) — the context documents and the budget;
 *  - `tick.ts` (T030) — `tick`, which changes checkbox bytes and nothing else.
 *
 * Phase 5 landed the staleness verdict: `sources.ts` (T035), `verdict.ts`
 * (T036, beside `packages/kernel/src/hasher/staleness.ts`) and
 * `task-reading.ts` (T037).
 *
 * Phase 6 landed the PUBLIC VERB:
 *
 *  - `verb.ts` (T039) — the eleven subcommands of `specstride spec`, their five
 *    flags, the four exit codes of the row `spec` of annex G §G.4 and the opt-in
 *    `--json`. `first-unapproved` takes the engine's verification of an approval
 *    record (F101-FR-031) as a PORT that the CLI hands over, and the module
 *    verifies no signature itself (F104-FR-019, research D-12).
 *
 * The modules are re-exported as NAMESPACES, not flattened: several of them
 * carry a `REQUIREMENTS` and a `BEHAVIOUR_ROWS` of their own, and a flat
 * re-export would have to drop or rename them, which would hide which module a
 * requirement belongs to.
 *
 * The package may import `@specstride/contracts` and `@specstride/kernel` and
 * nothing else; the hasher it calls is a module of the kernel that this feature
 * builds (`specs/100-specstride/contracts/data/package-graph.json`, research D-9).
 */

/** The name of this package, as the package graph of feature 100 gives it. */
export const PACKAGE_NAME = "@specstride/spec-formats";

/**
 * The port this package implements, by the identifier of annex C §C.7 of
 * feature 100. The operations are `detect`, `parse`, `validate`, `tick` and
 * `inputs` (F104-FR-009); `model.ts` declares their types, and `SpecGrammar`
 * is the record the three adapters of phase 4 fill in.
 */
export const EXTENSION_POINT = "specstride.spec-format/1";

/** The modules of the package, as namespaces (see the note above). */
export * as model from "./model.ts";
export * as registry from "./registry.ts";
export * as resolve from "./resolve.ts";
export * as slug from "./slug.ts";
export * as errors from "./errors.ts";
export * as adapters from "./adapters/index.ts";
export * as validate from "./validate.ts";
export * as context from "./context.ts";
export * as tick from "./tick.ts";
export * as sources from "./sources.ts";
export * as verdict from "./verdict.ts";
export * as taskReading from "./task-reading.ts";
export * as verb from "./verb.ts";

/** The modules of the package that are built, in the order the phases added them. */
export const MODULES = Object.freeze([
  "model.ts",
  "registry.ts",
  "resolve.ts",
  "slug.ts",
  "errors.ts",
  "adapters/native.ts",
  "adapters/speckit-tasks.ts",
  "adapters/openspec-change.ts",
  "adapters/index.ts",
  "validate.ts",
  "context.ts",
  "tick.ts",
  "sources.ts",
  "verdict.ts",
  "task-reading.ts",
  "verb.ts",
]);
