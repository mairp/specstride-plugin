/**
 * CT-127-36 (T054) — the characterization test of a PROVIDER WARNING and of
 * SOFT TOKENS (F127-FR-038).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ALERT_KIND_PROVIDER_WARNING,
  A_PROVIDER_WARNING_PASSES_THROUGH,
  OBSERVED_FACTS,
  PROVIDER_WARNING_CARRIES,
  PROVIDER_WARNING_LEVEL,
  THE_ALLOWANCE_IS_UNKNOWN_UNTIL_THE_PROVIDER_SIGNALS_IT,
  WINDOW_OF_THE_RUN,
  closeWindow,
  decideSoftAlerts,
  emptyObservedState,
  observe,
  observedTokensOf,
  providerWarningAlert,
  providerWarningKey,
  raiseProviderWarning,
  raiseSoftAlerts,
  softCeilingOf,
  softReading,
  softTokensKeyOf,
  warningOfClassification,
  windowKeyOf,
  windowsOf,
} from "../src/budget/observed.ts";
import { emptyAlertState, rearm } from "../src/budget/alerts.ts";
import { SOFT_DIMENSION, kindOf } from "../src/budget/ceilings.ts";
import { classify } from "../src/quota/classify.ts";
import { DEFAULT_START_MS, testPorts } from "./support/index.ts";

const NOW = DEFAULT_START_MS;
const HOUR = 60 * 60 * 1000;
const RESET = new Date(NOW + 5 * HOUR).toISOString();

/** A redactor that removes a key-looking token and cuts to the cap. */
const fakeRedact = (text: string, cap: number) => ({
  text: text.replace(/sk-[A-Za-z0-9]+/g, "[REDACTED]").slice(0, cap),
  replacements: 1,
  patternSetVersion: "test",
});

test("CT-127-36: a provider warning is the kind `provider-warning` at level `warn`", () => {
  assert.equal(ALERT_KIND_PROVIDER_WARNING, "provider-warning");
  assert.equal(PROVIDER_WARNING_LEVEL, "warn");
  assert.equal(A_PROVIDER_WARNING_PASSES_THROUGH, true);
  assert.deepEqual([...PROVIDER_WARNING_CARRIES], ["rateLimitType", "resetsAt"]);
});

test("CT-127-36: the warning carries the rate-limit type and the reset time", () => {
  const ports = testPorts();
  const event = providerWarningAlert(
    ports.eventWriter,
    {
      role: "proposer",
      utilization: 0.82,
      rateLimitType: "tokens-per-window",
      resetsAt: RESET,
    },
    { redact: fakeRedact },
  );
  assert.deepEqual([...ports.eventWriter.types()], ["alert"]);
  assert.equal(event.payload.kind, "provider-warning");
  assert.equal(event.payload.level, "warn");
  assert.equal(event.payload.role, "proposer");
  assert.equal(event.payload.value, 0.82, "the utilization the provider gave");
  assert.equal(event.payload.limit, 1);
  assert.equal(event.payload.message, "tokens-per-window", "the rate-limit type");
  assert.equal(event.payload.dedupeKey, "provider-warning:proposer:-");
  assert.equal(
    providerWarningKey({
      role: "proposer",
      utilization: null,
      rateLimitType: null,
      resetsAt: null,
    }),
    "provider-warning:proposer:-",
  );
});

test("CT-127-36: a warning PASSES THROUGH from a classification, and is not invented", () => {
  const classification = classify({
    structuredClass: "rate_limit_transient",
    rateLimitType: "requests-per-minute",
    utilization: 0.9,
    resetsAt: { structured: RESET },
  });
  const warning = warningOfClassification(classification, "proposer");
  assert.notEqual(warning, null);
  assert.equal(warning?.utilization, 0.9);
  assert.equal(warning?.rateLimitType, "requests-per-minute");
  assert.equal(warning?.resetsAt, RESET);

  // A classification with neither a utilization nor a rate-limit type is no
  // warning at all: the engine does not make one up.
  const bare = classify({ errorText: "something went wrong" });
  assert.equal(warningOfClassification(bare, "proposer"), null);
});

