/**
 * CT-127-4 (T014) — the characterization test of the FIELDS of a
 * classification and of the ORDER OF EVIDENCE (F127-FR-002).
 *
 * F127-FR-002 lists eight things every classification must carry, and then
 * fixes the order in which evidence is taken: a structured signal of the
 * stream, then a status, then a text pattern, then the stall watchdog — with
 * one extra rule, that a time read from text is used only where no structured
 * or header value exists.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  EVIDENCE_CAP_BYTES,
  REDACTOR_UNAVAILABLE,
  classify,
  resolveResetsAt,
  signalsOf,
} from "../src/quota/classify.ts";
import { testPorts } from "./support/index.ts";

/** A redactor that removes a key-looking token and cuts to the cap. */
const fakeRedact = (text: string, cap: number) => ({
  text: text.replace(/sk-[A-Za-z0-9]+/g, "[REDACTED]").slice(0, cap),
  replacements: 1,
  patternSetVersion: "test",
});

/** The eight things F127-FR-002 names, as the fields of this implementation. */
const FIELDS_OF_F127_FR_002 = Object.freeze([
  "quotaClass",
  "confidence",
  "resetsAt",
  "resetsAtSource",
  "retryable",
  "rateLimitType",
  "utilization",
  "evidence",
]);

test("CT-127-4: every classification carries the eight fields of F127-FR-002", () => {
  const result = classify(
    {
      structuredClass: "quota_window",
      resetsAt: { structured: "2026-01-01T05:00:00.000Z" },
      rateLimitType: "requests-per-window",
      utilization: 0.97,
      errorText: "session limit reached; key sk-ABC123",
    },
    { redact: fakeRedact },
  );
  for (const field of FIELDS_OF_F127_FR_002) {
    assert.ok(field in result, `a classification carries ${field} (F127-FR-002)`);
  }
  assert.equal(result.quotaClass, "quota_window");
  assert.equal(result.confidence, "structured");
  assert.equal(result.resetsAt, "2026-01-01T05:00:00.000Z");
  assert.equal(result.resetsAtSource, "structured");
  assert.equal(result.retryable, true);
  assert.equal(result.rateLimitType, "requests-per-window");
  assert.equal(result.utilization, 0.97);
  assert.equal(result.evidence, "session limit reached; key [REDACTED]");
  assert.equal(result.evidenceDropped, null);
  // And the two the requirement asks to record with every classification.
  assert.equal(result.ruleId, "Q-01-quota_window");
  assert.equal(result.tableVersion, "1");
});

test("CT-127-4: the rate-limit type and the utilization are null where the harness names none", () => {
  const result = classify({ status: { code: 429 } });
  assert.equal(result.rateLimitType, null, "null, not an empty string");
  assert.equal(result.utilization, null);
  assert.equal(
    classify({ utilization: Number.NaN }).utilization,
    null,
    "a figure that is not finite is no reading",
  );
});

test("CT-127-4: the evidence fragment has passed the redactor, and is dropped where none was handed in", () => {
  const dropped = classify({ errorText: "usage limit; key sk-SECRET" });
  assert.equal(dropped.evidence, null, "never the text in the clear (F100-FR-205)");
  assert.equal(dropped.evidenceDropped, REDACTOR_UNAVAILABLE);
  assert.ok(dropped.notes.some((note) => note.includes("no redactor")));

  const passed = classify({ errorText: "usage limit; key sk-SECRET" }, { redact: fakeRedact });
  assert.ok(passed.evidence !== null);
  assert.ok(!(passed.evidence as string).includes("sk-SECRET"), "the key is gone");

  const long = "a".repeat(EVIDENCE_CAP_BYTES + 500);
  const cut = classify({ errorText: long }, { redact: fakeRedact });
  assert.equal((cut.evidence as string).length, EVIDENCE_CAP_BYTES, "cut to the cap");
});

