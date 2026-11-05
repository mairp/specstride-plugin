/**
 * The check manifest of a phase: its derivation from the verification plan at
 * launch, its hash, and its comparison on a relaunch (`plan.md`, "Project
 * Structure"; F105-FR-020, F105-FR-021).
 *
 * Phase 4 fills it: `./derive.ts` is the derivation at launch with the intake
 * of declared reads and writes from the launch contract (T096, T148), and
 * `./compare.ts` the comparison on a relaunch and on a `resume` (T097).
 */
export * from "./derive.ts";
export * from "./compare.ts";
