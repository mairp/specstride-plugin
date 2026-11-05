/**
 * Feature 147 — the loader of the terms data (F147-FR-003, F147-FR-013;
 * EP-11 `specstride.terms/1`).
 *
 * `loadTermsData(value)` validates one data file: every row MUST hold all
 * eight fields (provider, auth tier, audience, status, source, access date,
 * quoted sentence, `verified-on`); a row that lacks a field makes the file
 * INVALID, and so does a row whose auth tier or audience is outside the
 * closed sets of annex X §X.6 rows 40 and 41. A status outside the closed
 * set of row 42 is a VALID row that is READ AS `refused` (F147-FR-003).
 *
 * The loader writes nothing and watches nothing (constitution I): it is a
 * pure check over a value the caller has already read. Replacement — a
 * newer valid file in user-level state (`user:terms`) replaces the shipped
 * one, an invalid one is ignored with a doctor finding — is
 * `resolveTermsData` below; the staleness warning of the doctor is the
 * doctor's (F147-FR-013; `STALE_AFTER_DAYS` of the contract).
 */
import { AUDIENCES, AUTH_TIERS, STALE_AFTER_DAYS } from "@specstride/contracts/ep/terms";
import type { Audience, AuthTier, TermsRow } from "@specstride/contracts/ep/terms";
import shippedDataJson from "./data/terms.json" with { type: "json" };

export { STALE_AFTER_DAYS };

/** The path of the shipped data file, relative to the repository root. */
export const SHIPPED_DATA_FILE = "packages/policy/src/terms/data/terms.json" as const;

/** The logical name of the user-level replacement file (annex B §B.5). */
export const USER_TERMS = "user:terms" as const;

/** A data file this loader refuses (F147-FR-003). */
export class TermsDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TermsDataError";
  }
}

/** One validated terms data file. */
export type TermsData = {
  readonly id: string;
  readonly version: string;
  readonly rows: readonly TermsRow[];
};

