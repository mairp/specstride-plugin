/**
 * T065 — the proof of the first form (`tool-less`) of a critic-class call
 * (F109-FR-038; feature 100, F100-FR-230).
 *
 * The call is refused unless its initial record shows an empty tool list and
 * the session id that the seam minted for the call. For a harness whose stream
 * has no initial record the proof is by pinned configuration — the installed
 * version equals the exact version pin of the tested harness adapter, the
 * preflight of that harness adapter passed, and the call ran with the flag set
 * of the first form — recorded as the weaker proof for every call that rests
 * on it, and open to a tested harness adapter only.
 *
 * Every other result is the typed failure `critic_not_toolless`, a critic
 * configuration error that halts the run (engine exit 3, stop reason
 * `critic_config`). The reply of a refused call is NOT read.
 */
import {
  CRITIC_CONFIG_STOP_REASON,
  CRITIC_NOT_TOOLLESS,
  ENGINE_EXIT_CODE_OF_CRITIC_CONFIG,
  type FixedForm,
  type FormRefusal,
  FIRST_FORM,
  refusal,
} from "./forms.ts";

/** The kind of proof the initial record gives. */
export const INITIAL_RECORD_PROOF = "initial-record" as const;
/** The kind of the weaker proof (F100-FR-230, case 3). */
export const PINNED_CONFIGURATION_PROOF = "pinned-configuration" as const;

/** Mints the session id of one critic-class call; the seam mints one per call. */
export function mintSessionId(random: () => string = defaultRandom): string {
  return `sess-${random()}`;
}

function defaultRandom(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The initial record a stream-capable harness hands the seam before its reply. */
export type InitialRecord = {
  /** The tools the harness started with; it MUST be empty for the first form. */
  readonly tools?: readonly string[];
  /** The session id the harness ran in, when the harness reports one. */
  readonly sessionId?: string | null;
};

/** The facts the weaker proof rests on (F100-FR-230, case 3; F109-FR-038). */
export type PinnedConfiguration = {
  /** The exact version pin of the tested harness adapter. */
  readonly pin: string;
  /** The version installed and used by the call. */
  readonly installedVersion: string;
  /** Whether the preflight of the harness adapter passed. */
  readonly preflightPassed: boolean;
  /** The flag set of the call, as the first form of the adapter names it. */
  readonly flagSet: readonly string[];
};

/** What the seam knows about one critic-class call of the first form. */
export type FirstFormCall = {
  /** The form fixed before the call; it must still be the first form. */
  readonly fixed: FixedForm;
  /** The session id the seam minted for this call. */
  readonly mintedSessionId: string;
  /** The initial record of the stream, or `null` where the stream has none. */
  readonly initialRecord: InitialRecord | null;
  /** Whether the harness adapter is a tested one (F109-FR-014). */
  readonly tested: boolean;
  /** The facts of the weaker proof, where the stream has no initial record. */
  readonly pinned?: PinnedConfiguration | null;
};

/** The proof result of one critic-class call of the first form. */
export type FirstFormProof =
  | {
      readonly accepted: true;
      readonly proofKind: typeof INITIAL_RECORD_PROOF | typeof PINNED_CONFIGURATION_PROOF;
      /** True only for the weaker proof by pinned configuration. */
      readonly weakerProof: boolean;
      /** The session proof case of F100-FR-230 that was taken, recorded per call. */
      readonly sessionProofCase:
        "caller-minted-id" | "harness-given-id" | "no-session-in-the-initial-record";
      /** The session id the call is held to. */
      readonly sessionId: string;
    }
  | (FormRefusal & {
      /** A refused call carries the typed failure of row 28. */
      readonly failure: typeof CRITIC_NOT_TOOLLESS;
      /** The reply of a refused call is not read: the accessor is closed. */
      readonly replyRead: false;
    });

/**
 * Proves the first form of one critic-class call (F109-FR-038). The proof is
 * made BEFORE any reply is read; on a refusal the reply of the call is never
 * read.
 */
export function proveFirstForm(call: FirstFormCall): FirstFormProof {
  if (call.fixed.form !== FIRST_FORM) {
    return refused(`the form fixed before the call is "${call.fixed.form}", not the first form`);
  }
  const tools = call.initialRecord?.tools;
  if (call.initialRecord !== null && call.initialRecord !== undefined) {
    if (tools === undefined || tools.length !== 0) {
      return refused(
        "the initial record of the first form shows a tool; the tool list must be empty",
      );
    }
    const sessionId = call.initialRecord.sessionId;
    if (sessionId !== call.mintedSessionId) {
      return refused(
        "the initial record shows another session id than the one the seam minted for the call",
      );
    }
    return {
      accepted: true,
      proofKind: INITIAL_RECORD_PROOF,
      weakerProof: false,
      sessionProofCase: "caller-minted-id",
      sessionId: call.mintedSessionId,
    };
  }
  // No initial record: the weaker proof by pinned configuration, for a tested
  // harness adapter only (F109-FR-038; CQ-182, Principle IX v3.0.1).
  if (!call.tested) {
    return refused("the proof by pinned configuration is open to a tested harness adapter only");
  }
  const pinned = call.pinned;
  if (pinned === undefined || pinned === null) {
    return refused(
      "the stream has no initial record and no proof by pinned configuration was given",
    );
  }
  if (pinned.installedVersion !== pinned.pin) {
    return refused(
      `the installed version ${pinned.installedVersion} is not the exact pin ${pinned.pin}`,
    );
  }
  if (!pinned.preflightPassed) {
    return refused("the preflight of the tested harness adapter did not pass");
  }
  if (pinned.flagSet.length === 0) {
    return refused("the call did not run with the flag set of the first form of the adapter");
  }
  return {
    accepted: true,
    proofKind: PINNED_CONFIGURATION_PROOF,
    weakerProof: true,
    sessionProofCase: "no-session-in-the-initial-record",
    sessionId: call.mintedSessionId,
  };
}

function refused(reason: string): FirstFormProof {
  return {
    ...refusal(reason),
    failure: CRITIC_NOT_TOOLLESS,
    replyRead: false,
  };
}

/* ------------------------------------------------------------------ *
 * The reply of a refused call is not read (F109-FR-038).
 * ------------------------------------------------------------------ */

/**
 * Reads the reply of a call whose proof was accepted. A refusal closes the
 * reply: calling this with a refused proof is an error, never a reply.
 */
export function readAcceptedReply(proof: FirstFormProof, readReply: () => string): string {
  if (!proof.accepted) {
    throw new Error(
      `the reply of a refused call is not read (${proof.failure}); ` +
        `the call is halted with the stop reason ${CRITIC_CONFIG_STOP_REASON} ` +
        `and the engine exit code ${ENGINE_EXIT_CODE_OF_CRITIC_CONFIG}`,
    );
  }
  return readReply();
}
