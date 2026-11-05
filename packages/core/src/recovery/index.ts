/**
 * T001 — the module group `recovery` of feature 101 (plan.md, "Path
 * Conventions"): the recovery cycle of diagnostician and accelerator.
 *
 * | Module | Task | Requirement |
 * |---|---|---|
 * | `index.ts` | T001 | — (the entry of the group) |
 * | `markers.ts` | T083 | F101-FR-021, F101-FR-024 |
 * | `diagnostician.ts` | T084 | F101-FR-020 to F101-FR-022 |
 * | `accelerator.ts` | T085 | F101-FR-024 to F101-FR-026 |
 *
 * The group holds no I/O of its own: the state of the tree around an
 * accelerated phase attempt is read through the check-runner port, because the
 * engine starts no process itself (F100-FR-012, F100-FR-234).
 */
export * from "./markers.ts";
export * as diagnostician from "./diagnostician.ts";
export * as accelerator from "./accelerator.ts";
