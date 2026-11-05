/**
 * T124 — the interface types of EP-16, the toolchain profile, from
 * `contracts/extension-points/EP-16.toolchain.json` and annex C, §C.14
 * (F100-FR-110).
 *
 * `specstride.toolchain/1`. Data: a profile per toolchain, so that the
 * protected set of a phase can be built. The point has no operation — the
 * `operations` list of its contract file is empty.
 *
 * The schema file of `specstride.toolchain/1` is written by feature 116 and
 * delivered to this package (annex C, §C.14, Content owner); this module
 * holds the interface type over it and the rules of §C.14.
 */
import type { Toolchain } from "../records/generated/toolchain.ts";

export const POINT_ID = "specstride.toolchain/1" as const;
export const EP = "EP-16" as const;
export const ANNEX_SECTION = "annex C, §C.14" as const;

/** The point is data; it has no operation (`operations` is empty). */
export const OPERATIONS = [] as const;
export type ToolchainOperation = never;
export const IS_DATA = true as const;

/** The schema id against which a profile is validated at load. */
export const SCHEMA_ID = "specstride.toolchain/1" as const;

/** A toolchain profile, as the schema of feature 116 defines it. */
export type ToolchainProfile = Toolchain;

/** What a profile holds (§C.14, Inputs). */
export const PROFILE_CONTENT = [
  "patterns for files that define checks",
  "cache locations",
  "user-level configuration files",
  "suppression markers",
  "the executables to pin",
  "seed paths for worker trees",
  "per worker the environment that moves a cache which is unsafe for several writers",
] as const;

/** What a profile produces (§C.14, Outputs). */
export const PROFILE_OUTPUTS = [
  "the protected set of a phase",
  "the pins of its executables",
] as const;

/** Where a profile is accepted from (F100-FR-110). */
export const ACCEPTED_FROM = ["the product", "user configuration"] as const;

/**
 * "Guarantees of an implementation" of §C.14: a profile is data. It names no
 * command to run, with one exception: one fixed argument list of a pinned
 * executable by which the effective configuration of the toolchain is read.
 */
export const THE_ONE_COMMAND_A_PROFILE_MAY_NAME =
  "one fixed argument list of a pinned executable by which the effective configuration of the toolchain is read" as const;

/**
 * "Failure of an implementation" of §C.14 — the plainer path: a refused
 * profile is treated as absent.
 */
export const FAILURE_PATH = "a refused profile is treated as absent" as const;

/** "Guarantees of the core": a toolchain without a profile has basic protection only. */
export const WITHOUT_A_PROFILE =
  "the basic protection only, and the doctor and the `[LOOP]` line say so" as const;

/**
 * "Unknown-value rule" of §C.14: an unknown field is ignored with a finding;
 * a toolchain the product does not detect has no profile.
 */
export const UNKNOWN_FIELD_IS_IGNORED_WITH_A_FINDING = true as const;

/** A profile that does not validate is refused at load with a doctor finding. */
export const REFUSED_AT_LOAD_WITH_A_DOCTOR_FINDING = true as const;

/** F100-FR-110 — the protected set is derived at launch and stored in the control plane. */
export const PROTECTED_SET_IS_DERIVED_AT_LAUNCH = true as const;
