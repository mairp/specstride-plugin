// T064 (F116-FR-014, F116-FR-015) — the doctor check of the toolchains.
//
// The check names the toolchains a run detected and which of them have no
// profile (they have the basic protection only), and warns of a profile given
// in project configuration. It is registered through the registration call of
// the kernel (F100-FR-189; annex G, §G.7) and NOT in the package of the
// doctor (F112-FR-033): a package registers its own checks without importing
// the doctor.
import type { DoctorCheck, Severity } from "@specstride/contracts/ep/doctor";
import { registerDoctorCheck } from "@specstride/kernel";
import type { ToolchainProfileData } from "./load.ts";
import { detectToolchains } from "./load.ts";

/** The stable dotted id of this check; ids are never renamed (§G.7). */
export const DOCTOR_CHECK_ID = "toolchain.profiles" as const;

/** What the probe of the check observes about a run. */
export interface ToolchainDoctorObserved {
  /** The toolchains the run detected. */
  readonly detected: readonly string[];
  /** The detected toolchains that have a profile. */
  readonly withProfile: readonly string[];
  /** The detected toolchains that have no profile: basic protection only. */
  readonly withoutProfile: readonly string[];
  /** Toolchains whose `toolchains.<id>` key was seen in project configuration. */
  readonly projectConfigProfiles: readonly string[];
}

/**
 * The findings of the check, from what a run observed. The message names the
 * toolchains detected, which of them have no profile, and warns of a profile
 * in project configuration (F116-FR-014, F116-FR-015).
 */
export function toolchainFindings(observed: ToolchainDoctorObserved): string[] {
  const findings: string[] = [];
  const list = (names: readonly string[]) => (names.length === 0 ? "(none)" : names.join(", "));
  findings.push(
    `toolchains detected: ${list(observed.detected)}; with a profile: ${list(observed.withProfile)}`,
  );
  if (observed.withoutProfile.length > 0) {
    findings.push(
      `toolchains with no profile: ${observed.withoutProfile.join(", ")}; the basic protection applied`,
    );
  } else {
    findings.push("every detected toolchain has a profile");
  }
  for (const id of observed.projectConfigProfiles) {
    findings.push(
      `toolchains.${id} in project configuration is ignored: the key is accepted from user configuration only`,
    );
  }
  return findings;
}

/** The severity of the check over what a run observed (§G.7). */
export function toolchainSeverity(observed: ToolchainDoctorObserved): Severity {
  return observed.projectConfigProfiles.length > 0 ? "warn" : "info";
}

/** Build the check (EP-14, `specstride.doctor/1`). */
export function createToolchainDoctorCheck(): DoctorCheck {
  return {
    id: DOCTOR_CHECK_ID,
    severityRule: (observed) => toolchainSeverity(observed as ToolchainDoctorObserved),
    lb: false,
    order: 500,
    async probe(injected) {
      return injected.observed;
    },
    messageTemplate:
      "toolchains detected, with a profile or with the basic protection only; a profile in project configuration is ignored",
    fixHint:
      "put the profile of your toolchain under the key `toolchains.<id>` of your user configuration",
  };
}

/** Register the check through the registration call of the kernel (§G.7). */
export function registerToolchainDoctorCheck(): void {
  registerDoctorCheck(createToolchainDoctorCheck());
}

/** What a run observes for the check, from its files and loaded profiles. */
export function observeToolchains(input: {
  files: readonly string[];
  profiles: readonly ToolchainProfileData[];
  projectConfigProfiles?: readonly string[];
}): ToolchainDoctorObserved {
  const detected = detectToolchains({ files: input.files, shippedProfiles: input.profiles });
  const withProfile = detected.filter((d) => d.fromProfile !== null).map((d) => d.id);
  const withoutProfile = detected.filter((d) => d.fromProfile === null).map((d) => d.id);
  const profiledIds = new Set(input.profiles.map((p) => p.id));
  const detectedIds = new Set(detected.map((d) => d.id));
  return {
    detected: [...detectedIds],
    withProfile,
    withoutProfile,
    projectConfigProfiles: (input.projectConfigProfiles ?? []).filter((id) => !profiledIds.has(id)),
  };
}
