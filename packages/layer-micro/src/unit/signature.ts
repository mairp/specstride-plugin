/**
 * T072 — the failure signature and the rule for dropping a continued session
 * (F115-FR-019; IR-53, the signature half).
 *
 * The signature is the ordered list of the ids of the failed commands with
 * their exit codes, in manifest order. No output of a check is parsed for a
 * decision: the signature reads exit statuses only. When the signature and
 * the tree fingerprint both equal those of the proposal before, a continued
 * session MUST be dropped and the repair MUST run in a fresh session.
 *
 * Purity: imports `@specstride/contracts` only; no `node:fs`, no process.
 */

/** One entry of the failure signature: a failed command id with its exit code. */
export type SignatureEntry = {
  readonly id: string;
  readonly exit: number;
};

/** One observed result of the check, as the check runner gave it. */
export type SignatureResult = {
  readonly id: string;
  readonly exit: number;
};

/**
 * F115-FR-019 — the failure signature: the failed commands with their exit
 * codes, in the order given (the manifest order the caller keeps).
 * Commands that exited 0 never enter the signature. No output is parsed.
 */
export function failureSignature(results: readonly SignatureResult[]): readonly SignatureEntry[] {
  return results
    .filter((result) => result.exit !== 0)
    .map((result) => ({ id: result.id, exit: result.exit }));
}

/** The stable key of a signature, for the comparison of two proposals. */
export function signatureKey(entries: readonly SignatureEntry[]): string {
  return entries.map((entry) => `${entry.id}:${entry.exit}`).join(";");
}

/** The signature and tree of one proposal, as the layer remembers them. */
export type ProposalSignature = {
  readonly signature: string;
  readonly treeFingerprint: string;
};

/**
 * F115-FR-019, F115-FR-034 — the signature is repeated: it equals the one of
 * the proposal before.
 */
export function signatureRepeated(
  current: ProposalSignature,
  previous?: ProposalSignature,
): boolean {
  return (
    previous !== undefined &&
    current.signature === previous.signature &&
    current.signature.length > 0
  );
}

/**
 * F115-FR-019 — a continued session is dropped, and the repair runs in a
 * fresh session, exactly when the signature and the tree fingerprint both
 * equal those of the proposal before. Anything else keeps the session.
 */
export function shouldDropContinuedSession(
  current: ProposalSignature,
  previous?: ProposalSignature,
): boolean {
  return (
    previous !== undefined &&
    current.signature === previous.signature &&
    current.treeFingerprint === previous.treeFingerprint
  );
}
