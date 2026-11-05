/**
 * CT-127-3 (T013) — the characterization test of the two OPERATIONS of EP-12,
 * the nine classes, the five confidence values, the value of `retryable` per
 * class of §Q.1 and the unknown-value rules (F127-FR-001).
 *
 * The test is written against the closed sets of `@specstride/contracts` and
 * against §Q.1 as `../src/quota/actions.ts` carries it, so a member added or
 * removed anywhere fails here.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CLASSES,
  CLASS_WHEN_UNKNOWN,
  CONFIDENCES,
  CONFIDENCE_WHEN_UNKNOWN,
  NO_ENTRY_MATCHES,
} from "@specstride/contracts/ep/quota-classifier";
import {
  OPERATIONS,
  QUOTA_CLASSES,
  RESET_SOURCES,
  RESET_SOURCE_WHEN_UNKNOWN,
  classify,
  observe,
  readConfidence,
  readQuotaClass,
  readResetSource,
} from "../src/quota/classify.ts";
import { ACTION_BY_CLASS, CLASSES_OF_Q1 } from "../src/quota/actions.ts";
import { RETRYABLE_BY_CLASS } from "../src/quota/table.ts";
import { testPorts } from "./support/index.ts";

/* ---------------------------------------------------------------- *
 * The two operations.
 * ---------------------------------------------------------------- */

test("CT-127-3: the classifier offers exactly the two operations `classify` and `observe`", () => {
  assert.deepEqual([...OPERATIONS], ["classify", "observe"]);
  assert.equal(typeof classify, "function");
  assert.equal(typeof observe, "function");
});

test("CT-127-3: `classify` gives a class, a confidence, `resetsAt` and `retryable`", () => {
  const result = classify({
    structuredClass: "quota_window",
    resetsAt: { structured: "2026-01-01T05:00:00.000Z" },
  });
  for (const field of ["quotaClass", "confidence", "resetsAt", "retryable"]) {
    assert.ok(field in result, `\`classify\` gives ${field} (F127-FR-001)`);
  }
  assert.equal(result.quotaClass, "quota_window");
  assert.equal(result.confidence, "structured");
  assert.equal(result.resetsAt, "2026-01-01T05:00:00.000Z");
  assert.equal(result.retryable, true);
});

test("CT-127-3: `observe` gives an alert level or nothing", () => {
  assert.equal(observe({ kind: "gauge", remaining: 0.05, of: "window" }), "loud");
  assert.equal(observe({ kind: "gauge", remaining: 0.2, of: "window" }), "warn");
  assert.equal(observe({ kind: "gauge", remaining: 0.4, of: "window" }), "info");
  assert.equal(
    observe({ kind: "gauge", remaining: 0.9, of: "window" }),
    undefined,
    "nothing, where no threshold of §Q.4 is reached",
  );
  assert.equal(
    observe({ kind: "gauge", remaining: 42, of: "window" }),
    undefined,
    "a gauge outside [0, 1] is no reading at all",
  );
  assert.equal(observe({ kind: "host-fact", fact: "the host hit its own limit" }), "warn");
});

/* ---------------------------------------------------------------- *
 * The nine classes and the five confidence values.
 * ---------------------------------------------------------------- */

test("CT-127-3: the classes are the nine of §Q.1, in the order of the table", () => {
  assert.equal(CLASSES.length, 9, "nine classes (§Q.1)");
  assert.deepEqual(
    [...CLASSES],
    [
      "quota_window",
      "quota_credit",
      "rate_limit_transient",
      "overload",
      "auth",
      "context_window",
      "agent_failure",
      "provider_other",
      "budget_cap",
    ],
  );
  assert.deepEqual([...QUOTA_CLASSES], [...CLASSES], "the module reads the closed set");
  assert.deepEqual([...CLASSES_OF_Q1], [...CLASSES], "§Q.1 has a row for each of the nine");
  for (const quotaClass of CLASSES) {
    assert.ok(ACTION_BY_CLASS[quotaClass] !== undefined, `§Q.1 has a row for ${quotaClass}`);
  }
});

test("CT-127-3: the confidence values are the five of §Q.2", () => {
  assert.equal(CONFIDENCES.length, 5);
  assert.deepEqual([...CONFIDENCES], ["structured", "status", "text", "stall", "host"]);
});

/* ---------------------------------------------------------------- *
 * `retryable` is a constant of the class.
 * ---------------------------------------------------------------- */

