/**
 * T012 — detection of the Codex harness and its version range (F131-FR-002).
 *
 * Detection establishes presence, version and the existence of the
 * configuration home free of charge: the version command of the harness and
 * nothing that changes state. The executable is resolved to an absolute path
 * and recorded with its version. The tested range is `>=0.153.4 <0.154`,
 * `verified-on` 2026-09-29. Each pass records the harness version, and a
 * change of version between two passes of one run is a warning. Nothing is
 * downloaded to reach a pin: this module installs nothing, fetches nothing
 * and writes nothing.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { HARNESS_PIN, PIN_VERIFIED_ON } from "./index.ts";

/**
 * The range check is local to the adapter on purpose: the harness package
 * exports its entry only, and the adapter's pin is one fixed range. The
 * comparison follows the same rule as the seam's version module: three
 * numeric parts, compared numerically; an unknown shape is never inside.
 */
export const CODEX_RANGE_FLOOR = [0, 153, 4] as const;
export const CODEX_RANGE_CEILING_EXCLUSIVE = [0, 154, 0] as const;

/** Parse `0.153.4` or a leading `v`; anything else is no version. */
export function parseCodexVersion(version: string | null | undefined): number[] | null {
  if (typeof version !== "string") return null;
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/.exec(version.trim());
  if (match === null) return null;
  return [Number(match[1]), Number(match[2] ?? "0"), Number(match[3] ?? "0")];
}

function compareParsed(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return (a[index] ?? 0) < (b[index] ?? 0) ? -1 : 1;
  }
  return 0;
}

/** Whether one version satisfies `>=0.153.4 <0.154` (F131-FR-002). */
export function codexVersionInRange(version: string | null): boolean {
  const parsed = parseCodexVersion(version);
  if (parsed === null) return false;
  return (
    compareParsed(parsed, CODEX_RANGE_FLOOR) >= 0 &&
    compareParsed(parsed, CODEX_RANGE_CEILING_EXCLUSIVE) < 0
  );
}

/** The warning recorded when the version changes between two passes of a run. */
export const VERSION_CHANGE_WARNING =
  "the version of the harness changed between two passes of one run" as const;

/** The tested range of the harness (F131-FR-002). */
export const CODEX_VERSION_RANGE = ">=0.153.4 <0.154" as const;

/** The date of the read behind the range (F131-FR-002). */
export const CODEX_VERIFIED_ON = PIN_VERIFIED_ON;

/** The version command of the harness: a read-only call, no model (FR-002). */
export const CODEX_VERSION_COMMAND = ["--version"] as const;

/** The configuration home of the harness, under the home or its overlay. */
export const CODEX_CONFIG_HOME_DEFAULT = ".codex" as const;

/** The name of the variable that overrides the configuration home. */
export const CODEX_HOME_VARIABLE = "CODEX_HOME" as const;

/** How the version command is run. The default runs the real process. */
export type VersionRunner = (
  path: string,
  args: readonly string[],
) => { readonly code: number; readonly stdout: string } | null;

/** One recorded invocation, for the no-download proof of the tests. */
export type RecordedInvocation = {
  readonly path: string;
  readonly args: readonly string[];
};

/** What detection of one machine reports. */
export type Detection = {
  /** Whether the harness is present on the search path. */
  readonly present: boolean;
  /** The resolved absolute path, or null where it is not found. */
  readonly path: string | null;
  /** The version the harness itself stated, or null where it states none. */
  readonly version: string | null;
  /** Whether the stated version is inside the tested range. */
  readonly inRange: boolean;
  /** The configuration home, where it exists. */
  readonly configHome: string | null;
  /** The version warning of this pass: outside the range, or none. */
  readonly versionWarning: string | null;
  /** Every invocation detection made — the proof that nothing but a read happened. */
  readonly invocations: readonly RecordedInvocation[];
};

/** Read `CODEX_HOME`, or the configuration home under the given home. */
export function codexConfigHome(env: Readonly<Record<string, string | undefined>>): string | null {
  const override = env[CODEX_HOME_VARIABLE];
  if (typeof override === "string" && override !== "") return override;
  const home = env.HOME;
  if (typeof home !== "string" || home === "") return null;
  return join(home, CODEX_CONFIG_HOME_DEFAULT);
}

