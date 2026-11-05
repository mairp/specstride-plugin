// CT-125-23 (T056) — usage (F125-FR-032): the increment per model call as
// it completes, the delta of a continued session, a killed pass, the
// notional label, null for an unknown figure (never zero for an unknown).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  finalRecordUsage,
  killedPassIncrement,
  messagesCallUsage,
  notionalLabel,
  totalTokens,
  usageIncrement,
} from "../../src/usage.ts";

describe("CT-125-23 — usage increments and the notional label (F125-FR-032)", () => {
  it("an assistant record's per-call usage is one increment as the call completes", () => {
    const increment = usageIncrement({
      sessionId: "s-1",
      model: "claude-sonnet-4-5",
      usage: { input: 1200, output: 340, cacheRead: 800, cacheCreate: 40 },
      authTier: 2,
    });
    assert.equal(increment.complete, true);
    assert.deepEqual(
      [increment.input, increment.output, increment.cacheRead, increment.cacheCreate],
      [1200, 340, 800, 40],
    );
  });

  it("the final record's per-model breakdown is preferred to the top-level usage", () => {
    const increment = finalRecordUsage({
      sessionId: "s-1",
      authTier: 2,
      breakdown: { input: 5000, output: 900, cacheRead: 100, cacheCreate: 0 },
      topLevelUsage: { input: 4200, output: 700, cacheRead: 0, cacheCreate: 0 },
      totalCostUsd: 0.042,
    });
    assert.deepEqual([increment.input, increment.output], [5000, 900]);
    assert.equal(increment.costEstimate, 0.042);
  });

  it("the delta of a continued session: the cumulative cost is differenced per session id", () => {
    const first = finalRecordUsage({
      sessionId: "s-continue",
      authTier: 2,
      breakdown: { input: 1000, output: 100 },
      totalCostUsd: 0.03,
    });
    assert.equal(first.costEstimate, 0.03);
    const second = finalRecordUsage({
      sessionId: "s-continue",
      authTier: 2,
      breakdown: { input: 2000, output: 200 },
      totalCostUsd: 0.09,
      cumulativeBefore: first.costEstimate === null ? null : 0.03,
    });
    assert.equal(second.costEstimate, 0.06);
  });

  it("a killed pass records no cost and is not complete", () => {
    const increment = killedPassIncrement({
      sessionId: "s-killed",
      model: "claude-sonnet-4-5",
      usage: { input: 300, output: 20 },
      authTier: 2,
    });
    assert.equal(increment.complete, false);
    assert.equal(increment.costEstimate, null);
    assert.deepEqual([increment.input, increment.output], [300, 20]);
    // Nothing at all seen: every figure stays null, never zero.
    const empty = killedPassIncrement({ sessionId: "s-killed", usage: null, authTier: 1 });
    assert.deepEqual(
      [empty.input, empty.output, empty.cacheRead, empty.cacheCreate, empty.costEstimate],
      [null, null, null, null, null],
    );
  });

  it("the cost at auth tier 1 is notional, with a label", () => {
    const increment = usageIncrement({
      sessionId: "s-1",
      usage: { input: 10, output: 5 },
      authTier: 1,
      costEstimate: 0.01,
    });
    assert.equal(increment.notional, true);
    assert.equal(increment.notionalReason, "auth-tier-1");
    assert.equal(notionalLabel(increment), "notional (auth-tier-1)");
    const paid = usageIncrement({
      sessionId: "s-2",
      usage: { input: 10, output: 5 },
      authTier: 2,
      costEstimate: 0.01,
    });
    assert.equal(paid.notional, false);
    assert.equal(notionalLabel(paid), null);
  });

  it("null for an unknown figure, never zero", () => {
    const increment = usageIncrement({
      sessionId: "s-1",
      usage: { input: 100, output: null, cacheRead: undefined, cacheCreate: Number.NaN },
      authTier: 2,
    });
    assert.equal(increment.input, 100);
    assert.deepEqual(
      [increment.output, increment.cacheRead, increment.cacheCreate],
      [null, null, null],
    );
    // A missing cost is null too, not 0.
    const noCost = finalRecordUsage({ sessionId: "s-1", authTier: 2, totalCostUsd: null });
    assert.equal(noCost.costEstimate, null);
  });

  it("a messages call reports tokens and no cost", () => {
    const increment = messagesCallUsage({
      sessionId: "s-1",
      model: "claude-sonnet-4-5",
      usage: { input: 42, output: 7, cacheRead: 3, cacheCreate: 0 },
    });
    assert.deepEqual(
      [increment.input, increment.output, increment.cacheRead, increment.cacheCreate],
      [42, 7, 3, 0],
    );
    assert.equal(increment.costEstimate, null);
  });

  it("session totals are null-aware: an all-unknown field sums to null, not 0", () => {
    const increments = [
      usageIncrement({ sessionId: "s", usage: { input: 100 }, authTier: 1 }),
      usageIncrement({ sessionId: "s", usage: { input: 50, output: null }, authTier: 1 }),
    ];
    assert.equal(totalTokens(increments, "input"), 150);
    assert.equal(totalTokens(increments, "output"), null);
  });
});
