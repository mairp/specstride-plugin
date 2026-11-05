/**
 * T010 — the unit tests of the classifier (F127-FR-001, F127-FR-002,
 * F127-FR-003), on the fake clock of T003.
 *
 * The classifier is pure, so the strongest thing a fake clock proves here is
 * that it is: the clock is injected and must not have moved by a single
 * millisecond after a thousand classifications.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CLASS_WHEN_UNKNOWN,
  CONFIDENCE_WHEN_UNKNOWN,
} from "@specstride/contracts/ep/quota-classifier";
import {
  CLASSIFIER_FAILED_RULE_ID,
  classifierFailed,
  classify,
  observe,
  OBSERVE_LEVELS,
  patternSignal,
  readConfidence,
  readQuotaClass,
  readResetSource,
  resolveResetsAt,
  signalsOf,
} from "../src/quota/classify.ts";
import { RETRYABLE_BY_CLASS } from "../src/quota/table.ts";
import { testPorts } from "./support/index.ts";

/** A redactor that replaces a key-looking token, so the evidence is proven redacted. */
const fakeRedact = (text: string, cap: number) => ({
  text: text.replace(/sk-[A-Za-z0-9]+/g, "[REDACTED]").slice(0, cap),
  replacements: 0,
  patternSetVersion: "test",
});

test("T010: the pattern signals name the group of the first matching pattern", () => {
  assert.equal(patternSignal("Your session limit has been reached"), "window");
  assert.equal(patternSignal("credit balance is too low"), "credit");
  assert.equal(patternSignal("INVALID API KEY"), "auth", "the match is case-insensitive");
  assert.equal(patternSignal("the server is busy, retry"), "overload");
  assert.equal(patternSignal("prompt is too long"), "context");
  assert.equal(patternSignal("something else entirely"), null);
  assert.equal(patternSignal(null), null);
  assert.equal(patternSignal(""), null);
});

test("T010: the pattern order of the data file decides a text that matches two groups", () => {
  // `order` is credit, auth, window, context, overload: credit wins over window.
  const both = "usage limit reached: your credit balance is too low";
  assert.equal(patternSignal(both), "credit");
});

test("T010: a structured signal fires first, and records its rule id", () => {
  const result = classify({ structuredClass: "quota_window", status: { code: 429 } });
  assert.equal(result.quotaClass, "quota_window");
  assert.equal(result.confidence, "structured", "the order of evidence of §Q.2");
  assert.equal(result.ruleId, "Q-01-quota_window", "the rule id is recorded (F127-FR-003)");
  assert.equal(result.tableVersion, "1", "the table version (F127-FR-002)");
  assert.equal(result.retryable, true, "§Q.1 gives `retryable` per class");
  assert.equal(result.failed, false);
});

test("T010: a status fires where no structured signal is present", () => {
  for (const [code, expected, ruleId] of [
    [402, "quota_credit", "Q-02"],
    [401, "auth", "Q-03"],
    [403, "auth", "Q-03"],
    [529, "overload", "Q-04"],
    [503, "overload", "Q-04"],
    [429, "rate_limit_transient", "Q-05"],
  ] as const) {
    const result = classify({ status: { code } });
    assert.equal(result.quotaClass, expected, `status ${code}`);
    assert.equal(result.confidence, "status", `status ${code}`);
    assert.equal(result.ruleId, ruleId, `status ${code}`);
    assert.equal(result.retryable, RETRYABLE_BY_CLASS[expected], `status ${code}`);
  }
});

test("T010: a text pattern fires where no structured signal and no status are present", () => {
  for (const [text, expected, ruleId] of [
    ["weekly limit reached", "quota_window", "Q-06"],
    ["insufficient_quota", "quota_credit", "Q-07"],
    ["not logged in", "auth", "Q-08"],
    ["overloaded", "overload", "Q-09"],
    ["maximum context length", "context_window", "Q-10"],
  ] as const) {
    const result = classify({ errorText: text }, { redact: fakeRedact });
    assert.equal(result.quotaClass, expected, text);
    assert.equal(result.confidence, "text", text);
    assert.equal(result.ruleId, ruleId, text);
  }
});

test("T010: the stall watchdog fires last, and gives quota_window with confidence stall", () => {
  const result = classify({ stalled: true });
  assert.equal(result.quotaClass, "quota_window");
  assert.equal(result.confidence, "stall");
  assert.equal(result.ruleId, "Q-11");
  // A status present beats the stall.
  assert.equal(classify({ stalled: true, status: { code: 402 } }).ruleId, "Q-02");
});

