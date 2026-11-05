/**
 * CT-127-5 (T015) — the characterization test of the TABLE (F127-FR-003):
 * exactly one row fires for every vector of signals, the default row, and a
 * classifier that fails.
 *
 * "Exactly one row fires" is proven over the whole cross-product of the four
 * signals the table declares, with the fired row recomputed INDEPENDENTLY in
 * this test from the data file: the predicates are evaluated here by hand, the
 * first matching row is taken, and the rule id must be the one `classify`
 * reports. A second row that also matched is not an error of the evaluator —
 * the evaluator takes the first — so the test asserts the stronger thing: the
 * row that fires is the FIRST matching row, and there is always exactly one
 * fired row because the last row is the default.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CLASSES,
  CLASS_WHEN_UNKNOWN,
  CONFIDENCE_WHEN_UNKNOWN,
} from "@specstride/contracts/ep/quota-classifier";
import {
  CLASSIFIER_FAILED_RULE_ID,
  classifierFailed,
  classify,
  type ClassifySignals,
} from "../src/quota/classify.ts";
import {
  CLASSIFY_POINT,
  DEFAULT_CLASSIFIER_TABLE,
  DEFAULT_TEXT_PATTERNS,
  loadClassifierTable,
} from "../src/quota/table.ts";
import { testPorts } from "./support/index.ts";

/* ---------------------------------------------------------------- *
 * The independent evaluation of the table, by hand.
 * ---------------------------------------------------------------- */

type Predicate = { op: string; signal: string; value: unknown } | undefined;

/** Evaluate one predicate of annex X §X.3 against a signal vector, by hand. */
function matches(when: Predicate, signals: Record<string, unknown>): boolean {
  if (when === undefined) return true; // the default row
  const value = signals[when.signal];
  switch (when.op) {
    case "equal":
      return value === when.value;
    case "member of":
      return Array.isArray(when.value) && (when.value as unknown[]).includes(value);
    default:
      throw new Error(`the test does not know the operator ${when.op}`);
  }
}

/** The FIRST row of the data file whose predicate matches; computed here. */
function firstMatchingRow(signals: ClassifySignals): { ruleId: string; choice: string } {
  const rows = DEFAULT_CLASSIFIER_TABLE.table.rows[CLASSIFY_POINT];
  for (const row of rows) {
    if (matches(row.when as Predicate, { ...signals })) {
      return { ruleId: row.ruleId, choice: String(row.choice) };
    }
  }
  throw new Error("no row matched and no default row exists");
}

/** Every value each signal of the table may take, plus one value outside each set. */
const STRUCTURED_CLASSES = [null, ...CLASSES, "a_class_no_set_holds"] as const;
const HTTP_STATUSES = [null, 200, 401, 402, 403, 429, 500, 503, 529] as const;
const TEXT_GROUPS = [
  null,
  ...DEFAULT_TEXT_PATTERNS.order,
  "a_group_the_file_does_not_hold",
] as const;
const STALLED = [false, true] as const;

test("CT-127-5: exactly one row fires for every vector of signals, and it is the first matching row", () => {
  let vectors = 0;
  for (const structuredClass of STRUCTURED_CLASSES) {
    for (const httpStatus of HTTP_STATUSES) {
      for (const textGroup of TEXT_GROUPS) {
        for (const stalled of STALLED) {
          const signals: ClassifySignals = Object.freeze({
            // The unknown class is read through row 46's rule before the table
            // sees it, which is what `signalsOf` does.
            structuredClass:
              structuredClass === null
                ? null
                : CLASSES.includes(structuredClass as never)
                  ? structuredClass
                  : CLASS_WHEN_UNKNOWN,
            httpStatus,
            textGroup,
            stalled,
          });
          const byHand = firstMatchingRow(signals);
          const result = classify({
            structuredClass,
            status: httpStatus === null ? undefined : { code: httpStatus },
            errorText: textGroup === null ? undefined : textOfGroup(textGroup),
            stalled,
          });
          assert.equal(
            result.ruleId,
            byHand.ruleId,
            `one row fires for ${JSON.stringify(signals)}: the first matching row`,
          );
          assert.equal(result.quotaClass, byHand.choice);
          vectors += 1;
        }
      }
    }
  }
  assert.equal(
    vectors,
    STRUCTURED_CLASSES.length * HTTP_STATUSES.length * TEXT_GROUPS.length * STALLED.length,
    "every vector of the cross-product was tried",
  );
  assert.ok(vectors > 1000, `the cross-product is ${vectors} vectors`);
});

