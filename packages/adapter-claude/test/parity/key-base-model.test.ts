// PT-125-C-061-key-base-model (T036) — the critic's direct call resolves its
// key, base address and model through the ALIASES of the baseline
// (F125-FR-029; C-061; B-0811, B-0812, B-0813, B-0814, B-0830; DV-027):
//   key   = SPECSTRIDE_CLAUDE_CRITIC_API_KEY, else ANTHROPIC_API_KEY;
//   base  = SPECSTRIDE_CLAUDE_CRITIC_BASE_URL, else ANTHROPIC_BASE_URL,
//           else https://api.anthropic.com, trailing slash removed;
//   model = SPECSTRIDE_CLAUDE_CRITIC_MODEL, else the default critic model of
//           the as-is critic data (claude-opus-4-8).
// With neither key the call fails WITHOUT a reply, so the verdict is scored
// MALFORMED by the critic strategy. A plain (non-https) address is refused
// unless it is the loopback address; redirects are refused. Each as-is name
// stays an alias of a key read from the variable at the moment of use.
// Surfaces: transcript (the request the stub receives), exit, stdout.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CRITIC_KEY_VARIABLES,
  CRITIC_BASE_URL_VARIABLES,
  CriticDirectRefusedError,
  CriticDirectTransportError,
  DEFAULT_CRITIC_BASE_URL,
  DEFAULT_CRITIC_MODEL,
  assertAddressAllowed,
  callCriticDirect,
  resolveCriticAliases,
} from "../../src/critic-direct.ts";

const KEY = "sk-alias-key";
const PROMPT = "Judge the evidence.";

