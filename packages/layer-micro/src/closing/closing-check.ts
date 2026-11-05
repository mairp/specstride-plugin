/**
 * T082 — the call point `onEvidence`: the closing check, the two returns and
 * phase evidence set aside (F115-FR-028, F115-FR-029; IR-05, IR-49).
 *
 * The closing check is a switch of its own, on by default. When phase
 * evidence appears in a phase attempt in which a unit was declared, the
 * runtime runs the inner check set on the final tree, unless the last check
 * passed on the same tree fingerprint. A failure returns the proposer to
 * work at most twice and only while cycles remain; when they are spent the
 * phase evidence goes to the phase gate unchanged. An inner result may delay
 * the phase gate and never skips or replaces it (IR-05). In a phase attempt
 * without a declared unit the closing check does not run.
 *
 * From the moment phase evidence exists in the attempt, no limit and no
 * breaker of the pass loop stops the run (IR-49): when one fires during a
 * repair after the closing check, the repair ends and the attempt goes to
 * the phase gate. Evidence that was set aside is kept in the control plane
 * with its hash; the phase gate takes the newer of it and the evidence the
 * proposer wrote again. When the tree changed and the evidence did not, the
 * further fact `evidence-predates-tree` is given to the builder of the fact
 * block.
 *
 * Purity: imports `@specstride/contracts` only; no `node:fs`, no process.
 */

/** The closing check switch, on by default (row 64; F115-FR-028). */
export const CLOSING_CHECK_DEFAULT_ON = true;

/** The most times a closing-check failure returns the proposer to work. */
export const MAX_RETURNS_TO_WORK = 2;

/** Why the closing check did not run. */
export type ClosingSkipReason = "switch-off" | "no-declared-unit" | "last-check-passed-same-tree";

/** What the call point `onEvidence` states. */
export type ClosingOutcome =
  | { readonly action: "skip"; readonly reason: ClosingSkipReason }
  | {
      /** A failure of the closing check: the proposer returns to work. */
      readonly action: "return-to-work";
      /** The return, 1 or 2 (never more; F115-FR-028). */
      readonly returnsToWork: number;
      /** The cycles the closing check and the return spent. */
      readonly cyclesSpent: number;
      /** Cycles left in the attempt after the return. */
      readonly cyclesLeft: number;
    }
  | {
      /**
       * The returns are spent, or the cycles are: the phase evidence goes to
       * the phase gate unchanged (F115-FR-028; IR-05 — the gate is never
       * skipped or replaced, only delayed).
       */
      readonly action: "phase-gate";
      readonly evidenceUnchanged: true;
      readonly cyclesSpent: number;
    };

/** The input of one closing check. */
export type ClosingCheckInput = {
  /** The switch `loop.micro.closing_check` (on by default). */
  readonly switchOn?: boolean;
  /** True when a unit was declared in the phase attempt. */
  readonly declaredUnit: boolean;
  /** The tree fingerprint of the check before, when it passed. */
  readonly lastPassedTreeFingerprint?: string;
  /** The tree fingerprint of the final tree. */
  readonly treeFingerprint: string;
  /** The closing-check failure already answered with a return to work. */
  readonly returnsToWorkUsed: number;
  /** The cycles left in the phase attempt. */
  readonly cyclesLeft: number;
};

/**
 * F115-FR-028 — the closing check. It runs the inner set on the final tree
 * unless the last check passed on the same fingerprint; a failure returns
 * the proposer to work at most twice, and only while cycles remain; when
 * they are spent the phase evidence goes to the phase gate unchanged.
 */
export function closingCheck(input: ClosingCheckInput): ClosingOutcome {
  if (input.switchOn === false) return { action: "skip", reason: "switch-off" };
  if (!input.declaredUnit) return { action: "skip", reason: "no-declared-unit" };
  if (
    input.lastPassedTreeFingerprint !== undefined &&
    input.lastPassedTreeFingerprint === input.treeFingerprint
  ) {
    return { action: "skip", reason: "last-check-passed-same-tree" };
  }
  if (input.cyclesLeft <= 0 || input.returnsToWorkUsed >= MAX_RETURNS_TO_WORK) {
    return { action: "phase-gate", evidenceUnchanged: true, cyclesSpent: 0 };
  }
  const returnsToWork = input.returnsToWorkUsed + 1;
  return {
    action: "return-to-work",
    returnsToWork,
    cyclesSpent: 1,
    cyclesLeft: input.cyclesLeft - 1,
  };
}

