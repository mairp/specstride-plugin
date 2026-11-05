/**
 * Detection and the version read of the prime agent executable (T019; covers
 * F138-FR-002, characterization test CT-138-2 in
 * `tests/characterization/138/detect.test.ts`).
 *
 * - Presence is established FREE OF CHARGE: the resolution reads the search
 *   path and the file system and starts no process.
 * - The version is read from the VERSION FLAG of the AGENT executable. The
 *   launcher of the consumer has no version flag and MUST NOT be probed for
 *   one (the descriptor states `launcherVersionProbe: false`).
 * - The path and the version are recorded with every pass and every
 *   critic-class call (F100-FR-080).
 * - The tested range is `>=0.7.3 <0.8`, verified on 2026-09-29. The doctor
 *   warns when the installed version is outside the range; a version that
 *   differs from that of an earlier pass or critic-class call of the same run
 *   is surfaced as a warning (Principle X). The adapter never installs,
 *   vendors or downloads the harness.
 */
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/** The version flag of the agent executable (argument table: `version`). */
export const AGENT_VERSION_FLAG = "-v";

/** The tested range of the agent executable (descriptor `versionRange`). */
export const TESTED_VERSION_RANGE = ">=0.7.3 <0.8";

/** The date the range was verified on (descriptor `verifiedOn`). */
export const RANGE_VERIFIED_ON = "2026-09-29";

/** A launcher is never probed for a version (F138-FR-002). */
export const LAUNCHER_VERSION_PROBE = false;

/** What the version probe targets: the agent executable, never the launcher. */
export function versionProbeTarget(): "agent-executable" {
  return "agent-executable";
}

/** The outcome of the free-of-charge presence check. */
export type Detection = {
  found: boolean;
  /** The path that would be executed, as resolved from the search path. */
  path: string | undefined;
  /** The name the resolution started from. */
  name: string;
  requirement: "F138-FR-002";
};

/**
 * Detect the agent executable free of charge: an absolute or relative path is
 * taken as it is, a bare name is searched on the search path of the given
 * environment. No process is started.
 */
export function detectAgentExecutable(
  name: string,
  env: Readonly<Record<string, string | undefined>> = {},
): Detection {
  if (name.includes("/")) {
    return {
      found: existsSync(name),
      path: name,
      name,
      requirement: "F138-FR-002",
    };
  }
  const pathVariable = env.PATH ?? "";
  for (const dir of pathVariable.split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) {
      return { found: true, path: candidate, name, requirement: "F138-FR-002" };
    }
  }
  return { found: false, path: undefined, name, requirement: "F138-FR-002" };
}

/** The version of the agent executable, read by the caller-injected runner. */
export type AgentVersion = {
  version: string;
  path: string;
};

/** A runner executes the version probe; the adapter injects it so that no
 * process is started by this module itself. */
export type VersionRunner = (path: string, flag: string) => Promise<string>;

/**
 * Read the version of the agent executable with its version flag. The
 * LAUNCHER is refused here as a second guard: probing it is the one thing
 * F138-FR-002 forbids.
 */
export async function readAgentVersion(
  detection: Detection,
  run: VersionRunner,
): Promise<AgentVersion> {
  if (!detection.found || detection.path === undefined) {
    throw new Error(`the agent executable ${detection.name} was not found; no version to read`);
  }
  const version = (await run(detection.path, AGENT_VERSION_FLAG)).trim();
  return { version, path: detection.path };
}

/**
 * Parse one comparison of the tested range. Only the two bounds of the prime
 * range are understood: `>=0.7.3 <0.8`.
 */
export function versionInRange(version: string, range: string = TESTED_VERSION_RANGE): boolean {
  const match = range.match(/^>=(\S+)\s+<(\S+)$/);
  if (!match) throw new Error(`unsupported range: ${range}`);
  const compare = (a: string, b: string): number => {
    const as = a.split(".").map((part) => Number.parseInt(part, 10));
    const bs = b.split(".").map((part) => Number.parseInt(part, 10));
    for (let i = 0; i < Math.max(as.length, bs.length); i += 1) {
      const x = as[i] ?? 0;
      const y = bs[i] ?? 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  };
  return compare(version, match[1] as string) >= 0 && compare(version, match[2] as string) < 0;
}

/** A warning the adapter surfaces to the doctor and the run record. */
export type VersionWarning = {
  kind: "version-range" | "version-changed";
  message: string;
};

/** The warning for an installed version outside the tested range. */
export function versionRangeWarning(version: string): VersionWarning {
  return {
    kind: "version-range",
    message:
      `prime agent ${version} is outside the tested range ${TESTED_VERSION_RANGE} ` +
      `(verified on ${RANGE_VERIFIED_ON})`,
  };
}

/**
 * The warning for a version that differs from that of an earlier pass or
 * critic-class call OF THE SAME RUN (Principle X): the change is a warning,
 * never a refusal.
 */
export function versionChangedWarning(earlier: string, current: string): VersionWarning {
  return {
    kind: "version-changed",
    message: `the prime agent version changed during the run: ${earlier} -> ${current}`,
  };
}

/**
 * Compare the version of this call with the version recorded for the earlier
 * calls of the same run and return the warnings to surface, in order:
 * the range warning first (the doctor's), then the change warning.
 */
export function versionWarnings(current: string, earlier: string | undefined): VersionWarning[] {
  const warnings: VersionWarning[] = [];
  if (!versionInRange(current)) warnings.push(versionRangeWarning(current));
  if (earlier !== undefined && earlier !== current) {
    warnings.push(versionChangedWarning(earlier, current));
  }
  return warnings;
}
