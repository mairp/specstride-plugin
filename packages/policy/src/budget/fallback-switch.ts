/**
 * T047 — what a switch does (F127-FR-022).
 *
 * Five rules, each with one symbol here:
 *
 *  - **the boundary** — a switch happens at a PHASE-ATTEMPT BOUNDARY where
 *    possible. `placeSwitch` says where it happens;
 *  - **the fresh session** — a switch INSIDE a phase attempt starts a FRESH
 *    SESSION, and context is carried THROUGH FILES, never through a session a
 *    second harness would have to inherit;
 *  - **the event** — every switch writes `fallback.switched` with the entries,
 *    the reason, the phase attempt and the change of billing mode;
 *  - **the critic-diversity warning** — a fallback that would make the critic
 *    and the proposer the same model raises it and does NOT block
 *    (`criticDiversity`; row 23 of the table of feature 100, where the
 *    "same-model warning" became the critic-diversity warning);
 *  - **no critic in the proposer's session** — a fallback never puts a critic
 *    into the session of the proposer (Principle II). `assertNoCriticInThe\
 *    ProposersSession` throws; it is not a warning.
 *
 * And one rule about what a switch is NOT: an ESCALATION to a higher model
 * tier of the SAME HARNESS is not a fallback and does not change the billing
 * mode. `classifyChange` separates the two, and an escalation that would
 * change the billing mode is refused.
 */
import { emit, type EmitOptions } from "../quota/events.ts";
import type { EventWriter, PolicyEvent } from "../quota/ports.ts";
import type { BillingMode } from "./ledger.ts";
import { entryLabel, type FallbackEntry } from "./fallback.ts";
import { isBillingModeChange } from "./fallback-billing.ts";

/* ------------------------------------------------------------------ *
 * 1. The boundary and the session.
 * ------------------------------------------------------------------ */

/** F127-FR-022 — "A switch MUST happen at a phase-attempt boundary where possible." */
export const SWITCH_AT_A_BOUNDARY_WHERE_POSSIBLE = true as const;

/** The two places a switch can happen. */
export const SWITCH_POINTS = ["phase-attempt-boundary", "inside-phase-attempt"] as const;
export type SwitchPoint = (typeof SWITCH_POINTS)[number];

/** A switch inside a phase attempt starts a FRESH session (F127-FR-022). */
export const SESSION_AFTER_A_SWITCH = "fresh" as const;

/** Context is carried through FILES and never through a session (F127-FR-022). */
export const CONTEXT_CARRIED_THROUGH = "files" as const;

/** Where a switch happens and what that means for the session. */
export type SwitchPlacement = {
  readonly at: SwitchPoint;
  /** Always `fresh`: a boundary starts one, and inside a phase attempt one is started. */
  readonly session: typeof SESSION_AFTER_A_SWITCH;
  /** How context reaches the new entry. */
  readonly contextThrough: typeof CONTEXT_CARRIED_THROUGH;
  /** True where the switch was deferred to the boundary (the preferred case). */
  readonly deferredToTheBoundary: boolean;
};

/**
 * Place the switch (F127-FR-022). Where a phase-attempt boundary is available
 * the switch waits for it; where it is not — the limit arrived in the middle
 * of a phase attempt and the attempt cannot go on — the switch happens inside
 * the attempt and starts a fresh session, with context through files.
 */
export function placeSwitch(input: { readonly boundaryAvailable: boolean }): SwitchPlacement {
  const at: SwitchPoint = input.boundaryAvailable
    ? "phase-attempt-boundary"
    : "inside-phase-attempt";
  return Object.freeze({
    at,
    session: SESSION_AFTER_A_SWITCH,
    contextThrough: CONTEXT_CARRIED_THROUGH,
    deferredToTheBoundary: input.boundaryAvailable,
  });
}

/* ------------------------------------------------------------------ *
 * 2. An escalation is not a fallback.
 * ------------------------------------------------------------------ */

