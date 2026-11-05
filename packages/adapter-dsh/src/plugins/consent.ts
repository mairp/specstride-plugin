/**
 * T059 — the consent record and the sources of the allowlist
 * (F130-FR-034).
 *
 * The protocol is an opt-in and stays one. Outside the `parity` profile the
 * allowlist is accepted from USER CONFIGURATION only: it is a widening key,
 * and from project configuration, the environment or a flag it is IGNORED,
 * with a launch message and a doctor warning (ruling P15; F100-FR-202;
 * ruling 35; CQ-233). Under the `parity` profile the as-is variable stays
 * its alias, as at the baseline. A plugin install writes the profile in the
 * consumer's real home, which a run otherwise never writes; the allowlist in
 * user configuration is the consent to exactly that write, for exactly the
 * listed plugins, and no other write to the real home is allowed. Every
 * install is recorded in the run record and in the receipt, with the
 * plugins, the reason and the allowlist entry that admitted each. Under the
 * audience `distributed` the protocol is off unless the allowlist is set.
 * The product never installs, vendors or downloads the harness itself.
 */

/** The setting of the allowlist (F130-FR-033). */
export const PLUGIN_ALLOWLIST_SETTING = "harnesses.dsh.pluginAllowlist" as const;

/** The setting of the time limit of the installer (F130-FR-033). */
export const PLUGIN_TIMEOUT_SETTING = "harnesses.dsh.pluginTimeoutSec" as const;

/** The as-is variable that aliases the allowlist under `parity` (DV-027). */
export const PLUGIN_ALLOWLIST_ALIAS = "DSH_PLUGIN_ALLOWLIST" as const;

/** The as-is variable that aliases the time limit under `parity` (DV-027). */
export const PLUGIN_TIMEOUT_ALIAS = "DSH_PLUGIN_TIMEOUT" as const;

/** The default time limit of the installer, as a setting value (F130-FR-033). */
export const PLUGIN_TIMEOUT_DEFAULT_SEC = 600 as const;

/** Where a stated allowlist value came from. */
export type AllowlistSource = "user-config" | "project-config" | "env" | "flag";

/** The plugin settings of one run, as F130-FR-033 states them. */
export type PluginSettings = {
  /** The comma-separated allowlist, or the empty string when unset. */
  readonly allowlist: string;
  readonly timeoutSec: number;
};

/**
 * Reads the settings of the protocol (F130-FR-033): the allowlist
 * `harnesses.dsh.pluginAllowlist`, a comma-separated list of exact
 * `package@semver` specs, with its as-is alias, and the time limit
 * `harnesses.dsh.pluginTimeoutSec`, default 600, with its alias. An EMPTY
 * value disables the protocol.
 */