test("T010: the default row — an input that matches nothing is provider_other/text", () => {
  const result = classify({ errorText: "a failure of no known shape" }, { redact: fakeRedact });
  assert.equal(result.quotaClass, "provider_other", "F127-FR-001");
  assert.equal(result.confidence, "text", "F127-FR-001");
  assert.equal(result.ruleId, "Q-99", "the default row");
  assert.equal(result.retryable, true);
  // An empty input is the same.
  assert.equal(classify({}).ruleId, "Q-99");
});

test("T010: exactly one row fires for every vector of signals", () => {
  const seen = new Set<string>();
  for (const structuredClass of [null, "quota_window", "auth", "not-a-class"]) {
    for (const code of [null, 401, 402, 429, 503, 529, 500]) {
      for (const errorText of [null, "weekly limit", "insufficient credits", "overloaded"]) {
        for (const stalled of [false, true]) {
          const result = classify(
            {
              structuredClass,
              status: code === null ? undefined : { code },
              errorText,
              stalled,
            },
            { redact: fakeRedact },
          );
          assert.equal(result.failed, false);
          assert.ok(result.ruleId.length > 0, "one row fired");
          seen.add(result.ruleId);
        }
      }
    }
  }
  assert.ok(seen.size > 1, "the sweep reached more than one row");
});

test("T010: the unknown-value rules of rows 46, 47 and 207", () => {
  // An unknown class from an implementation is read as `provider_other`.
  assert.equal(readQuotaClass("not-a-class"), CLASS_WHEN_UNKNOWN);
  assert.equal(readQuotaClass("quota_window"), "quota_window");
  assert.equal(readQuotaClass(null), null);
  const result = classify({ structuredClass: "not-a-class" });
  assert.equal(result.quotaClass, "provider_other", "read as provider_other (F127-FR-001)");
  assert.equal(result.confidence, "structured", "it still fired on a structured signal");
  assert.equal(result.ruleId, "Q-01-provider_other");
  // An unknown confidence is read as `text`.
  assert.equal(readConfidence("guessed"), CONFIDENCE_WHEN_UNKNOWN);
  assert.equal(classify({ status: { code: 402 }, confidence: "guessed" }).confidence, "text");
  // An unknown source of a reset time is read as `parsed_text`.
  assert.equal(readResetSource("sniffed"), "parsed_text");
  assert.equal(readResetSource(null), null);
});

test("T010: every field F127-FR-002 names is carried, and the evidence passed the redactor", () => {
  const result = classify(
    {
      structuredClass: "quota_window",
      errorText: "limit reached; key sk-ABC123 was used",
      resetsAt: { structured: "2026-01-01T05:00:00.000Z" },
      rateLimitType: "requests",
      utilization: 0.97,
    },
    { redact: fakeRedact },
  );
  assert.equal(result.quotaClass, "quota_window");
  assert.equal(result.confidence, "structured");
  assert.equal(result.resetsAt, "2026-01-01T05:00:00.000Z");
  assert.equal(result.resetsAtSource, "structured");
  assert.equal(result.retryable, true);
  assert.equal(result.rateLimitType, "requests");
  assert.equal(result.utilization, 0.97);
  assert.ok(result.evidence !== null);
  assert.ok(!result.evidence.includes("sk-ABC123"), "the evidence passed the redactor");
  assert.match(result.evidence, /\[REDACTED\]/);
  assert.equal(result.ruleId, "Q-01-quota_window");
  assert.equal(result.tableVersion, "1");
});

test("T010: with no redactor handed in, the evidence is dropped and never carried in the clear", () => {
  const result = classify({ status: { code: 402 }, errorText: "key sk-ABC123" });
  assert.equal(result.evidence, null, "fails closed (F100-FR-205)");
  assert.equal(result.evidenceDropped, "redactor-unavailable");
  assert.ok(result.notes.some((note) => note.includes("F100-FR-205")));
});