/** The first non-empty candidate on the search path, resolved absolutely. */
export function resolveOnPath(
  name: string,
  env: Readonly<Record<string, string | undefined>>,
  exists: (candidate: string) => boolean = (candidate) => existsSync(candidate),
): string | null {
  const pathVariable = env.PATH ?? "";
  for (const dir of pathVariable.split(delimiter)) {
    if (dir === "") continue;
    const candidate = isAbsolute(dir) ? join(dir, name) : join(process.cwd(), dir, name);
    if (exists(candidate)) return candidate;
  }
  return null;
}

/** Pull the version out of the output of `codex --version` (`codex-cli 0.153.4`). */
export function versionFromOutput(stdout: string): string | null {
  const match = /codex-cli\s+(\d+(?:\.\d+){0,2})/.exec(stdout);
  return match === null ? null : match[1];
}

/**
 * F131-FR-002 — detect the harness: presence, absolute path, version,
 * configuration home, and whether the version is inside the tested range.
 * Exactly one process is started, the version command; nothing is downloaded,
 * installed or written.
 */
export function detectCodex(input: {
  /** The environment of the consumer; read only for `PATH`, `HOME`, `CODEX_HOME`. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /**
   * How the version command runs. Defaults to running the real executable;
   * the tests inject a runner and so prove that detection starts nothing else.
   */
  readonly runVersion?: VersionRunner;
  /** Overrides the search, for tests; must still be an absolute path. */
  readonly resolve?: (name: string) => string | null;
  /** Overrides the existence check of the configuration home, for tests. */
  readonly configHomeExists?: (path: string) => boolean;
}): Detection {
  const invocations: RecordedInvocation[] = [];
  const runVersion: VersionRunner = input.runVersion ?? realVersionRunner;
  const path =
    input.resolve !== undefined ? input.resolve("codex") : resolveOnPath("codex", input.env);
  const version =
    path !== null
      ? (() => {
          const result = runVersion(path, CODEX_VERSION_COMMAND);
          invocations.push({ path, args: [...CODEX_VERSION_COMMAND] });
          if (result === null || result.code !== 0) return null;
          return versionFromOutput(result.stdout);
        })()
      : null;
  const configHomeCandidate = codexConfigHome(input.env);
  const configHomeExists = input.configHomeExists ?? ((candidate: string) => existsSync(candidate));
  const configHome =
    configHomeCandidate !== null && configHomeExists(configHomeCandidate)
      ? configHomeCandidate
      : null;
  const inRange = version !== null && codexVersionInRange(version);
  return {
    present: path !== null,
    path,
    version,
    inRange,
    configHome,
    versionWarning:
      version !== null && !inRange
        ? `the version ${version} is outside the tested range ${CODEX_VERSION_RANGE}`
        : null,
    invocations,
  };
}

/**
 * The version record of one pass, and the warning a change between two passes
 * of one run gives (F131-FR-002). `null` is recorded where the harness states
 * no version — a version is never guessed.
 */
export function versionChangeWarning(
  previous: string | null,
  current: string | null,
): string | null {
  if (previous === null || current === null) return null;
  return previous !== current ? VERSION_CHANGE_WARNING : null;
}

/**
 * The pin the descriptor and every fact carry: the harness version read with
 * a read-only `--version` on the date `verifiedOn` (F131-FR-007).
 */
export function harnessFactPin(): { readonly pin: string; readonly verifiedOn: string } {
  return { pin: HARNESS_PIN, verifiedOn: CODEX_VERIFIED_ON };
}

/** Real runner: spawn the version command, no shell, output captured. */
function realVersionRunner(
  path: string,
  args: readonly string[],
): { readonly code: number; readonly stdout: string } | null {
  const result = spawnSync(path, [...args], { encoding: "utf8" });
  if (result.error !== undefined && result.error !== null) return null;
  return { code: result.status ?? -1, stdout: result.stdout ?? "" };
}
