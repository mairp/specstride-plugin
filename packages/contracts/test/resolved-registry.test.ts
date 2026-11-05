/**
 * T167 — contract tests CT-100-192, CT-100-193 and CT-100-194 for the resolved
 * registry and role plan (annex C, §C.6; F100-FR-092, F100-FR-093,
 * F100-FR-094): a valid sample passes, a different major is refused, an
 * unknown field follows the rule of the schema, every required field is
 * required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/resolved-registry.schema.json" with { type: "json" };
import harnessTables from "../data/harness-tables.json" with { type: "json" };
import closedSetsData from "../data/closed-sets.json" with { type: "json" };
import {
  ANNEX_SECTION,
  AUTOMATIC_PICK_RULES,
  CONTENT_OWNER,
  CRITIC_ORDER,
  CRITIC_ORDER_STEPS,
  ENGINE_WALKS_THE_PLAN,
  FORM_ORDER_WITHIN_THE_STEP,
  LOGICAL_NAME,
  PLAN_ENTRY_FACTS,
  REASONS_TO_RANK_AGAIN,
  RESOLUTION_AFTER_LAUNCH,
  ROLES_OF_WAVE_1,
  ROLES_UNDER_THE_SAME_RULES,
  ROLE_FACTS,
  SCHEMA_ID,
  STATE_ORDER_WITHIN_THE_STEP,
  STEP_WITH_DISCOVERED_HARNESSES,
  WRITTEN_AT,
  everyRoleIsResolved,
  isResolvedRegistry,
  isRoleEntry,
  mayBePickedAutomatically,
  ranksAgainOnResume,
  readResolvedRegistry,
  tryReadResolvedRegistry,
} from "../src/records/resolved-registry.ts";
import { RecordRefusedError } from "../src/records/validate.ts";
import { requiredOf, sampleOf, withNextMajor } from "./samples.ts";

/** A valid record: every field §C.6 requires. */
function validRecord(): Record<string, unknown> {
  return {
    schema: SCHEMA_ID,
    harnesses: [
      {
        id: "a-harness-1",
        state: "tested",
        origin: "adapter",
        version: "1.2.3",
        descriptorHash: "a-hash",
        resolvedPath: "/a/path/to/a-harness",
        capabilities: { contextWindow: { value: 200000, provenance: "verified" } },
        containmentCeiling: { level: "C2", provenance: "verified" },
        sources: { contextWindow: "capture" },
      },
    ],
    roles: [
      {
        id: "proposer",
        capabilityLevelRequired: "proposer",
        independenceConstraints: [],
        budgetKey: "budget.proposer",
      },
      {
        id: "critic",
        capabilityLevelRequired: "completion",
        independenceConstraints: ["different-provider-from:proposer"],
        budgetKey: "budget.critic",
      },
    ],
    plan: {
      "1": {
        proposer: [
          {
            harness: "a-harness-1",
            model: "a-model",
            modelTier: "high",
            authTier: 1,
            transport: "subprocess",
            form: "tool-less",
            containment: "C2",
            termsDecision: { decision: "allowed", row: "a-terms-row" },
          },
        ],
        critic: [
          {
            harness: "a-harness-1",
            model: "another-model",
            modelTier: "low",
            authTier: 1,
            transport: "subprocess",
            form: "read-only-tools",
            containment: "C2",
            termsDecision: { decision: "allowed", row: "a-terms-row" },
          },
        ],
      },
    },
    criticPick: {
      step: "configured",
      state: "tested",
      window: 200000,
      windowSource: "declared",
      reason: "the consumer configured it",
      diversityWarningRaised: false,
    },
    runnersUp: [{ harness: "another-harness", reason: "no known context window" }],
    announced: ["critic: a-harness-1 (another-model), tool-less, C2"],
  };
}

test("CT-100-192: a valid sample of the resolved registry passes (annex C, §C.6)", () => {
  assert.equal(SCHEMA_ID, "specstride.registry/1");
  assert.equal(LOGICAL_NAME, "run:<runId>:registry");
  assert.equal(ANNEX_SECTION, "annex C, §C.6");
  assert.equal(CONTENT_OWNER, "124");
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);

  const sample = validRecord();
  assert.ok(isResolvedRegistry(sample));
  const record = readResolvedRegistry(sample, LOGICAL_NAME);
  assert.deepEqual(record, sample);
  assert.equal(tryReadResolvedRegistry(sample, LOGICAL_NAME).ok, true);
  assert.ok(isResolvedRegistry(sampleOf(SCHEMA_ID)));
});

