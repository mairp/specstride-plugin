/**
 * T075 — the as-is sandbox assertion under the `parity` profile (F109-FR-027).
 *
 * Outside the `parity` profile the seam NEVER asserts a sandbox to a harness
 * by itself. Under `parity`, when the run has the effective user id 0 and the
 * variable `IS_SANDBOX` is unset or empty, the seam hands `IS_SANDBOX=1` to
 * the harness, as the baseline does, and the engine log carries the as-is
 * note `  note     : root + IS_SANDBOX unset -> auto-set IS_SANDBOX=1`.
 */

/** The variable the baseline asserts to a harness that runs as root. */
export const SANDBOX_ASSERTION_VARIABLE = "IS_SANDBOX";

/** The as-is note the engine log carries when the seam asserts the variable. */
export const AS_IS_SANDBOX_NOTE = "  note     : root + IS_SANDBOX unset -> auto-set IS_SANDBOX=1";

/** What the as-is assertion decided for one run. */
export type AsIsAssertion = {
  /** True exactly when the seam asserted `IS_SANDBOX=1`. */
  readonly asserted: boolean;
  /** The environment the harness receives, with the assertion applied. */
  readonly env: Record<string, string | undefined>;
  /** The as-is note, exactly when the assertion was made; else null. */
  readonly note: string | null;
};

/**
 * F109-FR-027 — apply the as-is assertion. Under `parity` only, as root
 * (effective user id 0) only, and only when `IS_SANDBOX` is unset or empty.
 * Outside `parity`, never — the environment comes back as it was given.
 */
export function asIsSandboxAssertion(input: {
  readonly profile: string | null;
  readonly effectiveUid: number;
  readonly env: Readonly<Record<string, string | undefined>>;
}): AsIsAssertion {
  const env: Record<string, string | undefined> = { ...input.env };
  const current = input.env[SANDBOX_ASSERTION_VARIABLE];
  const applies =
    input.profile === "parity" &&
    input.effectiveUid === 0 &&
    (current === undefined || current === "");
  if (!applies) return { asserted: false, env, note: null };
  env[SANDBOX_ASSERTION_VARIABLE] = "1";
  return { asserted: true, env, note: AS_IS_SANDBOX_NOTE };
}
