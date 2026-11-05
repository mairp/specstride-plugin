/**
 * T020 and T066 — the environment of a command of the kind `command`
 * (F148-FR-002), and the operation `environment` of EP-05 that gives it to a
 * caller without starting a process (F148-FR-019; N-105-1, closed as CQ-215).
 *
 * ONE function computes it, `commandEnvironment`, and both callers use it:
 * the spawn of the kind `command` (`kind-command.ts`) and the operation
 * `environment` of the registry (`../registry/runner.ts`). That is what makes
 * F148-FR-019 true by construction rather than by a second implementation
 * kept in step by hand: the detached command that the owner of the
 * verification gate starts with the process primitive of the kernel
 * (F105-FR-035, F100-FR-234) gets the environment of this function, the same
 * bytes a command of the check runner gets.
 *
 * Outside the `parity` profile the environment is the ALLOW-LIST of
 * `data/env-allowlist.json` — the names a command may see, none of them a
 * provider credential (threat T-21; `research.md` D-8) — resolved against the
 * environment the runtime holds, with the values the runner fixes, overlaid
 * with the `env` the command declares.
 *
 * Under the `parity` profile (row 125 of annex X §X.7, register row DV-113,
 * key `verification.envAllowlist`, off) it is the environment of the PROCESS
 * overlaid with the declared `env`, as at the baseline: Specstride at
 * `9cab15d`, `lib/verification_plan.py:1569`, `os.environ.copy()` then
 * `command_env.update(command.get("env") or {})` — item B-1120.
 *
 * A name of the environment that matches a forbidden pattern is dropped even
 * where the allow-list would admit it, so a credential cannot reach a command
 * through a name the allow-list did not foresee.
 */
import { createRequire } from "node:module";
import process from "node:process";
import type { ManifestEntry } from "@specstride/contracts/ep/check-runner";
import { PROFILE_NAME } from "@specstride/contracts/profile/parity";
import { ENV_ALLOWLIST_KEY } from "../registry/switches.ts";

/** The name of the profile that turns the allow-list off (row 125 of §X.7). */
export const PARITY_PROFILE: string = PROFILE_NAME;

const require = createRequire(import.meta.url);

/** One name of the allow-list, with the reason it is on it. */
export type AllowedName = { readonly name: string; readonly reason: string };

/** The shape of `data/env-allowlist.json` (T003). */
export type EnvAllowlistFile = {
  readonly schema: string;
  readonly owner: string;
  readonly requirement: string;
  readonly note: string;
  readonly allow: readonly AllowedName[];
  readonly forbidden: {
    readonly note: string;
    readonly names: readonly string[];
    readonly patterns: readonly string[];
  };
};

/** `data/env-allowlist.json`, the one place the names stand. */
export const ENV_ALLOWLIST: EnvAllowlistFile =
  require("../../data/env-allowlist.json") as EnvAllowlistFile;

/** The names a command may see outside the `parity` profile (F148-FR-002). */
export const ALLOWED_NAMES: readonly string[] = Object.freeze(
  ENV_ALLOWLIST.allow.map((entry) => entry.name),
);

/** The provider variables the allow-list must never hold, by exact name. */
export const FORBIDDEN_NAMES: readonly string[] = Object.freeze([...ENV_ALLOWLIST.forbidden.names]);

/** The patterns that catch a credential the names do not yet list. */
export const FORBIDDEN_PATTERNS: readonly RegExp[] = Object.freeze(
  ENV_ALLOWLIST.forbidden.patterns.map((source) => new RegExp(source)),
);

/**
 * True where the name is a provider credential by name or by pattern. It is
 * dropped from the inherited environment whatever the allow-list says.
 */
export function isForbiddenName(name: string): boolean {
  if (FORBIDDEN_NAMES.includes(name)) return true;
  return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * The values the runner FIXES, with the reason each one is on the allow-list.
 * They are part of the environment a command gets, so the operation
 * `environment` returns them too (F148-FR-019).
 */
export const FIXED_VALUES: Readonly<Record<string, string>> = Object.freeze({
  TERM: "dumb",
  NO_COLOR: "1",
});

/** What a caller may say about the environment it wants computed. */
export type EnvironmentOptions = {
  /** The environment the runtime holds. Defaults to the runtime's own. */
  readonly processEnv?: Readonly<Record<string, string | undefined>>;
  /**
   * The temporary directory of the command, which the runner sets as
   * `TMPDIR`. Absent where the caller keeps the inherited value.
   */
  readonly temporaryDirectory?: string;
  /** The search path recorded at launch, which the runner uses in place of the live one. */
  readonly searchPath?: string;
};

/** The name the runner sets to the command's own temporary directory. */
export const TEMPORARY_DIRECTORY_NAME = "TMPDIR" as const;

/** The name whose value is the search path recorded at launch (F148-FR-010). */
export const SEARCH_PATH_NAME = "PATH" as const;

/** True where the profile turns the allow-list off: the `parity` profile (row 125). */
export function allowListIsOn(profile: string): boolean {
  return profile !== PARITY_PROFILE;
}

/** The key of the switch this function reads, for a caller that reports it. */
export const SWITCH_KEY = ENV_ALLOWLIST_KEY;

/**
 * F148-FR-002, F148-FR-019 — the environment of one command. No process is
 * started and no handle is needed: the function is pure in its inputs.
 */
export function commandEnvironment(
  entry: Pick<ManifestEntry, "env">,
  profile: string,
  options: EnvironmentOptions = {},
): Readonly<Record<string, string>> {
  const source =
    options.processEnv ?? (process.env as Readonly<Record<string, string | undefined>>);
  const declared = entry.env ?? {};
  const out: Record<string, string> = {};

  if (allowListIsOn(profile)) {
    for (const name of ALLOWED_NAMES) {
      if (isForbiddenName(name)) continue;
      const value = source[name];
      if (value !== undefined) out[name] = value;
    }
    for (const [name, value] of Object.entries(FIXED_VALUES)) out[name] = value;
    if (options.searchPath !== undefined) out[SEARCH_PATH_NAME] = options.searchPath;
    if (options.temporaryDirectory !== undefined) {
      out[TEMPORARY_DIRECTORY_NAME] = options.temporaryDirectory;
    }
  } else {
    // Under `parity`: the environment of the process, as at the baseline
    // (B-1120, `os.environ.copy()`). Nothing is dropped and nothing is fixed.
    for (const [name, value] of Object.entries(source)) {
      if (value !== undefined) out[name] = value;
    }
  }

  // The overlay of the command's own `env`, last, as at the baseline.
  for (const [name, value] of Object.entries(declared)) out[name] = value;

  return Object.freeze(out);
}

/**
 * The names of the runtime's environment that the allow-list DROPPED, so a
 * test and the doctor can see what did not reach the command. It is a reading
 * of the same inputs and starts no process.
 */
export function droppedNames(
  entry: Pick<ManifestEntry, "env">,
  profile: string,
  options: EnvironmentOptions = {},
): readonly string[] {
  const source =
    options.processEnv ?? (process.env as Readonly<Record<string, string | undefined>>);
  const kept = new Set(Object.keys(commandEnvironment(entry, profile, options)));
  return Object.freeze(
    Object.keys(source)
      .filter((name) => !kept.has(name))
      .sort(),
  );
}

/**
 * F148-SC-002 — the names of the given environment that are provider
 * credentials. Outside the `parity` profile none of them is in the
 * environment of a command.
 */
export function credentialNames(
  source: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  return Object.freeze(
    Object.keys(source)
      .filter((name) => isForbiddenName(name))
      .sort(),
  );
}
