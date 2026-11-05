/**
 * `packages/runtime/src/detach/` — EP-17, the detach strategies (plan.md,
 * "Project Structure"; spec.md F122-FR-001 to F122-FR-003).
 *
 * The registry of the extension point, `spawn-detached`, `foreground`, the
 * sample strategy and the conformance suite.
 *
 * Filled by: T014 (`registry.ts`), T029 to T034.
 */
export * from "./registry.ts";
