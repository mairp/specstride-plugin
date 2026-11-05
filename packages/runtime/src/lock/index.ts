/**
 * `packages/runtime/src/lock/` — EP-13, the workspace lock and its liveness
 * provider (plan.md, "Project Structure"; spec.md F122-FR-010 to F122-FR-022).
 *
 * The registry of the extension point, the directory-lock provider of research
 * D-1, the probe of research D-2, the atomic reclaim of research D-4 and the
 * liveness endpoint.
 *
 * Filled by: T012 (`owner-record.ts`), T014 (`registry.ts`), T017 to T028.
 */
export * from "./owner-record.ts";
export * from "./registry.ts";
export * from "./paths.ts";
export * from "./liveness.ts";
export * from "./probe.ts";
export * from "./reclaim.ts";
export * from "./directory-lock.ts";
export * from "./workspace-record.ts";