/** F127-FR-022 — an escalation of model tier is NOT a fallback. */
export const ESCALATION_IS_NOT_A_FALLBACK = true as const;

/** What a change from one entry to another is. */
export const CHANGE_KINDS = ["fallback", "escalation"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/**
 * True where the change is an ESCALATION: the same harness, a different model
 * tier. The harness is the same process and the same credentials, so nothing
 * about the billing arrangement changes.
 */
export function isEscalation(from: FallbackEntry, to: FallbackEntry): boolean {
  return from.harness === to.harness && from.modelTier !== to.modelTier;
}

/** An escalation that would change the billing mode (F127-FR-022). */
export class EscalationError extends Error {
  constructor(from: FallbackEntry, to: FallbackEntry) {
    super(
      `an escalation from ${entryLabel(from)} to ${entryLabel(to)} would change the billing mode ` +
        `from \`${from.billingMode}\` to \`${to.billingMode}\`; an escalation to a higher model ` +
        `tier of the same harness does not count as a fallback and does not change the billing ` +
        `mode (F127-FR-022)`,
    );
    this.name = "EscalationError";
  }
}

/** What the change is, with the billing mode it carries. */
export type Change = {
  readonly kind: ChangeKind;
  readonly from: FallbackEntry;
  readonly to: FallbackEntry;
  /** True only for a fallback that changes the billing mode. */
  readonly billingModeChanged: boolean;
  readonly billingModeFrom: BillingMode;
  readonly billingModeTo: BillingMode;
};

/**
 * Separate a fallback from an escalation (F127-FR-022). An escalation that
 * would change the billing mode is REFUSED, because the only way a higher
 * model tier of one harness can be billed differently is a second set of
 * credentials, which makes it a fallback entry and not an escalation.
 */
export function classifyChange(from: FallbackEntry, to: FallbackEntry): Change {
  const escalation = isEscalation(from, to);
  if (escalation && isBillingModeChange(from.billingMode, to.billingMode)) {
    throw new EscalationError(from, to);
  }
  return Object.freeze({
    kind: escalation ? ("escalation" as const) : ("fallback" as const),
    from,
    to,
    billingModeChanged: !escalation && isBillingModeChange(from.billingMode, to.billingMode),
    billingModeFrom: from.billingMode,
    billingModeTo: to.billingMode,
  });
}

/* ------------------------------------------------------------------ *
 * 3. The critic-diversity warning, and the critic's own session.
 * ------------------------------------------------------------------ */

/** The warning raised where a fallback makes the critic and the proposer one model. */
export const CRITIC_DIVERSITY_WARNING =
  "the critic and the proposer would run on the same model after this fallback; the critic's " +
  "independence is reduced (F127-FR-022, the critic-diversity warning)";

/** F127-FR-022 — the warning MUST NOT block. */
export const CRITIC_DIVERSITY_WARNING_BLOCKS = false as const;

/** The answer about diversity. */
export type CriticDiversity = {
  /** True where the critic and the proposer would be the same model. */
  readonly sameModel: boolean;
  readonly warning: string | null;
  /** Always false: the warning never blocks (F127-FR-022). */
  readonly blocks: false;
};

/**
 * The critic-diversity warning (F127-FR-022). Two entries are the same model
 * where the harness and the model agree; a null model on either side is read
 * as the harness's own default, so two entries of one harness with no model
 * named are the same model.
 */
export function criticDiversity(input: {
  readonly proposerAfterTheSwitch: FallbackEntry;
  readonly critic: FallbackEntry;
}): CriticDiversity {
  const a = input.proposerAfterTheSwitch;
  const b = input.critic;
  const sameModel = a.harness === b.harness && (a.model ?? null) === (b.model ?? null);
  return Object.freeze({
    sameModel,
    warning: sameModel ? CRITIC_DIVERSITY_WARNING : null,
    blocks: CRITIC_DIVERSITY_WARNING_BLOCKS,
  });
}

/** F127-FR-022 — "A fallback MUST NOT put a critic into the session of the proposer." */
export const A_FALLBACK_NEVER_PUTS_A_CRITIC_IN_THE_PROPOSERS_SESSION = true as const;

/** A switch that would share one session between the critic and the proposer. */
export class CriticSessionError extends Error {
  constructor(sessionId: string) {
    super(
      `the switch would run the critic in the session \`${sessionId}\`, which is the proposer's; ` +
        `a fallback never puts a critic into the session of the proposer (F127-FR-022)`,
    );
    this.name = "CriticSessionError";
  }
}

/**
 * Refuse a switch that would share a session (F127-FR-022). This THROWS where
 * the critic-diversity warning only warns: a shared model is a loss of
 * independence, a shared session is a breach of Principle II.
 */
export function assertNoCriticInTheProposersSession(sessions: {
  readonly proposerSessionId: string;
  readonly criticSessionId: string;
}): void {
  if (sessions.criticSessionId === sessions.proposerSessionId) {
    throw new CriticSessionError(sessions.proposerSessionId);
  }
}

/* ------------------------------------------------------------------ *
 * 4. The switch itself.
 * ------------------------------------------------------------------ */

/** What a caller hands `performSwitch`. */
export type SwitchInput = {
  readonly role: string;
  readonly from: FallbackEntry;
  readonly to: FallbackEntry;
  /** Why the switch happens: the quota class that triggered it. */
  readonly reason: string;
  /** The phase attempt the switch belongs to (annex B; `phase-3/attempt-2`). */
  readonly phaseAttempt: string;
  /** True where a phase-attempt boundary was available. */
  readonly boundaryAvailable: boolean;
  /** The critic's entry, where the role that switched is the proposer. */
  readonly critic?: FallbackEntry | undefined;
  /** The two session ids, where the caller runs both roles. */
  readonly sessions?:
    { readonly proposerSessionId: string; readonly criticSessionId: string } | undefined;
  readonly note?: string | null;
};

/** What a switch did. */
export type SwitchResult = {
  readonly change: Change;
  readonly placement: SwitchPlacement;
  readonly diversity: CriticDiversity | null;
  readonly event: PolicyEvent;
};

/**
 * Perform one switch (F127-FR-022).
 *
 * The order is: refuse what must be refused (a shared session, an escalation
 * that changes the billing mode), place the switch, raise the diversity
 * warning where it applies, and only then write `fallback.switched` with the
 * entries, the reason, the phase attempt and the change of billing mode.
 *
 * The `loud` alert of F127-FR-021 is written by `./fallback-billing.ts` BEFORE
 * this function is called, so that the alert precedes `fallback.switched` and
 * therefore the first call on the key.
 */
export function performSwitch(
  writer: EventWriter,
  input: SwitchInput,
  options: EmitOptions = {},
): SwitchResult {
  if (input.sessions !== undefined) assertNoCriticInTheProposersSession(input.sessions);
  const change = classifyChange(input.from, input.to);
  const placement = placeSwitch({ boundaryAvailable: input.boundaryAvailable });
  const diversity =
    input.critic === undefined
      ? null
      : criticDiversity({ proposerAfterTheSwitch: input.to, critic: input.critic });

  const event = emit(
    writer,
    "fallback.switched",
    {
      from: entryLabel(input.from),
      to: entryLabel(input.to),
      reason: input.reason,
      role: input.role,
      phaseAttempt: input.phaseAttempt,
      billingModeFrom: change.billingModeFrom,
      billingModeTo: change.billingModeTo,
      billingModeChanged: change.billingModeChanged,
      at: placement.at,
      session: placement.session,
      criticDiversityWarning: diversity?.sameModel === true,
      note: input.note ?? null,
    },
    options,
  );

  return Object.freeze({ change, placement, diversity, event });
}
