/**
 * T014 — minted session ids and the session state of a phase attempt
 * (F125-FR-013, F125-FR-014, F125-FR-004).
 *
 * - Every session id is MINTED by the adapter (`crypto.randomUUID`); the
 *   adapter never continues "the most recent conversation" and never passes
 *   `--continue` (D-7).
 * - A continuation whose session id is EMPTY is refused: the CLI would open
 *   an interactive picker (F125-FR-004).
 * - The per-run set of proposer session ids feeds the critic proof: a critic
 *   session id that appears in the set would be a shared session.
 * - At auth tier 1 no session state is persisted (`persisted: false`) and
 *   the adapter writes, edits, creates and removes nothing in the real
 *   configuration home (F125-FR-014, F125-FR-015).
 * - At auth tier 2 the session state lives in the throwaway home of the
 *   overlay and ENDS with the phase attempt: `endPhaseAttempt` removes the
 *   home it built, even after a kill, and never touches a path the adapter
 *   did not build.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

/** Why a session directive or an end-of-attempt request was refused. */
export type SessionRefusalReason = "empty-session-id" | "not-adapter-owned" | "real-home";

/** The error a refused session state operation carries. */
export class SessionRefusedError extends Error {
  readonly reason: SessionRefusalReason;

  constructor(reason: SessionRefusalReason, message: string) {
    super(message);
    this.name = "SessionRefusedError";
    this.reason = reason;
  }
}

/** The mode of a session directive. */
export type SessionMode = "fresh" | "continue";

/** A session directive as the harness port states it. */
export type SessionDirective = {
  readonly mode: SessionMode;
  /** Minted for `fresh`; an existing id for `continue`; never empty. */
  readonly sessionId: string;
};

/** Mints a fresh session id (F125-FR-013: the adapter mints it). */
export function mintSessionId(): string {
  return randomUUID();
}

/** True when `id` is a session id a continuation may carry: non-empty. */
export function sessionIdIsUsable(id: string): boolean {
  return typeof id === "string" && id.trim() !== "";
}

/** The session directive of the FIRST pass of a phase attempt: fresh, minted. */
export function freshDirective(): SessionDirective {
  return Object.freeze({ mode: "fresh", sessionId: mintSessionId() });
}

/**
 * The session directive of a LATER pass in the same phase attempt, where
 * continuation is in force for the auth tier (F125-FR-014). An empty id is
 * refused (F125-FR-004).
 */
export function continueDirective(sessionId: string): SessionDirective {
  if (!sessionIdIsUsable(sessionId)) {
    throw new SessionRefusedError(
      "empty-session-id",
      "refused the session directive: a continuation with an empty session id " +
        "would open the interactive picker of the CLI (F125-FR-004)",
    );
  }
  return Object.freeze({ mode: "continue", sessionId });
}

/** True where continuation is in force for the auth tier (F125-FR-014). */
export function continuationIsInForce(authTier: 1 | 2): boolean {
  // Auth tier 1: off until capture E shows the session state can be kept
  // outside the real configuration home while the login stays in it.
  return authTier === 2;
}

/* ------------------------------------------------------------------ *
 * T032 — the directive of a pass and the fresh cases (F125-FR-013).
 * ------------------------------------------------------------------ */

/**
 * The closed set of the cases that start a session FRESH with a new minted
 * id, whatever a caller asked (F125-FR-013): the first pass of a phase
 * attempt, a new phase attempt, a relaunch, a kill by a watchdog, the
 * second repair of a unit and an escalation. A critic-class call is always
 * fresh too; it builds its own call and never comes through here.
 */
export const FRESH_CASES = [
  "first-pass",
  "new-attempt",
  "relaunch",
  "watchdog-kill",
  "second-repair",
  "escalation",
] as const;
export type FreshCase = (typeof FRESH_CASES)[number];

/** The input the per-pass directive is built from. */
export type PassDirectiveInput = {
  /** The pass within the attempt, one-based. */
  readonly passNumber: number;
  readonly authTier: 1 | 2;
  /** One of the fresh cases; set whenever the pass MUST start fresh. */
  readonly freshCase?: FreshCase | null;
  /** The session id a continuation would carry (an existing session). */
  readonly sessionId?: string | null;
};

/**
 * The session directive of one pass (F125-FR-013, F125-FR-014): a fresh
 * minted id for the first pass of an attempt and for every fresh case; a
 * continuation BY ID for a later pass where continuation is in force for
 * the auth tier; never "the most recent conversation" (D-7). An empty id
 * on a continuation is refused (F125-FR-004).
 */
export function directiveForPass(input: PassDirectiveInput): SessionDirective {
  const fresh =
    (input.freshCase !== undefined && input.freshCase !== null) ||
    input.passNumber <= 1 ||
    !continuationIsInForce(input.authTier);
  if (fresh) return freshDirective();
  return continueDirective(input.sessionId ?? "");
}

/**
 * The cost delta of a continued session (F125-FR-014, F125-FR-032): the
 * harness reports the cost of the WHOLE conversation, so a pass records
 * only the difference between the cumulative total after it and the total
 * before it. Unknown figures stay null and are never read as zero.
 */