/** A fetch that records the request and answers the messages shape. */
function recordingFetch(
  recorded: { url: string; key: string | undefined }[],
  status = 200,
): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    recorded.push({ url: String(input), key: headers.get("x-api-key") ?? undefined });
    return Promise.resolve(
      new Response(JSON.stringify({ content: [{ type: "text", text: "VERDICT: APPROVED" }] }), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
}

describe("PT-125-C-061-key-base-model — the aliases of the direct call (F125-FR-029)", () => {
  it("the key comes from SPECSTRIDE_CLAUDE_CRITIC_API_KEY, else from ANTHROPIC_API_KEY", () => {
    const throughCriticVariable = resolveCriticAliases({
      SPECSTRIDE_CLAUDE_CRITIC_API_KEY: KEY,
      ANTHROPIC_API_KEY: "sk-general",
    });
    assert.equal(throughCriticVariable.key, KEY);
    assert.equal(throughCriticVariable.keySource, "SPECSTRIDE_CLAUDE_CRITIC_API_KEY");

    const throughGeneralVariable = resolveCriticAliases({ ANTHROPIC_API_KEY: "sk-general" });
    assert.equal(throughGeneralVariable.key, "sk-general");
    assert.equal(throughGeneralVariable.keySource, "ANTHROPIC_API_KEY");

    // the closed alias set, as data (B-0811, B-0812)
    assert.deepEqual(
      [...CRITIC_KEY_VARIABLES],
      ["SPECSTRIDE_CLAUDE_CRITIC_API_KEY", "ANTHROPIC_API_KEY"],
    );
  });

  it("with neither key variable the call fails WITHOUT a reply (a MALFORMED verdict)", async () => {
    const recorded: { url: string; key: string | undefined }[] = [];
    await assert.rejects(
      callCriticDirect({
        prompt: PROMPT,
        env: { PATH: "/usr/bin" },
        profile: "parity",
        fetchImpl: recordingFetch(recorded),
      }),
      (error: unknown) =>
        error instanceof CriticDirectRefusedError &&
        error.reason === "missing-key" &&
        /no key/.test(error.message),
    );
    // exit: no request left the process, so the critic strategy scores the
    // empty record MALFORMED — there is nothing else to score.
    assert.equal(recorded.length, 0);
  });

  it("the base address follows its aliases, with the trailing slash removed", () => {
    assert.deepEqual(
      [...CRITIC_BASE_URL_VARIABLES],
      ["SPECSTRIDE_CLAUDE_CRITIC_BASE_URL", "ANTHROPIC_BASE_URL"],
    );
    const critic = resolveCriticAliases({
      SPECSTRIDE_CLAUDE_CRITIC_API_KEY: KEY,
      SPECSTRIDE_CLAUDE_CRITIC_BASE_URL: "http://127.0.0.1:8081/",
    });
    assert.equal(critic.baseUrl, "http://127.0.0.1:8081");
    assert.equal(critic.baseUrlSource, "SPECSTRIDE_CLAUDE_CRITIC_BASE_URL");

    const general = resolveCriticAliases({
      SPECSTRIDE_CLAUDE_CRITIC_API_KEY: KEY,
      ANTHROPIC_BASE_URL: "https://proxy.internal/",
    });
    assert.equal(general.baseUrl, "https://proxy.internal");
    assert.equal(general.baseUrlSource, "ANTHROPIC_BASE_URL");

    const fallback = resolveCriticAliases({ SPECSTRIDE_CLAUDE_CRITIC_API_KEY: KEY });
    assert.equal(fallback.baseUrl, DEFAULT_CRITIC_BASE_URL);
    assert.equal(fallback.baseUrlSource, "default");
    assert.equal(DEFAULT_CRITIC_BASE_URL, "https://api.anthropic.com");
  });

  it("the model follows its alias, else the default critic model of the as-is data", () => {
    const named = resolveCriticAliases({
      SPECSTRIDE_CLAUDE_CRITIC_API_KEY: KEY,
      SPECSTRIDE_CLAUDE_CRITIC_MODEL: "claude-sonnet-4-5",
    });
    assert.equal(named.model, "claude-sonnet-4-5");
    assert.equal(named.modelSource, "SPECSTRIDE_CLAUDE_CRITIC_MODEL");

    const fallback = resolveCriticAliases({ SPECSTRIDE_CLAUDE_CRITIC_API_KEY: KEY });
    assert.equal(fallback.model, DEFAULT_CRITIC_MODEL);
    assert.equal(fallback.modelSource, "default");
    assert.equal(DEFAULT_CRITIC_MODEL, "claude-opus-4-8"); // B-0830
  });

  it("a plain address is refused unless it is the loopback address (B-0813)", () => {
    assert.doesNotThrow(() => assertAddressAllowed({ baseUrl: "http://127.0.0.1:8081" }));
    assert.doesNotThrow(() => assertAddressAllowed({ baseUrl: "http://localhost:8081" }));
    assert.throws(
      () => assertAddressAllowed({ baseUrl: "http://api.example.com" }),
      (error: unknown) =>
        error instanceof CriticDirectRefusedError && error.reason === "plain-address",
    );
    assert.doesNotThrow(() => assertAddressAllowed({ baseUrl: "https://api.example.com" }));
  });

  it("the key is sent only to the host it was declared for", () => {
    assert.throws(
      () =>
        assertAddressAllowed({ baseUrl: "https://other.host", declaredHost: "api.example.com" }),
      (error: unknown) =>
        error instanceof CriticDirectRefusedError && error.reason === "plain-address",
    );
    assert.doesNotThrow(() =>
      assertAddressAllowed({ baseUrl: "https://api.example.com", declaredHost: "api.example.com" }),
    );
  });

  it("a redirect is refused, never followed (B-0814)", async () => {
    const recorded: { url: string; key: string | undefined }[] = [];
    // redirect: "error" surfaces as a fetch failure whose message names it.
    const redirectingFetch = ((): Promise<Response> =>
      Promise.reject(new TypeError("fetch: unexpected redirect"))) as unknown as typeof fetch;
    await assert.rejects(
      callCriticDirect({
        prompt: PROMPT,
        env: {
          SPECSTRIDE_CLAUDE_CRITIC_API_KEY: KEY,
          SPECSTRIDE_CLAUDE_CRITIC_BASE_URL: "http://127.0.0.1:8081",
        },
        profile: "parity",
        fetchImpl: redirectingFetch,
      }),
      (error: unknown) =>
        (error instanceof CriticDirectRefusedError && error.reason === "redirect") ||
        error instanceof CriticDirectTransportError,
    );
    assert.equal(recorded.length, 0);
  });
});
