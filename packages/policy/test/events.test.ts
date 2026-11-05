/**
 * T012 — the unit tests of the ten events of this feature (F127-FR-040), on
 * the fake event writer of T003.
 *
 * The fake event writer refuses a type outside the ones F127-FR-040 names, so a
 * typo in an emitter fails here and not at a sink.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  alert,
  blocked,
  budgetExceeded,
  emit,
  fallbackRestored,
  fallbackSkipped,
  fallbackSwitched,
  FREE_TEXT_CAP_BYTES,
  FREE_TEXT_FIELDS,
  harnessError,
  isPolicyEventType,
  NO_CONTENT,
  PAIR_CLOSED,
  pairFindings,
  PolicyEventError,
  POLICY_EVENT_TYPES,
  preparePayload,
  quotaSignal,
  redactField,
  runPaused,
  runResumed,
} from "../src/quota/events.ts";
import { classify } from "../src/quota/classify.ts";
import { budgetExceededPayload, readCeiling } from "../src/budget/ceilings.ts";
import { applyUsageRecord, emptyLedger } from "../src/budget/ledger.ts";
import { EVENT_TYPES, testPorts } from "./support/index.ts";

/** A redactor that removes a key-looking token and cuts to the cap. */
const fakeRedact = (text: string, cap: number) => ({
  text: text.replace(/sk-[A-Za-z0-9]+/g, "[REDACTED]").slice(0, cap),
  replacements: 1,
  patternSetVersion: "test",
});

test("T012: the ten event types of F127-FR-040, and no eleventh", () => {
  assert.deepEqual(
    [...POLICY_EVENT_TYPES],
    [
      "quota.signal",
      "harness.error",
      "run.paused",
      "run.resumed",
      "alert",
      "budget.exceeded",
      "fallback.switched",
      "fallback.restored",
      "fallback.skipped",
      "blocked",
    ],
  );
  for (const type of POLICY_EVENT_TYPES) {
    assert.ok(isPolicyEventType(type), type);
    assert.ok(
      (EVENT_TYPES as readonly string[]).includes(type),
      `${type} is a type the catalogue of feature 111 holds`,
    );
  }
  assert.equal(isPolicyEventType("x.something"), false);
});

test("T012: all ten reach the event port, in order", () => {
  const ports = testPorts();
  const options = { redact: fakeRedact };
  quotaSignal(
    ports.eventWriter,
    {
      class: "quota_window",
      confidence: "structured",
      rateLimitType: "requests",
      utilization: 0.9,
      resetsAt: "2026-01-01T05:00:00.000Z",
      resetsAtSource: "structured",
      status: "429",
    },
    options,
  );
  harnessError(ports.eventWriter, { class: "provider_other", retryable: true }, options);
  let pair = PAIR_CLOSED;
  pair = runPaused(ports.eventWriter, pair, { class: "quota_window" }, options).pair;
  pair = runResumed(ports.eventWriter, pair, { pausedMs: 18_000_000 }, options).pair;
  alert(
    ports.eventWriter,
    {
      kind: "budget-threshold",
      level: "loud",
      role: "proposer",
      threshold: 90,
      value: 9,
      limit: 10,
    },
    options,
  );
  budgetExceeded(ports.eventWriter, { dimension: "costUsd", limit: 10, used: 12 }, options);
  fallbackSwitched(ports.eventWriter, { from: "a", to: "b", reason: "quota_window" }, options);
  fallbackRestored(ports.eventWriter, { from: "b", to: "a" }, options);
  fallbackSkipped(
    ports.eventWriter,
    {
      entry: 2,
      entryHarness: "codex",
      entryProvider: "openai",
      authTier: "2",
      audience: "operator",
      reason: "no-cap",
    },
    options,
  );
  blocked(
    ports.eventWriter,
    { reason: "budget-cap", needs: "raise the cap and run resume" },
    options,
  );

  assert.deepEqual([...ports.eventWriter.types()], [...POLICY_EVENT_TYPES]);
  assert.equal(pair.open, false);
});

