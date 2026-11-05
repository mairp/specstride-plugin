/**
 * T075 — the process primitive of the kernel and its clock (F100-FR-234).
 *
 * `start`, `startDetached`, `signalGroup`, `startTimeOf`, `findByRunToken`,
 * `waitForEnd` and a clock, exported from the index of `@specstride/kernel`.
 * The kernel holds no run policy: the registry, the identity check, survivors
 * and adoption stay in `packages/runtime/src/procs/` and call this primitive.
 */
export * from "./clock.ts";
export * from "./signals.ts";
export * from "./table.ts";
export * from "./waiter.ts";
export * from "./primitive.ts";
