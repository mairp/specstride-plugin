// CT-125-22 (T055) — the quota classifier (F125-FR-031): every row of
// contracts/classifier-table.md, with `retryable`, on recorded streams
// written from the documented shapes; overload is never quota; a text
// reset time is null. The case on the captured limit event of T003 is a
// skip with the reason "capture C absent" until the fixture exists, and
// this test does NOT wait for T003 (the capture is paid and out-of-band).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  classifierTable,
  classify,
  classifyDirect,
  classIsRetryable,
  textPatterns,
} from "../../src/classify.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

/** Recorded streams written from the documented shapes of the contract. */
const RECORDED_STREAMS: readonly {
  readonly name: string;
  readonly event: Parameters<typeof classify>[0];
}[] = [
  {
    name: "row 1 — limit event, status rejected",
    event: { kind: "limit_event", status: "rejected", resetsAt: "2026-10-27T12:00:00Z" },
  },
  {
    name: "row 2 — limit event, allowed_warning",
    event: { kind: "limit_event", status: "allowed_warning", utilization: 0.62 },
  },
  {
    name: "row 3 — limit event, credits_required",
    event: { kind: "limit_event", status: "rejected", code: "credits_required" },
  },
  {
    name: "row 4 — retry event, rate_limit",
    event: { kind: "retry_event", category: "rate_limit" },
  },
  {
    name: "row 5 — retry event, overloaded",
    event: { kind: "retry_event", category: "overloaded", status: 529 },
  },
  {
    name: "row 5 — error, overloaded",
    event: { kind: "error", category: "overloaded", status: 529 },
  },
  {
    name: "row 6 — retry event, billing_error",
    event: { kind: "retry_event", category: "billing_error" },
  },
  {
    name: "row 7 — error, authentication_failed",
    event: { kind: "error", category: "authentication_failed" },
  },
  {
    name: "row 8 — error, server_error",
    event: { kind: "error", category: "server_error", status: 500 },
  },
  {
    name: "row 9 — result, error_max_budget_usd",
    event: { kind: "result", subtype: "error_max_budget_usd" },
  },
  {
    name: "row 10 — result, error_max_turns",
    event: { kind: "result", subtype: "error_max_turns" },
  },
  {
    name: "row 11 — result text, session limit",
    event: {
      kind: "result",
      text: "Claude usage limit reached: session limit reached, resets 3pm",
    },
  },
  {
    name: "row 11 — result text, Opus limit",
    event: { kind: "result", text: "Opus limit reached. Reply /model to pick another." },
  },
  {
    name: "row 12 — result text, credit balance",
    event: { kind: "result", text: "Credit balance is too low to continue." },
  },
  { name: "row 13 — result text, 429", event: { kind: "result", text: "Request rejected (429)" } },
  {
    name: "row 14 — result text, temporarily limiting",
    event: {
      kind: "result",
      text: "Server is temporarily limiting requests (not your usage limit).",
    },
  },
  {
    name: "row 15 — result text, prompt too long",
    event: { kind: "result", text: "Prompt is too long: 240000 tokens > 200000 maximum" },
  },
  { name: "row 16 — exit 143", event: { kind: "exit", exitCode: 143 } },
  { name: "row 17 — other non-zero exit", event: { kind: "exit", exitCode: 1 } },
  {
    name: "row 17 — stream without a terminal record",
    event: { kind: "stream", noTerminalRecord: true },
  },
  { name: "row 18 — anything else", event: { kind: "error" } },
];