test("CT-127-36: the warning fires once per key and again after a re-arm", () => {
  const ports = testPorts();
  const warning = {
    role: "proposer",
    utilization: 0.8,
    rateLimitType: "tokens-per-window",
    resetsAt: RESET,
  };
  const first = raiseProviderWarning(ports.eventWriter, warning, emptyAlertState());
  assert.notEqual(first.event, null);
  const second = raiseProviderWarning(ports.eventWriter, warning, first.state);
  assert.equal(second.event, null);
  assert.equal(ports.eventWriter.countOf("alert"), 1);
  const third = raiseProviderWarning(ports.eventWriter, warning, rearm(first.state, "proposer"));
  assert.notEqual(third.event, null);
  assert.equal(ports.eventWriter.countOf("alert"), 2);
});

test("CT-127-36: an alert free-text field of a provider still passes the redactor", () => {
  const ports = testPorts();
  providerWarningAlert(
    ports.eventWriter,
    {
      role: "proposer",
      utilization: 0.5,
      rateLimitType: "quota for sk-ABCDEF1234567890 is low",
      resetsAt: null,
    },
    { redact: fakeRedact },
  );
  const message = String(ports.eventWriter.of("alert")[0].payload.message);
  assert.ok(!message.includes("sk-ABCDEF1234567890"));
  assert.match(message, /\[REDACTED\]/);
});

test("CT-127-36: with a subscription the engine tracks what it OBSERVES", () => {
  assert.equal(THE_ALLOWANCE_IS_UNKNOWN_UNTIL_THE_PROVIDER_SIGNALS_IT, true);
  assert.deepEqual([...OBSERVED_FACTS], ["tokens", "notionalCostUsd", "passes", "utilization"]);
  let state = emptyObservedState();
  state = observe(state, {
    role: "proposer",
    resetsAt: RESET,
    tokens: 1_000,
    notionalCostUsd: 0.4,
    closesAPass: true,
    utilization: 0.1,
  });
  state = observe(state, { role: "proposer", resetsAt: RESET, tokens: 500, notionalCostUsd: 0.2 });
  const window = state[windowKeyOf("proposer", RESET)];
  assert.equal(window.tokens, 1_500, "tokens per role per window");
  assert.ok(Math.abs((window.notionalCostUsd ?? 0) - 0.6) < 1e-9, "notional cost");
  assert.equal(window.passes, 1, "passes");
  assert.equal(window.utilization, 0.1, "the utilization the provider gave");
  assert.equal(window.window, RESET, "the harness's own window");
});

test("CT-127-36: a harness that reports no reset accumulates for the whole run", () => {
  assert.equal(WINDOW_OF_THE_RUN, "run");
  let state = emptyObservedState();
  state = observe(state, { role: "critic", tokens: 10 });
  state = observe(state, { role: "critic", tokens: 15 });
  assert.equal(state[windowKeyOf("critic", "run")].tokens, 25);
  assert.equal(observedTokensOf(state, "critic"), 25);
  assert.equal(windowsOf(state, "critic").length, 1);
  // Two windows of one role are kept apart.
  state = observe(state, { role: "critic", resetsAt: RESET, tokens: 7 });
  assert.equal(windowsOf(state, "critic").length, 2);
  assert.equal(observedTokensOf(state, "critic"), 32);
  // And a reset forgets the window's figures.
  const closed = closeWindow(state, "critic", RESET);
  assert.equal(observedTokensOf(closed, "critic"), 25);
});

