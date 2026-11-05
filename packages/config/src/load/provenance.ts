/**
 * T020 — provenance (F110-FR-021, F110-FR-024, F110-FR-025, F110-FR-026).
 *
 * F110-FR-024: every effective value has a source — the rank, and where the rank
 * has more than one place, the file or the name of the variable, and for a
 * learned value the id of its decision. A default the profile supplied shows the
 * name of the profile. The values a higher rank shadowed are recorded with their
 * ranks. The run record holds the same sources as `config show`.
 *
 * F110-FR-026: an environment value a higher rank shadows is reported as
 * shadowed, in `config show` and as a finding to the doctor; the same holds for
 * the environment value of a pinned key on `resume`. The report names the key and
 * the ranks.
 *
 * A secret is a reference and is never resolved here: the record carries the
 * reference as it was written (F110-FR-025, F110-FR-032).
 */
import {
  configRanks,
  rankOfLayer,
  type KeyClass,
  type RankLayer,
} from "@specstride/contracts/envelope/config";
import type { Finding } from "@specstride/contracts/records/doctor-findings";

import { matchCatalogueKey } from "../schema/catalogue.ts";
import { SECRET_REFERENCE } from "./files.ts";
import { FINDING_IDS } from "./trust.ts";
import type { MergedValue, ShadowedValue } from "./merge.ts";

/**
 * F110-FR-024, first sentence — the ranks that have more than one place, and so
 * name the file, the variable, the flag or the decision beside the rank. The
 * contract pin and the run snapshot have one place each.
 */
export const RANKS_WITH_MORE_THAN_ONE_PLACE: readonly RankLayer[] = Object.freeze([
  "flag",
  "environment",
  "project-configuration",
  "user-configuration",
  "learned-value",
  "default",
]);

/** True where the rank has more than one place (F110-FR-024). */
export function rankHasMoreThanOnePlace(layer: RankLayer): boolean {
  return RANKS_WITH_MORE_THAN_ONE_PLACE.includes(layer);
}

/** The label annex X §X.2 gives a rank, for a line a person reads. */
export function labelOfRank(layer: RankLayer): string {
  return configRanks.find((r) => r.layer === layer)?.label ?? layer;
}

/** One value a higher rank shadowed, as the record carries it. */
export interface ShadowedRecord {
  readonly source: RankLayer;
  readonly rank: number;
  readonly value: unknown;
  readonly place?: string | undefined;
}

/**
 * The provenance record of one key (`data-model.md`, "Provenance record"): the
 * key, the value or the reference, the source rank, the place, the id of the
 * learned decision, the name of the profile, and the list of shadowed values.
 */
export interface ProvenanceRecord {
  readonly key: string;
  /** The value, or the secret reference exactly as it was written. */
  readonly value: unknown;
  /** True where the value is a reference of §K.7 and was never resolved. */
  readonly isSecretReference: boolean;
  /** The rank layer the value came from. */
  readonly source: RankLayer;
  /** The rank number, 1 to 8. */
  readonly sourceRank: number;
  /** The file, the variable, the flag or the decision, where the rank has one. */
  readonly place?: string | undefined;
  /** The id of the decision, for a learned value. */
  readonly decisionId?: string | undefined;
  /** The name of the profile, for a default the profile supplied. */
  readonly profile?: string | undefined;
  /** `pinned` or `tunable` (annex B §B.12). */
  readonly class: KeyClass;
  /** Every value a higher rank shadowed, with its rank. */
  readonly shadowed: readonly ShadowedRecord[];
}

/** True where a value is a secret reference of §K.7 and must never be resolved. */
export function isSecretReferenceValue(key: string, value: unknown): boolean {
  const entry = matchCatalogueKey(key)?.entry;
  if (entry?.type.kind !== "secret-ref") return false;
  return typeof value === "string" && SECRET_REFERENCE.test(value);
}

const shadowedRecord = (s: ShadowedValue): ShadowedRecord =>
  Object.freeze({
    source: s.layer,
    rank: s.rank,
    value: s.value,
    ...(s.place === undefined ? {} : { place: s.place }),
  });

/**
 * F110-FR-024 — the provenance record of one merged value. The place is carried
 * only where the rank has more than one place; for a learned value the id of the
 * decision, and for a default the profile supplied, the name of the profile.
 */
export function provenanceOf(merged: MergedValue): ProvenanceRecord {
  const carriesPlace = rankHasMoreThanOnePlace(merged.source) && merged.place !== undefined;
  return Object.freeze({
    key: merged.key,
    value: merged.value,
    isSecretReference: isSecretReferenceValue(merged.key, merged.value),
    source: merged.source,
    sourceRank: merged.rank,
    ...(carriesPlace ? { place: merged.place } : {}),
    ...(merged.decisionId === undefined ? {} : { decisionId: merged.decisionId }),
    ...(merged.profile === undefined ? {} : { profile: merged.profile }),
    class: merged.class,
    shadowed: Object.freeze(merged.shadowed.map(shadowedRecord)),
  });
}

