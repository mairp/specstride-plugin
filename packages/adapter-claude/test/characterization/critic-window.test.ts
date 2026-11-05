// CT-125-34 (T081) — the context window of a critic-class call
// (F125-FR-027, CQ-145, CQ-202): outside the `parity` profile an unlisted
// model without a declared window does NOT qualify and the critic-class
// call is refused with the model and the key named; a declared window
// wins; under `parity` the fallback is 200,000. Surfaces: the refusal
// record, transcript (the refusal message).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CONTEXT_WINDOW_TABLE,
  CONTEXT_WINDOW_VARIABLE_PLACEHOLDER,
  CriticDirectRefusedError,
  PARITY_FALLBACK_CONTEXT_TOKENS,
  callCriticDirect,
  contextWindowFor,
} from "../../src/critic-direct.ts";

const UNLISTED = "claude-fable-9-unlisted";

describe("CT-125-34 — the critic's context window (F125-FR-027)", () => {
  it("outside `parity` an unlisted model without a declared window does not qualify and is refused, naming the model and the key", () => {
    assert.ok(!(UNLISTED in CONTEXT_WINDOW_TABLE.windows));
    try {
      contextWindowFor({ model: UNLISTED, profile: "default", declared: null });
      assert.fail("the call must be refused");
    } catch (error) {
      assert.ok(error instanceof CriticDirectRefusedError);
      assert.match(error.message, new RegExp(UNLISTED));
      // The key to set is named: roles.critic.contextTokens or the
      // as-is variable.
      assert.match(error.message, /roles\.critic\.contextTokens/);
      assert.match(error.message, new RegExp(CONTEXT_WINDOW_VARIABLE_PLACEHOLDER));
    }
  });

  it("outside `parity` the refusal goes through the whole direct call, with the model and the key in the message", async () => {
    await assert.rejects(
      callCriticDirect({
        prompt: "give a verdict",
        profile: "default",
        env: {
          SPECSTRIDE_CLAUDE_CRITIC_API_KEY: "sk-test-key",
          SPECSTRIDE_CLAUDE_CRITIC_MODEL: UNLISTED,
        },
        fetchImpl: (async () => {
          throw new Error("no call may be made");
        }) as typeof fetch,
      }),
      (error: unknown) => {
        assert.ok(error instanceof CriticDirectRefusedError);
        assert.match(error.message, new RegExp(UNLISTED));
        assert.match(error.message, new RegExp(CONTEXT_WINDOW_VARIABLE_PLACEHOLDER));
        return true;
      },
    );
  });

  it("a declared window wins, over the table and over the parity fallback", () => {
    assert.equal(
      contextWindowFor({ model: UNLISTED, profile: "default", declared: 480_000 }),
      480_000,
    );
    // It wins even for a LISTED model, and under `parity`.
    const listed = Object.keys(CONTEXT_WINDOW_TABLE.windows)[0];
    const listedValue = CONTEXT_WINDOW_TABLE.windows[listed];
    assert.equal(
      contextWindowFor({ model: listed, profile: "parity", declared: 123_456 }),
      123_456,
    );
    assert.notEqual(123_456, listedValue);
  });

  it("under `parity` the fallback is 200,000, for an unlisted model and as the table's own value", () => {
    assert.equal(PARITY_FALLBACK_CONTEXT_TOKENS, 200_000);
    assert.equal(CONTEXT_WINDOW_TABLE.parityFallbackTokens, 200_000);
    assert.equal(contextWindowFor({ model: UNLISTED, profile: "parity", declared: null }), 200_000);
  });

  it("a listed model gets its table window under both profiles", () => {
    for (const [model, tokens] of Object.entries(CONTEXT_WINDOW_TABLE.windows)) {
      assert.equal(contextWindowFor({ model, profile: "parity", declared: null }), tokens);
      assert.equal(contextWindowFor({ model, profile: "default", declared: null }), tokens);
    }
  });
});
