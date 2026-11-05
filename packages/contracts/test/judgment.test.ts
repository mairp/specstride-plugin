/**
 * T197 — contract tests CT-100-292 for the judgment exchange (annex G, §G.9;
 * F100-FR-192), over the keys `judgmentExchange` and `judgmentSchema` of
 * `data/cli-protocol.json`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import cliProtocol from "../data/cli-protocol.json" with { type: "json" };
import {
  ANNEX_SECTION,
  ANSWERED_BY,
  ANSWER_IS_RECORDED_IN,
  A_DELEGATION_IS_RECORDED_IN_THE_DIGEST,
  BATCH_BYTE_CAP,
  BATCH_TOKEN_CAP,
  BUDGET_SUBJECT,
  BYTES_PER_TOKEN,
  CONTENT_OWNER,
  DELEGATION_IS_NAMED_IN,
  DELEGATION_LEVEL,
  ItemLargerThanTheCapError,
  POINT_ID,
  SCHEMA_ID,
  THE_HOST_OPENS_THE_LAUNCH_CONTRACT,
  THE_HOST_OPENS_THE_SOURCES,
  acceptAnswer,
  batchIsInsideTheCap,
  bytesOfItem,
  bytesOfItems,
  loadSteps,
  pageIntoBatches,
  steps,
  type JudgmentItem,
} from "../src/grammar/judgment.ts";

/** One item of the exchange, as step 1 of §G.9 forms it. */
function item(id: string, excerpt: string): JudgmentItem {
  return {
    id,
    source: { path: "specs/100-specstride/tasks.md", line: 42, anchor: `T${id}` },
    excerpt,
    choices: [
      { id: "mapped", label: "the obligation maps to a stage" },
      { id: "out-of-scope", label: "the obligation is out of scope" },
    ],
  };
}

test("CT-100-292: the three steps, the schema id and the cap of a batch (F100-FR-192)", () => {
  assert.equal(ANNEX_SECTION, "annex G, §G.9");
  assert.equal(SCHEMA_ID, "specstride.judgment/1");
  assert.equal(SCHEMA_ID, (cliProtocol as { judgmentSchema: string }).judgmentSchema);
  assert.equal(CONTENT_OWNER, "107");
  assert.equal(POINT_ID, "specstride.host/1");
  const raw = (cliProtocol as { judgmentExchange: unknown[] }).judgmentExchange;
  assert.equal(steps.length, raw.length);
  assert.equal(steps.length, 3);
  assert.deepEqual(loadSteps(), steps);
  assert.deepEqual(
    steps.map((s) => s.step),
    [1, 2, 3],
  );
  assert.equal(steps[0]?.actor, "CLI");
  assert.match(steps[0]?.act ?? "", /3,000 tokens/);
  assert.match(steps[1]?.actor ?? "", /Host model/);
  assert.match(steps[1]?.actor ?? "", /harness named in user configuration/);
  assert.equal(steps[2]?.actor, "CLI");
  assert.match(steps[2]?.act ?? "", /provenance/);

  // The cap, in tokens and in bytes at 2.8 bytes per token (§G.5).
  assert.equal(BATCH_TOKEN_CAP, 3000);
  assert.equal(BYTES_PER_TOKEN, 2.8);
  assert.equal(BATCH_BYTE_CAP, 8400);
  assert.equal(BUDGET_SUBJECT, "One batch of the judgment exchange");
});

test("CT-100-292: the CLI pages the items into batches of at most 3,000 tokens", () => {
  // Every item fits: one batch.
  const small = [item("1", "a short excerpt"), item("2", "another short excerpt")];
  const one = pageIntoBatches(small);
  assert.equal(one.length, 1);
  assert.equal(one[0]?.items.length, 2);
  assert.equal(one[0]?.bytes, bytesOfItems(small));
  assert.ok(batchIsInsideTheCap(one[0]!));

  // Items that together exceed the cap are paged: every batch stays inside it,
  // and the order of the items is kept.
  const big = Array.from({ length: 12 }, (_, i) => item(String(i + 1), "x".repeat(2000)));
  const many = pageIntoBatches(big);
  assert.ok(many.length > 1, "the items are paged");
  for (const batch of many) {
    assert.ok(batchIsInsideTheCap(batch), `${batch.id} holds ${batch.bytes} bytes`);
    assert.ok(batch.bytes <= BATCH_BYTE_CAP);
  }
  assert.deepEqual(
    many.flatMap((b) => b.items.map((i) => i.id)),
    big.map((i) => i.id),
    "the order of the items is kept",
  );

  // An item larger than the cap by itself is an error: no batch could hold it.
  assert.throws(
    () => pageIntoBatches([item("huge", "x".repeat(BATCH_BYTE_CAP + 1))]),
    (err: unknown) => {
      assert.ok(err instanceof ItemLargerThanTheCapError);
      assert.equal(err.itemId, "huge");
      assert.ok(err.bytes > BATCH_BYTE_CAP);
      return true;
    },
  );
  assert.ok(bytesOfItem(item("1", "abc")) > 0);
});

test("CT-100-292: an answer carries its provenance (§G.9, step 3)", () => {
  const batch = pageIntoBatches([item("1", "an excerpt")])[0]!;
  // The host model answers with one of the choices the item offers.
  assert.equal(
    acceptAnswer(batch, {
      itemId: "1",
      choiceId: "mapped",
      provenance: { answeredBy: "host-model" },
    }).ok,
    true,
  );
  // A host without a model delegates to a harness named in user configuration,
  // through the `completion` level; the harness is part of the provenance.
  assert.equal(
    acceptAnswer(batch, {
      itemId: "1",
      choiceId: "out-of-scope",
      provenance: { answeredBy: "harness", harness: "the-harness", level: "completion" },
    }).ok,
    true,
  );
  const withoutHarness = acceptAnswer(batch, {
    itemId: "1",
    choiceId: "mapped",
    provenance: { answeredBy: "harness" },
  });
  assert.equal(withoutHarness.ok, false);
  if (!withoutHarness.ok) assert.equal(withoutHarness.reason, "no-provenance");

  // An item the batch does not hold, and a choice the item did not offer.
  const unknownItem = acceptAnswer(batch, {
    itemId: "2",
    choiceId: "mapped",
    provenance: { answeredBy: "host-model" },
  });
  assert.equal(unknownItem.ok, false);
  if (!unknownItem.ok) assert.equal(unknownItem.reason, "unknown-item");
  const unknownChoice = acceptAnswer(batch, {
    itemId: "1",
    choiceId: "invented",
    provenance: { answeredBy: "host-model" },
  });
  assert.equal(unknownChoice.ok, false);
  if (!unknownChoice.ok) assert.equal(unknownChoice.reason, "choice-the-item-did-not-offer");

  assert.deepEqual([...ANSWERED_BY], ["host-model", "harness"]);
  assert.deepEqual([...ANSWER_IS_RECORDED_IN], ["the launch contract", "the digest"]);
  assert.equal(DELEGATION_LEVEL, "completion");
  assert.equal(DELEGATION_IS_NAMED_IN, "user configuration");
  assert.equal(A_DELEGATION_IS_RECORDED_IN_THE_DIGEST, true);
  // The host never needs to open the launch contract or the sources.
  assert.equal(THE_HOST_OPENS_THE_LAUNCH_CONTRACT, false);
  assert.equal(THE_HOST_OPENS_THE_SOURCES, false);
});