/** §Q.1, the last column, transcribed from the specification. */
const RETRYABLE_OF_SECTION_Q1 = Object.freeze({
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

test("CT-127-3: `retryable` is the one value §Q.1 gives for the class", () => {
  for (const quotaClass of CLASSES) {
    assert.equal(
      RETRYABLE_BY_CLASS[quotaClass],
      RETRYABLE_OF_SECTION_Q1[quotaClass],
      `${quotaClass} carries the \`retryable\` of §Q.1`,
    );
    assert.equal(
      ACTION_BY_CLASS[quotaClass].retryable,
      RETRYABLE_OF_SECTION_Q1[quotaClass],
      `the row of §Q.1 for ${quotaClass} carries the same value`,
    );
  }
});

test("CT-127-3: `classify` writes the class's `retryable` whatever the input says", () => {
  for (const quotaClass of CLASSES) {
    if (quotaClass === "budget_cap") continue; // no row of the table chooses it
    const result = classify({ structuredClass: quotaClass });
    assert.equal(result.quotaClass, quotaClass);
    assert.equal(result.retryable, RETRYABLE_OF_SECTION_Q1[quotaClass]);
  }
});

test("CT-127-3: an entry that states another `retryable` is INVALID and is ignored with a note", () => {
  // §Q.1: "an entry that states another value is invalid".
  const invalid = classify({ structuredClass: "auth", retryable: true });
  assert.equal(invalid.quotaClass, "auth");
  assert.equal(invalid.retryable, false, "the value of the class stands, not the entry's");
  assert.ok(
    invalid.notes.some((note) => note.includes("invalid")),
    "the invalid entry is recorded in a note",
  );

  const alsoInvalid = classify({ structuredClass: "quota_window", retryable: false });
  assert.equal(alsoInvalid.retryable, true);
  assert.ok(alsoInvalid.notes.some((note) => note.includes("invalid")));

  // An entry that states the SAME value, or none, raises no note.
  const agreeing = classify({ structuredClass: "auth", retryable: false });
  assert.equal(agreeing.retryable, false);
  assert.deepEqual([...agreeing.notes], [], "an agreeing entry is not invalid");
  const silent = classify({ structuredClass: "auth" });
  assert.equal(silent.retryable, false, "an entry that states no value takes the class's");
  assert.deepEqual([...silent.notes], []);
});

/* ---------------------------------------------------------------- *
 * The unknown-value rules.
 * ---------------------------------------------------------------- */

test("CT-127-3: an unknown class from an implementation is read as `provider_other`", () => {
  assert.equal(CLASS_WHEN_UNKNOWN, "provider_other", "the rule of row 46 of annex X §X.6");
  assert.equal(readQuotaClass("a_class_no_set_holds"), "provider_other");
  assert.equal(readQuotaClass("quota_window"), "quota_window");
  assert.equal(readQuotaClass(null), null, "nothing stated is not an unknown value");
  const result = classify({ structuredClass: "a_class_no_set_holds" });
  assert.equal(result.quotaClass, "provider_other");
  assert.equal(result.retryable, true, "and it carries `provider_other`'s `retryable`");
});

test("CT-127-3: an unknown confidence is read as `text`", () => {
  assert.equal(CONFIDENCE_WHEN_UNKNOWN, "text", "the rule of row 47 of annex X §X.6");
  assert.equal(readConfidence("very-sure"), "text");
  assert.equal(readConfidence("stall"), "stall");
  assert.equal(readConfidence(undefined), null);
  const result = classify({ structuredClass: "quota_window", confidence: "very-sure" });
  assert.equal(result.confidence, "text");
});

test("CT-127-3: an unknown source of a reset time is read as `parsed_text`", () => {
  assert.deepEqual([...RESET_SOURCES], ["structured", "header", "parsed_text"]);
  assert.equal(RESET_SOURCE_WHEN_UNKNOWN, "parsed_text", "the rule of row 207");
  assert.equal(readResetSource("guessed"), "parsed_text");
  assert.equal(readResetSource("header"), "header");
  assert.equal(readResetSource(null), null);
});

test("CT-127-3: an input that matches no entry gives `provider_other` with the confidence `text`", () => {
  const nothing = classify({});
  assert.equal(nothing.quotaClass, NO_ENTRY_MATCHES.quotaClass);
  assert.equal(nothing.quotaClass, "provider_other");
  assert.equal(nothing.confidence, NO_ENTRY_MATCHES.confidence);
  assert.equal(nothing.confidence, "text");
  assert.equal(nothing.resetsAt, null);
  assert.equal(nothing.retryable, true);
  assert.equal(nothing.ruleId, "Q-99", "the default row fired");
});

test("CT-127-3 (checkpoint): the two operations read no clock", () => {
  const ports = testPorts();
  const before = ports.clock.nowMs();
  for (let i = 0; i < 200; i += 1) {
    classify({ errorText: `usage limit reached ${i}` });
    observe({ kind: "gauge", remaining: i / 200, of: "window" });
  }
  assert.equal(ports.clock.nowMs(), before, "the classifier is pure (F127-FR-003)");
  assert.equal(ports.clock.sleeps.length, 0);
});