const ROW_FIELDS = [
  "provider",
  "authTier",
  "audience",
  "status",
  "source",
  "accessDate",
  "quotedSentence",
  "verifiedOn",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, what: string, errors: string[]): boolean {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${what}: expected non-empty text`);
    return false;
  }
  return true;
}

/**
 * F147-FR-003 — validate one terms data file. Throws `TermsDataError`
 * naming every row and field that is missing or outside a closed set.
 */
export function loadTermsData(value: unknown): TermsData {
  const errors: string[] = [];
  if (!isRecord(value)) {
    throw new TermsDataError(`${SHIPPED_DATA_FILE}: the file is no record`);
  }
  const { id, version, rows } = value as Record<string, unknown>;
  if (typeof id !== "string" || id.length === 0) errors.push("id: expected non-empty text");
  if (typeof version !== "string" || version.length === 0)
    errors.push("version: expected non-empty text");
  if (!Array.isArray(rows)) {
    errors.push("rows: expected a list of rows");
  } else if (rows.length === 0) {
    errors.push("rows: the file holds no row");
  } else {
    rows.forEach((raw, index) => {
      const what = `rows[${index}]`;
      if (!isRecord(raw)) {
        errors.push(`${what}: expected a record`);
        return;
      }
      const row = raw as Record<string, unknown>;
      for (const field of ROW_FIELDS) {
        if (!(field in row)) errors.push(`${what}.${field}: the row lacks the field (F147-FR-003)`);
      }
      if (typeof row.provider === "string") text(row.provider, `${what}.provider`, errors);
      else errors.push(`${what}.provider: expected text`);
      if (typeof row.authTier === "number") {
        if (!(AUTH_TIERS as readonly number[]).includes(row.authTier))
          errors.push(
            `${what}.authTier: ${row.authTier} is outside the closed set ${AUTH_TIERS.join(", ")}`,
          );
      } else errors.push(`${what}.authTier: expected a whole number`);
      if (typeof row.audience === "string") {
        if (!(AUDIENCES as readonly string[]).includes(row.audience))
          errors.push(
            `${what}.audience: "${row.audience}" is outside the closed set ${AUDIENCES.join(" and ")}`,
          );
      } else errors.push(`${what}.audience: expected text`);
      // An unknown STATUS is a valid row read as `refused` (F147-FR-003);
      // anything that is not text is a missing field and invalid.
      if (typeof row.status !== "string") errors.push(`${what}.status: expected text`);
      if (typeof row.source === "string") text(row.source, `${what}.source`, errors);
      else errors.push(`${what}.source: expected text`);
      if (typeof row.accessDate === "string") text(row.accessDate, `${what}.accessDate`, errors);
      else errors.push(`${what}.accessDate: expected text`);
      if (typeof row.quotedSentence === "string")
        text(row.quotedSentence, `${what}.quotedSentence`, errors);
      else errors.push(`${what}.quotedSentence: expected text`);
      // `verified-on` is the date of the last re-check, or null before the
      // first one; a value that is neither is a missing field.
      if (row.verifiedOn !== null && typeof row.verifiedOn !== "string")
        errors.push(`${what}.verifiedOn: expected a date or null`);
    });
  }
  if (errors.length > 0) {
    throw new TermsDataError(`${SHIPPED_DATA_FILE}: ${errors.slice(0, 8).join("; ")}`);
  }
  return Object.freeze({
    id: id as string,
    version: version as string,
    rows: Object.freeze((rows as unknown[]).map((raw) => Object.freeze({ ...(raw as TermsRow) }))),
  });
}

/** The shipped data file, as imported data — no I/O (F147-FR-011). */
export function shippedTermsData(): unknown {
  return shippedDataJson;
}

/** Where the terms data in force came from (data-model.md). */
export type TermsOrigin = "shipped" | "replaced" | "ignored";

/** The result of the replacement rule of F147-FR-013. */
export type ResolvedTerms = {
  readonly origin: TermsOrigin;
  /** The data in force: the replacement, or the shipped file. */
  readonly data: TermsData | null;
  /** The doctor finding, where a replacement was ignored (F147-FR-013). */
  readonly finding: string | null;
};

/**
 * F147-FR-013 — a newer valid file in user-level state replaces the shipped
 * one; a file that does not validate is IGNORED with a doctor finding, and
 * the shipped file applies. Pure: the caller reads the file, this function
 * only decides.
 */
export function resolveTermsData(shipped: TermsData, userFile: unknown): ResolvedTerms {
  if (userFile === undefined || userFile === null) {
    return Object.freeze({ origin: "shipped" as const, data: shipped, finding: null });
  }
  try {
    return Object.freeze({
      origin: "replaced" as const,
      data: loadTermsData(userFile),
      finding: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Object.freeze({
      origin: "ignored" as const,
      data: shipped,
      finding: `the terms file in user-level state (${USER_TERMS}) does not validate and is ignored; the shipped file applies: ${message}`,
    });
  }
}

/** The audience/tier guards, re-exported beside the loader for one import site. */
export { type Audience, type AuthTier };

/**
 * F147-FR-013 — the data for the doctor's 30-day warning. The staleness of
 * the data is a doctor warning, never a gate input (research decision 4):
 * `evaluate` has no clock, so this helper is called by the doctor, with the
 * clock handed in as an argument. `verifiedOn` is the newest `verified-on`
 * date across the rows of the data in force (the replacement, or the shipped
 * file — the caller passes `ResolvedTerms.data`); `ageDays` counts whole days
 * from that date, read as UTC midnight; `stale` is true only when the data is
 * older than `STALE_AFTER_DAYS` (30) days.
 */
export type TermsStaleness = {
  readonly verifiedOn: string | null;
  readonly ageDays: number | null;
  readonly stale: boolean;
  readonly staleAfterDays: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function asUtcMidnightMs(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (m === null) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : ms;
}

export function staleness(data: TermsData, nowMs: number): TermsStaleness {
  let newest: number | null = null;
  let newestDate: string | null = null;
  for (const row of data.rows) {
    if (typeof row.verifiedOn !== "string") continue;
    const ms = asUtcMidnightMs(row.verifiedOn);
    if (ms === null) continue;
    if (newest === null || ms > newest) {
      newest = ms;
      newestDate = row.verifiedOn;
    }
  }
  if (newest === null || newestDate === null) {
    return Object.freeze({
      verifiedOn: null,
      ageDays: null,
      stale: false,
      staleAfterDays: STALE_AFTER_DAYS,
    });
  }
  const ageDays = Math.max(0, Math.floor((nowMs - newest) / MS_PER_DAY));
  return Object.freeze({
    verifiedOn: newestDate,
    ageDays,
    stale: ageDays > STALE_AFTER_DAYS,
    staleAfterDays: STALE_AFTER_DAYS,
  });
}
