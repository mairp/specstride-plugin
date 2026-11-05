/**
 * The result of a command: the conditions `tainted`, `cached`, `flaky`,
 * `interrupted` and `unchecked` as fields of their own, their reasons, the
 * errors of the runner and the unknown-value branch of every closed set
 * (plan.md, "Project Structure"; F148-FR-003, F148-FR-004).
 *
 * Phase 2 (T008) registers the closed sets of rows 53, 54, 233, 235 and 236
 * of annex X §X.6 with their unknown-value branches in `closed-sets.ts`.
 * Phase 3 (T021, T022) fills the result itself.
 */
export * from "./closed-sets.ts";
export * from "./result.ts";
export * from "./errors.ts";
