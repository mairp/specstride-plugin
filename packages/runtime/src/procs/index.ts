/**
 * `packages/runtime/src/procs/` — the process registry (plan.md, "Project
 * Structure"; spec.md F122-FR-023 to F122-FR-028, F122-FR-042).
 *
 * The entries with their classes `owned` and `adoptable`, the run token, the
 * identity check before a signal, the stop primitives extracted from Lisa,
 * the search for survivors and adoption. The process primitive itself lives
 * in `@specstride/kernel` (T075); no run policy lives there.
 *
 * Filled by: T010 (`platform.ts`), T013 (`run-token.ts`), T053
 * (`registry.ts`), T054 (`identity.ts`), T055 (`stop-primitives.ts`), T057
 * (`survivors.ts`, `adopt.ts`).
 */
export * from "./platform.ts";
export * from "./run-token.ts";
export * from "./registry.ts";
export * from "./identity.ts";
export * as stopPrimitives from "./stop-primitives.ts";
export * from "./survivors.ts";
export * as adopt from "./adopt.ts";
