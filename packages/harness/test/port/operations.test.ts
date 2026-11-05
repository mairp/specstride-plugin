/**
 * T016 — CT-109-3: the eight operations of the port (F109-FR-003).
 *
 * Every operation has a time limit; the degradation path is taken on a
 * throw, on a time-out and on an unknown value; and the terms gate is asked
 * before EVERY call. A degraded result never carries a verdict, an exit code
 * or a stop reason of the harness adapter.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BETWEEN_PASSES_OUTCOMES,
  PORT_OPERATIONS,
  TYPED_FAILURES,
  createHarnessPort,
  type Degradation,
  type HarnessAdapter,
  type TermsGate,
  type TimeLimits,
} from "../../src/port/port.ts";

/** A time limit that is generous, so a passing call never times out. */
const LIMITS: TimeLimits = Object.freeze({
  detect: 2_000,
  capabilities: 2_000,
  preflight: 2_000,
  startPass: 2_000,
  complete: 2_000,
  stop: 2_000,
  betweenPasses: 2_000,
  classify: 2_000,
});

/** A terms gate that counts what it is asked, and can be switched to refuse. */
function countingGate(alwaysAllow = true): TermsGate & { asked: string[] } {
  const gate = {
    asked: [] as string[],
    decide(operation: string): { allowed: boolean } {
      gate.asked.push(operation);
      return { allowed: alwaysAllow };
    },
  };
  return gate as unknown as TermsGate & { asked: string[] };
}

function adapter(partial: Partial<HarnessAdapter>): HarnessAdapter {
  return partial;
}

test("CT-109-3: the port offers exactly the eight operations of annex C §C.1", () => {
  assert.deepEqual(
    [...PORT_OPERATIONS],
    [
      "detect",
      "capabilities",
      "preflight",
      "startPass",
      "complete",
      "stop",
      "betweenPasses",
      "classify",
    ],
  );
});

test("CT-109-3: a passing call returns the value of the adapter, inside the result set", async () => {
  const gate = countingGate();
  const port = createHarnessPort({
    adapter: adapter({
      detect: () => ({ present: true, version: "1.0.0" }),
      classify: () => "rate_limited",
    }),
    timeLimits: LIMITS,
    termsGate: gate,
  });
  const detected = await port.detect();
  assert.deepEqual(detected, { ok: true, value: { present: true, version: "1.0.0" } });
  const classified = await port.classify({ exitCode: 1 });
  assert.equal(classified.ok && classified.value, "rate_limited");
  assert.deepEqual(gate.asked, ["detect", "classify"]);
});

test("CT-109-3: the terms gate is asked before EVERY call, and a refusal refuses the call", async () => {
  const gate = countingGate(false);
  const port = createHarnessPort({
    adapter: adapter({
      startPass: () => ({ pid: 1, raw: "x", sessionId: "s" }),
    }),
    timeLimits: LIMITS,
    termsGate: gate,
  });
  const result = await port.startPass({});
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.degradation.detail, /terms gate refused/);
    // No verdict, no exit code, no stop reason of the adapter passed on.
    assert.deepEqual(result.degradation, {
      operation: "startPass",
      reason: "threw",
      detail: result.degradation.detail,
    });
  }
  assert.deepEqual(gate.asked, ["startPass"], "asked exactly once, before the call");
});

test("CT-109-3: degradation on a throw — the adapter's error value never passes on", async () => {
  const degradations: Degradation[] = [];
  const port = createHarnessPort({
    adapter: adapter({
      complete: () => {
        throw new Error("adapter exploded with the whole reply in the message");
      },
    }),
    timeLimits: LIMITS,
    termsGate: countingGate(),
    onDegradation: (degradation) => degradations.push(degradation),
  });
  const result = await port.complete({});
  assert.equal(result.ok, false);
  assert.equal(result.ok ? null : result.degradation.reason, "threw");
  assert.equal(degradations.length, 1);
  assert.equal(degradations[0]!.operation, "complete");
  assert.equal(degradations[0]!.reason, "threw");
});

