/**
 * T026 — the settings of the proposer and their aliases (F130-FR-008).
 *
 * Every setting is a key of the consumer configuration with an AS-IS variable
 * as its alias, so that the as-is variable and the key reach the same value
 * (DV-027): the executable, the profile, the real home of the harness, the
 * provider for a bare model reference, the model reference used when the flag
 * names none (`roles.proposer.model`, which takes precedence over the
 * qualifier of the entry), the reasoning effort, and the permission mode of
 * F130-FR-010.
 *
 * Defaults: the executable `dsh`; the profile `headless`; the real home
 * `.dsh` under the consumer's home (read, linked into the overlay, exported
 * to the process — never written); the permission mode `workspace-write`.
 */
import { homedir } from "node:os";
import { join } from "node:path";

/** The key of each setting of the proposer (F130-FR-008), as a closed record. */
export const DSH_SETTING_KEYS = Object.freeze({
  bin: "harnesses.dsh.bin",
  profile: "harnesses.dsh.profile",
  home: "harnesses.dsh.home",
  provider: "harnesses.dsh.provider",
  model: "roles.proposer.model",
  effort: "roles.proposer.effort",
  permissionMode: "sandbox.permissionMode",
} as const);

/** One name of `DSH_SETTING_KEYS`. */
export type DshSettingName = keyof typeof DSH_SETTING_KEYS;

/** The as-is variable that aliases each key (DV-027); absent where none exists. */
export const DSH_SETTING_ALIASES: Readonly<Partial<Record<DshSettingName, string>>> = Object.freeze(
  {
    bin: "DSH_BIN",
    profile: "DSH_PROFILE",
    home: "DSH_HOME",
    provider: "DSH_PROVIDER",
    permissionMode: "DSH_PERMISSION_MODE",
  } as const,
);

/** The default profile of the headless invocation (F130-FR-007). */
export const DSH_DEFAULT_PROFILE = "headless" as const;

/** The default executable of the harness. */
export const DSH_DEFAULT_BIN = "dsh" as const;

/** The default permission mode of the proposer (F130-FR-010). */
export const DSH_DEFAULT_PERMISSION_MODE = "workspace-write" as const;

/** A read of the settings: each key with its resolved value (null where unset). */
export type DshSettings = {
  readonly bin: string;
  readonly profile: string;
  readonly home: string;
  readonly provider: string | null;
  readonly model: string | null;
  readonly effort: string | null;
  readonly permissionMode: string | null;
};

/** A source of configuration values: dotted keys of the consumer configuration. */
export type ConfigSource = {
  /** The value at a dotted key, or undefined where the key is absent. */
  readonly get?: (key: string) => string | undefined;
  /** Environment variables, for the as-is aliases. */
  readonly env?: Readonly<Record<string, string | undefined>>;
};

/** Reads one setting: the key first, then its as-is variable alias. */
function readSetting(source: ConfigSource, name: DshSettingName): string | undefined {
  const fromKey = source.get?.(DSH_SETTING_KEYS[name]);
  if (fromKey !== undefined && fromKey !== "") return fromKey;
  const alias = DSH_SETTING_ALIASES[name];
  const fromAlias = alias === undefined ? undefined : source.env?.[alias];
  return fromAlias !== undefined && fromAlias !== "" ? fromAlias : undefined;
}

/**
 * Resolves the settings of a proposer pass (F130-FR-008): the keys of
 * `DSH_SETTING_KEYS` with their as-is aliases, and the defaults above.
 * The real home is a READ path only: this module never writes it.
 */
export function resolveDshSettings(source: ConfigSource = {}): DshSettings {
  const env = source.env ?? {};
  return {
    bin: readSetting(source, "bin") ?? DSH_DEFAULT_BIN,
    profile: readSetting(source, "profile") ?? DSH_DEFAULT_PROFILE,
    home: readSetting(source, "home") ?? join(env.HOME ?? homedir(), ".dsh"),
    provider: readSetting(source, "provider") ?? null,
    model: readSetting(source, "model") ?? null,
    effort: readSetting(source, "effort") ?? null,
    permissionMode: readSetting(source, "permissionMode") ?? null,
  };
}
