/**
 * T302 — contract test CT-100-337 for the interface through which the engine
 * calls finalization (annex A, §A.4, F100-FR-237; annex X §X.6 row 175).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  FINALIZATION_CALLER,
  FINALIZATION_DECISIONS,
  FINALIZATION_IMPLEMENTATION,
  FINALIZATION_IS_AN_EXTENSION_POINT,
  FINALIZATION_LAYER,
  FINALIZATION_OPERATIONS,
  FINALIZE_INPUTS,
  FINALIZE_OUTPUTS,
  HANDED_TO_THE_ENGINE_BY,
  finalizationDecisionSet,
  type Finalization,
  type FinalizationDecision,
  type Finalize,
  type Reconcile,
  type SweepRetention,
} from "../src/engine/finalization.ts";
import * as packageIndex from "../src/index.ts";
import { closedSets } from "../src/enums/all-sets.ts";

test("CT-100-337: the interface has the three plain function types of F100-FR-237", () => {
  assert.deepEqual([...FINALIZATION_OPERATIONS], ["reconcile", "finalize", "sweepRetention"]);
  // A plain function interface, at layer L2 of the `contracts` package, handed
  // to the engine by the composition root, and NO extension point in Wave 1.
  assert.equal(FINALIZATION_IS_AN_EXTENSION_POINT, false);
  assert.equal(FINALIZATION_LAYER, "L2");
  assert.equal(HANDED_TO_THE_ENGINE_BY, "the composition root");
  assert.equal(FINALIZATION_IMPLEMENTATION, "@specstride/harness");
  assert.match(FINALIZATION_CALLER, /pass loop \(feature 103, F103-FR-013\)/);
});

test("CT-100-337: the decision is the closed set of row 175 of annex X §X.6", () => {
  assert.deepEqual([...FINALIZATION_DECISIONS], ["cap_halt", "halt", "continue"]);
  assert.equal(finalizationDecisionSet.number, 175);
  assert.equal(finalizationDecisionSet.name, "Finalization decisions");
  assert.equal(finalizationDecisionSet.owner, "126");
  // It is the row of the table, not a second list of the same literals.
  const row = closedSets.get(175);
  assert.ok(row !== undefined);
  assert.deepEqual([...row.members], [...FINALIZATION_DECISIONS]);
  // An unknown decision is read as `continue` (the cell of the row).
  const unknown = finalizationDecisionSet.onUnknown("something-else");
  assert.equal(unknown.kind, "default");
  assert.equal(unknown.treatedAs, "continue");
});

test("CT-100-337: `finalize` takes and returns what F126-FR-034 names", () => {
  assert.deepEqual(
    [...FINALIZE_INPUTS],
    [
      "the invocation identity",
      "the breaker state",
      "the limit",
      "an optional kill reason",
      "an optional cap limit",
    ],
  );
  assert.deepEqual(
    [...FINALIZE_OUTPUTS],
    [
      "the decision",
      "the reason code",
      "is_error",
      "the count of consecutive errors",
      "the kill class",
      "the cap count",
    ],
  );

  // A conforming implementation type-checks against the three types, and this
  // value proves the shapes at run time too.
  const reconcile: Reconcile = (invocation, observations) => ({
    invocation,
    isError: observations.some((o) => o.values["error"] === true),
    reasonCode: "",
    exitCode: 0,
    observations,
  });
  const finalize: Finalize = (invocation, breaker, limit, killReason, capLimit) => {
    const isError = killReason !== undefined;
    const consecutiveErrors = isError ? breaker.consecutiveErrors + 1 : 0;
    const capCount = capLimit === undefined ? 0 : 1;
    const decision: FinalizationDecision =
      capLimit !== undefined && capCount >= capLimit
        ? "cap_halt"
        : consecutiveErrors >= limit.consecutiveErrorLimit
          ? "halt"
          : "continue";
    return {
      decision,
      reasonCode: killReason ?? "",
      is_error: isError,
      consecutiveErrors,
      killClass: killReason === "hard cap" ? "budget" : killReason === undefined ? null : "unknown",
      capCount,
      result: reconcile(invocation, []),
      event: { event: "invocation.finalized", invocation, values: { decision } },
    };
  };
  const sweepRetention: SweepRetention = () => ({ swept: 2, kept: 1 });
  const finalization: Finalization = { reconcile, finalize, sweepRetention };

  const invocation = { runId: "run-1", passId: "pa-1", invocationId: "i-1" };
  // The optional kill reason and cap limit really are optional.
  const clean = finalization.finalize(
    invocation,
    { consecutiveErrors: 0, open: false },
    { consecutiveErrorLimit: 3 },
  );
  assert.equal(clean.decision, "continue");
  assert.equal(clean.is_error, false);
  assert.equal(clean.consecutiveErrors, 0);
  assert.equal(clean.killClass, null);
  assert.equal(clean.capCount, 0);
  assert.ok(FINALIZATION_DECISIONS.includes(clean.decision));

  // The breaker at its limit halts, and the kill reason gives a kill class.
  const halted = finalization.finalize(
    invocation,
    { consecutiveErrors: 2, open: false },
    { consecutiveErrorLimit: 3 },
    "hard cap",
  );
  assert.equal(halted.decision, "halt");
  assert.equal(halted.is_error, true);
  assert.equal(halted.consecutiveErrors, 3);
  assert.equal(halted.killClass, "budget");
  assert.equal(halted.reasonCode, "hard cap");

  // The cap limit gives `cap_halt`.
  const capped = finalization.finalize(
    invocation,
    { consecutiveErrors: 0, open: false },
    { consecutiveErrorLimit: 3 },
    undefined,
    1,
  );
  assert.equal(capped.decision, "cap_halt");
  assert.equal(capped.capCount, 1);

  // `reconcile` turns observations into one result; `sweepRetention` a run.
  const result = finalization.reconcile(invocation, [
    { source: "stream", at: "2026-10-01T00:00:00Z", values: { error: false } },
    { source: "exit", at: "2026-10-01T00:00:01Z", values: { error: true } },
  ]);
  assert.equal(result.isError, true);
  assert.equal(result.observations.length, 2);
  assert.deepEqual(result.invocation, invocation);
  assert.deepEqual(finalization.sweepRetention("run-1"), { swept: 2, kept: 1 });
});

test("CT-100-337: the interface is exported from src/index.ts (F100-FR-237)", () => {
  // The composition root reaches it through the package surface, not a deep path.
  for (const name of [
    "FINALIZATION_OPERATIONS",
    "FINALIZATION_IS_AN_EXTENSION_POINT",
    "FINALIZATION_LAYER",
    "FINALIZATION_DECISIONS",
    "FINALIZE_INPUTS",
    "FINALIZE_OUTPUTS",
    "finalizationDecisionSet",
  ]) {
    assert.ok(name in packageIndex, `src/index.ts re-exports ${name}`);
  }
  assert.deepEqual(
    [...(packageIndex as { FINALIZATION_OPERATIONS: readonly string[] }).FINALIZATION_OPERATIONS],
    ["reconcile", "finalize", "sweepRetention"],
  );
});
