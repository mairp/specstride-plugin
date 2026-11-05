/**
 * `packages/runtime/src/inbox/` — the inbox (plan.md, "Project Structure";
 * spec.md F122-FR-029, F122-FR-030).
 *
 * The atomic write a process outside the tree uses to ask the run for
 * something, the validation of a request before it is used, and the reading of
 * the inbox at a boundary of the loop.
 *
 * Filled by: T060.
 */
export * from "./inbox.ts";