/**
 * F110-FR-024, F110-SC-001 — the provenance of every resolved key, in the order
 * of the keys. `config show` prints this table and the run record holds it, so
 * that the two can never disagree.
 */
export function provenanceTable(
  values: ReadonlyMap<string, MergedValue>,
): readonly ProvenanceRecord[] {
  return Object.freeze(
    [...values.values()].map(provenanceOf).sort((a, b) => a.key.localeCompare(b.key)),
  );
}

/** F110-FR-025, first sentence — a key whose value comes from a rank other than 8. */
export function isSetAboveTheDefault(record: ProvenanceRecord): boolean {
  return record.source !== "default";
}

/**
 * F110-FR-024, last sentence — the `sources` summary of the run record (annex G
 * §G.6, the field `sources`). It is built from the same records `config show`
 * prints, so that the run record holds the same sources.
 */
export function runRecordSources(
  records: readonly ProvenanceRecord[],
): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  const out: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const record of records) {
    out[record.key] = Object.freeze({
      value: record.value,
      source: record.source,
      rank: record.sourceRank,
      class: record.class,
      ...(record.place === undefined ? {} : { place: record.place }),
      ...(record.decisionId === undefined ? {} : { decision: record.decisionId }),
      ...(record.profile === undefined ? {} : { profile: record.profile }),
      shadowed: Object.freeze(
        record.shadowed.map((s) =>
          Object.freeze({
            source: s.source,
            rank: s.rank,
            ...(s.place === undefined ? {} : { place: s.place }),
          }),
        ),
      ),
    });
  }
  return Object.freeze(out);
}

/* ------------------------------------------------------------------ *
 * F110-FR-026 — a shadowed environment value is a finding.
 * ------------------------------------------------------------------ */

/** The rank of the environment: 4 (annex X §X.2). */
export const ENVIRONMENT_RANK: number = rankOfLayer["environment"];

/** A shadowed environment value, as `config show` and the doctor report it. */
export interface ShadowedEnvironmentReport {
  readonly key: string;
  /** The name of the variable that was shadowed. */
  readonly variable: string | undefined;
  /** The rank of the environment: always 4. */
  readonly shadowedRank: number;
  /** The rank that shadowed it, and its layer. */
  readonly byRank: number;
  readonly by: RankLayer;
  /** True where the key is pinned and the run is a `resume` (F110-FR-026). */
  readonly pinnedOnResume: boolean;
  /** The line `config show` prints, naming the key and the ranks. */
  readonly message: string;
}

/**
 * F110-FR-026 — every environment value a higher rank shadowed. The report names
 * the key and the ranks; on `resume` the environment value of a pinned key is
 * reported the same way, which is the case the requirement names by hand.
 */
export function shadowedEnvironmentValues(
  records: readonly ProvenanceRecord[],
  options: { readonly onResume?: boolean | undefined } = {},
): readonly ShadowedEnvironmentReport[] {
  const out: ShadowedEnvironmentReport[] = [];
  for (const record of records) {
    for (const shadow of record.shadowed) {
      if (shadow.source !== "environment") continue;
      const pinnedOnResume = options.onResume === true && record.class === "pinned";
      out.push(
        Object.freeze({
          key: record.key,
          variable: shadow.place,
          shadowedRank: shadow.rank,
          byRank: record.sourceRank,
          by: record.source,
          pinnedOnResume,
          message:
            `\`${record.key}\`: the environment value` +
            (shadow.place === undefined ? "" : ` of \`${shadow.place}\``) +
            ` at rank ${shadow.rank} is shadowed by ${labelOfRank(record.source)} at rank ` +
            `${record.sourceRank}` +
            (pinnedOnResume
              ? `; the key is \`pinned\`, and on \`resume\` a pinned key ranks above the ` +
                `environment (F110-FR-022, F110-FR-026)`
              : " (F110-FR-026)"),
        }),
      );
    }
  }
  return Object.freeze(out);
}

/** F110-FR-026 — the same reports as findings for the doctor. */
export function shadowedEnvironmentFindings(
  records: readonly ProvenanceRecord[],
  options: { readonly onResume?: boolean | undefined } = {},
): readonly Finding[] {
  return Object.freeze(
    shadowedEnvironmentValues(records, options).map((report) =>
      Object.freeze({
        id: FINDING_IDS.shadowedEnvironment,
        severity: "info" as const,
        lb: false,
        message: report.message,
        fix:
          `remove the variable, or set the key at the rank you mean; the ranks are those of ` +
          `annex X §X.2`,
        evidence: `${report.variable ?? "the environment"}: \`${report.key}\``,
      }),
    ),
  );
}
