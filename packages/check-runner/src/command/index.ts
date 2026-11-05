/**
 * The kind `command` of EP-05: spawn without a shell, the process group, the
 * time limit, the output cap and the environment (plan.md, "Project
 * Structure"; F148-FR-002, F148-FR-004, F148-FR-019).
 *
 * Phase 1 extracts the executor of Lisa's verification package into this
 * folder as the source the kind is built on (T006, `research.md` D-1); phase
 * 3 (T020, T066) adds the allow-list, the group and the conditions on top of
 * it without changing the extracted module.
 */
export * from "./lisa-plan.ts";
export * from "./lisa-executor.ts";
export * from "./environment.ts";
export * from "./containment.ts";
export * from "./kind-command.ts";
