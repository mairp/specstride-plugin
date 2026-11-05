/**
 * CT-126-14 (T045) — the plain function interface of the finalization
 * (F100-FR-237): `invocationFinalization` binds the artifacts of the pass to
 * the contract operations `reconcile`, `finalize` and `sweepRetention`.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { invocationFinalization } from "../src/invocation/interface.ts";
import type {
  InvocationIdentity,
  InvocationObservation,
} from "@specstride/contracts/engine/finalization";

const IDENTITY: InvocationIdentity = {
  runId: "run-ct14",
  passId: "pass-ct14",
  invocationId: "inv-000014-ff14ct14",
};

test("CT-126-14: the interface holds the three operations of the contract", () => {
  const finalization = invocationFinalization({ root: "/tmp/ct126-14-unused" });
  assert.deepEqual(Object.keys(finalization).sort(), ["finalize", "reconcile", "sweepRetention"]);
});

test("CT-126-14: reconcile folds the observations of one invocation into the result shape", () => {
  const finalization = invocationFinalization({ root: "/tmp/ct126-14-unused" });
  const observations: InvocationObservation[] = [
    {
      source: "producer",
      at: "0000000000.000000000",
      values: { producer_exit_code: 0, parser_exit_code: 0, duration_ms: 500 },
    },
    {
      source: "provider-terminal",
      at: "0000000000.000000001",
      values: { provider_terminal: "success", stop_reason: "end_turn" },
    },
  ];
  const result = finalization.reconcile(IDENTITY, observations);
  assert.equal(result.invocation.invocationId, IDENTITY.invocationId);
  assert.equal(result.isError, false);
  assert.equal(result.reasonCode, "success");
  assert.equal(result.exitCode, 0);

  // A failing producer with a failing terminal: an error, with its reason.
  const failing = finalization.reconcile(IDENTITY, [
    {
      source: "producer",
      at: "0000000000.000000000",
      values: { producer_exit_code: 1, parser_exit_code: 0, duration_ms: 500 },
    },
    {
      source: "provider-terminal",
      at: "0000000000.000000001",
      values: { provider_terminal: "error", reason_code: "provider_error" },
    },
  ]);
  assert.equal(failing.isError, true);
  // The producer exit decides before the terminal (B-2171).
  assert.equal(failing.reasonCode, "producer_nonzero");

  // The error the provider reported, with the exit clean (B-2176).
  const providerError = finalization.reconcile(IDENTITY, [
    {
      source: "producer",
      at: "0000000000.000000000",
      values: { producer_exit_code: 0, parser_exit_code: 0, duration_ms: 500 },
    },
    {
      source: "provider-terminal",
      at: "0000000000.000000001",
      values: { provider_terminal: "error", reason_code: "provider_error" },
    },
  ]);
  assert.equal(providerError.isError, true);
  assert.equal(providerError.reasonCode, "provider_error");

  // The flags are data of the values.
  const cancelled = finalization.reconcile(IDENTITY, [
    { source: "producer", at: "0000000000.000000000", values: { cancelled: true } },
  ]);
  assert.equal(cancelled.reasonCode, "cancelled");
});

test("CT-126-14: finalize decides from the breaker state, the limit and the kill reason", () => {
  const root = mkdtempSync(join(tmpdir(), "ct126-14-"));
  const breakerPath = join(root, "breakers.json");
  try {
    const finalization = invocationFinalization({
      root,
      breakerStatePath: () => breakerPath,
    });
    const first = finalization.finalize(
      IDENTITY,
      { consecutiveErrors: 0, open: false },
      {
        consecutiveErrorLimit: 2,
      },
      "hard_cap",
    );
    assert.equal(first.decision, "continue");
    assert.equal(first.is_error, true);
    assert.equal(first.reasonCode, "budget");
    assert.equal(first.consecutiveErrors, 1);
    assert.equal(first.event["event"], "agent_result");
    assert.equal((first.event["values"] as Record<string, unknown>)["is_error"], true);

    // The state the fold wrote decides the second call: the limit halts.
    const state = JSON.parse(readFileSync(breakerPath, "utf8")) as {
      count: number;
      last_reason_code: string | null;
    };
    assert.equal(state.count, 1);
    assert.equal(state.last_reason_code, "budget");
    const second = finalization.finalize(
      { ...IDENTITY, invocationId: "inv-000014-second" },
      { consecutiveErrors: state.count, open: false },
      { consecutiveErrorLimit: 2 },
      "hard_cap",
    );
    assert.equal(second.decision, "halt");
    assert.equal(second.consecutiveErrors, 2);
    assert.equal(second.killClass, "budget");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CT-126-14: a durable result decides is_error and the reason code where the composition root binds one", () => {
  const finalization = invocationFinalization({
    root: "/tmp/ct126-14-unused",
    readResult: () => ({ isError: false, reasonCode: "success" }),
  });
  const outcome = finalization.finalize(
    IDENTITY,
    { consecutiveErrors: 3, open: false },
    { consecutiveErrorLimit: 2 },
    "producer_nonzero",
  );
  assert.equal(outcome.is_error, false, "the durable result decides over the kill reason");
  assert.equal(outcome.decision, "continue");
  assert.equal(outcome.consecutiveErrors, 0, "a success resets the count of consecutive errors");
});

test("CT-126-14: sweepRetention sweeps the invocations of one run under the bound root", () => {
  const root = mkdtempSync(join(tmpdir(), "ct126-14-sweep-"));
  try {
    const finalization = invocationFinalization({ root });
    const sweep = finalization.sweepRetention("run-ct14");
    assert.ok(typeof sweep === "object");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