/* ---------------------------------------------------------------- *
 * The order of evidence of §Q.2.
 * ---------------------------------------------------------------- */

test("CT-127-4: the order of evidence is structured, status, text pattern, stall watchdog", () => {
  const everything = {
    structuredClass: "agent_failure",
    status: { code: 402 },
    errorText: "your session limit has been reached",
    stalled: true,
  } as const;

  // 1. A structured signal wins over all three.
  const structured = classify(everything);
  assert.equal(structured.quotaClass, "agent_failure");
  assert.equal(structured.confidence, "structured");

  // 2. With no structured signal, the status wins over the text and the stall.
  const { structuredClass: _s, ...noStructured } = everything;
  const status = classify(noStructured);
  assert.equal(status.quotaClass, "quota_credit", "402 is `quota_credit` (row Q-02)");
  assert.equal(status.confidence, "status");

  // 3. With neither, the text pattern wins over the stall watchdog.
  const { status: _st, ...textOnly } = noStructured;
  const text = classify(textOnly);
  assert.equal(text.quotaClass, "quota_window", "the group `window` (row Q-06)");
  assert.equal(text.confidence, "text");

  // 4. The stall watchdog is the last resort.
  const stall = classify({ stalled: true });
  assert.equal(stall.quotaClass, "quota_window", "row Q-11");
  assert.equal(stall.confidence, "stall");
});

test("CT-127-4: the signal vector is built in the order of §Q.2", () => {
  const signals = signalsOf({
    structuredClass: "overload",
    status: { code: 529 },
    errorText: "the server is busy",
    stalled: true,
  });
  assert.deepEqual(
    Object.keys(signals),
    ["structuredClass", "httpStatus", "textGroup", "stalled"],
    "the four signals, in the order of the evidence of §Q.2",
  );
  assert.equal(signals.structuredClass, "overload");
  assert.equal(signals.httpStatus, 529);
  assert.equal(signals.textGroup, "overload");
  assert.equal(signals.stalled, true);
});

test("CT-127-4: a time read from text is used only where no structured and no header value exists", () => {
  const all = resolveResetsAt({
    structured: "2026-01-01T05:00:00.000Z",
    header: "2026-01-01T06:00:00.000Z",
    parsedText: "2026-01-01T07:00:00.000Z",
  });
  assert.equal(all.resetsAt, "2026-01-01T05:00:00.000Z");
  assert.equal(all.resetsAtSource, "structured");

  const header = resolveResetsAt({
    header: "2026-01-01T06:00:00.000Z",
    parsedText: "2026-01-01T07:00:00.000Z",
  });
  assert.equal(header.resetsAt, "2026-01-01T06:00:00.000Z");
  assert.equal(header.resetsAtSource, "header", "a header beats a time read from a message");

  const parsed = resolveResetsAt({ parsedText: "2026-01-01T07:00:00.000Z" });
  assert.equal(parsed.resetsAt, "2026-01-01T07:00:00.000Z");
  assert.equal(parsed.resetsAtSource, "parsed_text", "the last resort of §Q.2");

  const none = resolveResetsAt(undefined);
  assert.equal(none.resetsAt, null);
  assert.equal(none.resetsAtSource, null);

  // The same through `classify`.
  const classified = classify({
    structuredClass: "quota_window",
    resetsAt: { header: "2026-01-01T06:00:00.000Z", parsedText: "2026-01-01T07:00:00.000Z" },
  });
  assert.equal(classified.resetsAtSource, "header");
});

test("CT-127-4 (checkpoint): the fields are computed with no clock and no I/O", () => {
  const ports = testPorts();
  const before = ports.clock.nowMs();
  classify({ errorText: "weekly limit reached" }, { redact: fakeRedact });
  assert.equal(ports.clock.nowMs(), before);
  assert.deepEqual(ports.fileWriter.writes, []);
  assert.deepEqual(ports.eventWriter.types(), []);
});
