/**
 * T057 — the announcement of caps, billing mode and fallback entries at launch
 * and at `resume` (F127-FR-041).
 *
 * At launch and at `resume` the announcement lists, PER ROLE:
 *
 *  - the BILLING MODE of the primary entry;
 *  - the CEILINGS IN FORCE;
 *  - the FALLBACK ENTRIES with their billing mode and cap;
 *  - and any role whose SPEND CANNOT BE MEASURED (F127-FR-035).
 *
 * It says "API key in use, cap <value>" for a role on an API key, and says so
 * when NO CAP is set — `API_KEY_IN_USE_WITH_A_CAP` and
 * `API_KEY_IN_USE_WITH_NO_CAP` are the two forms, and `apiKeyLine` picks
 * between them. The `loud` `billing-mode-change` alert of F127-FR-021 appears
 * here too, which is why the announcement is written at `resume` and not only
 * at launch: a consumer who was away while the run switched is told at the
 * next thing they do.
 *
 * The announcement is PRINTED BY THE CLI (§Q.5, the row "Announcement at
 * launch and at `resume`"), so this module builds the LINES and, where a
 * caller hands it a writer and a path, puts them on disk through the atomic
 * write of annex A §A.3 — a durable record a reader can read back and hash
 * without asking the process that wrote it.
 */
import { contentHash } from "@specstride/kernel";
import type { AtomicWrite } from "../quota/ports.ts";
import { keyOf, type Ceiling } from "./ceilings.ts";
import { declaredCapOf } from "./fallback-billing.ts";
import { entryLabel, type FallbackEntry, type RolePlan } from "./fallback.ts";
import { OBSERVED_BY_SPECSTRIDE_ONLY, type BillingMode } from "./ledger.ts";

/* ------------------------------------------------------------------ *
 * 1. When, and the two forms of the API-key line.
 * ------------------------------------------------------------------ */

/** The two moments the announcement is made (F127-FR-041). */
export const ANNOUNCED_AT = ["launch", "resume"] as const;
export type AnnouncedAt = (typeof ANNOUNCED_AT)[number];

/** The form F127-FR-041 names for a role on an API key WITH a cap. */
export const API_KEY_IN_USE_WITH_A_CAP = "API key in use, cap <value>" as const;

/** The form for a role on an API key with NO cap set (F127-FR-041). */
export const API_KEY_IN_USE_WITH_NO_CAP = "API key in use, no cap set" as const;

/** The fixed opening of both forms, so a reader can grep for one string. */
export const API_KEY_IN_USE = "API key in use" as const;

/** What the announcement says of a role whose spend cannot be measured. */
export const SPEND_CANNOT_BE_MEASURED: string =
  "spend cannot be measured: this harness reports no cost; the wallClock, phaseAttempts and " +
  "calls ceilings still apply";

/**
 * The API-key line of a role (F127-FR-041). With a cap the `<value>` of the
 * form is replaced by the figure; with none, the line SAYS SO rather than
 * leaving the reader to notice an absence.
 */
export function apiKeyLine(capUsd: number | null): string {
  return capUsd === null
    ? API_KEY_IN_USE_WITH_NO_CAP
    : `${API_KEY_IN_USE}, cap ${formatCap(capUsd)}`;
}

