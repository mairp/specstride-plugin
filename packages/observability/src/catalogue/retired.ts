/**
 * T071 and T072 — the retirement of 2026-09-30 (second pass, item C8), AS DATA.
 *
 * T071: *the test CT-111-152 and the two types `critic.passed_over` and
 * `critic.diversity` are gone with F111-FR-052; the id is retired, never
 * reused.*
 * T072: *see T071; the facts ride `critic.selected` and `critic.call`
 * (F111-FR-011).*
 *
 * WHY A RETIREMENT IS DATA AND NOT A SENTENCE. A retired id is the one kind of
 * fact a reader cannot check by reading: nothing is there. If the record of it
 * lives only in a report, the next person to need an event type takes the next
 * free number and reuses it, and two different facts end up with one name in
 * two versions of the stream. So the retirement is held here, and
 * `retirementFindings` is the check: a retired type that is a row of the
 * catalogue again is a finding, and the build fails on it.
 *
 * Nothing was LOST with the two types. `critic.passed_over` carried the
 * pass-over reasons of an automatic pick; they stay on the announcement line
 * and in the field `criticPick` of the resolved registry (feature 124).
 * `critic.diversity` carried the warning; it rides `critic.selected` at launch
 * and `critic.call` before a call, in the fields `diversity` and
 * `sameModelWarning` (F111-FR-011, research D-15).
 */
import { CATALOGUE, type CatalogueEntry } from "./index.ts";

/** The day the two types were retired. */
export const RETIRED_ON = "2026-09-30" as const;

/** The item of the second-pass list that retired them. */
export const RETIRED_SECOND_PASS_ITEM = "C8" as const;

/** A retired id is never reused. */
export const NEVER_REUSED = true as const;

/** One retired event type, with where its facts went instead. */
export type RetiredEventType = {
  readonly type: string;
  readonly retiredOn: string;
  readonly item: string;
  /** The requirement that was retired with it. */
  readonly requirement: string;
  /** The types that carry the facts now. */
  readonly ridesOn: readonly string[];
  readonly reason: string;
};

/** The two types that were proposed on 2026-09-30 and retired the same day. */
export const RETIRED_EVENT_TYPES: readonly RetiredEventType[] = Object.freeze([
  Object.freeze({
    type: "critic.passed_over",
    retiredOn: RETIRED_ON,
    item: RETIRED_SECOND_PASS_ITEM,
    requirement: "F111-FR-052",
    ridesOn: Object.freeze(["critic.selected"]),
    reason:
      "the pass-over reasons of an automatic pick stay on the announcement line and in the " +
      "field `criticPick` of the resolved registry (feature 124); the catalogue keeps " +
      "`critic.selected` only among the four proposed types",
  }),
  Object.freeze({
    type: "critic.diversity",
    retiredOn: RETIRED_ON,
    item: RETIRED_SECOND_PASS_ITEM,
    requirement: "F111-FR-052",
    ridesOn: Object.freeze(["critic.selected", "critic.call"]),
    reason:
      "the warning rides `critic.selected` at launch and `critic.call` before a call " +
      "(F111-FR-011), whether or not the line is silenced",
  }),
]);

/** The names of the retired types, in the order the task names them. */
export const RETIRED_TYPE_NAMES: readonly string[] = Object.freeze(
  RETIRED_EVENT_TYPES.map((record) => record.type),
);

/** The test ids that are retired and name no test. */
export const RETIRED_TEST_IDS = ["CT-111-152"] as const;

/** The requirement ids that are retired and are a requirement of nothing. */
export const RETIRED_REQUIREMENT_IDS = ["F111-FR-052"] as const;

/** The task ids that are retired and carry no deliverable. */
export const RETIRED_TASK_IDS = ["T071", "T072"] as const;

/**
 * The requirement ids that MOVED to feature 144 with group G5. They are not
 * retired — feature 144 owns them — and this feature claims none of them.
 */
export const REQUIREMENT_IDS_MOVED_TO_144: readonly string[] = Object.freeze(
  Array.from({ length: 11 }, (_unused, index) => `F111-FR-0${39 + index}`),
);

/**
 * The findings of the catalogue against the retirement: a retired type that is
 * a row again. Empty means no retired id was reused.
 */
export function retirementFindings(rows: readonly CatalogueEntry[] = CATALOGUE): readonly string[] {
  const present = new Set(rows.map((row) => row.type));
  const findings: string[] = [];
  for (const record of RETIRED_EVENT_TYPES) {
    if (!present.has(record.type)) continue;
    findings.push(
      `${record.type}: the type was retired on ${record.retiredOn} (second pass, item ` +
        `${record.item}) and is a row of the catalogue again; a retired id is never reused`,
    );
  }
  return Object.freeze(findings);
}
