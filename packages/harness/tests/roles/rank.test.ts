/**
 * T025 — CT-124-40 (F124-FR-040): the ranking table.
 *
 * Candidates of both forms of the `completion` level; every tool-less
 * candidate stands before every candidate with read-only tools; each of the
 * six keys decides once; the decision carries its rule id and the version
 * of the table.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  compareCandidates,
  decidingRuleId,
  RANKING_RULE_IDS,
  RANKING_TABLE_ID,
  RANKING_TABLE_VERSION,
  rankCandidates,
  type RankingSignal,
} from "../../src/roles/rank.ts";

function signal(overrides: Partial<RankingSignal> & { readonly harness: string }): RankingSignal {
  return {
    form: "tool-less",
    state: "tested",
    costClass: "subscription",
    limitSignalSeen: false,
    windowTokens: 128000,
    modelId: "model-a",
    ...overrides,
  };
}

test("CT-124-40 the data holds the six keys in order", () => {
  assert.deepEqual(RANKING_RULE_IDS, [
    "R1-form",
    "R2-state",
    "R3-cost",
    "R4-quota",
    "R5-window",
    "R6-id",
  ]);
  assert.equal(RANKING_TABLE_ID, "critic-ranking");
  assert.equal(RANKING_TABLE_VERSION, "1");
});

test("CT-124-40 every tool-less candidate stands before every candidate with read-only tools", () => {
  const mixed = [
    signal({ harness: "read-only-a", form: "read-only-tools" }),
    signal({ harness: "tool-less-z", form: "tool-less" }),
    signal({ harness: "read-only-b", form: "read-only-tools", state: "tested" }),
    signal({ harness: "tool-less-a", form: "tool-less" }),
  ];
  const { order } = rankCandidates(mixed);
  const firstReadOnly = order.findIndex((entry) => entry.form === "read-only-tools");
  const lastToolLess = order.map((entry) => entry.form).lastIndexOf("tool-less");
  assert.ok(
    lastToolLess < firstReadOnly,
    `the order is ${order.map((entry) => entry.harness).join(", ")}`,
  );
});

test("CT-124-40 each of the six keys decides once", () => {
  const decided = (
    a: RankingSignal,
    b: RankingSignal,
    ruleId: string,
    choice: "first" | "second",
  ) => {
    const decision = compareCandidates(a, b);
    assert.equal(decision.ruleId, ruleId, `${ruleId}: the rule id that fired`);
    assert.equal(decision.choice, choice);
    assert.equal(decision.tableId, RANKING_TABLE_ID);
    assert.equal(decision.tableVersion, RANKING_TABLE_VERSION);
    assert.equal(decidingRuleId(decision), ruleId);
  };

  // R1 — form, tool-less first.
  decided(
    signal({ harness: "a", form: "tool-less" }),
    signal({ harness: "b", form: "read-only-tools" }),
    "R1-form",
    "first",
  );
  // R2 — state, in the order of the data.
  decided(
    signal({ harness: "a", state: "tested" }),
    signal({ harness: "b", state: "declared" }),
    "R2-state",
    "first",
  );
  // R3 — cost class, local and subscription before metered.
  decided(
    signal({ harness: "a", costClass: "local" }),
    signal({ harness: "b", costClass: "metered" }),
    "R3-cost",
    "first",
  );
  // R3 within `metered` — the rising price of output.
  decided(
    signal({ harness: "a", costClass: "metered", outputPriceUsd: 1 }),
    signal({ harness: "b", costClass: "metered", outputPriceUsd: 3 }),
    "R3-cost",
    "first",
  );
  // R4 — no limit signal seen before one seen.
  decided(
    signal({ harness: "a", limitSignalSeen: false }),
    signal({ harness: "b", limitSignalSeen: true }),
    "R4-quota",
    "first",
  );
  // R5 — larger window first.
  decided(
    signal({ harness: "a", windowTokens: 200000 }),
    signal({ harness: "b", windowTokens: 32000 }),
    "R5-window",
    "first",
  );
  // R6 — harness id, then model id, in byte order.
  decided(
    signal({ harness: "a", modelId: "m2" }),
    signal({ harness: "b", modelId: "m1" }),
    "R6-id",
    "first",
  );
  decided(
    signal({ harness: "same", modelId: "m1" }),
    signal({ harness: "same", modelId: "m2" }),
    "R6-id",
    "first",
  );
});

test("CT-124-40 a pair no key decides keeps the order of the registry", () => {
  const a = signal({ harness: "same", modelId: "m" });
  const b = signal({ harness: "same", modelId: "m" });
  const decision = compareCandidates(a, b);
  assert.equal(decision.ruleId, "R0-equal");
  assert.equal(decision.choice, "keep the order of the registry");
});

test("CT-124-40 candidates of both forms rank with the tool-less one first, with the deciding rule recorded", () => {
  const { order, decisions } = rankCandidates([
    signal({ harness: "z-read-only", form: "read-only-tools" }),
    signal({ harness: "a-tool-less", form: "tool-less", state: "declared" }),
  ]);
  assert.deepEqual(
    order.map((entry) => entry.harness),
    ["a-tool-less", "z-read-only"],
  );
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0]!.ruleId, "R1-form");
  assert.equal(decisions[0]!.tableVersion, RANKING_TABLE_VERSION);
});