test("CT-100-192: a different major of the resolved registry is refused (F100-FR-049)", () => {
  const next = withNextMajor(SCHEMA_ID);
  assert.equal(next, "specstride.registry/2");
  assert.throws(
    () => readResolvedRegistry({ ...validRecord(), schema: next }, LOGICAL_NAME),
    (err: unknown) => {
      assert.ok(err instanceof RecordRefusedError);
      assert.equal(err.reason, "different-major");
      assert.equal(err.logicalName, LOGICAL_NAME);
      assert.match(err.message, /the major found is 2/);
      assert.match(err.message, /the major supported is 1/);
      return true;
    },
  );
  assert.equal(tryReadResolvedRegistry({ ...validRecord(), schema: next }, LOGICAL_NAME).ok, false);
});

test("CT-100-192: an unknown field follows the rule of the schema (annex C, §C.6)", () => {
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  const withExtra = { ...validRecord(), aFieldAWriterOfALaterMinorAdded: 1 };
  if (/refus/i.test(rule)) {
    assert.equal(isResolvedRegistry(withExtra), false, `the schema is closed: ${rule}`);
  } else {
    assert.ok(isResolvedRegistry(withExtra), `the reader ignores what it does not know: ${rule}`);
    assert.doesNotThrow(() => readResolvedRegistry(withExtra, LOGICAL_NAME));
  }
});

test("CT-100-192: every required field of the resolved registry is required", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.deepEqual(
    [...required],
    ["schema", "harnesses", "roles", "plan", "criticPick", "runnersUp", "announced"],
  );
  for (const field of required) {
    const without: Record<string, unknown> = validRecord();
    delete without[field];
    assert.equal(isResolvedRegistry(without), false, `${field} must be required`);
  }
  const properties = (
    schema as {
      properties: Record<string, { description?: string; "x-type-in-words"?: string }>;
    }
  ).properties;
  for (const field of required) {
    assert.notEqual(properties[field]?.description, undefined, `${field} has a meaning`);
    assert.notEqual(properties[field]?.["x-type-in-words"], undefined, `${field} has a type`);
  }
  // `runnersUp` may be empty, and the record still validates (§C.6).
  assert.ok(isResolvedRegistry({ ...validRecord(), runnersUp: [] }));
});

test("CT-100-192: the record is written at launch and is not ranked again (F100-FR-092)", () => {
  assert.equal(WRITTEN_AT, "launch");
  assert.equal(RESOLUTION_AFTER_LAUNCH, false);
  assert.equal(ENGINE_WALKS_THE_PLAN, true);
  // A resume or relaunch reads the record and does not rank again, unless the
  // consumer asks by flag or the stored pick no longer exists.
  assert.deepEqual([...REASONS_TO_RANK_AGAIN], ["flag", "stored-pick-gone"]);
  assert.deepEqual(ranksAgainOnResume({ storedPickStillExists: true }), { again: false });
  assert.deepEqual(ranksAgainOnResume({ consumerAsksByFlag: true }), {
    again: true,
    reason: "flag",
  });
  assert.deepEqual(ranksAgainOnResume({ storedPickStillExists: false }), {
    again: true,
    reason: "stored-pick-gone",
  });
  // The entries of the plan carry the eight facts of §C.6.
  const entry = (validRecord().plan as Record<string, Record<string, Record<string, unknown>[]>>)[
    "1"
  ]?.["critic"]?.[0] as Record<string, unknown>;
  for (const fact of PLAN_ENTRY_FACTS) {
    assert.notEqual(entry[fact], undefined, `an entry of the plan carries ${fact}`);
  }
});

