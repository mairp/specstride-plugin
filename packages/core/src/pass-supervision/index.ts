/**
 * The index of the module group `pass-supervision` of `@specstride/core`
 * (T004 of feature 118).
 *
 * This index exports ONLY the pass-supervision surface: the ports of
 * `ports.ts` (T005) and the module metadata of `module.ts`. The decisions of
 * the feature (the watchdogs, the stop ladder, the kill note, the yield, the
 * jobs, the failure ledger, the failfast switch) enter here through their own
 * files as the tasks after Setup write them (T022 onward); nothing else of
 * `@specstride/core` is re-exported through this file.
 */
export * from "./ports.ts";
export * from "./module.ts";
