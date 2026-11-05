/**
 * `@specstride/runtime` — the detached runtime of feature 122.
 *
 * The composition root of the runtime. Each area is exported under its own
 * name rather than flattened, because the two extension points of this
 * feature both define a `POINT_ID`, an `EP` and an `ANNEX_SECTION`, and a flat
 * barrel would have to rename one of each — which would mean the name a
 * consumer imports differs from the name the module defines.
 */
export * as detach from "./detach/index.ts";
export * as doctor from "./doctor/index.ts";
export * as inbox from "./inbox/index.ts";
export * as lease from "./lease/index.ts";
export * as lock from "./lock/index.ts";
export * as procs from "./procs/index.ts";
export * as root from "./root/index.ts";
export * as state from "./state/index.ts";
export * from "./registry-frame.ts";
