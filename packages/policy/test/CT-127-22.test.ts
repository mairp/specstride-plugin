/**
 * CT-127-22 (T044) — the characterization test of an ALLOWED and a REFUSED
 * entry, and of NO BYPASS (F127-FR-020).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DECISIONS_THAT_ALLOW,
  EVALUATE_AT_EVERY_SWITCH,
  GATE_INPUTS,
  NOTHING_BYPASSES_IT,
  SKIP_REASON_TERMS_REFUSED,
  STATUS_WHEN_UNKNOWN,
  TERMS_OPERATION,
  TERMS_OPERATION_IS_OF_THE_POINT,
  TERMS_POINT_ID,
  TermsBypassError,
  evaluateEntry,
  evaluateEveryEntry,
  evaluateWithNoBypass,
  gateCheck,
  queryOf,
  refuseBypass,
  skipRefusedEntry,
} from "../src/budget/fallback-gate.ts";
import { SKIP_REASONS, entryOf, walkFallback, type RolePlan } from "../src/budget/fallback.ts";
import {
  noRowOutcome,
  type TermsDecision,
  type TermsGate,
  type TermsQuery,
} from "@specstride/contracts/ep/terms";
import { testPorts } from "./support/index.ts";

const ALLOWED = entryOf(0, {
  harness: "stub-api",
  model: "m",
  authTier: 1,
  provider: "allowed-provider",
  billingMode: "api",
  capUsd: 25,
  audience: "personal",
});
const REFUSED = entryOf(1, {
  harness: "stub-refused",
  authTier: 3,
  provider: "refused-provider",
  billingMode: "api",
  capUsd: 25,
  audience: "distributed",
});

/** A gate that counts its calls, so "at every switch" can be observed. */
function countingGate(answer: (query: TermsQuery) => TermsDecision) {
  const queries: TermsQuery[] = [];
  const gate: TermsGate = {
    evaluate(query) {
      queries.push(query);
      return answer(query);
    },
  };
  return { gate, queries };
}

const byProvider = (query: TermsQuery): TermsDecision =>
  query.provider === "refused-provider"
    ? { decision: "refused", row: null, explanation: "the terms of this provider refuse it" }
    : { decision: "allowed", row: null, explanation: "allowed" };

function planOf(entries: readonly ReturnType<typeof entryOf>[]): RolePlan {
  return {
    role: "proposer",
    primary: entryOf(0, { harness: "stub-harness", billingMode: "subscription" }),
    entries,
    resolvedHarnesses: ["stub-api", "stub-refused", "stub-harness"],
  };
}

test("CT-127-22: the point and the operation are EP-11 `evaluate`", () => {
  assert.equal(TERMS_POINT_ID, "specstride.terms/1");
  assert.equal(TERMS_OPERATION, "evaluate");
  assert.equal(TERMS_OPERATION_IS_OF_THE_POINT, true);
  assert.equal(EVALUATE_AT_EVERY_SWITCH, true);
  assert.deepEqual([...GATE_INPUTS], ["provider", "authTier", "audience", "acknowledgements"]);
});

test("CT-127-22: the query carries the provider, the auth tier, the audience and the acknowledgements", () => {
  const query = queryOf(ALLOWED, { acknowledgements: ["tos-2026-01"] });
  assert.deepEqual(
    { ...query, acknowledgements: [...query.acknowledgements] },
    {
      provider: "allowed-provider",
      authTier: 1,
      audience: "personal",
      acknowledgements: ["tos-2026-01"],
    },
  );
  // A caller may override the audience; the entry's own value is the default.
  const distributed = queryOf(ALLOWED, { acknowledgements: [], audience: "distributed" });
  assert.equal(distributed.audience, "distributed");
});

test("CT-127-22: an ALLOWED entry is taken", () => {
  const { gate, queries } = countingGate(byProvider);
  const decision = evaluateEntry(gate, ALLOWED, { acknowledgements: [] });
  assert.equal(decision.allowed, true);
  assert.equal(decision.skipReason, null);
  assert.equal(decision.warning, null);
  assert.equal(queries.length, 1, "the gate was asked");
});

test("CT-127-22: `allowed-with-warning` is allowed, and the warning is carried", () => {
  const { gate } = countingGate(() => noRowOutcome(1));
  const decision = evaluateEntry(gate, ALLOWED, { acknowledgements: [] });
  assert.equal(decision.decision.decision, "allowed-with-warning");
  assert.equal(decision.allowed, true);
  assert.equal(decision.skipReason, null);
  assert.match(decision.warning ?? "", /unknown terms/);
  assert.deepEqual([...DECISIONS_THAT_ALLOW], ["allowed", "allowed-with-warning"]);
});