/** A text whose first matching pattern group is the one named. */
function textOfGroup(group: string): string {
  const patterns = DEFAULT_TEXT_PATTERNS.groups.get(group);
  if (patterns === undefined || patterns.length === 0) {
    return "a text that matches no pattern group at all";
  }
  return patterns[0];
}

test("CT-127-5: the default row fires for a vector no other row matches", () => {
  const nothing = classify({});
  assert.equal(nothing.ruleId, DEFAULT_CLASSIFIER_TABLE.defaultRuleId);
  assert.equal(nothing.ruleId, "Q-99");
  assert.equal(nothing.quotaClass, CLASS_WHEN_UNKNOWN);
  assert.equal(nothing.confidence, CONFIDENCE_WHEN_UNKNOWN);

  // A vector with signals that no row names fires the default row too.
  const unseen = classify({ status: { code: 418 }, errorText: "I am a teapot" });
  assert.equal(unseen.ruleId, "Q-99");
  assert.equal(unseen.quotaClass, "provider_other");

  // The default row is the LAST row of the point, and the only one with no `when`.
  const rows = DEFAULT_CLASSIFIER_TABLE.table.rows[CLASSIFY_POINT];
  const withoutWhen = rows.filter((row) => row.when === undefined);
  assert.equal(withoutWhen.length, 1, "exactly one default row (F127-FR-003)");
  assert.equal(withoutWhen[0].ruleId, "Q-99");
  assert.equal(rows[rows.length - 1].ruleId, "Q-99", "and it is the last row");
});

test("CT-127-5: every row of the table records a rule id, and the ids are unique", () => {
  const rows = DEFAULT_CLASSIFIER_TABLE.table.rows[CLASSIFY_POINT];
  const ids = rows.map((row) => row.ruleId);
  assert.equal(new Set(ids).size, ids.length, "no rule id is used twice");
  for (const id of ids) assert.ok(id.length > 0, "every row has a rule id (F127-FR-003)");
});

/* ---------------------------------------------------------------- *
 * A classifier that fails.
 * ---------------------------------------------------------------- */

test("CT-127-5: a classifier that fails gives `provider_other` and never throws", () => {
  const failed = classifierFailed("the evaluator threw");
  assert.equal(failed.quotaClass, "provider_other");
  assert.equal(failed.confidence, "text");
  assert.equal(failed.failed, true);
  assert.equal(failed.ruleId, CLASSIFIER_FAILED_RULE_ID);
  assert.equal(failed.retryable, true, "`provider_other`'s own value (§Q.1)");
  assert.ok(failed.notes.some((note) => note.includes("as-is path of consecutive errors")));
});

test("CT-127-5: a table whose point has no rows makes `classify` fail, not throw", () => {
  // A table the evaluator refuses: the point `classify` holds no row at all.
  const broken = loadClassifierTable({
    schema: "specstride.table/1",
    id: "broken-for-the-test",
    version: "1",
    points: { classify: { signals: { stalled: "truth value" }, choices: ["provider_other"] } },
    rows: {
      classify: [
        {
          ruleId: "only",
          default: true,
          choice: "provider_other",
          retryable: true,
          confidence: "text",
        },
      ],
    },
  });
  // The loaded table is sound; now break the rows after the load, which is
  // the one way an evaluator failure can be produced without a provider.
  const sabotaged = {
    ...broken,
    table: { ...broken.table, rows: { ...broken.table.rows, classify: [] } },
  };
  const result = classify({ stalled: true }, { table: sabotaged });
  assert.equal(result.failed, true, "`classify` never throws (F127-FR-003)");
  assert.equal(result.quotaClass, "provider_other");
  assert.equal(result.ruleId, CLASSIFIER_FAILED_RULE_ID);
});

test("CT-127-5: a row whose rule id carries no facts makes `classify` fail", () => {
  const loaded = DEFAULT_CLASSIFIER_TABLE;
  const sabotaged = { ...loaded, facts: new Map() };
  const result = classify({ stalled: true }, { table: sabotaged });
  assert.equal(result.failed, true);
  assert.equal(result.quotaClass, "provider_other");
  assert.ok(result.notes.some((note) => note.includes("recorded no class")));
});

test("CT-127-5 (checkpoint): the table is evaluated with no clock and no I/O", () => {
  const ports = testPorts();
  const before = ports.clock.nowMs();
  for (let i = 0; i < 500; i += 1) classify({ status: { code: 429 } });
  assert.equal(ports.clock.nowMs(), before, "a pure table (F127-FR-003)");
  assert.deepEqual(ports.fileWriter.writes, []);
});