test("CT-127-36: the soft budget is a soft ceiling and never a cap of spend", () => {
  assert.equal(softTokensKeyOf("proposer"), "budget.role.proposer.softTokens");
  const ceiling = softCeilingOf("proposer", 10_000);
  assert.equal(ceiling.dimension, SOFT_DIMENSION);
  assert.equal(ceiling.scope, "role");
  assert.equal(kindOf(SOFT_DIMENSION), "soft");
  let state = emptyObservedState();
  state = observe(state, { role: "proposer", tokens: 8_000 });
  const reading = softReading("proposer", 10_000, state);
  assert.equal(reading.kind, "soft");
  assert.equal(reading.isCapOfSpend, false);
  assert.equal(reading.active, true);
  assert.equal(reading.used, 8_000);
  assert.equal(reading.limit, 10_000);
  assert.equal(reading.exhausted, false);
});

test("CT-127-36: SOFT TOKENS alert at 50 `info`, 75 and 90 `warn` — never `loud`", () => {
  const ports = testPorts();
  let observed = emptyObservedState();
  observed = observe(observed, { role: "proposer", tokens: 9_500 });
  const reading = softReading("proposer", 10_000, observed);
  const result = raiseSoftAlerts(ports.eventWriter, { reading, state: emptyAlertState() });
  assert.deepEqual(
    result.raised.map((item) => [item.threshold, item.level]),
    [
      [50, "info"],
      [75, "warn"],
      [90, "warn"],
    ],
  );
  assert.equal(ports.eventWriter.countOf("alert"), 3);
  for (const event of ports.eventWriter.of("alert")) {
    assert.notEqual(event.payload.level, "loud", "no metered money is at risk");
    assert.equal(event.payload.role, "proposer");
    assert.equal(event.payload.limit, 10_000);
  }
});

test("CT-127-36: a soft budget PAST its limit still alerts — there is no `budget.exceeded` for it", () => {
  const ports = testPorts();
  let observed = emptyObservedState();
  observed = observe(observed, { role: "proposer", tokens: 25_000 });
  const reading = softReading("proposer", 10_000, observed);
  assert.equal(reading.exhausted, true);
  assert.equal(reading.over, 15_000);
  const result = raiseSoftAlerts(ports.eventWriter, { reading, state: emptyAlertState() });
  assert.deepEqual(
    result.raised.map((item) => item.threshold),
    [50, 75, 90],
  );
  assert.equal(ports.eventWriter.countOf("budget.exceeded"), 0);
});

test("CT-127-36: a soft alert fires once per key, and a window reset re-arms it", () => {
  const ports = testPorts();
  let observed = emptyObservedState();
  observed = observe(observed, { role: "proposer", resetsAt: RESET, tokens: 6_000 });
  const reading = softReading("proposer", 10_000, observed);
  const first = raiseSoftAlerts(ports.eventWriter, { reading, state: emptyAlertState() });
  assert.equal(first.raised.length, 1);
  const second = raiseSoftAlerts(ports.eventWriter, { reading, state: first.state });
  assert.equal(second.raised.length, 0);
  assert.equal(ports.eventWriter.countOf("alert"), 1);
  const third = raiseSoftAlerts(ports.eventWriter, {
    reading,
    state: rearm(first.state, "proposer"),
  });
  assert.equal(third.raised.length, 1);
});

test("CT-127-36: a soft budget that is off raises nothing", () => {
  let observed = emptyObservedState();
  observed = observe(observed, { role: "proposer", tokens: 99_999 });
  for (const limit of [0, null, undefined]) {
    const reading = softReading("proposer", limit, observed);
    assert.equal(reading.active, false, String(limit));
    assert.deepEqual(
      [...decideSoftAlerts({ reading, state: emptyAlertState() })],
      [],
      String(limit),
    );
  }
});

test("CT-127-36: a notional cost that no record reported stays unknown", () => {
  let state = emptyObservedState();
  state = observe(state, { role: "proposer", tokens: 10 });
  assert.equal(state[windowKeyOf("proposer", "run")].notionalCostUsd, null);
  state = observe(state, { role: "proposer", tokens: 10, notionalCostUsd: 1.5 });
  assert.equal(state[windowKeyOf("proposer", "run")].notionalCostUsd, 1.5);
});
