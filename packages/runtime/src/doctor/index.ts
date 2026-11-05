/**
 * `packages/runtime/src/doctor/` — the checks this feature registers with
 * EP-14 (plan.md, "Project Structure"; spec.md F122-FR-021, F122-FR-022).
 *
 * The permissions and the writability of the control root, the facts of the
 * detach spike (`spike-facts.json`) and the findings of the lock.
 *
 * Filled by: T005 (`spike-facts.json`), T015 (`control-root-checks.ts`), and
 * the doctor tasks of the later phases.
 */
export * from "./control-root-checks.ts";
export * from "./lock-checks.ts";
export * from "./layout-checks.ts";
export * as detachChecks from "./detach-checks.ts";
export * as survivorChecks from "./survivor-checks.ts";
export * as platformChecks from "./platform-checks.ts";
