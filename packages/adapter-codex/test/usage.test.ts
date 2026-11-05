/**
 * T054 / CT-131-35 — usage per turn (F131-FR-035).
 *
 * The usage comes from the record that completes a turn: input, cached input
 * and output tokens, as increments. A value the record does not carry is
 * null, never zero. A killed pass keeps the usage of the turns that
 * completed, and the turn in flight is unknown. The usage of a call of form
 * (b) comes from the usage field of the reply where there is one, and is
 * otherwise null. The cost is null unless it is computed from prices with a
 * date in the descriptor; a cost under a login is labelled `notional`, under
 * an API key `metered`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { UsageReportedEvent } from "../../harness/src/stream/usage.ts";
import { loadStreamMapping } from "../src/mapping.ts";
import { computeCost, usageOfDirectReply, usageOfStream } from "../src/usage.ts";

const MAPPING = loadStreamMapping();

/** Two completed turns, then a third turn in flight that never completes. */
const THREE_TURNS = [
  JSON.stringify({ type: "thread.started", thread_id: "s-usage-1" }),
  JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 11, cached_input_tokens: 4, output_tokens: 3 },
  }),
  JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 7, cached_input_tokens: 0, output_tokens: 5 },
  }),
  JSON.stringify({ type: "turn.started" }),
  JSON.stringify({
    type: "item.completed",
    item: { id: "item_2", type: "agent_message", text: "…" },
  }),
];

function reported(events: readonly { type: string }[]): UsageReportedEvent[] {
  return events.filter((event): event is UsageReportedEvent => event.type === "usage.reported");
}

test("CT-131-35: usage is reported per turn, as increments", () => {
  const { events, facts } = usageOfStream(THREE_TURNS, { mapping: MAPPING });
  const perTurn = reported(events);
  assert.equal(perTurn.length, 2);
  assert.deepEqual(
    perTurn.map((event) => [event.inputTokens, event.cacheReadTokens, event.outputTokens]),
    [
      [11, 4, 3],
      [7, 0, 5],
    ],
  );
  assert.equal(facts.reportedCalls, 2);
  assert.equal(facts.totalInputTokens, 18);
  assert.equal(facts.totalOutputTokens, 8);
});

test("CT-131-35: a value the record does not carry is null, never zero", () => {
  const { events, facts } = usageOfStream(
    [
      JSON.stringify({ type: "thread.started", thread_id: "s-usage-2" }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 5 } }),
    ],
    { mapping: MAPPING },
  );
  const [event] = reported(events);
  assert.equal(event.inputTokens, 5);
  assert.equal(event.outputTokens, null);
  assert.equal(event.cacheReadTokens, null);
  assert.notEqual(event.outputTokens, 0);
  assert.notEqual(event.cacheReadTokens, 0);
  assert.equal(facts.totalOutputTokens, null);
});

test("CT-131-35: a killed pass keeps the completed turns; the turn in flight is unknown", () => {
  const { events, facts } = usageOfStream(THREE_TURNS, {
    mapping: MAPPING,
    killed: true,
  });
  // The two completed turns are kept.
  assert.equal(reported(events).length, 2);
  const unavailable = events.find((event) => event.type === "usage.unavailable");
  assert.ok(unavailable !== undefined && unavailable.type === "usage.unavailable");
  assert.equal(unavailable.reason, "killed");
  // The last usage kept is the second completed turn, never the third.
  assert.ok(unavailable.lastUsage !== null);
  assert.equal(unavailable.lastUsage.inputTokens, 7);
  assert.equal(unavailable.lastUsage.outputTokens, 5);
  // The turn in flight produced no usage record at all.
  assert.equal(
    reported(events).some((event) => event.inputTokens === null && event.outputTokens === null),
    false,
  );
  assert.equal(facts.usageComplete, false);
  assert.equal(facts.unavailableReason, "killed");
});

test("CT-131-35: the usage of form (b) comes from the reply's usage field, else null", () => {
  const withUsage = usageOfDirectReply(
    { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 40 } },
    2,
  );
  assert.equal(withUsage.inputTokens, 120);
  assert.equal(withUsage.outputTokens, 30);
  assert.equal(withUsage.cacheReadTokens, 40);
  const withoutUsage = usageOfDirectReply(undefined, 2);
  assert.equal(withoutUsage.inputTokens, null);
  assert.equal(withoutUsage.outputTokens, null);
  assert.equal(withoutUsage.cacheReadTokens, null);
  assert.notEqual(withoutUsage.inputTokens, 0);
});

test("CT-131-35: the cost is null unless computed from dated prices; notional under a login, metered under a key", () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 100_000 };
  // No prices: the cost is null.
  assert.deepEqual(computeCost(usage, null, 1), { cost: null, costBasis: "notional" });
  // Prices with a date, as the descriptor carries them (per million tokens).
  const prices = { currency: "USD", input: 1.25, output: 10, asOf: "2026-09-29" };
  assert.deepEqual(computeCost(usage, prices, 1), { cost: 2.25, costBasis: "notional" });
  assert.deepEqual(computeCost(usage, prices, 2), { cost: 2.25, costBasis: "metered" });
  // Under a login a cost is labelled notional, never measured.
  const login = usageOfStream(
    [
      JSON.stringify({ type: "thread.started", thread_id: "s-usage-4" }),
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    ],
    { mapping: MAPPING, subscription: true },
  );
  const [event] = reported(login.events);
  assert.equal(event.costBasis, "notional");
});
