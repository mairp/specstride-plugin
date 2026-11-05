/**
 * T055 — the containment ceiling and the refusal without the opt-in
 * (F138-FR-015; user story 5).
 *
 * Prime says of itself that it is not a sandbox: it runs model-generated
 * code with the consumer's permissions. The adapter's containment ceiling is
 * therefore C0, declared with the harness's own statement as its
 * provenance. As a proposer prime runs ONLY where the consumer opted in to
 * C0 in USER configuration — the environment, a flag and project
 * configuration are not an opt-in. A launch that names prime as proposer
 * without the opt-in is refused before any pass, and the reason names the
 * opt-in. The run record says `protection=detect`. Parallel units stay off
 * unless `loop.parallel.allow_detect` is set in user configuration — the
 * only source that may set it. The adapter states that the harness has no
 * permission mode; the runtime never asserts a sandbox. Under the `parity`
 * profile the value C0 of row 25 stands for the opt-in (CQ-149).
 */
import { primeDescriptor } from "./index.ts";

/** The containment ceiling of prime, from the descriptor data. */
export const PRIME_CONTAINMENT_CEILING: string = (
  primeDescriptor.containment as { ceiling: string }
).ceiling;

/** The provenance of the ceiling: the harness's own statement. */
export const PRIME_CONTAINMENT_PROVENANCE: string = (
  primeDescriptor.containment as { provenance: string }
).provenance;

/** What the run record says: protection=detect (never a sandbox). */
export const PROTECTION_VALUE = "detect";
/** The run record field and its value, spelled as the record spells it. */
export const PROTECTION_RUN_RECORD = `protection=${PROTECTION_VALUE}` as const;

/** The statement of the adapter about the harness's permission mode. */
export const NO_PERMISSION_MODE_STATEMENT =
  "prime has no permission mode; the runtime never asserts a sandbox";

/** The only user-configuration key that may allow parallel units under C0. */
export const ALLOW_DETECT_KEY = "loop.parallel.allow_detect";

/** Where an opt-in claim came from. Only the first two are an opt-in. */
export type OptInSource =
  "user-configuration" | "parity-profile" | "environment" | "flag" | "project-configuration";

/** The sources that ARE an opt-in to C0. */
export const OPT_IN_SOURCES: readonly OptInSource[] = Object.freeze([
  "user-configuration",
  "parity-profile",
]);

/** The sources that are NOT an opt-in, however loudly they claim it. */
export const NOT_OPT_IN_SOURCES: readonly OptInSource[] = Object.freeze([
  "environment",
  "flag",
  "project-configuration",
]);

/** The refusal of a launch that names prime as proposer without the opt-in. */
export class ContainmentRefusedError extends Error {
  readonly seen: OptInSource | null;
  constructor(seen: OptInSource | null) {
    const where =
      seen === null
        ? "no claim of an opt-in was seen"
        : `the opt-in claim came from ${seen}, which is not an opt-in`;
    super(
      `prime: refused before the first pass — the containment ceiling is ` +
        `${PRIME_CONTAINMENT_CEILING} and the consumer did not opt in to C0 ` +
        `in user configuration (${where}); add the opt-in to C0 in user ` +
        `configuration to run prime as proposer`,
    );
    this.name = "ContainmentRefusedError";
    this.seen = seen;
  }
}

/**
 * Require the opt-in for a proposer call. Accepts an opt-in from user
 * configuration, or — under the `parity` profile — the value C0 of row 25,
 * which stands for the opt-in (CQ-149). A claim from the environment, a
 * flag or project configuration is refused as if there were no opt-in. The
 * refusal happens here, before any pass runs.
 */
export function requireC0OptIn(input: { source: OptInSource | null }): {
  optedIn: true;
  via: OptInSource;
} {
  if (input.source !== null && OPT_IN_SOURCES.includes(input.source)) {
    return { optedIn: true, via: input.source };
  }
  throw new ContainmentRefusedError(input.source);
}

/** The refusal decision without throwing, for the doctor and the tests. */
export function c0OptInDecision(source: OptInSource | null): {
  refused: boolean;
  reason: string;
} {
  try {
    const result = requireC0OptIn({ source });
    return { refused: false, reason: `opted in via ${result.via}` };
  } catch (error) {
    return { refused: true, reason: (error as Error).message };
  }
}

/**
 * May parallel units run? Off, unless `loop.parallel.allow_detect` is set in
 * user configuration — the only source that may set it. The same claim from
 * the environment, a flag or project configuration leaves parallel off.
 */
export function parallelUnitsAllowed(input: {
  allowDetect: { source: OptInSource; set: boolean } | null;
}): boolean {
  return (
    input.allowDetect !== null &&
    input.allowDetect.set &&
    input.allowDetect.source === "user-configuration"
  );
}

/** The row of the `parity` profile that fixes the containment level. */
export const PARITY_ROW_CONTAINMENT = 25;
/** Under `parity`, the value C0 of row 25 stands for the opt-in. */
export function optInUnderParity(): { optedIn: true; via: "parity-profile" } {
  return { optedIn: true, via: "parity-profile" };
}
