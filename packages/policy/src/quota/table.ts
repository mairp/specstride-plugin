/**
 * T005 — the data files of the default classifier, loaded and validated.
 *
 * `packages/policy/data/classifier.table.json` is a byte-for-byte copy of
 * `specs/127-quota-budgets-and-pause/contracts/classifier.table.json`, and
 * `packages/policy/data/text-patterns.json` of
 * `specs/127-quota-budgets-and-pause/contracts/text-patterns.json` (T005,
 * F127-FR-003). Both are validated AT LOAD:
 *
 *  - the table against the table schema of feature 100,
 *    `specstride.table/1` of annex X §X.3, through `loadTable` of
 *    `@specstride/kernel`, which also refuses a table without a default row
 *    per decision point, a choice outside the choice set, an unknown signal
 *    and an unknown operator (F100-FR-204);
 *  - this module then adds the three checks the schema cannot make, because
 *    `specstride.table/1` carries no field of feature 127: every row names a
 *    `retryable` and a `confidence`, the `confidence` is a member of the
 *    closed set of row 47, and the `retryable` of a row is the constant of
 *    its class in §Q.1 (item W-127-02 of the spec: "an entry that states
 *    another value is invalid");
 *  - the pattern set against its own shape: the schema id, a group per name
 *    of `order`, a name of `order` per group, and a non-empty text per
 *    pattern.
 *
 * F127-FR-003 asks for "versioned data, no I/O, no clock and no model": the
 * two files are imported as data, so this module opens nothing and the
 * classifier of `./classify.ts` reads no file of its own.
 */
import { loadTable, TABLE_SCHEMA_ID, type LoadedTable } from "@specstride/kernel";
import { quotaConfidence } from "@specstride/contracts/enums/all-sets";
import type { Confidence, QuotaClass } from "@specstride/contracts/ep/quota-classifier";
import classifierTableData from "../../data/classifier.table.json" with { type: "json" };
import textPatternsData from "../../data/text-patterns.json" with { type: "json" };

/** The decision point the classifier evaluates (`classifier.table.json`). */
export const CLASSIFY_POINT = "classify" as const;

/** The schema id of the pattern set (`text-patterns.json`). */
export const PATTERNS_SCHEMA_ID = "specstride.quota-patterns/1" as const;

/** The paths of the two data files, relative to the repository root. */
export const DATA_FILES = Object.freeze({
  table: "packages/policy/data/classifier.table.json",
  patterns: "packages/policy/data/text-patterns.json",
});

/** Where each data file was copied from (T005). */
export const DATA_SOURCES = Object.freeze({
  table: "specs/127-quota-budgets-and-pause/contracts/classifier.table.json",
  patterns: "specs/127-quota-budgets-and-pause/contracts/text-patterns.json",
});

/**
 * The constant `retryable` of each class, §Q.1 column `retryable`. A row of
 * the table, an entry of a harness adapter or of a `failures` map that states
 * no value takes the value here; one that states another value is invalid
 * (item W-127-02).
 */
export const RETRYABLE_BY_CLASS: Readonly<Record<QuotaClass, boolean>> = Object.freeze({
  quota_window: true,
  quota_credit: false,
  rate_limit_transient: true,
  overload: true,
  auth: false,
  context_window: false,
  agent_failure: true,
  provider_other: true,
  budget_cap: false,
});

/** A data file this module refuses at load (F127-FR-003). */
export class ClassifierDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClassifierDataError";
  }
}

/** What a row of the table adds to the three fields `specstride.table/1` holds. */
export type ClassifierRowFacts = {
  /** The class the row chooses; the `choice` of the row. */
  readonly quotaClass: QuotaClass;
  /** The confidence the row records, a member of row 47 of annex X §X.6. */
  readonly confidence: Confidence;
  /** The constant `retryable` of the class (§Q.1). */
  readonly retryable: boolean;
  /** True for the default row — the row without `when` (F127-FR-003). */
  readonly isDefault: boolean;
};

/** The table, with the per-row facts of feature 127 beside it. */
export type ClassifierTable = {
  readonly table: LoadedTable;
  /** The facts of each row, by rule id. */
  readonly facts: ReadonlyMap<string, ClassifierRowFacts>;
  /** The rule id of the default row of `classify` (F127-FR-003). */
  readonly defaultRuleId: string;
  /** The version of the table, recorded with every classification (F127-FR-002). */
  readonly version: string;
};

