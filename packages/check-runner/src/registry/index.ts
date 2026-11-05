/**
 * The EP-05 registry of the check runner: the operations `pin`, `start`,
 * `poll`, `result`, `cancel` and `environment`, the handles and the process
 * group of one check (plan.md, "Project Structure"; F148-FR-001,
 * F148-FR-019).
 *
 * Phase 2 (T009) registers the switches of the `parity` profile this feature
 * owns — rows 6, 7, 31 and 125 of annex X §X.7 — in `switches.ts`; importing
 * this module registers them. Phase 3 (T019, T066) fills the operations.
 *
 * Phase 5 (T033) adds `degrade.ts`: the plainer path of a runner that throws,
 * runs over its own time or returns a value outside the closed sets of its
 * operation (F148-FR-018).
 */
export * from "./switches.ts";
export * from "./runner.ts";
export * from "./degrade.ts";
