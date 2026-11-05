/**
 * T037 — CT-109-102: characterization of Lisa's failure classification
 * (F109-FR-009).
 *
 * Lisa's provider seam classified provider failures into typed kinds and let
 * a structured code win over a match on text. This test pins that behavior
 * as the seam now carries it: whatever Lisa's clients classified, the seam's
 * `classify` must classify the same way, so the extraction changed nothing
 * about the kinds and nothing about the precedence.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { classify } from "../../src/failures/classify.ts";

test("CT-109-102: the kinds Lisa typed keep their names", () => {
  // Lisa's clients answered authentication, rate limiting, quota and
  // transport shapes of failure; each keeps its typed kind.
  const cases: readonly [string, string][] = [
    ["401 unauthorized: bad api key", "authentication_failed"],
    ["429 rate limit exceeded, please retry", "rate_limited"],
    ["insufficient quota on this subscription", "quota_exhausted"],
    ["connect ETIMEDOUT to api endpoint", "transport_failed"],
  ];
  for (const [text, kind] of cases) {
    assert.equal(classify({ text }).kind, kind, text);
  }
});

test("CT-109-102: a structured code wins over text, as in Lisa's seam", () => {
  // Lisa's SDK clients surfaced typed error codes; where a code was present
  // it decided, even when the body text suggested another family.
  assert.equal(
    classify({ structuredCode: "rate_limit_error", text: "please authenticate" }).kind,
    "rate_limited",
  );
});

test("CT-109-102: a code Lisa's clients never named still reads as agent_failure", () => {
  assert.equal(classify({ structuredCode: "E_UNKNOWN_LISA" }).kind, "agent_failure");
});

test("CT-109-102: what matched nothing in Lisa's seam matches nothing here", () => {
  assert.equal(classify({ text: "the model answered with a refused patch" }).kind, "agent_failure");
});