/** The pattern groups of the default text classifier, in the order they are tried. */
export type TextPatterns = {
  /** Case-insensitive substrings per group name. */
  readonly groups: ReadonlyMap<string, readonly string[]>;
  /** The group names in the order of evaluation (`order` of the data file). */
  readonly order: readonly string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Load and validate the classifier table (T005, F127-FR-003). Throws
 * `TableLoadError` for a refusal of the schema of feature 100 and
 * `ClassifierDataError` for a refusal of the three checks of feature 127.
 */
export function loadClassifierTable(value: unknown = classifierTableData): ClassifierTable {
  const table = loadTable(value);
  if (!(CLASSIFY_POINT in table.rows)) {
    throw new ClassifierDataError(
      `${DATA_FILES.table}: the table ${table.id} has no decision point ` +
        `${CLASSIFY_POINT} (${TABLE_SCHEMA_ID})`,
    );
  }
  const raw = isRecord(value) ? value : {};
  const rawRows =
    isRecord(raw.rows) && Array.isArray(raw.rows[CLASSIFY_POINT])
      ? (raw.rows[CLASSIFY_POINT] as unknown[])
      : [];
  const facts = new Map<string, ClassifierRowFacts>();
  let defaultRuleId: string | undefined;
  for (const row of table.rows[CLASSIFY_POINT]) {
    const rawRow = rawRows.find(
      (candidate) => isRecord(candidate) && candidate.ruleId === row.ruleId,
    );
    const where = `${DATA_FILES.table}: the row ${row.ruleId}`;
    if (!isRecord(rawRow)) throw new ClassifierDataError(`${where} is not a record`);
    if (typeof rawRow.retryable !== "boolean") {
      throw new ClassifierDataError(
        `${where} states no \`retryable\`; §Q.1 gives one value per class and every row ` +
          `carries it (item W-127-02)`,
      );
    }
    if (typeof rawRow.confidence !== "string" || !quotaConfidence.has(rawRow.confidence)) {
      throw new ClassifierDataError(
        `${where} states the confidence ${JSON.stringify(rawRow.confidence)}, which is not a ` +
          `member of the closed set "${quotaConfidence.name}" (annex X §X.6 row ` +
          `${quotaConfidence.number}: ${quotaConfidence.members.join(", ")})`,
      );
    }
    const quotaClass = row.choice as QuotaClass;
    const expected = RETRYABLE_BY_CLASS[quotaClass];
    if (expected !== undefined && rawRow.retryable !== expected) {
      throw new ClassifierDataError(
        `${where} states \`retryable\` ${String(rawRow.retryable)} for the class ` +
          `${quotaClass}, whose constant value in §Q.1 is ${String(expected)}; an entry that ` +
          `states another value is invalid (item W-127-02)`,
      );
    }
    const isDefault = row.when === undefined;
    if (isDefault) defaultRuleId = row.ruleId;
    facts.set(row.ruleId, {
      quotaClass,
      confidence: rawRow.confidence as Confidence,
      retryable: rawRow.retryable,
      isDefault,
    });
  }
  if (defaultRuleId === undefined) {
    // `loadTable` already refuses this; the check keeps the type honest.
    throw new ClassifierDataError(
      `${DATA_FILES.table}: the decision point ${CLASSIFY_POINT} has no default row ` +
        `(F127-FR-003)`,
    );
  }
  return Object.freeze({ table, facts, defaultRuleId, version: table.version });
}

/**
 * Load and validate the pattern set of the default text classifier (T005,
 * F127-FR-003). Throws `ClassifierDataError` on every refusal.
 */
export function loadTextPatterns(value: unknown = textPatternsData): TextPatterns {
  const where = DATA_FILES.patterns;
  if (!isRecord(value)) throw new ClassifierDataError(`${where}: the pattern set is not a record`);
  if (value.schema !== PATTERNS_SCHEMA_ID) {
    throw new ClassifierDataError(
      `${where}: the schema id is ${JSON.stringify(value.schema)}, not ${PATTERNS_SCHEMA_ID}`,
    );
  }
  if (!isRecord(value.groups))
    throw new ClassifierDataError(`${where}: \`groups\` is not a record`);
  if (!Array.isArray(value.order) || value.order.length === 0) {
    throw new ClassifierDataError(`${where}: \`order\` is not a non-empty list of group names`);
  }
  const groups = new Map<string, readonly string[]>();
  for (const [name, patterns] of Object.entries(value.groups)) {
    if (!Array.isArray(patterns) || patterns.length === 0) {
      throw new ClassifierDataError(`${where}: the group ${name} holds no pattern`);
    }
    for (const pattern of patterns) {
      if (typeof pattern !== "string" || pattern.length === 0) {
        throw new ClassifierDataError(`${where}: the group ${name} holds an empty pattern`);
      }
    }
    groups.set(name, Object.freeze([...(patterns as string[])]));
  }
  const order: string[] = [];
  for (const name of value.order) {
    if (typeof name !== "string") {
      throw new ClassifierDataError(`${where}: \`order\` holds a name that is not text`);
    }
    if (!groups.has(name)) {
      throw new ClassifierDataError(
        `${where}: \`order\` names the group ${name}, which \`groups\` does not hold`,
      );
    }
    if (order.includes(name)) {
      throw new ClassifierDataError(`${where}: \`order\` names the group ${name} twice`);
    }
    order.push(name);
  }
  for (const name of groups.keys()) {
    if (!order.includes(name)) {
      throw new ClassifierDataError(
        `${where}: the group ${name} is not named in \`order\`, so it would never be tried`,
      );
    }
  }
  return Object.freeze({ groups, order: Object.freeze(order) });
}

/** The table as the product ships it, validated at load (T005). */
export const DEFAULT_CLASSIFIER_TABLE: ClassifierTable = loadClassifierTable();

/** The pattern set as the product ships it, validated at load (T005). */
export const DEFAULT_TEXT_PATTERNS: TextPatterns = loadTextPatterns();
