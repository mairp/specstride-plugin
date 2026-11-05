// Feature 117 (T060) — the debug lines and the kept prompt
// (F117-FR-016, F117-FR-028, F117-FR-043).
//
// With the debug switch of the critic role on (row 56, `roles.critic.debug`):
//  - the assembled prompt is kept under the logical state name
//    `attempt:<N>:<k>:<n>:critic-prompt` (annex B §B.5), and
//  - the debug lines are printed on standard error, among them the line with
//    the nonce: `[debug] nonce=<nonce> provider=<provider> prompt bytes=<n>`.
//
// The prompt holds the nonce and, with the block set `current`, the boundary
// token of the call, so it is kept and the line with the nonce is printed
// ONLY AFTER THE CALL HAS RETURNED (F117-FR-016, U1): `KeptPrompt` refuses
// both before that.
//
// The kept text is OUTSIDE-CLASS text: it passes the ONE ingress of F100-FR-009
// (the one point of redaction) before it is kept — the injected port here is
// the ONLY place in `critic-input/` that hands prompt text outward. Where the
// ingress cannot run, the text is DROPPED and the record says so; the critic
// call does not fail for it (F117-FR-044).

/**
 * The one ingress, owned by `../ingress.ts` since T097; re-exported here so
 * the callers of the kept prompt keep one import.
 */
export { INGRESS_CLASS, type OutsideTextIngress } from "../ingress.ts";
import { INGRESS_CLASS, type OutsideTextIngress } from "../ingress.ts";

/** The logical state name of the kept prompt (annex B §B.5, F117-FR-016). */
export function criticPromptStateKey(phase: number, call: number, index: number): string {
  return `attempt:${phase}:${call}:${index}:critic-prompt`;
}

/** The debug line with the nonce, printed only after the call has returned. */
export function debugNonceLine(values: {
  readonly nonce: string;
  readonly provider: string;
  readonly bytes: number;
}): string {
  return `[debug] nonce=${values.nonce} provider=${values.provider} prompt bytes=${values.bytes}`;
}

/** The debug line with the sizes per block, for `prompt.built` support. */
export function debugBlockLine(values: {
  readonly label: string;
  readonly bytes: number;
  readonly tokens: number;
}): string {
  return `[debug] block ${values.label} ${values.bytes} B (~${values.tokens} tokens)`;
}

/** The record of a kept prompt: the state key and, when kept, the redacted text. */
export type KeptPromptRecord =
  | { readonly kept: true; readonly key: string; readonly text: string; readonly redacted: boolean }
  | { readonly kept: false; readonly key: string; readonly reason: string };

/**
 * The prompt of one critic-class call, kept under its logical name only after
 * the call has returned. Before that, `keepAfterCall` throws: the prompt
 * holds the nonce and the boundary token (F117-FR-016).
 */
export class KeptPrompt {
  readonly #key: string;
  readonly #text: string;
  readonly #ingress: OutsideTextIngress | undefined;
  #callReturned = false;

  constructor(values: {
    readonly phase: number;
    readonly call: number;
    readonly index: number;
    readonly text: string;
    readonly ingress?: OutsideTextIngress | undefined;
  }) {
    this.#key = criticPromptStateKey(values.phase, values.call, values.index);
    this.#text = values.text;
    this.#ingress = values.ingress;
  }

  /** The logical state name the prompt is kept under. */
  get key(): string {
    return this.#key;
  }

  /** True once the call has returned; the prompt may be kept from then on. */
  get callReturned(): boolean {
    return this.#callReturned;
  }

  /** Mark the call as returned. Idempotent. */
  markCallReturned(): void {
    this.#callReturned = true;
  }

  /**
   * Keep the prompt AFTER the call has returned: the text passes the one
   * ingress, where it is redacted, before it is held. Where the ingress
   * cannot run, the text is dropped and the record says so; the call does not
   * fail for it (F117-FR-044).
   */
  keepAfterCall(): KeptPromptRecord {
    if (!this.#callReturned) {
      throw new Error(
        "the critic prompt is kept only after the call has returned: it holds the " +
          "nonce and the boundary token of the call (F117-FR-016, F100-FR-139)",
      );
    }
    if (this.#ingress === undefined) {
      return { kept: false, key: this.#key, reason: "no ingress: the text is dropped, not kept" };
    }
    const outcome = this.#ingress(this.#text, INGRESS_CLASS);
    if (!outcome.ok) {
      return {
        kept: false,
        key: this.#key,
        reason: `the ingress dropped the text (${outcome.mark}); the record says so`,
      };
    }
    return { kept: true, key: this.#key, text: outcome.text, redacted: true };
  }
}