export function pluginSettings(source: {
  readonly get?: (key: string) => string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): PluginSettings {
  const read = (key: string, alias: string): string => {
    const fromKey = source.get?.(key);
    if (fromKey !== undefined && fromKey !== "") return fromKey;
    const fromAlias = source.env?.[alias];
    if (fromAlias !== undefined && fromAlias !== "") return fromAlias;
    return "";
  };
  const timeoutRaw = read(PLUGIN_TIMEOUT_SETTING, PLUGIN_TIMEOUT_ALIAS);
  const timeoutSec =
    timeoutRaw !== "" && Number.isFinite(Number(timeoutRaw)) && Number(timeoutRaw) > 0
      ? Number(timeoutRaw)
      : PLUGIN_TIMEOUT_DEFAULT_SEC;
  return { allowlist: read(PLUGIN_ALLOWLIST_SETTING, PLUGIN_ALLOWLIST_ALIAS), timeoutSec };
}

/** The consent decision for one run. */
export type AllowlistConsent =
  | {
      readonly accepted: true;
      readonly allowlist: readonly string[];
      readonly source: "user-config";
      /** The consent record, written to the run record on every install. */
      readonly record: ConsentRecord;
    }
  | {
      readonly accepted: false;
      readonly allowlist: readonly string[];
      /** Where a value was stated but not accepted, if any. */
      readonly ignoredFrom: AllowlistSource | null;
      /** The launch message of the pass loop (F130-FR-034). */
      readonly launchMessage: string;
      /** The doctor warning (F130-FR-005, F130-FR-034). */
      readonly doctorWarning: string;
    };

/** The launch message for an ignored allowlist (F130-FR-034). */
export function allowlistIgnoredLaunchMessage(from: AllowlistSource): string {
  return (
    `${"pass-loop"}: ignoring DSH plugin allowlist from ${from}; ` +
    `set ${PLUGIN_ALLOWLIST_SETTING} in user configuration to opt in`
  );
}

/** The doctor warning for an ignored allowlist (F130-FR-005, F130-FR-034). */
export function allowlistIgnoredDoctorWarning(from: AllowlistSource): string {
  return (
    `warn: the DSH plugin allowlist from ${from} is ignored outside the parity profile; ` +
    `the plugin protocol accepts user configuration only (ruling P15)`
  );
}

/**
 * Resolves the consent for one run (F130-FR-034): outside `parity`, ONLY the
 * user configuration is accepted — a widening key from project
 * configuration, the environment or a flag is ignored with the launch
 * message and the doctor warning. Under `parity` the as-is variable stays
 * its alias, so the environment source is accepted as the alias of the
 * setting, as at the baseline. Under the audience `distributed` the protocol
 * is off unless the allowlist is set.
 */
export function resolveAllowlistConsent(input: {
  readonly profile: string;
  readonly audience?: "personal" | "distributed";
  /** The stated values, most specific last; the first accepted one wins. */
  readonly stated: readonly {
    readonly source: AllowlistSource;
    readonly value: string;
  }[];
}): AllowlistConsent {
  const parity = input.profile === "parity";
  const acceptable: readonly AllowlistSource[] = parity ? ["user-config", "env"] : ["user-config"];
  let ignoredFrom: AllowlistSource | null = null;
  for (const entry of input.stated) {
    if (entry.value === undefined || entry.value === "") continue;
    if (!acceptable.includes(entry.source)) {
      ignoredFrom = entry.source;
      continue;
    }
    const allowlist = entry.value
      .split(",")
      .map((spec) => spec.trim())
      .filter((spec) => spec !== "");
    // Under `distributed` the protocol is off unless the allowlist is set.
    if (allowlist.length === 0) continue;
    return {
      accepted: true,
      allowlist,
      source: "user-config",
      record: consentRecord({ allowlist, profile: input.profile }),
    };
  }
  if (ignoredFrom !== null) {
    return {
      accepted: false,
      allowlist: [],
      ignoredFrom,
      launchMessage: allowlistIgnoredLaunchMessage(ignoredFrom),
      doctorWarning: allowlistIgnoredDoctorWarning(ignoredFrom),
    };
  }
  return {
    accepted: false,
    allowlist: [],
    ignoredFrom: null,
    launchMessage: "",
    doctorWarning: "",
  };
}

/**
 * The consent record (F130-FR-034): the consumer's consent is to exactly the
 * listed plugins, to exactly one write — the install into the real home —
 * and never to what the profile LOADS into a pass (that is F130-FR-043,
 * recorded separately).
 */
export type ConsentRecord = {
  readonly consent: "user-configuration";
  readonly scope: "install-only";
  readonly setting: typeof PLUGIN_ALLOWLIST_SETTING;
  readonly profile: string;
  readonly allowlist: readonly string[];
};

/** Builds the consent record of one run. */
export function consentRecord(input: {
  readonly allowlist: readonly string[];
  readonly profile: string;
}): ConsentRecord {
  return {
    consent: "user-configuration",
    scope: "install-only",
    setting: PLUGIN_ALLOWLIST_SETTING,
    profile: input.profile,
    allowlist: input.allowlist,
  };
}

/**
 * The run-record entry of one install (F130-FR-034): the plugins, the reason
 * and, for EACH plugin, the allowlist entry that admitted it.
 */
export type InstallRunRecord = {
  readonly kind: "plugin-install";
  readonly profile: string;
  readonly reason: string;
  readonly consent: "user-configuration";
  readonly plugins: readonly {
    readonly plugin: string;
    readonly admittedBy: string;
    readonly write: "real-home";
    /** The admitted plugin is loaded into the next pass BY THIS CONSENT. */
    readonly loadedIntoNextPass: true;
  }[];
};

/** Builds the run-record entry of one install. */
export function installRunRecord(input: {
  readonly profile: string;
  readonly reason: string;
  readonly plugins: readonly string[];
  readonly allowlist: readonly string[];
}): InstallRunRecord {
  return {
    kind: "plugin-install",
    profile: input.profile,
    reason: input.reason,
    consent: "user-configuration",
    plugins: input.plugins.map((plugin) => ({
      plugin,
      // The allowlist entry that admitted the plugin is the identical exact
      // spec: membership is LITERAL (F130-FR-032).
      admittedBy: plugin,
      write: "real-home" as const,
      loadedIntoNextPass: true as const,
    })),
  };
}

/**
 * Whether the ONE allowed write to the real home may happen (F130-FR-034,
 * ruling P15): only for plugins the accepted allowlist lists, LITERALLY, and
 * only where consent was accepted. A real-home write for a plugin outside
 * the allowlist is refused.
 */
export function realHomeWriteAllowed(
  consent: AllowlistConsent,
  plugins: readonly string[],
): { readonly ok: true } | { readonly ok: false; readonly cause: string } {
  if (!consent.accepted) {
    return { ok: false, cause: "no plugin consent: the allowlist was not accepted" };
  }
  for (const plugin of plugins) {
    if (!consent.allowlist.includes(plugin)) {
      return { ok: false, cause: `plugin ${plugin} is not in the allowlist` };
    }
  }
  return { ok: true };
}