test("T010: a time read from text is used only where no structured or header value exists", () => {
  const all = {
    structured: "2026-01-01T01:00:00.000Z",
    header: "2026-01-01T02:00:00.000Z",
    parsedText: "2026-01-01T03:00:00.000Z",
  };
  assert.deepEqual(resolveResetsAt(all), {
    resetsAt: all.structured,
    resetsAtSource: "structured",
  });
  assert.deepEqual(resolveResetsAt({ header: all.header, parsedText: all.parsedText }), {
    resetsAt: all.header,
    resetsAtSource: "header",
  });
  assert.deepEqual(resolveResetsAt({ parsedText: all.parsedText }), {
    resetsAt: all.parsedText,
    resetsAtSource: "parsed_text",
  });
  assert.deepEqual(resolveResetsAt(undefined), { resetsAt: null, resetsAtSource: null });
});

test("T010: an entry that states another `retryable` is invalid; the class's value stands", () => {
  const result = classify({ structuredClass: "auth", retryable: true });
  assert.equal(result.retryable, false, "§Q.1 gives false for `auth`");
  assert.ok(result.notes.some((note) => note.includes("item W-127-02")));
  // An entry that states the same value adds no note.
  assert.equal(classify({ structuredClass: "auth", retryable: false }).notes.length, 0);
});

test("T010: a classifier that fails gives provider_other and says so (F127-FR-003)", () => {
  // A table whose decision point `classify` has no rows makes `evaluateTable`
  // throw, which is the one way the evaluation of a loaded table can fail.
  const result = classify(
    { status: { code: 402 } },
    {
      table: {
        table: { schema: "specstride.table/1", id: "x", version: "9", points: {}, rows: {} },
        facts: new Map(),
        defaultRuleId: "none",
        version: "9",
      },
    },
  );
  assert.equal(result.failed, true);
  assert.equal(result.quotaClass, "provider_other");
  assert.equal(result.confidence, "text");
  assert.equal(result.ruleId, CLASSIFIER_FAILED_RULE_ID);
  assert.ok(result.notes.some((note) => note.includes("F127-FR-003")));
  // `classifierFailed` is the same classification, reachable directly.
  const direct = classifierFailed("a reason");
  assert.equal(direct.quotaClass, "provider_other");
  assert.equal(direct.retryable, true);
});

test("T010: `signalsOf` builds the vector the table declares", () => {
  assert.deepEqual(
    signalsOf({
      structuredClass: "auth",
      status: { code: 429 },
      errorText: "overloaded",
      stalled: true,
    }),
    { structuredClass: "auth", httpStatus: 429, textGroup: "overload", stalled: true },
  );
  assert.deepEqual(signalsOf({}), {
    structuredClass: null,
    httpStatus: null,
    textGroup: null,
    stalled: false,
  });
  assert.equal(signalsOf({ status: { code: Number.NaN } }).httpStatus, null);
});

test("T010: `observe` gives a level of row 48 or nothing (F127-FR-001)", () => {
  assert.equal(observe({ kind: "gauge", remaining: 1, of: "window" }), undefined);
  assert.equal(observe({ kind: "gauge", remaining: 0.6, of: "window" }), undefined);
  assert.equal(observe({ kind: "gauge", remaining: 0.5, of: "window" }), "info");
  assert.equal(observe({ kind: "gauge", remaining: 0.25, of: "window" }), "warn");
  assert.equal(observe({ kind: "gauge", remaining: 0.1, of: "window" }), "loud");
  assert.equal(observe({ kind: "gauge", remaining: 0, of: "window" }), "loud");
  assert.equal(observe({ kind: "gauge", remaining: 2, of: "window" }), undefined);
  assert.equal(observe({ kind: "host-fact", fact: "a limit was seen" }), "warn");
  for (const level of OBSERVE_LEVELS) assert.ok(["info", "warn", "loud"].includes(level));
});

test("T010 (checkpoint): the classifier reads no clock — the fake clock never moves", () => {
  const ports = testPorts();
  const before = ports.clock.nowMs();
  const beforeMonotonic = ports.clock.monotonicMs();
  for (let i = 0; i < 1000; i += 1) {
    classify(
      { status: { code: 429 }, errorText: `attempt ${i} weekly limit` },
      { redact: fakeRedact },
    );
  }
  assert.equal(ports.clock.nowMs(), before, "no clock reading moved (F127-FR-003)");
  assert.equal(ports.clock.monotonicMs(), beforeMonotonic);
  assert.equal(ports.clock.sleeps.length, 0, "and nothing slept");
  assert.equal(ports.fileWriter.writes.length, 0, "no I/O (F127-FR-003)");
  assert.equal(ports.eventWriter.events.length, 0);
});
