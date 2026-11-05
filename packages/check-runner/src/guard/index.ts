/**
 * The guards of a start: one runner for every check, no start while a pass
 * lives, and the integrity rules that hold with a loop layer off — the hash
 * of the check manifest, the pin and the search path (plan.md, "Project
 * Structure"; F148-FR-005, F148-FR-010).
 *
 * Phase 1 creates the folder of `plan.md`. Phase 3 (T023) fills `one-runner.ts`
 * and phase 4 (T029) fills `integrity.ts`.
 */
export * from "./one-runner.ts";
export * from "./integrity.ts";
