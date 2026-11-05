/**
 * T053 — derivation's verification-mode rule and its reason
 * (F107-FR-036; annex X §X.6 rows 52 and 284; research.md row 13; ruling 40,
 * ruling K1).
 *
 * The rule, and nothing else:
 *
 * - derivation MUST set the mode `required` wherever commands are declared,
 *   and say why: the reason is the member `declared` of the closed set
 *   "Reason of the verification mode" (row 284);
 * - where NO command is declared anywhere, derivation sets the mode that
 *   configuration resolves — `required` by default (ruling K1) — and says so
 *   with the reason `configured` and the source of the configured value;
 * - derivation MUST NOT invent a command: the declared count comes from the
 *   inventory's discoveries (F107-FR-008), never from a guess, and a mode
 *   name that is not of row 52 resolves to the default rather than being
 *   copied into the contract.
 *
 * The mode is recorded in `configuration.verification` ({mode, reason}) and
 * printed on the line `[SPECSTRIDE-DERIVE]` (`verification=`, `reason=`) and
 * in the report of `dry-run`; the reason itself is not stored beyond the
 * member `reason` of that block, because it follows from the inventory.
 */

/** The verification modes of the closed set of annex X §X.6 row 52. */
export const VERIFICATION_MODES = ["required", "plan", "off"] as const;
export type VerificationMode = (typeof VERIFICATION_MODES)[number];

/** The reasons of the closed set "Reason of the verification mode" (row 284). */
export const VERIFICATION_REASONS = ["declared", "configured"] as const;
export type VerificationReason = (typeof VERIFICATION_REASONS)[number];

/** The mode configuration resolves when nothing is configured (ruling K1). */
export const DEFAULT_CONFIGURED_MODE: VerificationMode = "required";

/** The source of the configured value when nothing is configured. */
export const DEFAULT_CONFIGURED_SOURCE = "default" as const;

/** The source recorded for the reason `declared` — the inventory itself. */
export const DECLARED_SOURCE = "the inventory" as const;

/** What the rule produces, exactly as `configuration.verification` stores it. */
export type VerificationModeDecision = {
  readonly mode: VerificationMode;
  readonly reason: VerificationReason;
  /**
   * The source of the value: `the inventory` for `declared`; the source of
   * the configured value (`default` when nothing was configured) for
   * `configured`.
   */
  readonly source: string;
};

/** The input of the rule: the declared count of the inventory, and the configuration. */
export type VerificationModeInput = {
  /**
   * The number of commands the inventory holds as DECLARED (F107-FR-008):
   * from the verification-commands documents and the declared commands of
   * the plan — never from a shell candidate alone, and never invented.
   */
  readonly declaredCommands: number;
  /** The mode user configuration resolves, when it resolves one. */
  readonly configuredMode?: string | undefined;
  /** The source of the configured mode (user-config, environment, flag). */
  readonly configuredSource?: string | undefined;
};

/** True when the text names a mode of row 52. */
export function isVerificationMode(text: string): text is VerificationMode {
  return (VERIFICATION_MODES as readonly string[]).includes(text);
}

/**
 * F107-FR-036 — the verification-mode rule of derivation. Pure: the same
 * input always gives the same decision.
 */
export function verificationModeRule(input: VerificationModeInput): VerificationModeDecision {
  if (input.declaredCommands > 0) {
    // Commands are declared: `required`, and the closed-set reason says the
    // inventory declared them. The configured mode (if any) is not in force.
    return Object.freeze({
      mode: "required",
      reason: "declared",
      source: DECLARED_SOURCE,
    });
  }
  // No command is declared anywhere: the mode configuration resolves,
  // `required` by default (ruling K1), with the reason `configured` and the
  // source of the configured value. A name that is not of row 52 does not
  // reach the contract: it resolves to the default.
  const configured =
    input.configuredMode !== undefined && isVerificationMode(input.configuredMode)
      ? input.configuredMode
      : DEFAULT_CONFIGURED_MODE;
  return Object.freeze({
    mode: configured,
    reason: "configured",
    source: input.configuredSource ?? DEFAULT_CONFIGURED_SOURCE,
  });
}
