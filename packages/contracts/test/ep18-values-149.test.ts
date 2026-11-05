/**
 * T004 — the two values of EP-18 and their guards (feature 149,
 * data-model.md, "Plan of the next phase attempt" and "Outcome of one critic
 * call").
 *
 * Neither value is written as a record and neither crosses a process or a file
 * boundary, so neither has a schema file and neither has a schema id: this test
 * asserts that too, over `schemas/` and over the schema ids the package knows.
 * Each guard applies the validation rule of data-model.md:
 *
 * - the plan: "`kind` is `bumped` only when `decision.choice` is `bump` and the
 *   kind the recovery cycle gave was `plain`; `skipReason` is present exactly
 *   when `decision.choice` is `skip`";
 * - the outcome of a call: every field of its table, and no nonce and no hash of
 *   a nonce in it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIELDS_NO_CALL_OUTCOME_CARRIES,
  PLAN_VALIDATION_RULE,
  isCriticCallOutcome,
  isNextAttemptPlan,
  type AttemptTierDecision,
  type CriticCallOutcome,
  type NextAttemptPlan,
} from "../src/ep/ep18-values.ts";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function decision(choice: "bump" | "skip" | "none", ruleId: string): AttemptTierDecision {
  return {
    tableId: "attempt-planner.tier-bump",
    tableVersion: "1.0.0",
    point: "attempt-tier",
    ruleId,
    signals: { criticRejections: 2, k: 2 },
    choice,
  };
}

function plainPlan(): NextAttemptPlan {
  return { kind: "plain", modelTier: "base", freshSession: true };
}

function outcome(): CriticCallOutcome {
  return {
    verdict: "REJECTED",
    sessionId: "session-1",
    form: "tool-less",
    proof: {
      form: "tool-less",
      outcome: "passed",
      kind: "initial-record",
      sessionProofCase: "harness-given-id",
      weakerProof: false,
      facts: { emptyToolList: true, sessionIdentity: true },
      underParity: false,
    },
    sameModelWarning: false,
    usage: { inputTokens: 10, outputTokens: 20 },
    latency: 1234,
  };
}

test("T004: the plan of the next phase attempt is accepted in its valid shapes", () => {
  assert.equal(isNextAttemptPlan(plainPlan()), true);
  // Every kind of row 9, with no table evaluated.
  for (const kind of ["plain", "diagnosed", "accelerated"] as const) {
    assert.equal(isNextAttemptPlan({ ...plainPlan(), kind }), true, kind);
  }
  // `bumped` with the choice `bump` and the recovery cycle's kind `plain`.
  assert.equal(
    isNextAttemptPlan(
      {
        kind: "bumped",
        modelTier: "high",
        freshSession: true,
        decision: decision("bump", "TB-07-bump"),
      },
      "plain",
    ),
    true,
  );
  // A skip: the reason is present, and the kind stays the recovery cycle's.
  assert.equal(
    isNextAttemptPlan({
      kind: "plain",
      modelTier: "base",
      freshSession: true,
      decision: decision("skip", "TB-04-ladder-top"),
      skipReason: "ladder-top",
    }),
    true,
  );
  // A table evaluated whose choice is `none`: no reason, no bump.
  assert.equal(
    isNextAttemptPlan({
      ...plainPlan(),
      decision: decision("none", "TB-02-below-k"),
    }),
    true,
  );
});

test("T004: the guard applies the first half of the validation rule of data-model.md", () => {
  assert.match(PLAN_VALIDATION_RULE, /`kind` is `bumped` only when `decision\.choice` is `bump`/);
  const bumped = {
    kind: "bumped",
    modelTier: "high",
    freshSession: true,
    decision: decision("bump", "TB-07-bump"),
  };
  // `bumped` with the choice `bump` but no kind from the recovery cycle.
  assert.equal(isNextAttemptPlan(bumped), false, "the recovery kind must be given");
  // `bumped` where the recovery cycle gave something other than `plain`.
  for (const recoveryKind of ["diagnosed", "accelerated", "bumped"]) {
    assert.equal(isNextAttemptPlan(bumped, recoveryKind), false, recoveryKind);
  }
  // `bumped` with no table evaluated, or with a choice other than `bump`.
  assert.equal(
    isNextAttemptPlan({ kind: "bumped", modelTier: "high", freshSession: true }, "plain"),
    false,
  );
  assert.equal(
    isNextAttemptPlan({ ...bumped, decision: decision("none", "TB-03-already-bumped") }, "plain"),
    false,
  );
  assert.equal(
    isNextAttemptPlan(
      { ...bumped, decision: decision("skip", "TB-05-critic-model"), skipReason: "critic-model" },
      "plain",
    ),
    false,
  );
});

test("T004: the guard applies the second half of the validation rule of data-model.md", () => {
  assert.match(
    PLAN_VALIDATION_RULE,
    /`skipReason` is present exactly when `decision\.choice` is `skip`/,
  );
  // A skip without a reason.
  assert.equal(
    isNextAttemptPlan({ ...plainPlan(), decision: decision("skip", "TB-06-quota-exhausted") }),
    false,
  );
  // A reason without a skip: no table, the choice `none`, the choice `bump`.
  assert.equal(isNextAttemptPlan({ ...plainPlan(), skipReason: "ladder-top" }), false);
  assert.equal(
    isNextAttemptPlan({
      ...plainPlan(),
      decision: decision("none", "TB-01-option-off"),
      skipReason: "ladder-top",
    }),
    false,
  );
  // A reason outside row 254 of annex X §X.6.
  assert.equal(
    isNextAttemptPlan({
      ...plainPlan(),
      decision: decision("skip", "TB-04-ladder-top"),
      skipReason: "no-such-reason",
    }),
    false,
  );
});

test("T004: the guard refuses a plan whose fields are of the wrong kind", () => {
  assert.equal(isNextAttemptPlan(undefined), false);
  assert.equal(isNextAttemptPlan(null), false);
  assert.equal(isNextAttemptPlan("plain"), false);
  assert.equal(isNextAttemptPlan([]), false);
  // An unknown kind of phase attempt is not a valid plan; the engine then reads
  // it as `plain` (the unknown-value rule of row 9).
  assert.equal(isNextAttemptPlan({ ...plainPlan(), kind: "escalated" }), false);
  assert.equal(isNextAttemptPlan({ ...plainPlan(), modelTier: "" }), false);
  assert.equal(isNextAttemptPlan({ ...plainPlan(), modelTier: 3 }), false);
  assert.equal(isNextAttemptPlan({ ...plainPlan(), freshSession: "yes" }), false);
  // A decision record without the fields of annex X §X.3, or with a choice
  // outside row 253.
  assert.equal(isNextAttemptPlan({ ...plainPlan(), decision: {} }), false);
  assert.equal(
    isNextAttemptPlan({
      ...plainPlan(),
      decision: { ...decision("none", "TB-00-default"), ruleId: "" },
    }),
    false,
  );
  assert.equal(
    isNextAttemptPlan({
      ...plainPlan(),
      decision: { ...decision("none", "TB-00-default"), choice: "defer" },
    }),
    false,
  );
});

test("T004: the outcome of one critic call is accepted in its valid shapes", () => {
  assert.equal(isCriticCallOutcome(outcome()), true);
  for (const verdict of ["APPROVED", "REJECTED", "MALFORMED"] as const) {
    assert.equal(isCriticCallOutcome({ ...outcome(), verdict }), true, verdict);
  }
  // `usage` and `latency` are as the harness reported them, or null.
  assert.equal(isCriticCallOutcome({ ...outcome(), usage: null, latency: null }), true);
  // The critic-diversity warning is a truth value; feature 111 owns the field.
  assert.equal(isCriticCallOutcome({ ...outcome(), sameModelWarning: true }), true);
  // The second form of the `completion` level, with its proof.
  assert.equal(
    isCriticCallOutcome({
      ...outcome(),
      form: "read-only-tools",
      proof: { ...outcome().proof, form: "read-only-tools", kind: "call-record" },
    }),
    true,
  );
});

test("T004: no outcome of a critic call carries a nonce or the hash of one", () => {
  assert.deepEqual([...FIELDS_NO_CALL_OUTCOME_CARRIES], ["nonce", "nonceHash"]);
  for (const field of FIELDS_NO_CALL_OUTCOME_CARRIES) {
    assert.equal(
      isCriticCallOutcome({ ...outcome(), [field]: "deadbeefdeadbeef" }),
      false,
      `an outcome that carries ${field} is refused`,
    );
    // Even where the field is empty or null, the name alone is refused.
    assert.equal(isCriticCallOutcome({ ...outcome(), [field]: null }), false, field);
  }
});

test("T004: the guard refuses an outcome whose fields are of the wrong kind", () => {
  assert.equal(isCriticCallOutcome(undefined), false);
  assert.equal(isCriticCallOutcome("APPROVED"), false);
  // An unknown verdict is not a valid outcome; the engine then reads it as
  // MALFORMED (the unknown-value rule of row 8 of annex X §X.6).
  assert.equal(isCriticCallOutcome({ ...outcome(), verdict: "PASSED" }), false);
  assert.equal(isCriticCallOutcome({ ...outcome(), sessionId: "" }), false);
  assert.equal(isCriticCallOutcome({ ...outcome(), form: "all-tools" }), false);
  assert.equal(isCriticCallOutcome({ ...outcome(), proof: undefined }), false);
  assert.equal(
    isCriticCallOutcome({ ...outcome(), proof: { ...outcome().proof, outcome: "maybe" } }),
    false,
  );
  assert.equal(isCriticCallOutcome({ ...outcome(), sameModelWarning: 1 }), false);
  assert.equal(isCriticCallOutcome({ ...outcome(), usage: { inputTokens: "10" } }), false);
  assert.equal(isCriticCallOutcome({ ...outcome(), latency: "fast" }), false);
});

test("T004: neither value has a schema file and neither has a schema id", async () => {
  const schemas = readdirSync(join(PACKAGE_ROOT, "schemas"));
  for (const name of schemas) {
    assert.ok(
      !/attempt-plan|next-attempt|critic-call|call-outcome|ep18/i.test(name),
      `schemas/ holds no schema of a value of EP-18, but holds ${name}`,
    );
  }
  // And the module itself declares no schema id, unlike every record module of
  // the package, each of which holds `SCHEMA_ID` and `LOGICAL_NAME`.
  const module = readFileSync(join(PACKAGE_ROOT, "src", "ep", "ep18-values.ts"), "utf8");
  assert.equal(/\bSCHEMA_ID\b/.test(module), false, "the module declares no schema id");
  assert.equal(/\bLOGICAL_NAME\b/.test(module), false, "the module declares no logical name");
  // No schema of the package describes either value, by name or by its fields.
  for (const name of schemas) {
    const text = readFileSync(join(PACKAGE_ROOT, "schemas", name), "utf8");
    assert.equal(
      /next attempt plan|plan of the next phase attempt|outcome of one critic call/i.test(text),
      false,
      `schemas/${name} describes no value of EP-18`,
    );
  }
  const exported = (await import("../src/ep/ep18-values.ts")) as Record<string, unknown>;
  assert.equal("SCHEMA_ID" in exported, false);
  assert.equal("LOGICAL_NAME" in exported, false);
});
