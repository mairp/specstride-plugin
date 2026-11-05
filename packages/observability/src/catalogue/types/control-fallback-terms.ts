/**
 * T070 — the `data` schemas of the three types of F111-FR-051: run control, a
 * skipped fallback entry and the terms gate.
 *
 * *The catalogue MUST hold the types `source.change_accepted` (an intended
 * change of a source that the consumer accepted, one event for each file: which
 * of `spec`, `plan` or `tasks`, its logical name, the old hash, the new hash
 * and the time), `fallback.skipped` (a fallback entry that was not used, with
 * the entry and a reason of the set of feature 127) and `terms.override_used`
 * (a use of an entry of `distribution.termsOverride`: the provider whose row
 * gates, the auth tier and the audience), each with the `data` of the table
 * "Types added on 2026-09-30". No count and no detail of how a change was
 * accepted MUST be in `source.change_accepted`. They MUST project to nothing.
 * The feature that owns the behaviour emits them.*
 *
 * ONE EVENT FOR EACH FILE IS A PROPERTY OF A SEQUENCE, not of an event, so it
 * cannot live in a schema. `oneEventForEachFile` is that property as a function
 * over the events of one acceptance: a `file` that holds a list, a `file` of no
 * set, and two events naming the same file are each a finding. The schema does
 * the half it can: `file` carries the closed set, so a list is refused there
 * too.
 *
 * `authTier` STAYS TEXT. Annex X §X.6 row 40 (auth tiers) holds no member yet.
 * A schema that invented three would refuse the fourth the terms gate is about
 * to write; the row number is recorded instead, and the field is text until
 * feature 147 fills the row.
 *
 * THE ENVELOPE NAMES THE ENTRY IN USE. F111-FR-051: *the role is the envelope
 * field `role`; the envelope fields `harness` and `provider` name the entry in
 * use, not the skipped one.* So the SKIPPED entry is named in `data`, by
 * `entryHarness` and `entryProvider`, and `data` carries none of the envelope's
 * own three names — `fallbackSkippedFindings` is that rule over the fields of
 * the row.
 */
import { closedSet } from "@specstride/contracts/enums/all-sets";
import { CATALOGUE, type CatalogueEntry } from "../index.ts";
import { PATH_SHAPE } from "./layer-check.ts";
import { refine, COUNT, TEXT, type TypeRefinement } from "./refinement.ts";

/** The three types of F111-FR-051, in the order the requirement names them. */
export const CONTROL_FALLBACK_TERMS_TYPES = [
  "source.change_accepted",
  "fallback.skipped",
  "terms.override_used",
] as const;
export type ControlFallbackTermsType = (typeof CONTROL_FALLBACK_TERMS_TYPES)[number];

/** F111-FR-051: they project to nothing. */
export const CONTROL_FALLBACK_TERMS_TYPES_PROJECT_TO = null;

/** True where the type is one of the three. */
export function isControlFallbackTermsType(type: string): boolean {
  return (CONTROL_FALLBACK_TERMS_TYPES as readonly string[]).includes(type);
}

/* ------------------------------------------------------------------ *
 * The closed sets, read from annex X §X.6 by row number.
 * ------------------------------------------------------------------ */

/** The rows that name the files of an accepted change: 50 and 135. */
export const ACCEPTED_SOURCE_FILE_ROWS = [50, 135] as const;

/**
 * Which of `spec`, `plan` or `tasks` was accepted: annex X §X.6 rows 50 and
 * 135, which name the same three. A member of a set and never a path.
 */
export const ACCEPTED_SOURCE_FILES: readonly string[] = Object.freeze([
  ...new Set(ACCEPTED_SOURCE_FILE_ROWS.flatMap((row) => [...(closedSet(row)?.members ?? [])])),
]);

/** The reasons that skip a fallback entry: annex X §X.6 row 208 (feature 127). */
export const FALLBACK_SKIP_REASONS: readonly string[] = Object.freeze([
  ...(closedSet(208)?.members ?? []),
]);

/** The audiences: annex X §X.6 row 41. */
export const AUDIENCES: readonly string[] = Object.freeze([...(closedSet(41)?.members ?? [])]);

/** The row of annex X §X.6 that will hold the auth tiers. */
export const AUTH_TIER_SET_ROW = 40;

/** The auth tiers: annex X §X.6 row 40, which holds no member yet. */
export const AUTH_TIERS: readonly string[] = Object.freeze([
  ...(closedSet(AUTH_TIER_SET_ROW)?.members ?? []),
]);

/* ------------------------------------------------------------------ *
 * `source.change_accepted`.
 * ------------------------------------------------------------------ */

/** The logical name of one source of a feature, as `blocked` writes it. */
export function sourceChangeLogicalNameOf(featureId: string, file: string): string {
  return `feature:${featureId}:${file}`;
}

/**
 * The field names that WOULD hold the text of the source, a count, or a detail
 * of how the change was accepted. F111-FR-051 keeps none of them, so a field so
 * named is a design mistake and the build fails on it.
 */
export const FIELDS_THAT_WOULD_HOLD_SOURCE_TEXT = [
  "text",
  "body",
  "source",
  "diff",
  "patch",
  "content",
  "contents",
  "lines",
  "excerpt",
  "snippet",
  "count",
  "counts",
  "changes",
  "changeCount",
  "how",
  "detail",
  "details",
  "note",
  "notes",
] as const;

/**
 * The findings of the catalogue against F111-FR-051: a field of
 * `source.change_accepted` whose NAME says it would hold the text of the
 * source, a count or a detail of how the change was accepted.
 */