/**
 * F115-FR-028 — a valid checkpoint written in the pass that also wrote phase
 * evidence is accepted as a declaration, and the closing check serves as its
 * check: no second check of the unit is made.
 */
export function evidencePassCheckpoint(validCheckpoint: boolean): {
  readonly acceptedAsDeclaration: boolean;
  readonly closingCheckServesAsItsCheck: boolean;
} {
  return { acceptedAsDeclaration: validCheckpoint, closingCheckServesAsItsCheck: validCheckpoint };
}

/**
 * F115-FR-029, IR-49 — from the moment phase evidence exists, no limit and
 * no breaker of the pass loop stops the run: a repair that a limit or a
 * breaker fires in simply ends, and the attempt goes to the phase gate.
 */
export function limitAfterEvidence(limitOrBreakerFired: boolean): {
  readonly stop: false;
  readonly repairEnds: boolean;
  readonly goesTo: "phase-gate";
} {
  return { stop: false, repairEnds: limitOrBreakerFired, goesTo: "phase-gate" };
}

/** Phase evidence set aside, as it is kept in the control plane (F115-FR-029). */
export type EvidenceSetAside = {
  readonly setAside: true;
  /** The hash the evidence is kept with. */
  readonly hash: string;
  /** The location in the control plane. */
  readonly location: string;
};

/**
 * F115-FR-029 — phase evidence that was set aside is kept in the control
 * plane with its hash.
 */
export function setAsideEvidence(evidenceHash: string, location: string): EvidenceSetAside {
  return { setAside: true, hash: evidenceHash, location };
}

/**
 * F115-FR-029 — the phase gate takes the newer of the evidence set aside and
 * the evidence the proposer wrote again: the one with the later written-at
 * instant. Ties keep the set-aside one.
 */
export function newerEvidence(
  setAside: { readonly hash: string; readonly writtenAt: number },
  writtenAgain?: { readonly hash: string; readonly writtenAt: number },
): { readonly hash: string; readonly from: "set-aside" | "written-again" } {
  if (writtenAgain === undefined || setAside.writtenAt >= writtenAgain.writtenAt) {
    return { hash: setAside.hash, from: "set-aside" };
  }
  return { hash: writtenAgain.hash, from: "written-again" };
}

/**
 * F115-FR-029 — the further fact `evidence-predates-tree` (annex D §D.7;
 * annex X §X.6 row 66), given to the builder of the fact block when the tree
 * changed and the phase evidence did not.
 */
export function evidencePredatesTree(state: {
  readonly treeChanged: boolean;
  readonly evidenceChanged: boolean;
}): { readonly fact: "evidence-predates-tree" } | undefined {
  return state.treeChanged && !state.evidenceChanged
    ? { fact: "evidence-predates-tree" }
    : undefined;
}

/**
 * The seam of the control plane where evidence set aside and the outcome of
 * the call point are kept for an independent reader. The layer is pure
 * (F100-FR-012): it holds no file system, so the runtime hands the store in
 * and the durable read is a separate read function on the same seam — the
 * writer never answers the read.
 */
export type EvidenceStore = Map<string, { hash: string; writtenAt: number }>;

/** The runtime record of one phase attempt for an independent reader. */
export type RunLog = { events: string[]; stopReason?: string; exitCode?: number };

/**
 * F115-FR-029 — write the evidence set aside into the control-plane seam.
 * The write is by the location only; reading goes through
 * `readSetAsideEvidence`.
 */
export function recordSetAsideEvidence(
  store: EvidenceStore,
  aside: EvidenceSetAside,
  at: number = Date.now(),
): void {
  store.set(aside.location, { hash: aside.hash, writtenAt: at });
}

/** The independent read path of the evidence set aside. */
export function readSetAsideEvidence(
  store: EvidenceStore,
  location: string,
): { hash: string; writtenAt: number } | undefined {
  return store.get(location);
}

/**
 * Record the outcome of the closing check on the run record of the attempt.
 * Only the `phase-gate` action reaches the gate; no stop reason and no exit
 * code is ever recorded (IR-49).
 */
export function recordClosingOutcome(log: RunLog, outcome: ClosingOutcome): void {
  if (outcome.action === "phase-gate") log.events.push("phase.gate.reached");
}

/**
 * Record the answer of `limitAfterEvidence` on the run record: the gate is
 * reached, no stop and no exit is recorded (IR-49).
 */
export function recordLimitAfterEvidence(
  log: RunLog,
  _outcome: ReturnType<typeof limitAfterEvidence>,
): void {
  log.events.push("phase.gate.reached");
}
