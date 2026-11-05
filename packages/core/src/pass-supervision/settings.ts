/**
 * T032 of feature 118 — the settings and aliases of the watchdogs and the
 * ceilings (F118-FR-014; C-051, C-052; B-0046, B-0058, B-0470 to B-0475,
 * B-0488 to B-0492, B-0506, B-0507, B-0521, B-0538, B-0540, B-0541).
 *
 * The flags and variables of the baseline stay as aliases of configuration
 * keys, with the values and defaults of the baseline. The pass loop is not a
 * public command; its flags are internal parameters. The alias entries as
 * data live in feature 110's alias table (T008); this module resolves a
 * settings object from them and keeps the two distinctions the baseline
 * makes: a repeat-ignore value that is empty differs from one that is unset,
 * and the progress-path flags win over the environment variable.
 */

/** Every supervision setting, resolved (F118-FR-014). */
export interface SupervisionSettings {
  /** The absolute pass ceiling, in seconds (default 1,800). */
  readonly ceilingSec: number;
  /** The idle period, in seconds (default 900). */
  readonly idleTimeoutSec: number;
  /** The progress period, in seconds (default 1,800; 0 disables). */
  readonly progressTimeoutSec: number;
  /** The progress roots, in order (flags win over the variable). */
  readonly progressPaths: readonly string[];
  /** The repeat limit (default 12; 0 disables both repetition checks). */
  readonly repeatLimit: number;
  /** The repeat-ignore expression: `undefined` unset (default on), `""` explicit off. */
  readonly repeatIgnore: string | undefined;
  /** The tick, in seconds (default 15). */
  readonly tickSec: number;
  /** The limit of consecutive cap kills (default 3). */
  readonly maxConsecutiveCaps: number;
  /** The short-pass period, in seconds (default 180). */
  readonly shortPassSec: number;
  /** After how many short passes the nudge is shown (default 2; 0 disables). */
  readonly shortPassNudgeAfter: number;
  /** The directory of the yield artifacts. */
  readonly yieldDir: string;
}

/** The defaults of the baseline, one field of `SupervisionSettings` each. */
export const SETTINGS_DEFAULTS: SupervisionSettings = Object.freeze({
  ceilingSec: 1800,
  idleTimeoutSec: 900,
  progressTimeoutSec: 1800,
  progressPaths: [],
  repeatLimit: 12,
  repeatIgnore: undefined,
  tickSec: 15,
  maxConsecutiveCaps: 3,
  shortPassSec: 180,
  shortPassNudgeAfter: 2,
  yieldDir: "yield",
});

/** One alias of the baseline: the flags, the variable and the key of one setting. */
export interface SettingAlias {
  /** The configuration key of feature 110, when the catalogue holds one for
   *  this setting (T008 added the keys of F118-FR-014 to the alias table);
   *  `undefined` for a setting the baseline carries only as a variable. */
  readonly key: string | undefined;
  /** The internal flags of the pass loop, in order. */
  readonly flags: readonly string[];
  /** The environment variable of the baseline. */
  readonly env: string;
  /** The default, as the baseline holds it. */
  readonly default: string;
}

/** The alias table of F118-FR-014 (the flags are internal parameters). */
export const ALIASES: readonly SettingAlias[] = Object.freeze([
  {
    key: "roles.proposer.timeoutSec",
    flags: ["--timeout", "--proposer-timeout"],
    env: "SPECSTRIDE_PROPOSER_TIMEOUT",
    default: "1800",
  },
  {
    key: "roles.proposer.idleTimeoutSec",
    flags: ["--idle-timeout"],
    env: "SPECSTRIDE_PROPOSER_IDLE_TIMEOUT",
    default: "900",
  },
  {
    key: "roles.proposer.progressTimeoutSec",
    flags: ["--progress-timeout"],
    env: "SPECSTRIDE_PROPOSER_PROGRESS_TIMEOUT",
    default: "1800",
  },
  {
    key: "roles.proposer.progressPaths",
    flags: ["--progress-path"],
    env: "SPECSTRIDE_PROPOSER_PROGRESS_PATHS",
    default: "",
  },
  {
    key: "roles.proposer.repeatLimit",
    flags: ["--repeat-limit"],
    env: "SPECSTRIDE_PROPOSER_REPEAT_LIMIT",
    default: "12",
  },
  {
    key: "roles.proposer.repeatIgnore",
    flags: [],
    env: "SPECSTRIDE_PROPOSER_REPEAT_IGNORE",
    default: "",
  },
  { key: undefined, flags: [], env: "SPECSTRIDE_WATCHDOG_TICK", default: "15" },
  { key: "roles.proposer.maxCaps", flags: [], env: "SPECSTRIDE_PROPOSER_MAX_CAPS", default: "3" },
  { key: undefined, flags: [], env: "SPECSTRIDE_SHORT_PASS_SEC", default: "180" },
  { key: undefined, flags: [], env: "SPECSTRIDE_SHORT_PASS_NUDGE_AFTER", default: "2" },
  { key: undefined, flags: ["--yield-dir"], env: "YIELD_DIR", default: "yield" },
]);