test("T012: the free-text fields are redacted and cut", () => {
  const ports = testPorts();
  const long = `limit reached with key sk-ABCDEF1234567890 ${"x".repeat(2000)}`;
  quotaSignal(
    ports.eventWriter,
    {
      class: "quota_window",
      confidence: "text",
      rateLimitType: null,
      utilization: null,
      resetsAt: null,
      resetsAtSource: null,
      status: "429",
      evidence: long,
    },
    { redact: fakeRedact },
  );
  const evidence = ports.eventWriter.of("quota.signal")[0].payload.evidence as string;
  assert.ok(!evidence.includes("sk-ABCDEF1234567890"), "redacted");
  assert.match(evidence, /\[REDACTED\]/);
  assert.ok(evidence.length <= FREE_TEXT_CAP_BYTES, `cut to ${FREE_TEXT_CAP_BYTES}`);
});

test("T012: with no redactor, a free-text field is dropped and never carried in the clear", () => {
  const ports = testPorts();
  blocked(ports.eventWriter, { reason: "auth", needs: "repair the login for sk-SECRET" });
  const needs = ports.eventWriter.of("blocked")[0].payload.needs as string;
  assert.equal(needs, "[dropped: redactor-unavailable]", "fails closed (F100-FR-205)");
  assert.ok(!needs.includes("sk-SECRET"));
});

test("T012: a typed field is never sent through the redactor", () => {
  const payload = preparePayload(
    "alert",
    {
      kind: "budget-threshold",
      level: "loud",
      role: "proposer",
      threshold: 90,
      value: 9.5,
      limit: 10,
    },
    { redact: () => ({ text: "MANGLED", replacements: 0, patternSetVersion: "t" }) },
  );
  assert.equal(payload.threshold, 90, "a number stays a number");
  assert.equal(payload.value, 9.5);
  assert.equal(payload.level, "loud");
  assert.equal(payload.role, "proposer");
  // And the one free-text field of `alert` is the one that is redacted.
  assert.deepEqual([...FREE_TEXT_FIELDS.alert], ["message"]);
});

test("T012: an event of this feature carries no content", () => {
  const ports = testPorts();
  for (const forbidden of NO_CONTENT) {
    assert.throws(
      () =>
        emit(ports.eventWriter, "harness.error", {
          class: "x",
          retryable: true,
          [forbidden]: "a reply",
        }),
      (error: unknown) =>
        error instanceof PolicyEventError && /no content/.test((error as Error).message),
      forbidden,
    );
  }
  assert.equal(ports.eventWriter.events.length, 0, "and nothing reached the port");
});

test("T012: `run.paused` and `run.resumed` open and close a pair", () => {
  const ports = testPorts();
  let pair = PAIR_CLOSED;
  // A `run.resumed` with no pause open is refused.
  assert.throws(
    () => runResumed(ports.eventWriter, pair, { pausedMs: 1 }),
    (error: unknown) =>
      error instanceof PolicyEventError && /no pair/.test((error as Error).message),
  );
  pair = runPaused(ports.eventWriter, pair, { class: "quota_window" }).pair;
  assert.equal(pair.open, true);
  // A second `run.paused` while one is open is refused.
  assert.throws(
    () => runPaused(ports.eventWriter, pair, { class: "quota_window" }),
    (error: unknown) =>
      error instanceof PolicyEventError && /already open/.test((error as Error).message),
  );
  pair = runResumed(ports.eventWriter, pair, { pausedMs: 5 }).pair;
  assert.equal(pair.open, false);
  assert.deepEqual([...ports.eventWriter.types()], ["run.paused", "run.resumed"]);
});