test("CT-127-22: a REFUSED entry is skipped with `terms-refused`, and the next is tried", () => {
  assert.equal(SKIP_REASON_TERMS_REFUSED, "terms-refused");
  assert.ok((SKIP_REASONS as readonly string[]).includes(SKIP_REASON_TERMS_REFUSED));
  const ports = testPorts();
  const { gate, queries } = countingGate(byProvider);
  const walk = walkFallback(
    planOf([REFUSED, ALLOWED]),
    [gateCheck(gate, { acknowledgements: [] })],
    {
      writer: ports.eventWriter,
    },
  );
  assert.equal(walk.chosen?.harness, "stub-api", "the next entry is tried");
  assert.equal(walk.skipped.length, 1);
  assert.equal(walk.skipped[0].reason, "terms-refused");
  assert.equal(walk.skipped[0].known, true, "the reason is a member of row 208");
  assert.equal(queries.length, 2, "every entry was evaluated, in order");
  assert.deepEqual(
    queries.map((query) => query.provider),
    ["refused-provider", "allowed-provider"],
  );
});

test("CT-127-22: the skip is NEVER SILENT — `fallback.skipped` names the entry and the reason", () => {
  const ports = testPorts();
  const { gate } = countingGate(byProvider);
  walkFallback(planOf([REFUSED, ALLOWED]), [gateCheck(gate, { acknowledgements: [] })], {
    writer: ports.eventWriter,
  });
  assert.deepEqual([...ports.eventWriter.types()], ["fallback.skipped"]);
  const payload = ports.eventWriter.of("fallback.skipped")[0].payload;
  assert.equal(payload.entry, 1);
  assert.equal(payload.entryHarness, "stub-refused");
  assert.equal(payload.entryProvider, "refused-provider");
  assert.equal(payload.authTier, "3");
  assert.equal(payload.audience, "distributed");
  assert.equal(payload.reason, "terms-refused");
  assert.equal(payload.role, "proposer");
});

test("CT-127-22: `skipRefusedEntry` writes the same event on its own", () => {
  const ports = testPorts();
  skipRefusedEntry(ports.eventWriter, REFUSED, { role: "critic" });
  const payload = ports.eventWriter.of("fallback.skipped")[0].payload;
  assert.equal(payload.reason, "terms-refused");
  assert.equal(payload.role, "critic");
  assert.equal(payload.entry, 1);
});

test("CT-127-22: the gate is asked at EVERY entry, and the recorded decision is not reused", () => {
  const { gate, queries } = countingGate(byProvider);
  const decisions = evaluateEveryEntry(gate, planOf([ALLOWED, REFUSED, ALLOWED]), {
    acknowledgements: ["a"],
  });
  assert.equal(queries.length, 3, "three entries, three calls");
  assert.deepEqual(
    decisions.map((decision) => decision.allowed),
    [true, false, true],
  );
  // And a second switch asks again: six calls for two walks of three entries.
  evaluateEveryEntry(gate, planOf([ALLOWED, REFUSED, ALLOWED]), { acknowledgements: ["a"] });
  assert.equal(queries.length, 6);
});

test("CT-127-22: a gate that throws is read as REFUSED, never as permission", () => {
  assert.equal(STATUS_WHEN_UNKNOWN, "refused");
  const gate: TermsGate = {
    evaluate() {
      throw new Error("the terms data did not validate");
    },
  };
  const decision = evaluateEntry(gate, ALLOWED, { acknowledgements: [] });
  assert.equal(decision.allowed, false);
  assert.equal(decision.decision.decision, "refused");
  assert.equal(decision.skipReason, "terms-refused");
  assert.match(decision.decision.explanation, /read as `refused`/);
});

test("CT-127-22: NO comment, flag, mode or project key bypasses the gate", () => {
  assert.deepEqual([...NOTHING_BYPASSES_IT], ["comment", "flag", "mode", "project key"]);
  for (const kind of NOTHING_BYPASSES_IT) {
    assert.throws(() => refuseBypass(kind), TermsBypassError, kind);
    assert.throws(
      () => refuseBypass(kind),
      /no comment, flag, mode or project key bypasses the terms gate/,
      kind,
    );
  }
});

test("CT-127-22: a bypass request on a refused entry does not make it allowed", () => {
  const { gate, queries } = countingGate(byProvider);
  assert.throws(
    () => evaluateWithNoBypass(gate, REFUSED, { acknowledgements: [] }, { kind: "flag" }),
    TermsBypassError,
  );
  assert.equal(queries.length, 0, "the gate was not even reached: the request is refused first");
  // Without the request, the gate's own answer stands.
  const decision = evaluateWithNoBypass(gate, REFUSED, { acknowledgements: [] }, null);
  assert.equal(decision.allowed, false);
});

test("CT-127-22: a bypass request on an ALLOWED entry is refused too", () => {
  const { gate } = countingGate(byProvider);
  assert.throws(
    () => evaluateWithNoBypass(gate, ALLOWED, { acknowledgements: [] }, { kind: "project key" }),
    TermsBypassError,
  );
});
