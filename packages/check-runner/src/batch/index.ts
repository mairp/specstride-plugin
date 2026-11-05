/**
 * Concurrent verification commands: the admission rules, the formation of a
 * batch as a pure function of the manifest and the parallelism
 * (`research.md` D-3), the isolation of a member, the fingerprint pair of a
 * batch, the demotion of the parallelism after a taint, the run to the end
 * and the second execution of a failed member (plan.md, "Project Structure";
 * F148-FR-011 to F148-FR-016).
 */
export * from "./admission.ts";
export * from "./isolation.ts";
export * from "./parallelism.ts";
export * from "./run-batch.ts";
