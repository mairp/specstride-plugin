/**
 * T035 — CT-109-9: `classify` (F109-FR-009).
 *
 * The closed vocabulary; a structured code wins over a match on text; what
 * matches no entry is `agent_failure`; for a declared harness the `failures`
 * map is the only source; an authentication failure names what to fix.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUILTIN_CODES,
  TYPED_FAILURES,
  TEXT_RULES,
  UNKNOWN_FAILURE,
  classify,
  readFailuresMap,
} from "../../src/failures/classify.ts";

test("CT-109-9: the vocabulary is the closed set of typed failures and nothing else", () => {
  assert.deepEqual(
    [...TYPED_FAILURES],
    [
      "authentication_failed",
      "rate_limited",
      "quota_exhausted",
      "context_window_exceeded",
      "transport_failed",
      "agent_failure",
      "capability_absent",
      "critic_not_toolless",
    ],
  );
});

test("CT-109-9: every text rule names a member of the closed vocabulary", () => {
  for (const rule of TEXT_RULES) {
    assert.ok(
      (TYPED_FAILURES as readonly string[]).includes(rule.kind),
      `a text rule names ${rule.kind}, which is not in the vocabulary`,
    );
  }
  for (const rule of BUILTIN_CODES) {
    assert.ok((TYPED_FAILURES as readonly string[]).includes(rule.kind));
  }
});

test("CT-109-9: a structured code wins over a match on text", () => {
  // The text would read as rate_limited; the code decides.
  const got = classify({
    structuredCode: "invalid_api_key",
    text: "429 too many requests, slow down",
  });
  assert.equal(got.kind, "authentication_failed");
  assert.equal(got.code, "invalid_api_key");
});

test("CT-109-9: an unknown structured code still wins, and reads as agent_failure", () => {
  const got = classify({
    structuredCode: "E_WIDGET_FLUX",
    text: "context window exceeded: too many tokens",
  });
  assert.equal(got.kind, "agent_failure");
});

test("CT-109-9: what matches no entry is agent_failure", () => {
  assert.equal(classify({ text: "the agent wrote a bad patch" }).kind, UNKNOWN_FAILURE);
  assert.equal(classify({ text: "" }).kind, UNKNOWN_FAILURE);
});

test("CT-109-9: the text rules classify the five failure families", () => {
  assert.equal(
    classify({ text: "request failed with 401 unauthorized: invalid api key" }).kind,
    "authentication_failed",
  );
  assert.equal(classify({ text: "HTTP 429: rate limit exceeded" }).kind, "rate_limited");
  assert.equal(
    classify({ text: "you exceeded your current quota, check billing" }).kind,
    "quota_exhausted",
  );
  assert.equal(
    classify({ text: "prompt is too long: maximum context length reached" }).kind,
    "context_window_exceeded",
  );
  assert.equal(
    classify({ text: "FetchError: connect ECONNREFUSED 127.0.0.1:1" }).kind,
    "transport_failed",
  );
});

test("CT-109-9: for a declared harness the failures map is the only source", () => {
  const map = { E_DSH_PATCH: "agent_failure", E_DSH_AUTH: "authentication_failed" };
  // The map decides, even where its code names an UNKNOWN kind literal.
  assert.equal(
    classify({ structuredCode: "E_DSH_AUTH", text: "429 rate limit", failuresMap: map }).kind,
    "authentication_failed",
  );
  // Text alone no longer classifies for a declared harness.
  assert.equal(
    classify({ text: "429 rate limit exceeded", failuresMap: map }).kind,
    UNKNOWN_FAILURE,
  );
  // A code outside the map is not run through the built-in codes.
  assert.equal(
    classify({ structuredCode: "invalid_api_key", text: "401", failuresMap: map }).kind,
    UNKNOWN_FAILURE,
  );
});

test("CT-109-9: readFailuresMap accepts only members of the closed vocabulary", () => {
  assert.equal(readFailuresMap({ A: "rate_limited" }, "A"), "rate_limited");
  assert.equal(readFailuresMap({ A: "not_a_kind" }, "A"), UNKNOWN_FAILURE);
  assert.equal(readFailuresMap({ A: "rate_limited" }, "B"), UNKNOWN_FAILURE);
  assert.equal(readFailuresMap(null, "A"), UNKNOWN_FAILURE);
});

test("CT-109-9: an authentication failure is reported as such and names what to fix", () => {
  const got = classify({ structuredCode: "invalid_api_key", harness: "harness-a" });
  assert.equal(got.kind, "authentication_failed");
  assert.ok(got.fix !== null);
  assert.match(got.fix!, /credential/);
  assert.match(got.fix!, /harness-a/);
  // And from text alone.
  const fromText = classify({ text: "Error: 401 unauthorized" });
  assert.equal(fromText.kind, "authentication_failed");
  assert.ok(fromText.fix !== null && fromText.fix.length > 0);
});

test("CT-109-9: the typed failure carries no verdict — the seam scores nothing", () => {
  const got = classify({ text: "429" });
  assert.ok(!("verdict" in got));
  assert.ok(!("exit_code" in got));
});
