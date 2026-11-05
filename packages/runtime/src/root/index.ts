/**
 * `packages/runtime/src/root/` — the runtime root, leader of the detached
 * process tree (plan.md, "Project Structure"; spec.md F122-FR-001,
 * F122-FR-022, F122-FR-031, F122-FR-038, F122-FR-039, F122-FR-043).
 *
 * The control root and its two checks, the advisory marker, the layout version
 * file and the life cycle of the root itself.
 *
 * Filled by: T015 (`control-root.ts`), T035 to T052.
 */
export * from "./control-root.ts";
export * from "./marker.ts";
export * from "./layout-version.ts";
export * from "./start.ts";
export * from "./end.ts";
export * as endOwned from "./end-owned.ts";
