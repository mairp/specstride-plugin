/**
 * T045 — the window rule of the critic and the override (F130-FR-029).
 *
 * The window of the context is looked up by the part of the model reference
 * AFTER THE LAST `/`; the bare harness name looks up an EMPTY model. The
 * windows of the baseline's table name models specific to the owner's
 * machines, so they are supplied by configuration: `harnesses.dsh.contextWindows`
 * (a map from model to tokens) and `roles.critic.contextTokens`, which always
 * wins. Under the `parity` profile an unknown model gets the default of
 * 98,304 tokens. Outside the profile a critic on this harness qualifies only
 * with a KNOWN window (Principle IX): an unknown model is an error, and the
 * value used is the smaller of the declared and the effective window. There
 * is no default window for an unknown model outside `parity`.
 */

/** The default window of the `parity` profile (row 28 of annex X §X.7). */
export const CRITIC_DEFAULT_WINDOW = 98_304 as const;

/** Where a resolved window came from. */
export type CriticWindowSource =
  "roles.critic.contextTokens" | "harnesses.dsh.contextWindows" | "parity default 98,304";

/** The outcome of the window resolution. */
export type CriticWindowResolution =
  | { readonly ok: true; readonly window: number; readonly source: CriticWindowSource }
  | { readonly ok: false; readonly message: string };

/** The input: the model reference (null for the bare harness name), the maps. */
export type CriticWindowInput = {
  /** The model reference; null is looked up as the EMPTY model. */
  readonly reference: { readonly model: string } | null;
  /** `roles.critic.contextTokens` — always wins (F130-FR-029). */
  readonly criticContextTokens?: number | null;
  /** `harnesses.dsh.contextWindows` — a map from model to tokens. */
  readonly contextWindows?: Readonly<Record<string, number>>;
  /** The profile: `parity` gets the default, outside it an unknown model fails. */
  readonly profile: string;
  /**
   * The effective window of a gateway in front of the model, where one is
   * known: the value used is the SMALLER of the declared and this.
   */
  readonly effectiveWindow?: number | null;
};

/** The key a model reference is looked up by: the part after the LAST `/`. */
export function criticWindowKey(reference: { readonly model: string } | null): string {
  const model = reference === null ? "" : reference.model;
  const slash = model.lastIndexOf("/");
  return slash < 0 ? model : model.slice(slash + 1);
}

/** The smaller of two known numbers; null where either is unknown. */
function smaller(declared: number, effective: number | null | undefined): number {
  if (effective === null || effective === undefined) return declared;
  return Math.min(declared, effective);
}

/**
 * F130-FR-029 — resolves the window of a critic call. `roles.critic.contextTokens`
 * always wins; then the map `harnesses.dsh.contextWindows` keyed by the part
 * after the last `/`; under `parity` an unknown model gets 98,304; outside
 * `parity` an unknown model is an error — there is no default window.
 */
export function resolveCriticWindow(input: CriticWindowInput): CriticWindowResolution {
  if (input.criticContextTokens !== null && input.criticContextTokens !== undefined) {
    return {
      ok: true,
      window: smaller(input.criticContextTokens, input.effectiveWindow),
      source: "roles.critic.contextTokens",
    };
  }
  const key = criticWindowKey(input.reference);
  const declared = input.contextWindows?.[key];
  if (declared !== undefined && Number.isFinite(declared) && declared > 0) {
    return {
      ok: true,
      window: smaller(declared, input.effectiveWindow),
      source: "harnesses.dsh.contextWindows",
    };
  }
  if (input.profile === "parity") {
    return {
      ok: true,
      window: smaller(CRITIC_DEFAULT_WINDOW, input.effectiveWindow),
      source: "parity default 98,304",
    };
  }
  return {
    ok: false,
    message:
      `pass-loop: dsh critic: no context window is known for the model '${key}'; ` +
      `outside the parity profile the critic qualifies only with a known window ` +
      `(set roles.critic.contextTokens or harnesses.dsh.contextWindows)`,
  };
}