export function sourceChangeFieldFindings(
  rows: readonly CatalogueEntry[] = CATALOGUE,
): readonly string[] {
  const findings: string[] = [];
  for (const row of rows) {
    if (row.type !== "source.change_accepted") continue;
    for (const field of row.dataFields) {
      if (!(FIELDS_THAT_WOULD_HOLD_SOURCE_TEXT as readonly string[]).includes(field)) continue;
      findings.push(
        `source.change_accepted: the data field \`${field}\` would hold the text of the ` +
          `source, a count or a detail of how the change was accepted; F111-FR-051 keeps ` +
          `none of them`,
      );
    }
  }
  return Object.freeze(findings);
}

/**
 * The findings of the `source.change_accepted` events of one acceptance: one
 * event for each file. A `file` that holds a list, a `file` of no set, and two
 * events naming the same file are each a finding.
 */
export function oneEventForEachFile(
  events: readonly Readonly<Record<string, unknown>>[],
): readonly string[] {
  const findings: string[] = [];
  const seen = new Map<string, number>();
  for (const data of events) {
    const file = data.file;
    if (Array.isArray(file)) {
      findings.push(
        "source.change_accepted: `file` holds a list; one event names one of " +
          `${ACCEPTED_SOURCE_FILES.join(", ")} and never several`,
      );
      continue;
    }
    if (typeof file !== "string" || !ACCEPTED_SOURCE_FILES.includes(file)) {
      findings.push(
        `source.change_accepted: \`${String(file)}\` is no member of ${ACCEPTED_SOURCE_FILES.join(", ")}`,
      );
      continue;
    }
    seen.set(file, (seen.get(file) ?? 0) + 1);
  }
  for (const [file, count] of seen) {
    if (count === 1) continue;
    findings.push(
      `source.change_accepted: the file \`${file}\` is named by ${count} events; ` +
        `one event for each file`,
    );
  }
  return Object.freeze(findings);
}

/** `changedRef` is a logical name, as in `blocked`, and never a path. */
export function changedRefFindings(data: Readonly<Record<string, unknown>>): readonly string[] {
  const reference = data.changedRef;
  if (typeof reference !== "string" || !PATH_SHAPE.test(reference)) return Object.freeze([]);
  return Object.freeze([
    "source.change_accepted: `changedRef` is the logical name of the source, as in `blocked`; " +
      `it reads the path \`${reference}\``,
  ]);
}

/* ------------------------------------------------------------------ *
 * `fallback.skipped`.
 * ------------------------------------------------------------------ */

/** The envelope's own three names; `data` carries none of them (F111-FR-051). */
export const ENVELOPE_FIELDS_NOT_IN_DATA = ["harness", "provider", "role"] as const;

/**
 * The findings of the fields of `fallback.skipped`: a field of `data` that
 * takes one of the envelope's own three names. The envelope names the entry IN
 * USE; the skipped entry is `entryHarness` and `entryProvider`.
 */
export function fallbackSkippedFindings(fields: readonly string[]): readonly string[] {
  const findings: string[] = [];
  for (const field of fields) {
    if (!(ENVELOPE_FIELDS_NOT_IN_DATA as readonly string[]).includes(field)) continue;
    findings.push(
      `fallback.skipped: \`${field}\` is a field of the envelope and names the entry in use; ` +
        "the skipped entry is `entryHarness`/`entryProvider` in `data`",
    );
  }
  return Object.freeze(findings);
}

/* ------------------------------------------------------------------ *
 * The refinements.
 * ------------------------------------------------------------------ */

/** The refinements of F111-FR-051. */
export const REFINEMENTS: readonly TypeRefinement[] = Object.freeze([
  refine({
    requirement: "F111-FR-051",
    type: "source.change_accepted",
    required: ["file", "changedRef", "oldHash", "newHash", "acceptedAt"],
    fields: {
      file: {
        enum: ACCEPTED_SOURCE_FILES,
        note: "annex X §X.6 rows 50 and 135: a member of a set and no path",
      },
      changedRef: { ...TEXT, note: "the logical name, as in `blocked`" },
      oldHash: TEXT,
      newHash: TEXT,
      acceptedAt: { ...TEXT, note: "the time recorded in the run snapshot" },
    },
    rules: [
      {
        name: "the-reference-is-a-logical-name",
        check: (data) => changedRefFindings(data)[0] ?? null,
      },
    ],
    note: "one event for each file accepted; no text of the source",
  }),
  refine({
    requirement: "F111-FR-051",
    type: "fallback.skipped",
    required: ["entry", "entryHarness", "entryProvider", "authTier", "audience", "reason"],
    fields: {
      entry: { ...COUNT, note: "the position of the entry in the fallback list of the role" },
      entryHarness: TEXT,
      entryProvider: TEXT,
      authTier: {
        ...TEXT,
        note: `annex X §X.6 row ${AUTH_TIER_SET_ROW}, which holds no member yet; text until it does`,
      },
      audience: { enum: AUDIENCES, note: "annex X §X.6 row 41" },
      reason: {
        enum: FALLBACK_SKIP_REASONS,
        note: 'the set "Reasons that skip a fallback entry" of feature 127 (row 208)',
      },
    },
  }),
  refine({
    requirement: "F111-FR-051",
    type: "terms.override_used",
    required: ["termsProvider", "authTier", "audience"],
    fields: {
      termsProvider: {
        ...TEXT,
        note: "the provider whose row of the terms table gated the call",
      },
      authTier: {
        ...TEXT,
        note: `annex X §X.6 row ${AUTH_TIER_SET_ROW}, which holds no member yet; text until it does`,
      },
      audience: { enum: AUDIENCES, note: "annex X §X.6 row 41" },
    },
    note: "one event for each launch and each switch that relies on the entry",
  }),
]);