export function continuedSessionDelta(
  cumulativeBefore: number | null,
  cumulativeAfter: number | null,
): number | null {
  if (cumulativeBefore === null || cumulativeAfter === null) return null;
  if (!Number.isFinite(cumulativeBefore) || !Number.isFinite(cumulativeAfter)) return null;
  return cumulativeAfter - cumulativeBefore;
}

/** A record of one proposer session, as the data model shapes it. */
export type SessionRecord = {
  readonly sessionId: string;
  readonly attemptId: string;
  readonly passIds: readonly string[];
  readonly mintedBy: "adapter";
  /** False at auth tier 1: nothing is kept in the real home. */
  readonly persisted: boolean;
  /** Auth tier 2 only: the throwaway home that carries the state. */
  readonly throwawayHome: string | null;
  readonly firstRequestAt: string | null;
  readonly lastRequestAt: string | null;
};

/** The per-run set of proposer session ids (feeds the critic proof). */
export class SessionRun {
  private readonly proposerIds = new Set<string>();
  private readonly records = new Map<string, SessionRecord>();

  readonly attemptId: string;

  constructor(attemptId: string) {
    this.attemptId = attemptId;
  }

  /** Records a fresh proposer session (F125-FR-013). */
  recordFresh(passId: string, authTier: 1 | 2, throwawayHome: string | null): SessionRecord {
    const directive = freshDirective();
    return this.record(directive.sessionId, passId, authTier, throwawayHome);
  }

  /** Records a session under an id this run already minted or continues. */
  record(
    sessionId: string,
    passId: string,
    authTier: 1 | 2,
    throwawayHome: string | null,
  ): SessionRecord {
    if (!sessionIdIsUsable(sessionId)) {
      throw new SessionRefusedError("empty-session-id", "refused to record an empty session id");
    }
    const previous = this.records.get(sessionId);
    const record: SessionRecord = Object.freeze({
      sessionId,
      attemptId: this.attemptId,
      passIds: previous === undefined ? [passId] : [...previous.passIds, passId],
      mintedBy: "adapter",
      // Auth tier 1 persists NOTHING (F125-FR-014): the real home gets none.
      persisted: authTier === 2,
      throwawayHome: authTier === 2 ? throwawayHome : null,
      firstRequestAt: previous?.firstRequestAt ?? new Date().toISOString(),
      lastRequestAt: new Date().toISOString(),
    });
    this.proposerIds.add(sessionId);
    this.records.set(sessionId, record);
    return record;
  }

  /** True when a proposer pass of this run used `sessionId`. */
  wasUsedByProposer(sessionId: string): boolean {
    return this.proposerIds.has(sessionId);
  }

  /** The per-run set of proposer session ids, for the critic proof. */
  proposerSessionIds(): readonly string[] {
    return Object.freeze([...this.proposerIds]);
  }

  /** Every session record of the run. */
  sessionRecords(): readonly SessionRecord[] {
    return Object.freeze([...this.records.values()]);
  }
}

/** A throwaway home the adapter built (auth tier 2, F125-FR-017). */
export type ThrowawayHome = {
  readonly path: string;
  /** Proof that the adapter built it: only such a home is ever removed. */
  readonly adapterOwned: true;
  readonly scope: "pass" | "attempt";
};

/**
 * Builds the throwaway home of an auth tier 2 attempt (the overlay of
 * annex C §C.16): a fresh directory OUTSIDE the real configuration home.
 * `mkdir` is injectable for tests.
 */
export function buildThrowawayHome(input: {
  /** Where overlays are built (never the real home, never the workspace). */
  readonly overlayRoot: string;
  readonly attemptId: string;
  readonly scope?: "pass" | "attempt";
  readonly mkdir?: (dir: string) => void;
}): ThrowawayHome {
  const overlayRoot = path.resolve(input.overlayRoot);
  const home = path.join(overlayRoot, `claude-home-${input.attemptId}`);
  (input.mkdir ?? ((dir: string) => mkdirSync(dir, { recursive: true })))(home);
  return Object.freeze({ path: home, adapterOwned: true, scope: input.scope ?? "attempt" });
}

/**
 * Ends the session state of a phase attempt (F125-FR-014): at auth tier 2
 * the state is in the throwaway home and goes with it — removed even when
 * the pass was killed; at auth tier 1 nothing was persisted and nothing is
 * removed. The real configuration home is NEVER a target: a home the
 * adapter did not build, the workspace root and the real home are refused
 * before any removal.
 */
export function endPhaseAttempt(input: {
  readonly home: ThrowawayHome | null;
  /** The consumer's real configuration home; refused as a removal target. */
  readonly realConfigHome: string | null;
  readonly rm?: (dir: string) => void;
}): { removed: string | null } {
  if (input.home === null) return { removed: null };
  const target = path.resolve(input.home.path);
  if (!input.home.adapterOwned) {
    throw new SessionRefusedError(
      "not-adapter-owned",
      `refused to remove "${target}": the adapter did not build it`,
    );
  }
  if (input.realConfigHome !== null) {
    const real = path.resolve(input.realConfigHome);
    if (target === real || target.startsWith(real + path.sep)) {
      throw new SessionRefusedError(
        "real-home",
        `refused to remove "${target}": it is the real configuration home (F125-FR-015)`,
      );
    }
  }
  (input.rm ?? ((dir: string) => rmSync(dir, { recursive: true, force: true })))(target);
  return { removed: target };
}
