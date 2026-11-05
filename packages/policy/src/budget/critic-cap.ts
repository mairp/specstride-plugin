/**
 * T072 — the CAP REQUIREMENT of an automatically picked metered critic, and
 * the reason `no-cap` (F127-FR-036; DV-049; CQ-132).
 *
 * The requirement, in three parts:
 *
 *  1. **a critic that is PICKED AUTOMATICALLY and runs on a METERED ENDPOINT
 *     must have a hard spending cap** — `requiresACap` is true for exactly
 *     that case: a named critic is the consumer's own choice, and a critic on
 *     a subscription spends no money per call;
 *  2. **the cap must be announced at launch** — `announcementLine`, in the
 *     form `./announce.ts` uses for a role on an API key with a cap;
 *  3. **a candidate without a declared cap (`budget.role.critic.costUsd`)
 *     must not be picked; the pick records the reason `no-cap` and GOES ON TO
 *     THE NEXT CANDIDATE** — `pickCritic`, which walks the candidates in
 *     order, records a skip for each, and answers the first that qualifies.
 *
 * CQ-132: the reading this feature proceeds on is that such a candidate gets
 * NO DEFAULT CAP. A default would be a number the product invented for the
 * consumer's money; a skip is a decision the consumer can see and change.
 *
 * The reason recorded is `no-cap`, which the specification names and which is
 * a member of row 208 of annex X §X.6, the skip-reason set this feature owns.
 * Row 182 — the reasons a critic candidate does not qualify, owned by feature
 * 124 — carries the neighbouring member `no-spend-cap` for the pick's own
 * record; `ROW_182_MEMBER` names it so a caller can write the one the reader
 * of that set expects without this module guessing which.
 */
import { closedSet } from "@specstride/contracts/enums/all-sets";
import { apiKeyLine, formatCap } from "./announce.ts";
import { type BillingMode, readBillingMode } from "./ledger.ts";
import { SKIP_REASON_NO_CAP } from "./fallback-billing.ts";
import { type SkipReason } from "./fallback.ts";

/* ------------------------------------------------------------------ *
 * 1. The key, the reason and the two sets.
 * ------------------------------------------------------------------ */

/** The key F127-FR-036 names for the cap of the critic. */
export const CRITIC_CAP_KEY = "budget.role.critic.costUsd" as const;

/** The reason the pick records (F127-FR-036); row 208 of annex X §X.6. */
export const PICK_REASON_NO_CAP: SkipReason = SKIP_REASON_NO_CAP;

/** Row 208, the skip-reason set this feature owns. */
export const SKIP_REASON_SET = closedSet(208);

/**
 * The neighbouring member of row 182 (the reasons a critic candidate does not
 * qualify or is passed over, owned by feature 124). F127-FR-036 names
 * `no-cap`; a reader of row 182 expects `no-spend-cap`, so both are given and
 * neither is invented here.
 */
export const ROW_182_MEMBER = "no-spend-cap" as const;

/** Row 182 as the contracts package registers it (feature 124 owns it). */
export const CRITIC_PICK_REASON_SET = closedSet(182);

/** CQ-132 — a candidate without a declared cap gets NO DEFAULT CAP. */
export const NO_DEFAULT_CAP = true as const;

/** Row 35 of annex X §X.7: under `parity` every fixture names the critic. */
export const PARITY_NAMES_THE_CRITIC = true as const;

/* ------------------------------------------------------------------ *
 * 2. Metered, and picked automatically.
 * ------------------------------------------------------------------ */

/** How the critic came to be the critic (F127-FR-036). */
export const PICK_KINDS = ["automatic", "named"] as const;
export type PickKind = (typeof PICK_KINDS)[number];

/**
 * The billing modes of a METERED endpoint: `api` alone. Under a subscription a
 * call spends no money (F127-FR-029), and `unknown` is not known to be metered
 * — the doctor says so through F127-FR-035 instead of a cap being demanded for
 * a figure nothing can count against.
 */
export const METERED_BILLING_MODES: readonly BillingMode[] = Object.freeze(["api"]);

/** One candidate for the critic role. */
export type CriticCandidate = {
  readonly harness: string;
  readonly model?: string | undefined;
  /** `api`, `subscription` or `unknown`; another value is read as `unknown`. */
  readonly billingMode: string;
  /** The cap declared on the candidate itself, where it carries one. */
  readonly capUsd?: number | null | undefined;
};

/** True where the candidate runs on a metered endpoint (F127-FR-036). */
export function isMetered(candidate: CriticCandidate): boolean {
  return METERED_BILLING_MODES.includes(readBillingMode(candidate.billingMode));
}

/**
 * True where the candidate MUST have a hard spending cap: it is metered AND
 * the pick is automatic (F127-FR-036). A critic the consumer named is their
 * own choice and is not refused for want of a cap.
 */
export function requiresACap(candidate: CriticCandidate, pick: PickKind): boolean {
  return pick === "automatic" && isMetered(candidate);
}

/**
 * The cap in force for a candidate: the one declared on the candidate, else
 * the configured `budget.role.critic.costUsd`. A limit of 0, absent or not
 * finite is NO CAP (F127-FR-024: 0 is off).
 */
export function declaredCapOf(
  candidate: CriticCandidate,
  configuredCapUsd?: number | null | undefined,
): number | null {
  for (const value of [candidate.capUsd, configuredCapUsd]) {
    if (typeof value === "number" && Number.isFinite(value) && value !== 0) return value;
  }
  return null;
}

/** True where a cap is declared for the candidate (F127-FR-036). */
export function hasADeclaredCap(
  candidate: CriticCandidate,
  configuredCapUsd?: number | null | undefined,
): boolean {
  return declaredCapOf(candidate, configuredCapUsd) !== null;
}

