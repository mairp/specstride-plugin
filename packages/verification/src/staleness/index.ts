/**
 * The staleness check of the verification plan at critic start, which stays
 * under the `parity` profile only (`plan.md`, "Project Structure";
 * F105-FR-042, F105-FR-043; `research.md` D-10).
 *
 * Phase 4 fills it: `./plan-check.ts` is the check under the profile, at
 * critic start and at every other step the baseline hands the spec together
 * with the plan (T102), and `./binding.ts` the binding that holds inside AND
 * outside the profile, which the public command `verify` makes (T103).
 */
export * from "./plan-check.ts";
export * from "./binding.ts";
