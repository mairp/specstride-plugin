/**
 * The names of the prime proposer (T020; covers F138-FR-003, parity items
 * C-052 / B-0517 / B-0518, test PT-138-C-052-*).
 *
 * Two executables stand behind the qualifier `prime[:variant]`:
 *
 * - the AGENT executable, the thing that is detected and version-probed
 *   (F138-FR-002). The consumer sets it with the key `harnesses.prime.bin`;
 *   the as-is alias is `SPECSTRIDE_PRIME_AGENT_BIN` and the as-is default
 *   name is `prime-agent` (B-0517).
 * - the LAUNCHER of the consumer, used ONLY when a variant is given. The key
 *   is `harnesses.prime.launcher`, the as-is default name is `prime`. Two
 *   as-is variables reach that key IN THIS ORDER (B-0518, and the one
 *   exception of F138-FR-003 to the rule that refuses two variables over one
 *   key): `SPECSTRIDE_PRIME_FLEET_BIN` comes first, and the legacy alias
 *   `SPECSTRIDE_PRIME_BIN` is read when the first is unset.
 *
 * The proposer and the critic read the SAME settings: the resolution here is
 * the one both roles call. The launcher is never probed for a version and is
 * never named by the product (it is a path in the consumer's configuration).
 */

/** The settings key of the agent executable. */
export const PRIME_BIN_KEY = "harnesses.prime.bin";

/** The as-is default name of the agent executable (B-0517). */
export const PRIME_BIN_DEFAULT = "prime-agent";

/** The as-is environment alias of the agent executable (B-0517). */
export const PRIME_BIN_ALIAS = "SPECSTRIDE_PRIME_AGENT_BIN";

/** The settings key of the launcher. */
export const PRIME_LAUNCHER_KEY = "harnesses.prime.launcher";

/** The as-is default name of the launcher (B-0518). */
export const PRIME_LAUNCHER_DEFAULT = "prime";

/** The first variable of the launcher, in the order of the baseline (B-0518). */
export const PRIME_LAUNCHER_ALIAS_FIRST = "SPECSTRIDE_PRIME_FLEET_BIN";

/** The legacy alias of the launcher, read when the first is unset (B-0518). */
export const PRIME_LAUNCHER_ALIAS_LEGACY = "SPECSTRIDE_PRIME_BIN";

/** The order of the two launcher variables: the exception of F138-FR-003. */
export const PRIME_LAUNCHER_ALIAS_ORDER = [
  PRIME_LAUNCHER_ALIAS_FIRST,
  PRIME_LAUNCHER_ALIAS_LEGACY,
] as const;

/** The names table, as data: what the consumer sets, what the aliases are. */
export const PRIME_NAMES = {
  agent: {
    key: PRIME_BIN_KEY,
    alias: PRIME_BIN_ALIAS,
    defaultName: PRIME_BIN_DEFAULT,
    versionProbe: true,
  },
  launcher: {
    key: PRIME_LAUNCHER_KEY,
    aliases: PRIME_LAUNCHER_ALIAS_ORDER,
    defaultName: PRIME_LAUNCHER_DEFAULT,
    versionProbe: false,
    usedOnlyWithVariant: true,
  },
  sharedByRoles: ["proposer", "critic"],
  requirement: "F138-FR-003",
} as const;

/** A minimal view of the environment the resolution reads. */
export type NameEnvironment = Readonly<Record<string, string | undefined>>;

/** A minimal view of the consumer's settings (the two keys this module owns). */
export type PrimeSettings = {
  [PRIME_BIN_KEY]?: string;
  [PRIME_LAUNCHER_KEY]?: string;
};

/** One resolved name, with where it came from. */
export type ResolvedName = {
  /** The name in force. */
  name: string;
  /** Where it came from: the setting, one alias, or the as-is default. */
  source: "setting" | "alias" | "default";
  /** Which alias, when `source` is `alias`. */
  alias?: string;
};

/** The resolution of both executables for one call. */
export type ResolvedExecutableNames = {
  agent: ResolvedName;
  launcher: ResolvedName;
};

/**
 * Resolve the agent executable and the launcher for one call, from the
 * consumer's settings and the environment, in the order of the baseline. The
 * launcher falls through `SPECSTRIDE_PRIME_FLEET_BIN`, then the legacy
 * `SPECSTRIDE_PRIME_BIN`, then the default — the order exception of
 * F138-FR-003 (when the two variables differ, the FIRST wins; the launch is
 * not refused, unlike every other key).
 */
export function resolveExecutableNames(
  settings: PrimeSettings | undefined,
  env: NameEnvironment,
): ResolvedExecutableNames {
  const agentSetting = settings?.[PRIME_BIN_KEY];
  const agent: ResolvedName = agentSetting
    ? { name: agentSetting, source: "setting" }
    : env[PRIME_BIN_ALIAS]
      ? { name: env[PRIME_BIN_ALIAS] as string, source: "alias", alias: PRIME_BIN_ALIAS }
      : { name: PRIME_BIN_DEFAULT, source: "default" };

  const launcherSetting = settings?.[PRIME_LAUNCHER_KEY];
  const first = env[PRIME_LAUNCHER_ALIAS_FIRST];
  const legacy = env[PRIME_LAUNCHER_ALIAS_LEGACY];
  const launcher: ResolvedName = launcherSetting
    ? { name: launcherSetting, source: "setting" }
    : first
      ? { name: first, source: "alias", alias: PRIME_LAUNCHER_ALIAS_FIRST }
      : legacy
        ? { name: legacy, source: "alias", alias: PRIME_LAUNCHER_ALIAS_LEGACY }
        : { name: PRIME_LAUNCHER_DEFAULT, source: "default" };

  return { agent, launcher };
}
