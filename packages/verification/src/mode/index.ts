/**
 * The folder `mode` of `@specstride/verification`: the three verification
 * modes and the four settings, with the errors each refuses a launch with, and
 * the resolution of the mode in force that the command line calls before it
 * writes the run snapshot.
 *
 * Owned requirements: F105-FR-001 to F105-FR-004 and F105-FR-010. The closed
 * sets of this feature (T008) and the switches of the `parity` profile (T009)
 * live here too, because the modes are what they are about.
 */
export * from "./closed-sets.ts";
export * from "./switches.ts";
export * from "./modes.ts";
export * from "./settings.ts";
export * from "./effects.ts";
export * from "./preflight.ts";
export * from "./in-force.ts";
export * from "./narrowing.ts";
