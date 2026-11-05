/**
 * The ingress of `@specstride/observability` (feature 111): one point for all
 * text that enters from outside the runtime. Phase 1 holds the boundary
 * primitive of F100-FR-221; T040 adds the redactor call, the classes and the
 * limits.
 */
export * from "./boundary.ts";
export * from "./limits.ts";
export * from "./targets.ts";
export * from "./retention.ts";
export * from "./ingress.ts";