describe("CT-125-22 — the classifier table on recorded streams (F125-FR-031)", () => {
  it("every row of the table has a recorded stream and its class", () => {
    assert.equal(RECORDED_STREAMS.length >= 20, true);
    for (const { name, event } of RECORDED_STREAMS) {
      const outcome = classify(event);
      assert.equal(typeof outcome.row, "number", name);
      // A classification is either a class with its confidence and its
      // retryable value, or a stated non-class (rows 2 and 16).
      if (outcome.class !== null) {
        assert.equal(typeof classifierTable.retryableByClass[outcome.class], "boolean", name);
        assert.equal(outcome.confidence !== null, true, name);
      } else {
        assert.ok(
          [2, 16].includes(outcome.row),
          `${name}: a null class is rows 2 or 16, got ${outcome.row}`,
        );
      }
    }
  });

  it("row 1 — a rejected limit event is quota_window, structured, retryable, with the event's reset", () => {
    const outcome = classify({
      kind: "limit_event",
      status: "rejected",
      resetsAt: "2026-10-27T12:00:00Z",
    });
    assert.deepEqual(
      [outcome.class, outcome.confidence, outcome.retryable, outcome.resetsAt, outcome.portFailure],
      ["quota_window", "structured", true, "2026-10-27T12:00:00Z", "quota_exhausted"],
    );
  });

  it("row 2 — an allowed_warning limit event is an observe gauge, never a class", () => {
    const outcome = classify({ kind: "limit_event", status: "allowed_warning", utilization: 0.62 });
    assert.equal(outcome.class, null);
    assert.deepEqual(outcome.gauge, { type: "observe", field: "utilization", value: 0.62 });
    assert.equal(outcome.portFailure, null);
  });

  it("rows 3 to 8 — the structured retry and error categories carry their class and port failure", () => {
    assert.deepEqual(
      classify({ kind: "limit_event", status: "rejected", code: "credits_required" }).class,
      "quota_credit",
    );
    assert.equal(
      classify({ kind: "retry_event", category: "rate_limit" }).portFailure,
      "rate_limited",
    );
    assert.equal(
      classify({ kind: "error", category: "overloaded", status: 529 }).class,
      "overload",
    );
    assert.equal(
      classify({ kind: "retry_event", category: "billing_error" }).class,
      "quota_credit",
    );
    assert.equal(classify({ kind: "error", category: "authentication_failed" }).class, "auth");
    assert.equal(classify({ kind: "error", category: "server_error" }).class, "provider_other");
  });

  it("rows 9 and 10 — the final-record subtypes are budget_cap and agent_failure", () => {
    assert.equal(classify({ kind: "result", subtype: "error_max_budget_usd" }).class, "budget_cap");
    assert.equal(classify({ kind: "result", subtype: "error_max_budget_usd" }).retryable, false);
    assert.equal(classify({ kind: "result", subtype: "error_max_turns" }).class, "agent_failure");
    assert.equal(classify({ kind: "result", subtype: "error_max_turns" }).retryable, true);
  });

  it("rows 11 to 15 — the text fallback keeps its class, and a text reset time is null", () => {
    const cases: readonly [string, string, string | null, boolean][] = [
      ["session limit", "quota_window", null, true],
      ["Credit balance is too low", "quota_credit", null, false],
      ["Request rejected (429)", "rate_limit_transient", null, true],
      [
        "Server is temporarily limiting requests (not your usage limit)",
        "rate_limit_transient",
        null,
        true,
      ],
      ["Prompt is too long", "context_window", null, false],
    ];
    for (const [text, cls, resetsAt, retryable] of cases) {
      const outcome = classify({ kind: "result", text });
      assert.equal(outcome.class, cls, text);
      assert.equal(outcome.confidence, "text", text);
      assert.equal(outcome.resetsAt, resetsAt, text);
      assert.equal(outcome.retryable, retryable, text);
    }
  });

  it("overload is never quota", () => {
    const outcomes = [
      classify({ kind: "retry_event", category: "overloaded", status: 529 }),
      classify({ kind: "error", category: "overloaded", status: 529 }),
      classifyDirect({ kind: "status", status: 529 }),
    ];
    for (const outcome of outcomes) {
      assert.equal(outcome.class, "overload");
      assert.notEqual(outcome.class, "quota_window");
      assert.notEqual(outcome.class, "quota_credit");
      assert.equal(outcome.retryable, true);
    }
    // The table itself never marks overload as a quota class.
    assert.equal(classifierTable.retryableByClass["overload"], true);
  });

  it("rows 16 to 18 — the stops and the fallback", () => {
    const polite = classify({ kind: "exit", exitCode: 143 });
    assert.equal(polite.class, null); // a stop the caller asked for
    const other = classify({ kind: "exit", exitCode: 1 });
    assert.deepEqual(
      [other.class, other.confidence, other.retryable],
      ["agent_failure", "status", true],
    );
    const empty = classify({ kind: "stream", noTerminalRecord: true });
    assert.equal(empty.class, "agent_failure");
    const unknown = classify({ kind: "error" });
    assert.deepEqual(
      [unknown.class, unknown.confidence, unknown.retryable, unknown.portFailure],
      ["provider_other", "text", true, "agent_failure"],
    );
  });

  it("retryable is a value of the class, not of the row", () => {
    const expected: Record<string, boolean> = {
      quota_window: true,
      rate_limit_transient: true,
      overload: true,
      agent_failure: true,
      provider_other: true,
      quota_credit: false,
      auth: false,
      context_window: false,
      budget_cap: false,
    };
    for (const [cls, retryable] of Object.entries(expected)) {
      assert.equal(classIsRetryable(cls as never), retryable, cls);
      assert.equal(classifierTable.retryableByClass[cls], retryable, cls);
    }
  });

  it("the direct-call table of the contract classifies by status", () => {
    assert.equal(classifyDirect({ kind: "status", status: 401 }).class, "auth");
    assert.equal(classifyDirect({ kind: "status", status: 403 }).retryable, false);
    assert.equal(classifyDirect({ kind: "status", status: 402 }).class, "quota_credit");
    assert.equal(
      classifyDirect({ kind: "status", status: 400, bodyNamesTooLongPrompt: true }).class,
      "context_window",
    );
    assert.equal(classifyDirect({ kind: "status", status: 418 }).class, "provider_other");
    const tooFast = classifyDirect({ kind: "status", status: 429, retryAfter: "12" });
    assert.equal(tooFast.class, "rate_limit_transient");
    assert.equal(tooFast.resetsAt, "12");
    const noReset = classifyDirect({ kind: "status", status: 429 });
    assert.equal(noReset.resetsAt, null);
    assert.equal(classifyDirect({ kind: "status", noReply: true }).class, null); // transport_failed
  });

  it("the text patterns of rows 11 to 15 are data in the table", () => {
    const patterns = textPatterns().flatMap((row) => row.patterns);
    for (const text of [
      "session limit",
      "weekly limit",
      "Opus limit",
      "Sonnet limit",
      "Credit balance is too low",
      "Request rejected (429)",
      "Prompt is too long",
    ]) {
      assert.ok(patterns.includes(text), text);
    }
  });

  it("the captured limit event of T003 is a skip with the reason 'capture C absent' until the fixture exists (and the test does not wait for it)", () => {
    const raw = JSON.parse(readFileSync(path.join(FIXTURES, "limit-event.json"), "utf8")) as {
      status?: string;
      recordedEvents?: number;
    };
    if (raw.status === "recorded" && (raw.recordedEvents ?? 0) > 0) {
      // The operator has run the paid capture; the recorded stream is
      // replayed against the table. This branch stays unexercised until
      // then and the test NEVER waits for the capture.
      const stream = readFileSync(path.join(FIXTURES, "limit-event.ndjson"), "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line));
      for (const event of stream) {
        const outcome = classify(event as Parameters<typeof classify>[0]);
        assert.equal(typeof outcome.row, "number");
      }
      return;
    }
    assert.equal(raw.status, "unverified");
    assert.equal(raw.recordedEvents, 0, "capture C absent: the fixture holds no recorded event");
  });
});