/** A cap as the announcement prints it: US dollars, at most two decimals. */
export function formatCap(capUsd: number): string {
  const rounded = Math.round(capUsd * 100) / 100;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)} USD`;
}

/** The billing-mode line of a role that is not on an API key (F127-FR-041). */
export function billingModeLine(billingMode: BillingMode): string {
  return billingMode === "subscription"
    ? `subscription in use, spend is notional and ${OBSERVED_BY_SPECSTRIDE_ONLY}`
    : "billing mode unknown, spend may be metered and is counted as unknown";
}

/* ------------------------------------------------------------------ *
 * 2. What the announcement is built from.
 * ------------------------------------------------------------------ */

/** One role, as the announcement sees it. */
export type RoleAnnouncement = {
  readonly role: string;
  /** The role plan: the primary entry and the fallback entries. */
  readonly plan: RolePlan;
  /** The ceilings in force for the role, and the run ceilings a caller adds. */
  readonly ceilings: readonly Ceiling[];
  /** The cap on the role from configuration (`budget.role.<role>.costUsd`). */
  readonly configuredCapUsd?: number | null | undefined;
  /** True where the harness of the primary entry reports no cost (F127-FR-035). */
  readonly spendUnmeasurable?: boolean | undefined;
};

/** What `announce` is handed. */
export type AnnounceInput = {
  readonly at: AnnouncedAt;
  readonly roles: readonly RoleAnnouncement[];
  /** Any `loud` alert still open, which the announcement repeats (F127-FR-021). */
  readonly openLoudAlerts?: readonly string[] | undefined;
};

/** The announcement: its lines, and the facts a reader may want as data. */
export type Announcement = {
  readonly at: AnnouncedAt;
  /** The lines, in order, as the CLI prints them. */
  readonly lines: readonly string[];
  /** The roles whose spend cannot be measured (F127-FR-035). */
  readonly unmeasurable: readonly string[];
  /** The roles on an API key, and the cap each has (F127-FR-041). */
  readonly onAnApiKey: readonly { readonly role: string; readonly capUsd: number | null }[];
};

/** The line one ceiling contributes: its key and its limit (F127-FR-041). */
export function ceilingLine(ceiling: Ceiling): string | null {
  const limit = ceiling.limit;
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit === 0) return null;
  return `${keyOf(ceiling)} = ${limit}`;
}

/** The ceilings in force, as lines; a ceiling that is off contributes none. */
export function ceilingLines(ceilings: readonly Ceiling[]): readonly string[] {
  return Object.freeze(ceilings.map(ceilingLine).filter((line): line is string => line !== null));
}

/**
 * The line one fallback entry contributes: the entry, its billing mode and its
 * cap (F127-FR-041). An API-key entry with no declared cap is announced as
 * such, so a consumer sees before the run why it will be skipped
 * (F127-FR-021).
 */
export function fallbackLine(entry: FallbackEntry): string {
  const cap = declaredCapOf(entry);
  const capPart =
    entry.billingMode === "api"
      ? cap === null
        ? ", no cap set (it will be skipped)"
        : `, cap ${formatCap(cap)}`
      : cap === null
        ? ""
        : `, cap ${formatCap(cap)}`;
  return `  fallback ${entry.index}: ${entryLabel(entry)} (${entry.billingMode})${capPart}`;
}

/** The lines of one role (F127-FR-041). */
export function roleLines(role: RoleAnnouncement): readonly string[] {
  const lines: string[] = [];
  const primary = role.plan.primary;
  const head =
    primary.billingMode === "api"
      ? apiKeyLine(declaredCapOf(primary, role.configuredCapUsd))
      : billingModeLine(primary.billingMode);
  lines.push(`${role.role}: ${entryLabel(primary)} — ${head}`);

  const ceilings = ceilingLines(role.ceilings);
  lines.push(
    ceilings.length === 0
      ? "  ceilings in force: none"
      : `  ceilings in force: ${ceilings.join(", ")}`,
  );

  if (role.plan.entries.length === 0) {
    lines.push("  fallback: off");
  } else {
    for (const entry of role.plan.entries) lines.push(fallbackLine(entry));
  }

  if (role.spendUnmeasurable === true) lines.push(`  ${SPEND_CANNOT_BE_MEASURED}`);
  return Object.freeze(lines);
}

/**
 * The announcement at launch or at `resume` (F127-FR-041). The first line says
 * which of the two it is, so that a consumer reading a log knows whether the
 * run is starting or going on.
 */
export function announce(input: AnnounceInput): Announcement {
  const lines: string[] = [`Budgets and billing at ${input.at}:`];
  const unmeasurable: string[] = [];
  const onAnApiKey: { readonly role: string; readonly capUsd: number | null }[] = [];

  for (const role of input.roles) {
    lines.push(...roleLines(role));
    if (role.spendUnmeasurable === true) unmeasurable.push(role.role);
    if (role.plan.primary.billingMode === "api") {
      onAnApiKey.push(
        Object.freeze({
          role: role.role,
          capUsd: declaredCapOf(role.plan.primary, role.configuredCapUsd),
        }),
      );
    }
  }

  for (const open of input.openLoudAlerts ?? []) lines.push(`  loud alert still open: ${open}`);

  return Object.freeze({
    at: input.at,
    lines: Object.freeze(lines),
    unmeasurable: Object.freeze(unmeasurable),
    onAnApiKey: Object.freeze(onAnApiKey),
  });
}

/** The announcement as the CLI prints it. */
export function announcementText(announcement: Announcement): string {
  return `${announcement.lines.join("\n")}\n`;
}

/* ------------------------------------------------------------------ *
 * 3. The durable record (F127-FR-041, the effect a reader can witness).
 * ------------------------------------------------------------------ */

/** The logical name of the announcement, by the layout rules of annex B §B.5. */
export const ANNOUNCEMENT_LOGICAL_NAME = "run:<runId>:announcement" as const;

/** The path of the announcement of one run under a run root. */
export function announcementPath(runRoot: string, at: AnnouncedAt): string {
  return `${runRoot}/announcement-${at}.txt`;
}

/** What a written announcement is, for a reader that did not write it. */
export type WrittenAnnouncement = {
  readonly path: string;
  readonly at: AnnouncedAt;
  readonly text: string;
  /** The canonical content hash of the text (annex X §X.5). */
  readonly contentHash: string;
  readonly lineCount: number;
};

/**
 * Write the announcement through the atomic write of annex A §A.3
 * (F127-FR-041). The answer carries the content hash, so a reader that opens
 * the path independently can prove it is reading what was written and not a
 * value this function merely claimed.
 */
export function writeAnnouncement(
  writer: AtomicWrite,
  path: string,
  announcement: Announcement,
): WrittenAnnouncement {
  const text = announcementText(announcement);
  writer.write(path, text);
  return Object.freeze({
    path,
    at: announcement.at,
    text,
    contentHash: contentHash(text),
    lineCount: announcement.lines.length,
  });
}

/**
 * Read an announcement back from disk (F127-FR-041). The independent read path
 * of the written record: it returns the text and its hash, and nothing of the
 * value `writeAnnouncement` answered.
 */
export function readAnnouncement(
  writer: AtomicWrite,
  path: string,
): {
  readonly text: string;
  readonly contentHash: string;
  readonly lines: readonly string[];
} | null {
  if (!writer.exists(path)) return null;
  const text = writer.read(path);
  return Object.freeze({
    text,
    contentHash: contentHash(text),
    lines: Object.freeze(text.replace(/\n$/, "").split("\n")),
  });
}