test("T012: the findings of a stream say which pair did not close", () => {
  assert.deepEqual([...pairFindings(["run.paused", "run.resumed"])], []);
  assert.deepEqual([...pairFindings(["alert", "run.paused", "quota.signal", "run.resumed"])], []);
  assert.match(pairFindings(["run.paused"])[0], /no `run\.resumed` closed/);
  assert.match(pairFindings(["run.resumed"])[0], /with no `run\.paused` open/);
  assert.match(pairFindings(["run.paused", "run.paused"])[0], /a second `run\.paused`/);
});

test("T012: `emit` refuses a type outside the ten", () => {
  const ports = testPorts();
  assert.throws(
    () => emit(ports.eventWriter, "host.quota_observed" as never, {}),
    (error: unknown) =>
      error instanceof PolicyEventError && /F127-FR-040/.test((error as Error).message),
  );
});

test("T012: `redactField` handles an absent, an empty and a throwing case", () => {
  assert.equal(redactField(null, {}), null);
  assert.equal(redactField(undefined, {}), null);
  assert.equal(redactField("", {}), null);
  assert.equal(
    redactField("text", {
      redact: () => ({
        text: "",
        replacements: 0,
        patternSetVersion: "t",
        dropped: true,
        reason: "pattern-set-invalid: x",
      }),
    }),
    "[dropped: pattern-set-invalid: x]",
  );
  assert.match(
    redactField("text", {
      redact: () => {
        throw new Error("boom");
      },
    }) ?? "",
    /^\[dropped: redactor-unavailable/,
  );
});

test("T012: a classification and a ceiling reading flow straight into their events", () => {
  const ports = testPorts();
  const classification = classify(
    {
      structuredClass: "quota_window",
      errorText: "weekly limit, key sk-X1",
      resetsAt: { header: "2026-01-01T05:00:00.000Z" },
    },
    { redact: fakeRedact },
  );
  quotaSignal(
    ports.eventWriter,
    {
      class: classification.quotaClass,
      confidence: classification.confidence,
      rateLimitType: classification.rateLimitType,
      utilization: classification.utilization,
      resetsAt: classification.resetsAt,
      resetsAtSource: classification.resetsAtSource,
      status: "none",
      evidence: classification.evidence,
      ruleId: classification.ruleId,
      tableVersion: classification.tableVersion,
    },
    { redact: fakeRedact },
  );
  const signal = ports.eventWriter.of("quota.signal")[0].payload;
  assert.equal(signal.class, "quota_window");
  assert.equal(signal.resetsAtSource, "header");
  assert.equal(signal.ruleId, "Q-01-quota_window");
  assert.ok(!String(signal.evidence).includes("sk-X1"));

  const ledger = applyUsageRecord(emptyLedger("r"), {
    usageId: "a",
    role: "proposer",
    billingMode: "api",
    costUsd: 12,
  }).ledger;
  const reading = readCeiling({ scope: "run", dimension: "costUsd", limit: 10 }, { ledger });
  budgetExceeded(ports.eventWriter, budgetExceededPayload(reading) as never, {
    redact: fakeRedact,
  });
  const exceeded = ports.eventWriter.of("budget.exceeded")[0].payload;
  assert.equal(exceeded.dimension, "costUsd");
  assert.equal(exceeded.limit, 10);
  assert.equal(exceeded.used, 12);
  assert.equal(exceeded.resumable, true);
});

test("T012 (checkpoint): emitting reads no clock and writes no file", () => {
  const ports = testPorts();
  const before = ports.clock.nowMs();
  for (let i = 0; i < 200; i += 1) {
    harnessError(
      ports.eventWriter,
      { class: "provider_other", retryable: true },
      { redact: fakeRedact },
    );
  }
  assert.equal(ports.clock.nowMs(), before, "the envelope's `ts` belongs to feature 111");
  assert.equal(ports.fileWriter.writes.length, 0, "and the file to its writer");
  assert.equal(ports.eventWriter.countOf("harness.error"), 200);
});