test("CT-109-3: degradation on a time-out — the operation runs over its limit", async () => {
  const degradations: Degradation[] = [];
  const port = createHarnessPort({
    adapter: adapter({
      preflight: () =>
        new Promise<boolean>(() => {
          // never settles: the time limit must win
        }),
    }),
    timeLimits: { ...LIMITS, preflight: 30 },
    termsGate: countingGate(),
    onDegradation: (degradation) => degradations.push(degradation),
  });
  const result = await port.preflight("proposer");
  assert.equal(result.ok, false);
  assert.equal(result.ok ? null : result.degradation.reason, "timeout");
  assert.match(result.ok ? "" : result.degradation.detail, /time limit/);
  assert.equal(degradations[0]!.reason, "timeout");
});

test("CT-109-3: degradation on an unknown value — a value outside the operation's result set", async () => {
  const degradations: Degradation[] = [];
  const port = createHarnessPort({
    adapter: adapter({
      // `stop` must return `{ ended: boolean }`; a bare exit code is NOT in the set.
      stop: () => 3,
      betweenPasses: () => "maybe",
      classify: () => "kind_of_failed",
      capabilities: () => null,
    }),
    timeLimits: LIMITS,
    termsGate: countingGate(),
    onDegradation: (degradation) => degradations.push(degradation),
  });
  const stopped = await port.stop({});
  assert.equal(stopped.ok, false, "an exit code in the result is an unknown value");
  assert.equal(stopped.ok ? null : stopped.degradation.reason, "unknown-value");

  const between = await port.betweenPasses({});
  assert.equal(between.ok, false);

  const classified = await port.classify({});
  assert.equal(classified.ok, false, "a failure outside the closed vocabulary is unknown");

  const capabilities = await port.capabilities();
  assert.equal(capabilities.ok, false, "null is outside the result set of `capabilities`");

  assert.ok(degradations.every((d) => d.reason === "unknown-value"));
});

test("CT-109-3: every operation of the port goes through the same call path", async () => {
  const gate = countingGate();
  const port = createHarnessPort({
    adapter: adapter({
      detect: () => ({ present: true }),
      capabilities: () => ({}),
      preflight: () => true,
      startPass: () => ({ pid: 12, raw: "", sessionId: "s1" }),
      complete: () => ({ reply: "done" }),
      stop: () => ({ ended: true }),
      betweenPasses: () => "continue",
      classify: () => "agent_failure",
    }),
    timeLimits: LIMITS,
    termsGate: gate,
  });
  const results = [
    await port.detect(),
    await port.capabilities(),
    await port.preflight("proposer"),
    await port.startPass({}),
    await port.complete({}),
    await port.stop({}),
    await port.betweenPasses({}),
    await port.classify({}),
  ];
  assert.ok(
    results.every((result) => result.ok),
    JSON.stringify(results),
  );
  assert.deepEqual(gate.asked, [...PORT_OPERATIONS], "every operation asked the gate first");
});

test("CT-109-3: the time limits are configuration and are recorded on the port", () => {
  const port = createHarnessPort({
    adapter: adapter({}),
    timeLimits: LIMITS,
    termsGate: countingGate(),
  });
  assert.deepEqual(port.timeLimits, LIMITS);
  for (const operation of PORT_OPERATIONS) {
    assert.equal(typeof port.timeLimits[operation], "number");
    assert.ok(port.timeLimits[operation] > 0);
  }
});

test("CT-109-3: the closed sets the port reads hold their members", () => {
  assert.deepEqual([...TYPED_FAILURES].length, 8);
  assert.ok(TYPED_FAILURES.includes("authentication_failed"));
  assert.ok(TYPED_FAILURES.includes("rate_limited"));
  assert.ok(TYPED_FAILURES.includes("quota_exhausted"));
  assert.ok(TYPED_FAILURES.includes("context_window_exceeded"));
  assert.deepEqual([...BETWEEN_PASSES_OUTCOMES], ["continue", "stop:4", "stop:7"]);
});

test("CT-109-3: an operation the adapter holds no implementation of degrades, it does not hang", async () => {
  const port = createHarnessPort({
    adapter: adapter({}),
    timeLimits: LIMITS,
    termsGate: countingGate(),
  });
  const result = await port.complete({});
  assert.equal(result.ok, false);
  assert.equal(result.ok ? null : result.degradation.reason, "threw");
  assert.match(result.ok ? "" : result.degradation.detail, /holds no implementation/);
});