/** The environment the resolver reads: a plain record handed in, never the
 *  process environment of the host (F100-FR-012: the core has no I/O). */
export type Environment = Readonly<Record<string, string | undefined>>;

/** The internal flags the resolver reads, as `name=value` pairs in order. */
export type FlagList = readonly string[];

/** The value of one flag `--name=value`, or `undefined`. */
export function flagValue(flags: FlagList, name: string): string | undefined {
  for (const flag of flags) {
    const prefix = `${name}=`;
    if (flag.startsWith(prefix)) return flag.slice(prefix.length);
  }
  return undefined;
}

/** Every value of a repeatable flag `--name=value`, in order. */
export function flagValues(flags: FlagList, name: string): string[] {
  const prefix = `${name}=`;
  return flags.filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length));
}

function integerSetting(alias: SettingAlias, environment: Environment, flags: FlagList): number {
  let fromFlag: string | undefined;
  for (const name of alias.flags) {
    fromFlag = flagValue(flags, name);
    if (fromFlag !== undefined) break;
  }
  const raw = fromFlag ?? environment[alias.env];
  const parsed = raw === undefined ? Number(alias.default) : Number(raw);
  return Number.isFinite(parsed) ? parsed : Number(alias.default);
}

/** Resolve the repeat-ignore setting: an empty value differs from an unset one. */
export function resolveRepeatIgnore(
  environment: Environment,
  _flags: FlagList,
): string | undefined {
  const raw = environment[ALIASES[5].env];
  return raw === undefined ? undefined : raw;
}

/** Resolve the progress roots: explicit flags win over the colon-separated variable. */
export function resolveProgressPaths(environment: Environment, flags: FlagList): string[] {
  const fromFlags = flagValues(flags, "--progress-path");
  if (fromFlags.length > 0) return fromFlags;
  const fromEnv = environment[ALIASES[3].env];
  if (fromEnv === undefined || fromEnv === "") return [];
  return fromEnv.split(":");
}

/** Resolve the directory of the yield artifacts (`--yield-dir`, else `YIELD_DIR`). */
export function resolveYieldDir(environment: Environment, flags: FlagList): string {
  const flag = flagValue(flags, "--yield-dir");
  if (flag !== undefined) return flag;
  const env = environment[ALIASES[10].env];
  if (env !== undefined && env !== "") return env;
  return SETTINGS_DEFAULTS.yieldDir;
}

/** Resolve every supervision setting from the aliases, flags and environment. */
export function resolveSettings(environment: Environment, flags: FlagList): SupervisionSettings {
  return {
    ceilingSec: integerSetting(ALIASES[0], environment, flags),
    idleTimeoutSec: integerSetting(ALIASES[1], environment, flags),
    progressTimeoutSec: integerSetting(ALIASES[2], environment, flags),
    progressPaths: resolveProgressPaths(environment, flags),
    repeatLimit: integerSetting(ALIASES[4], environment, flags),
    repeatIgnore: resolveRepeatIgnore(environment, flags),
    tickSec: integerSetting(ALIASES[6], environment, flags),
    maxConsecutiveCaps: integerSetting(ALIASES[7], environment, flags),
    shortPassSec: integerSetting(ALIASES[8], environment, flags),
    shortPassNudgeAfter: integerSetting(ALIASES[9], environment, flags),
    yieldDir: resolveYieldDir(environment, flags),
  };
}
