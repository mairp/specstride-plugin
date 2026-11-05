/**
 * T015 — the facts of the terms row, and the rule that the harness is never a
 * default and never picked (F130-FR-004, F130-FR-030).
 *
 * dsh has NO row of the terms-gate data: the status of the row is `absent`
 * (no row establishes the licence or the upstream terms), which the gate reads
 * as UNKNOWN TERMS. While the terms are unknown, ruling P14 (with F100-FR-093)
 * bars the harness from being a default and from being picked automatically —
 * for the proposer role and for the critic role alike (F130-FR-030), under
 * EVERY audience (`personal` lifts neither bar, CQ-183) and under every
 * profile. The harness is usable in a role only where the consumer named it
 * for that role: `roles.proposer.harness` / `roles.critic.harness`, the flag
 * or the as-is variable that is their alias, or a fallback entry the consumer
 * wrote. Every launch that names it states "unknown terms" and the doctor
 * warns; under the `parity` profile the warning is recorded and no line is
 * printed (ruling 68). Where no harness is named for a role, role resolution
 * passes over this harness with the reason `terms-unknown`.
 *
 * Auth tier 3 is never valid, and the adapter holds no login token: the
 * harness owns its login (descriptor `auth.credential: null`).
 */

/** The audiences of the distribution (annex X row 34). */
export type TermsAudience = "personal" | "distributed";

/** The roles the bar holds for (both roles, F130-FR-004 / F130-FR-030). */
export type DshRole = "proposer" | "critic";

/** The row of the terms-gate data this adapter supplies: absent, so unknown. */
export type DshTermsRow = {
  readonly provider: "dsh";
  /** Auth tiers 1 and 2 (descriptor `auth.tiers`); tier 3 is never valid. */
  readonly authTiers: readonly [1, 2];
  readonly tier3: "never-valid";
  /** No row establishes the licence or the upstream terms. */
  readonly status: "absent";
  /** What the gate reads an absent row as. */
  readonly terms: "unknown";
  /** The adapter never holds a login token; the harness owns its login. */
  readonly credential: null;
  /** What every launch that names the harness states. */
  readonly launchStatement: "unknown terms";
};

/** The facts of the row, as one frozen record. */
export const DSH_TERMS_ROW: DshTermsRow = Object.freeze({
  provider: "dsh" as const,
  authTiers: Object.freeze([1, 2]) as readonly [1, 2],
  tier3: "never-valid" as const,
  status: "absent" as const,
  terms: "unknown" as const,
  credential: null,
  launchStatement: "unknown terms" as const,
});

/** The facts of the terms row (F130-FR-004). The row is data, not a lookup. */
export function dshTermsRow(): DshTermsRow {
  return DSH_TERMS_ROW;
}

/** The reason role resolution passes this harness over with (F130-FR-004). */
export const DSH_PASS_OVER_REASON = "terms-unknown" as const;
export type DshPassOverReason = typeof DSH_PASS_OVER_REASON;

/** Where the consumer named dsh for the role: any of the naming places. */
export type DshNaming = {
  /** `roles.proposer.harness` / `roles.critic.harness` of the consumer. */
  readonly roles?: Readonly<Record<string, string | null | undefined>>;
  /** The flag or the as-is variable that is their alias, per role. */
  readonly flag?: Readonly<Record<string, string | null | undefined>>;
  /** A fallback entry the consumer wrote, per role. */
  readonly fallback?: Readonly<Record<string, string | null | undefined>>;
};

/**
 * True where the consumer named dsh for ROLE in any of the naming places:
 * the role's harness setting, its flag or alias, or a fallback entry.
 */
export function dshNamedForRole(naming: DshNaming | undefined, role: DshRole): boolean {
  if (naming === undefined) return false;
  const places = [naming.roles, naming.flag, naming.fallback];
  return places.some((place) => place?.[role] === "dsh");
}

/** The decision role resolution reaches for dsh in one role and audience. */
export type DshTermsDecision = {
  readonly role: DshRole;
  readonly audience: TermsAudience;
  /** Whether the consumer named dsh for the role. */
  readonly named: boolean;
  /** Always false: never a default, under every audience and for both roles. */
  readonly isDefault: false;
  /** Always false: never picked automatically (F130-FR-030). */
  readonly picked: false;
  /** Usable exactly where the consumer named it for the role. */
  readonly usable: boolean;
  /** `terms-unknown` exactly where role resolution passes the harness over. */
  readonly passOverReason: DshPassOverReason | null;
  /** `unknown terms` on every launch that names the harness, else null. */
  readonly warning: "unknown terms" | null;
  /** True under `parity`: the warning is recorded and no line is printed. */
  readonly warningRecordedOnly: boolean;
};

export type DshTermsDecisionInput = {
  readonly role: DshRole;
  readonly audience: TermsAudience;
  /** The naming places of the consumer, as `dshNamedForRole` reads them. */
  readonly naming?: DshNaming;
  /** The profile in force; under `parity` the warning is recorded only. */
  readonly profile?: string;
};

/**
 * The decision for one role and audience. The audience changes nothing
 * (F130-FR-004: `personal` lifts neither bar); the profile changes only how
 * the warning reaches the consumer (recorded under `parity`, ruling 68).
 */
export function dshTermsDecision(input: DshTermsDecisionInput): DshTermsDecision {
  const named = dshNamedForRole(input.naming, input.role);
  const recordedOnly = input.profile === "parity";
  if (!named) {
    return {
      role: input.role,
      audience: input.audience,
      named: false,
      isDefault: false,
      picked: false,
      usable: false,
      passOverReason: DSH_PASS_OVER_REASON,
      warning: null,
      warningRecordedOnly: false,
    };
  }
  return {
    role: input.role,
    audience: input.audience,
    named: true,
    isDefault: false,
    picked: false,
    usable: true,
    passOverReason: null,
    warning: "unknown terms",
    warningRecordedOnly: recordedOnly,
  };
}

/**
 * F130-FR-004 — the harness is NEVER the default for ROLE, under every
 * audience. (The function exists so a caller states the audience and the role
 * it asks about; the answer is false for all of them.)
 */
export function dshIsDefault(role: DshRole, audience: TermsAudience): false {
  void role;
  void audience;
  return false;
}

/**
 * F130-FR-030 — the harness is NEVER picked automatically as a critic
 * (or proposer), whatever step of the order it would qualify in, under every
 * audience.
 */
export function dshIsAutoPickCandidate(role: DshRole, audience: TermsAudience): false {
  void role;
  void audience;
  return false;
}

/**
 * F130-FR-004 — the record role resolution writes when it passes this harness
 * over: the harness, the role, the reason `terms-unknown`, and the audience
 * that did not lift the bar.
 */
export function dshRoleResolutionPassOver(input: {
  readonly role: DshRole;
  readonly audience: TermsAudience;
}): {
  readonly harness: "dsh";
  readonly role: DshRole;
  readonly reason: DshPassOverReason;
  readonly audience: TermsAudience;
} {
  return {
    harness: "dsh",
    role: input.role,
    reason: DSH_PASS_OVER_REASON,
    audience: input.audience,
  };
}
