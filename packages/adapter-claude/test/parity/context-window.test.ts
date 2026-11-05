// PT-125-C-066-context-window (T037) — the critic runs only on a model whose
// context window is known up front (F125-FR-027; C-066; B-0911; DV-106):
//   - the table of the as-is critic: 1,000,000 tokens for the listed Opus,
//     Sonnet, Fable and Mythos ids, 200,000 for the Haiku id;
//   - the consumer's explicit window (roles.critic.contextTokens, as-is
//     variable SPECSTRIDE_CRITIC_CONTEXT_TOKENS) ALWAYS wins;
//   - under the `parity` profile only, an unlisted Claude model falls back
//     to 200,000 tokens, as the baseline does;
//   - outside `parity` there is NO default window: an unlisted model without
//     a declared window does not qualify as critic and the call is refused,
//     naming the model and the key to set.
// Surfaces: stdout (the resolved window on the call record), state
// (data/models.json is the table; data, never a rule).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  CONTEXT_WINDOW_TABLE,
  CONTEXT_WINDOW_VARIABLE_PLACEHOLDER,
  CRITIC_CONTEXT_TOKENS_VARIABLE,
  CriticDirectRefusedError,
  PARITY_FALLBACK_CONTEXT_TOKENS,
  contextWindowFor,
} from "../../src/critic-direct.ts";

const DATA_MODELS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "models.json",
);

describe("PT-125-C-066-context-window — the context window of the critic (F125-FR-027)", () => {
  it("the table gives 1,000,000 to the listed Opus, Sonnet, Fable and Mythos ids, 200,000 to the Haiku id (B-0911)", () => {
    const windows = CONTEXT_WINDOW_TABLE.windows;
    for (const model of [
      "claude-opus-4-8",
      "claude-opus-4-5",
      "claude-sonnet-4-5",
      "claude-fable-1",
      "claude-mythos-1",
    ]) {
      assert.equal(windows[model], 1_000_000, model);
    }
    assert.equal(windows["claude-haiku-4-5"], 200_000);
  });

  it("the table is DATA of data/models.json, not a rule in code", () => {
    const parsed = JSON.parse(readFileSync(DATA_MODELS, "utf8")) as {
      contextWindows: { windows: Record<string, number>; parityFallbackTokens: number };
    };
    assert.equal(parsed.contextWindows.windows["claude-opus-4-8"], 1_000_000);
    assert.equal(parsed.contextWindows.parityFallbackTokens, 200_000);
    assert.deepEqual(CONTEXT_WINDOW_TABLE.windows, parsed.contextWindows.windows);
  });

  it("the consumer's explicit window always wins, under either profile", () => {
    assert.equal(
      contextWindowFor({
        model: "claude-haiku-4-5",
        profile: "default",
        declared: 128_000,
      }),
      128_000,
    );
    assert.equal(
      contextWindowFor({ model: "claude-opus-4-8", profile: "parity", declared: 64_000 }),
      64_000,
    );
    assert.equal(CONTEXT_WINDOW_VARIABLE_PLACEHOLDER, "SPECSTRIDE_CRITIC_CONTEXT_TOKENS");
    assert.equal(CRITIC_CONTEXT_TOKENS_VARIABLE, "SPECSTRIDE_CRITIC_CONTEXT_TOKENS");
  });

  it("under `parity` only, an unlisted model falls back to 200,000 tokens", () => {
    assert.equal(
      contextWindowFor({ model: "claude-something-new", profile: "parity" }),
      PARITY_FALLBACK_CONTEXT_TOKENS,
    );
    assert.equal(PARITY_FALLBACK_CONTEXT_TOKENS, 200_000);
  });

  it("outside `parity`, an unlisted model without a declared window is refused, naming the model and the key to set", () => {
    assert.throws(
      () => contextWindowFor({ model: "claude-something-new", profile: "default" }),
      (error: unknown) =>
        error instanceof CriticDirectRefusedError &&
        error.reason === "context-window-unknown" &&
        error.message.includes("claude-something-new") &&
        error.message.includes("SPECSTRIDE_CRITIC_CONTEXT_TOKENS"),
    );
  });
});
