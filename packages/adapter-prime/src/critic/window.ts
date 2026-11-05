/**
 * The context window statement of a prime critic (T051; covers F138-FR-022,
 * test CT-138-22 in `tests/characterization/138/critic.test.ts`).
 *
 * The adapter states the window with its source: declared by the consumer,
 * or read from the model list of the harness — and the SMALLER of the two
 * where both exist. Outside the `parity` profile there is NO default
 * window: a critic whose window is unknown does not qualify, a configured
 * one is refused with the reason, and it is never picked automatically.
 * Under the `parity` profile the adapter states 98,304 tokens for `prime`
 * and for `prime:<variant>` — whose model the product cannot see — with the
 * source `catalogue`.
 */

/** The window the `parity` profile states for an unseen model. */
export const PARITY_CATALOGUE_WINDOW = 98_304;

/** Where a stated window comes from. */
export type WindowSource = "consumer" | "model-list" | "catalogue";

/** The statement of the window of one critic configuration. */
export type ContextWindowStatement = {
  /** The tokens, or null where the window is unknown. */
  tokens: number | null;
  /** The source of the number. */
  source: WindowSource | null;
};

/** The inputs a window statement reads. */
export type WindowInput = {
  profile: "parity" | "default";
  /** The window the consumer declared (`SPECSTRIDE_CRITIC_CONTEXT_TOKENS` or configuration). */
  declaredByConsumer?: number | null | undefined;
  /** The window the model list of the harness states for the model in force. */
  modelListTokens?: number | null | undefined;
};

/** True where the number is a positive finite token count. */
function isTokens(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * State the context window of a prime critic with its source
 * (F138-FR-022). Outside `parity` an unknown window is `null` with no
 * source: no default is invented. Under `parity` an unseen model gets the
 * catalogue window of 98,304 tokens.
 */
export function contextWindowStatement(input: WindowInput): ContextWindowStatement {
  if (input.profile === "parity") {
    if (isTokens(input.declaredByConsumer)) {
      return { tokens: input.declaredByConsumer, source: "consumer" };
    }
    return { tokens: PARITY_CATALOGUE_WINDOW, source: "catalogue" };
  }
  const declared = isTokens(input.declaredByConsumer) ? input.declaredByConsumer : null;
  const listed = isTokens(input.modelListTokens) ? input.modelListTokens : null;
  if (declared !== null && listed !== null) {
    return {
      tokens: Math.min(declared, listed),
      source: declared <= listed ? "consumer" : "model-list",
    };
  }
  if (declared !== null) return { tokens: declared, source: "consumer" };
  if (listed !== null) return { tokens: listed, source: "model-list" };
  return { tokens: null, source: null };
}

/** True where the critic qualifies with the window it stated (F138-FR-022). */
export function windowQualifies(statement: ContextWindowStatement): boolean {
  return statement.tokens !== null;
}

/**
 * The refusal of a configured critic whose window is unknown outside the
 * `parity` profile (F138-FR-022): the reason is stated, the launch ends.
 */
export function refuseUnknownWindow(statement: ContextWindowStatement): string | null {
  if (statement.tokens !== null) return null;
  return (
    "critic: no context window is known for prime; declare one " +
    "(the consumer's setting or the model list of the harness) — " +
    "outside the parity profile there is no default window"
  );
}
