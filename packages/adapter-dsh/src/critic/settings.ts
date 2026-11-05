/**
 * T041 — the settings of the critic and their aliases (F130-FR-022).
 *
 * Each setting is a key of the consumer configuration with an AS-IS variable
 * as its alias, as for the proposer (DV-027): the executable and the profile
 * (`harnesses.dsh.bin`, `harnesses.dsh.profile`), the real home
 * (`harnesses.dsh.home`, read and never written), the model
 * (`roles.critic.model` for this harness — used when the entry has no
 * qualifier — with the model of the proposer as fallback), the provider
 * (`roles.critic.provider`, preferred over the provider of the proposer),
 * the reasoning effort (`roles.critic.effort`, with the effort of the
 * proposer as fallback, added to the settings of the overlay), the context
 * tokens of the critic (`roles.critic.contextTokens`), and the proof switch
 * `harnesses.dsh.critic.proof` (F130-FR-024: `strict` | `none`).
 *
 * The permission mode of the critic is `read-only` and is EXPORTED TO EVERY
 * CRITIC CALL whatever the setting of the proposer says (F130-FR-022);
 * a configured mode never lifts it.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { DSH_DEFAULT_BIN, DSH_DEFAULT_PROFILE, type ConfigSource } from "../proposer/settings.ts";
import { CRITIC_PERMISSION_MODE } from "../proposer/permission.ts";

/** The key of each setting of the critic (F130-FR-022), as a closed record. */
export const CRITIC_SETTING_KEYS = Object.freeze({
  bin: "harnesses.dsh.bin",
  profile: "harnesses.dsh.profile",
  home: "harnesses.dsh.home",
  model: "roles.critic.model",
  provider: "roles.critic.provider",
  effort: "roles.critic.effort",
  contextTokens: "roles.critic.contextTokens",
  proof: "harnesses.dsh.critic.proof",
} as const);

/** One name of `CRITIC_SETTING_KEYS`. */
export type CriticSettingName = keyof typeof CRITIC_SETTING_KEYS;

/** The as-is variable that aliases each key (DV-027); absent where none exists. */
export const CRITIC_SETTING_ALIASES: Readonly<Partial<Record<CriticSettingName, string>>> =
  Object.freeze({
    bin: "DSH_BIN",
    profile: "DSH_PROFILE",
    home: "DSH_HOME",
    model: "DSH_CRITIC_MODEL",
    provider: "DSH_CRITIC_PROVIDER",
    effort: "DSH_CRITIC_EFFORT",
    contextTokens: "DSH_CRITIC_CONTEXT_TOKENS",
    proof: "DSH_CRITIC_PROOF",
  } as const);

/** The values of the proof switch `harnesses.dsh.critic.proof` (F130-FR-024). */
export const CRITIC_PROOF_VALUES: readonly string[] = Object.freeze(["strict", "none"]);

/** The default of the proof switch (F130-FR-024: the default MUST be `strict`). */
export const CRITIC_PROOF_DEFAULT = "strict" as const;

/** The proof the `parity` profile makes (row 117 of annex X §X.7: `none`). */
export const CRITIC_PROOF_PARITY = "none" as const;

/** The permission mode of the critic, exported to EVERY call (F130-FR-022). */
export const CRITIC_MODE_EXPORTED = CRITIC_PERMISSION_MODE;

/** A read of the critic settings, with the proposer fallbacks applied. */
export type CriticSettings = {
  readonly bin: string;
  readonly profile: string;
  readonly home: string;
  readonly model: string | null;
  readonly provider: string | null;
  readonly effort: string | null;
  readonly contextTokens: number | null;
  /** The value of `harnesses.dsh.critic.proof`, `none` under `parity`. */
  readonly proof: "strict" | "none";
  /** Always `read-only`, whatever the proposer's mode says (F130-FR-022). */
  readonly permissionMode: typeof CRITIC_PERMISSION_MODE;
};

/** The proposer fallbacks of F130-FR-022: model, provider and effort. */
export type CriticProposerFallback = {
  readonly model?: string | null;
  readonly provider?: string | null;
  readonly effort?: string | null;
};

/** Reads one setting: the key first, then its as-is variable alias. */
function readSetting(source: ConfigSource, name: CriticSettingName): string | undefined {
  const fromKey = source.get?.(CRITIC_SETTING_KEYS[name]);
  if (fromKey !== undefined && fromKey !== "") return fromKey;
  const alias = CRITIC_SETTING_ALIASES[name];
  const fromAlias = alias === undefined ? undefined : source.env?.[alias];
  return fromAlias !== undefined && fromAlias !== "" ? fromAlias : undefined;
}

/**
 * Resolves the settings of a critic call (F130-FR-022): the keys of
 * `CRITIC_SETTING_KEYS` with their aliases, the proposer fallbacks, and the
 * permission mode `read-only` exported to every call whatever the proposer
 * says. The real home is a READ path only: this module never writes it.
 */
export function resolveCriticSettings(
  source: ConfigSource = {},
  fallback: CriticProposerFallback = {},
): CriticSettings {
  const env = source.env ?? {};
  const profile = readSetting(source, "profile") ?? DSH_DEFAULT_PROFILE;
  const rawProof = readSetting(source, "proof");
  if (rawProof !== undefined && !CRITIC_PROOF_VALUES.includes(rawProof)) {
    throw new Error(
      `dsh critic: ${CRITIC_SETTING_KEYS.proof} must be one of ` +
        `${CRITIC_PROOF_VALUES.join(", ")}, got ${rawProof}`,
    );
  }
  const proof = (
    profile === "parity" ? CRITIC_PROOF_PARITY : (rawProof ?? CRITIC_PROOF_DEFAULT)
  ) as "strict" | "none";
  const rawTokens = readSetting(source, "contextTokens");
  const tokens = rawTokens === undefined ? null : Number(rawTokens);
  return {
    bin: readSetting(source, "bin") ?? DSH_DEFAULT_BIN,
    profile,
    home: readSetting(source, "home") ?? join(env.HOME ?? homedir(), ".dsh"),
    model: readSetting(source, "model") ?? fallback.model ?? null,
    provider: readSetting(source, "provider") ?? fallback.provider ?? null,
    effort: readSetting(source, "effort") ?? fallback.effort ?? null,
    contextTokens: tokens !== null && Number.isFinite(tokens) && tokens > 0 ? tokens : null,
    proof,
    permissionMode: CRITIC_MODE_EXPORTED,
  };
}
