/**
 * T047 / CT-131-30 — the context window of the critic outside the `parity`
 * profile (F131-FR-030).
 *
 * The order of the window sources: the consumer's declaration; the
 * model-list endpoint, where it reports a window; the table of this adapter
 * (`data/window-table.json`, provenance `adapter`, dated). Where a declared
 * and an effective window differ, the SMALLER wins. A model with no known
 * window does not qualify for an automatic pick, a critic the consumer
 * configured on such a model with no declared window is refused, and NEITHER
 * gets a default window — the fallback of 128,000 is under `parity` only
 * (DV-106). The rule holds for BOTH forms: form (a) runs on a model whose
 * window is known, form (b) is refused the same way.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  PARITY_FALLBACK_TOKENS,
  WINDOW_REFUSAL,
  callCriticDirect,
  loadWindowTable,
  resolveCriticWindow,
} from "../src/critic-direct.ts";
import { buildFormAInvocation } from "../src/critic-readonly.ts";

const TABLE = loadWindowTable();

test("CT-131-30: the order of the window sources outside parity — declared, then endpoint, then the adapter table", () => {
  // 1. the consumer's declaration wins over everything.
  assert.deepEqual(
    resolveCriticWindow({
      model: "gpt-5",
      profile: "default",
      declared: 10_000,
      endpointWindow: 999_999,
      table: TABLE,
    }),
    { tokens: 10_000, source: "declared" },
  );
  // 2. the endpoint, where it reports a window, beats the table.
  assert.deepEqual(
    resolveCriticWindow({
      model: "gpt-5",
      profile: "default",
      endpointWindow: 333_333,
      table: TABLE,
    }),
    { tokens: 333_333, source: "endpoint" },
  );
  // 3. the table of the adapter is the last source.
  assert.deepEqual(
    resolveCriticWindow({
      model: "gpt-5",
      profile: "default",
      table: TABLE,
    }),
    { tokens: 400_000, source: "adapter" },
  );
  // The fallback of the parity profile is NOT a source outside it.
  assert.notEqual(TABLE.models["gpt-5-unlisted-131"], PARITY_FALLBACK_TOKENS);
});

test("CT-131-30: where a declared and an effective window differ, the smaller wins", () => {
  const smallerDeclared = resolveCriticWindow({
    model: "gpt-5.5",
    profile: "default",
    declared: 200_000,
    endpointWindow: 900_000,
    table: TABLE,
  });
  assert.equal(smallerDeclared?.tokens, 200_000);
  const smallerEffective = resolveCriticWindow({
    model: "gpt-5.5",
    profile: "default",
    declared: 900_000,
    endpointWindow: 200_000,
    table: TABLE,
  });
  assert.equal(smallerEffective?.tokens, 200_000);
  assert.equal(smallerEffective?.source, "endpoint", "the source names where the value came from");
});

test("CT-131-30: an unknown model does not qualify — no fallback, no default window, outside parity", () => {
  assert.equal(
    resolveCriticWindow({ model: "gpt-5-unlisted-131", profile: "default", table: TABLE }),
    null,
    "no window of any kind: the model does not qualify",
  );
  // Under parity the SAME model still gets the as-is fallback (DV-106).
  assert.equal(
    resolveCriticWindow({ model: "gpt-5-unlisted-131", profile: "parity", table: TABLE })?.tokens,
    128_000,
  );
});

test("CT-131-30: a configured critic on an unknown model is refused, form (b), with no call", async () => {
  const outcome = await callCriticDirect({
    settings: {
      baseUrl: "https://api.openai.com/v1",
      key: "k",
      model: "gpt-5-unlisted-131",
      sources: { baseUrl: "default", key: "unset", model: "caller" },
    },
    prompt: "review",
    profile: "default",
    table: TABLE,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok ? "" : outcome.reason, WINDOW_REFUSAL);
  assert.match(outcome.ok ? "" : outcome.message, /does not qualify/);
});

test("CT-131-30: an automatic pick cannot choose a model whose window is unknown — the role plan must name a listed model, both forms", () => {
  // Form (b): the pick is the model of the descriptor; only a listed model
  // resolves to a window, so only it qualifies.
  for (const model of ["gpt-5", "gpt-5.5", "gpt-5.4", "gpt-5.4-pro"]) {
    assert.notEqual(resolveCriticWindow({ model, profile: "default", table: TABLE }), null, model);
  }
  assert.equal(
    resolveCriticWindow({ model: "gpt-5-unlisted-131", profile: "default", table: TABLE }),
    null,
  );
  // Form (a): the invocation of the read-only sandbox carries `-m {model}`,
  // and the same window rule refuses a model with no known window there too.
  const invocation = buildFormAInvocation({
    workdir: "/w",
    model: "gpt-5",
  });
  assert.ok(invocation.args.includes("-m"), "form (a) names the model of the role plan");
  const named = invocation.args[invocation.args.indexOf("-m") + 1];
  assert.notEqual(resolveCriticWindow({ model: named!, profile: "default", table: TABLE }), null);
});
