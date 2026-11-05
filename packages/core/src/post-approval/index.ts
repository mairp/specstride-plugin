/**
 * T001 — the module group `post-approval` of feature 101 (plan.md, "Path
 * Conventions"): the steps that follow an approval, in their fixed order.
 *
 * | Module | Task | Requirement |
 * |---|---|---|
 * | `index.ts` | T001 | — (the entry of the group) |
 * | `order.ts` | T044 | F101-FR-033 |
 * | `tick.ts` | T045 | F101-FR-034 |
 * | `commit.ts` | T046 | F101-FR-035 |
 *
 * The group holds no I/O of its own: the approval commit is a fixed-argv call
 * of the version-control tool through the check-runner port, because the
 * engine starts no process itself (F100-FR-012, F100-FR-234).
 */
export * from "./order.ts";
export * from "./tick.ts";
export * from "./commit.ts";