/* ------------------------------------------------------------------ *
 * 3. The check of one candidate.
 * ------------------------------------------------------------------ */

/** What `checkCandidate` answers. */
export type CandidateCheck = {
  readonly harness: string;
  readonly metered: boolean;
  readonly pick: PickKind;
  readonly requiresACap: boolean;
  readonly capUsd: number | null;
  /** True where the candidate may be picked (F127-FR-036). */
  readonly qualifies: boolean;
  /** `no-cap` where it may not; null where it may (F127-FR-036). */
  readonly reason: SkipReason | null;
  /** The member of row 182 for the pick's own record, where it is skipped. */
  readonly row182Reason: typeof ROW_182_MEMBER | null;
  readonly note: string | null;
};

/**
 * Check one candidate against the cap requirement (F127-FR-036).
 *
 * A metered candidate picked automatically with no declared cap does NOT
 * qualify, and the reason is `no-cap`. Everything else qualifies: a named
 * critic, a critic on a subscription, and a metered automatic pick that has a
 * cap.
 */
export function checkCandidate(input: {
  readonly candidate: CriticCandidate;
  readonly pick: PickKind;
  readonly configuredCapUsd?: number | null | undefined;
}): CandidateCheck {
  const { candidate, pick } = input;
  const metered = isMetered(candidate);
  const needs = requiresACap(candidate, pick);
  const capUsd = declaredCapOf(candidate, input.configuredCapUsd);
  const qualifies = !needs || capUsd !== null;
  return Object.freeze({
    harness: candidate.harness,
    metered,
    pick,
    requiresACap: needs,
    capUsd,
    qualifies,
    reason: qualifies ? null : PICK_REASON_NO_CAP,
    row182Reason: qualifies ? null : ROW_182_MEMBER,
    note: qualifies
      ? null
      : `the candidate ${candidate.harness} runs on a metered endpoint and is picked ` +
        `automatically, and no cap is declared at ${CRITIC_CAP_KEY} or on the candidate; it is ` +
        `not picked and the reason ${PICK_REASON_NO_CAP} is recorded (F127-FR-036, CQ-132)`,
  });
}

/* ------------------------------------------------------------------ *
 * 4. The pick.
 * ------------------------------------------------------------------ */

/** What `pickCritic` answers. */
export type CriticPick = {
  /** The candidate that was picked, or null where none qualified. */
  readonly picked: CriticCandidate | null;
  /** Its cap, where it is metered and picked automatically. */
  readonly capUsd: number | null;
  /** Every candidate that was passed over, in order, with its reason. */
  readonly skipped: readonly CandidateCheck[];
  /** The checks of every candidate considered, in order. */
  readonly checks: readonly CandidateCheck[];
  /** The announcement line of the cap at launch, or null (F127-FR-036). */
  readonly announcementLine: string | null;
  readonly note: string;
};

/**
 * Pick the critic (F127-FR-036).
 *
 * The candidates are walked IN ORDER. A metered automatic candidate with no
 * declared cap is not picked, the reason `no-cap` is recorded, and the walk
 * GOES ON TO THE NEXT CANDIDATE — it does not stop and it does not fall back
 * to a default cap (CQ-132). Where no candidate qualifies, `picked` is null
 * and every skip is in `skipped`, so the consumer learns what to declare.
 */
export function pickCritic(input: {
  readonly candidates: readonly CriticCandidate[];
  readonly pick?: PickKind | undefined;
  readonly configuredCapUsd?: number | null | undefined;
}): CriticPick {
  const pick = input.pick ?? "automatic";
  const checks: CandidateCheck[] = [];
  const skipped: CandidateCheck[] = [];
  let picked: CriticCandidate | null = null;
  let capUsd: number | null = null;

  for (const candidate of input.candidates) {
    const check = checkCandidate({
      candidate,
      pick,
      configuredCapUsd: input.configuredCapUsd,
    });
    checks.push(check);
    if (picked !== null) continue;
    if (check.qualifies) {
      picked = candidate;
      capUsd = check.capUsd;
    } else {
      skipped.push(check);
    }
  }

  return Object.freeze({
    picked,
    capUsd,
    skipped: Object.freeze(skipped),
    checks: Object.freeze(checks),
    announcementLine:
      picked === null ? null : announcementLine({ candidate: picked, pick, capUsd }),
    note:
      picked === null
        ? `no candidate qualified for the critic role: ${skipped
            .map((check) => `${check.harness} (${String(check.reason)})`)
            .join(", ")}; declare ${CRITIC_CAP_KEY} (F127-FR-036)`
        : `the critic is ${picked.harness}` +
          (capUsd === null
            ? `, which needs no cap (${pick === "named" ? "named by the consumer" : "not metered"})`
            : `, with the cap ${formatCap(capUsd)} announced at launch`) +
          (skipped.length === 0
            ? ""
            : `; passed over: ${skipped.map((check) => check.harness).join(", ")}`),
  });
}

/* ------------------------------------------------------------------ *
 * 5. The announcement at launch (F127-FR-036).
 * ------------------------------------------------------------------ */

/**
 * The line the announcement prints for the picked critic (F127-FR-036: "the
 * cap MUST be announced at launch"). A metered critic prints the API-key line
 * of `./announce.ts` with its cap, so the two announcements read alike.
 */
export function announcementLine(input: {
  readonly candidate: CriticCandidate;
  readonly pick: PickKind;
  readonly capUsd: number | null;
}): string {
  const head = isMetered(input.candidate)
    ? apiKeyLine(input.capUsd)
    : `${readBillingMode(input.candidate.billingMode)} in use`;
  const label =
    input.candidate.model === undefined
      ? input.candidate.harness
      : `${input.candidate.harness}/${input.candidate.model}`;
  return `critic: ${label} — ${head}`;
}