test("CT-100-193: the four steps of the critic order and the rules of a pick", () => {
  // The critic order is the key `criticOrder` of `data/harness-tables.json`.
  const raw = (harnessTables as { criticOrder: { Step: string; Candidate: string }[] }).criticOrder;
  assert.equal(CRITIC_ORDER.length, 4);
  assert.equal(CRITIC_ORDER.length, raw.length);
  CRITIC_ORDER.forEach((row, i) => {
    assert.equal(row.step, i + 1);
    assert.equal(row.candidate, raw[i]?.Candidate);
  });
  assert.deepEqual(
    [...CRITIC_ORDER_STEPS],
    ["configured", "gateway", "discovered", "default-model-tier"],
  );
  // Row 180 of annex X §X.6 names the same four steps.
  const row180 = (
    closedSetsData as { closedSets: { number: number; literals: string[] }[] }
  ).closedSets.find((r) => r.number === 180);
  assert.deepEqual([...(row180?.literals ?? [])], [...CRITIC_ORDER_STEPS]);
  // Step 1 is the critic the consumer configured; discovery never overrides it.
  assert.equal(CRITIC_ORDER[0]?.id, "configured");
  assert.match(String(CRITIC_ORDER[0]?.candidate), /Discovery never overrides it/);
  // Within step 3 a tool-less candidate stands before one with read-only tools,
  // and a tested harness before an unverified one.
  assert.equal(STEP_WITH_DISCOVERED_HARNESSES, "discovered");
  assert.deepEqual([...FORM_ORDER_WITHIN_THE_STEP], ["tool-less", "read-only-tools"]);
  assert.deepEqual([...STATE_ORDER_WITHIN_THE_STEP], ["tested", "locally-verified"]);
  assert.match(String(CRITIC_ORDER[2]?.candidate), /tested before unverified/);

  // An unverified harness of kind `cli` is never picked automatically.
  assert.equal(AUTOMATIC_PICK_RULES.neverAnUnverifiedCliHarness, true);
  assert.equal(
    mayBePickedAutomatically({
      state: "declared",
      kind: "cli",
      termsKnown: true,
      namedByTheConsumer: false,
    }),
    false,
  );
  assert.equal(
    mayBePickedAutomatically({
      state: "tested",
      kind: "cli",
      termsKnown: true,
      namedByTheConsumer: false,
    }),
    true,
  );
  // A harness whose terms are unknown and that the consumer did not name is
  // never picked automatically; naming it makes it usable, with the warning.
  assert.equal(
    mayBePickedAutomatically({
      state: "tested",
      kind: "openai-chat",
      termsKnown: false,
      namedByTheConsumer: false,
    }),
    false,
  );
  assert.equal(AUTOMATIC_PICK_RULES.unknownTermsAreUsableWhenTheConsumerNamesThem, true);
  assert.equal(AUTOMATIC_PICK_RULES.unknownTermsWarning, "unknown-terms");
  // A model whose window is not known does not qualify for an automatic pick.
  assert.equal(
    mayBePickedAutomatically({
      state: "tested",
      kind: "openai-chat",
      termsKnown: true,
      namedByTheConsumer: false,
      contextWindowKnown: false,
    }),
    false,
  );
  // A metered endpoint needs a hard cap, announced at launch; the pick is
  // announced, recorded and shown in the digest.
  assert.equal(AUTOMATIC_PICK_RULES.meteredEndpointNeedsAHardSpendingCap, true);
  assert.equal(AUTOMATIC_PICK_RULES.spendingCapIsAnnouncedAtLaunch, true);
  assert.equal(AUTOMATIC_PICK_RULES.pickIsAnnounced, true);
  assert.equal(AUTOMATIC_PICK_RULES.pickIsRecorded, true);
  assert.equal(AUTOMATIC_PICK_RULES.pickIsShownInTheDigest, true);
  // The record carries the pick with its step, its window and its source.
  const record = readResolvedRegistry(validRecord(), LOGICAL_NAME);
  const pick = record.criticPick as Record<string, unknown>;
  assert.ok(CRITIC_ORDER_STEPS.includes(pick.step as never));
  assert.notEqual(pick.windowSource, undefined);
  assert.equal(pick.diversityWarningRaised, false);
  assert.ok((record.announced as readonly string[]).length > 0);
});

test("CT-100-194: roles are an open registry and every registered role is resolved", () => {
  assert.deepEqual(
    [...ROLE_FACTS],
    ["id", "capabilityLevelRequired", "independenceConstraints", "budgetKey"],
  );
  assert.deepEqual([...ROLES_OF_WAVE_1], ["proposer", "critic"]);
  assert.deepEqual([...ROLES_UNDER_THE_SAME_RULES], ["diagnostician", "accelerator"]);

  const record = readResolvedRegistry(validRecord(), LOGICAL_NAME);
  for (const role of record.roles) assert.ok(isRoleEntry(role));
  assert.equal(isRoleEntry({ id: "critic" }), false);

  // Role resolution resolves every registered role: the plan holds an entry
  // for each, per phase.
  assert.ok(everyRoleIsResolved([...ROLES_OF_WAVE_1], record.plan));
  assert.equal(
    everyRoleIsResolved(["proposer", "critic", "a-role-of-a-later-wave"], record.plan),
    false,
  );
});
