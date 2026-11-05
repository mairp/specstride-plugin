/**
 * T029 (feature 112) — the checks of the group `terms` (F112-FR-016,
 * CT-112-116; catalogue rows 24 to 26; DV-048).
 *
 * `terms.gate` evaluates the provider, the auth tier and the audience against
 * the terms data: `fail` when the row is `refused`, `warn` when it is
 * `conditional`, `personal-only` in the audience `distributed`, or unknown (no
 * row), `info` when it is `allowed`. `terms.stale` warns when the terms data
 * is older than 30 days (ruling 59). `terms.audience` shows the audience in
 * force and where it was set. A harness with unknown terms that the consumer
 * named shows the unknown-terms warning (F112-FR-016, last sentence).
 *
 * The probe reads the terms data through the probe bag; the gate itself is not
 * re-implemented here, its verdict arrives as data.
 */
import type { Check, ProbeBag } from "../registry/types.ts";
import { cfg } from "./read.ts";

/** The age after which the terms data is stale: 30 days (ruling 59). */
export const TERMS_STALE_DAYS = 30 as const;
export const TERMS_STALE_MS = TERMS_STALE_DAYS * 24 * 60 * 60 * 1000;

/** The row the terms gate returned, as data (feature 147 owns the gate). */
export type TermsRow = {
  readonly result: "refused" | "conditional" | "personal-only" | "unknown" | "allowed";
  readonly audience: "personal" | "distributed";
  readonly tier?: string;
};

/** The severity `terms.gate` returns for a terms row (F112-FR-016). */
export function severityOfTermsRow(row: TermsRow | undefined): "fail" | "warn" | "info" {
  if (row === undefined) return "warn"; // unknown: no row
  if (row.result === "refused") return "fail";
  if (row.result === "conditional") return "warn";
  if (row.result === "personal-only" && row.audience === "distributed") return "warn";
  if (row.result === "unknown") return "warn";
  return "info"; // allowed
}

/** `terms.gate` — the verdict of the terms gate, shown (row 24, lb). */
export const termsGateCheck: Check = {
  id: "terms.gate",
  group: "terms",
  lb: true,
  order: 24,
  messageTemplate: "tier {tier} audience={audience}: {verdict}",
  fixHint: "switch tier, or set the audience in user configuration",
  severityRule: (o: unknown) => {
    const s = o as { severity: "fail" | "warn" | "info" };
    return s.severity;
  },
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const row = cfg<TermsRow | undefined>(b, "terms.row", undefined);
    const unknownHarnesses = cfg<readonly string[]>(b, "terms.harnessUnknown", []);
    const severity =
      severityOfTermsRow(row) === "info" && unknownHarnesses.length > 0
        ? "warn"
        : severityOfTermsRow(row);
    return {
      severity,
      row: row?.result ?? "unknown",
      tier: row?.tier ?? "?",
      audience: row?.audience ?? "unknown",
      verdict:
        row === undefined
          ? "unknown terms"
          : row.result === "personal-only" && row.audience === "distributed"
            ? "personal-only terms in a distributed audience"
            : `${row.result} by the terms data`,
      // A harness the consumer named whose terms are unknown warns as well.
      unknownHarnesses,
    };
  },
};

/** `terms.stale` — terms data older than 30 days (row 25). */
export const termsStaleCheck: Check = {
  id: "terms.stale",
  group: "terms",
  lb: false,
  order: 25,
  messageTemplate: "terms data checked {checkedAtIso}, {ageDays} days old",
  fixHint: "update the product",
  severityRule: (o: unknown) => {
    const s = o as { ageDays: number | null };
    return s.ageDays !== null && s.ageDays > TERMS_STALE_DAYS ? "warn" : "info";
  },
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const checkedAt = cfg<number | undefined>(b, "terms.checkedAt", undefined);
    const now = cfg<number>(b, "terms.now", b.clock.now());
    const ageMs = checkedAt === undefined ? null : Math.max(0, now - checkedAt);
    return {
      ageDays: ageMs === null ? null : Math.floor(ageMs / (24 * 60 * 60 * 1000)),
      checkedAtIso: checkedAt === undefined ? "never" : new Date(checkedAt).toISOString(),
    };
  },
};

/** `terms.audience` — the audience in force and where it was set (row 26). */
export const termsAudienceCheck: Check = {
  id: "terms.audience",
  group: "terms",
  lb: false,
  order: 26,
  messageTemplate: "audience {audience} ({source})",
  fixHint: "none",
  severityRule: () => "info",
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    return {
      audience: cfg<string>(b, "terms.audience", "personal"),
      source: cfg<string>(b, "terms.audienceSource", "user configuration"),
    };
  },
};

/** The three checks of the group `terms`, in catalogue order. */
export const termsChecks: readonly Check[] = Object.freeze([
  termsGateCheck,
  termsStaleCheck,
  termsAudienceCheck,
]);
