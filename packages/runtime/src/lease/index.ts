/**
 * `packages/runtime/src/lease/` — the lease (plan.md, "Project Structure";
 * spec.md F122-FR-008, F122-FR-014, F122-FR-018, F122-FR-032).
 *
 * Write, heartbeat, `handDown` and `verify`: the record that tells a live
 * owner of a run from a dead one, and the hand-down of the lease token.
 *
 * Filled by: T042 (`timing.ts`, `lease.ts`), T043 (`hand-down.ts`).
 */
export * from "./timing.ts";
export * from "./lease.ts";
export * from "./hand-down.ts";
