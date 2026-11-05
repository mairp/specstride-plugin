// CT-125-21 (T042) — a critic-class call that FAILS gives NO verdict and a
// typed failure; a refused terms gate refuses the call (F125-FR-030; FX-06).
// The typed failures are the port's: error status, hang, non-zero exit and
// empty reply. The critic's credentials are never in the proposer's
// environment. Surfaces: exit, state (the call record), stdout.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CriticDirectTransportError,
  budgetCapMissing,
  callCriticDirect,
} from "../../src/critic-direct.ts";
import {
  CriticTransportError,
  callCriticCli,
  lastCriticCallRecordOf,
} from "../../src/critic-cli.ts";
import { CREDENTIAL_VARS, buildCallEnvironment } from "../../src/invoke-proposer.ts";

const MINTED = "4d5e6f7a-8b9c-4918-8276-4561237890ab";
const KEY = "sk-critic-key";
const DIRECT_ENV = { SPECSTRIDE_CLAUDE_CRITIC_API_KEY: KEY } as Record<string, string | undefined>;

/** A fetch that answers the given status, or hangs the connection. */
function statusFetch(status: number, body: unknown): typeof fetch {
  return ((): Promise<Response> =>
    Promise.resolve(new Response(JSON.stringify(body), { status }))) as typeof fetch;
}
function hangingFetch(): typeof fetch {
  return ((): Promise<Response> =>
    Promise.reject(new Error("connection reset before answer"))) as typeof fetch;
}

const CLI_INPUT = {
  prompt: "Judge the evidence.",
  model: "claude-opus-4-8",
  executable: "/usr/local/bin/claude",
  sessionId: MINTED,
  proposerSessionIds: new Set<string>(),
  termsAllowed: true,
  processEnv: { PATH: "/usr/bin", HOME: "/home/consumer" } as Record<string, string | undefined>,
};

describe("CT-125-21 — a failed critic call and a refused terms gate (F125-FR-030)", () => {
  it("a non-zero exit gives a typed failure and NO verdict, on the CLI transport", async () => {
    await assert.rejects(
      callCriticCli({
        ...CLI_INPUT,
        spawnCritic: () => ({
          pid: 4251,
          stream: Promise.reject(
            new CriticTransportError("non-zero-exit", "the critic CLI ended with exit 1"),
          ),
        }),
      }),
      (error: unknown) => error instanceof CriticTransportError && error.kind === "non-zero-exit",
    );
    // state: no verdict, a failure kind on the call record.
    const record = lastCriticCallRecordOf();
    assert.ok(record !== null);
    assert.equal(record.verdict, null);
    assert.equal(record.failure?.kind, "non-zero-exit");
    assert.equal(record.proof.outcome, "refused-no-record");
  });

  it("an empty reply gives the typed empty-reply failure and NO verdict", async () => {
    const emptyStream = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: MINTED,
      tools: [],
      mcp_servers: [],
      plugins: [],
    });
    await assert.rejects(
      callCriticCli({
        ...CLI_INPUT,
        spawnCritic: () => ({ pid: 4252, stream: Promise.resolve(emptyStream) }),
      }),
      (error: unknown) => error instanceof CriticTransportError && error.kind === "empty-reply",
    );
    const record = lastCriticCallRecordOf();
    assert.ok(record !== null);
    assert.equal(record.verdict, null);
    assert.equal(record.failure?.kind, "empty-reply");
  });

  it("a hang gives the typed hang failure and NO verdict, on the direct transport", async () => {
    await assert.rejects(
      callCriticDirect({
        prompt: "Judge the evidence.",
        env: DIRECT_ENV,
        profile: "default",
        fetchImpl: hangingFetch(),
      }),
      (error: unknown) => error instanceof CriticDirectTransportError && error.kind === "hang",
    );
  });

  it("an error status gives the typed error-status failure and NO verdict, on the direct transport", async () => {
    await assert.rejects(
      callCriticDirect({
        prompt: "Judge the evidence.",
        env: DIRECT_ENV,
        profile: "default",
        fetchImpl: statusFetch(503, { error: { type: "overloaded_error" } }),
      }),
      (error: unknown) =>
        error instanceof CriticDirectTransportError && error.kind === "error-status",
    );
  });

  it("a refused terms gate refuses the CLI call before it is made", async () => {
    let spawned = false;
    await assert.rejects(
      callCriticCli({
        ...CLI_INPUT,
        termsAllowed: false,
        spawnCritic: () => {
          spawned = true;
          return { pid: 4253, stream: Promise.resolve("") };
        },
      }),
      (error: unknown) =>
        error instanceof Error &&
        error.name === "TermsGateRefusedError" &&
        (error as { reason?: string }).reason === "terms-refused",
    );
    assert.equal(spawned, false, "no process was started");
  });

  it("a refused terms gate refuses the direct call before it is made", async () => {
    let fetched = false;
    const watchingFetch: typeof fetch = ((): Promise<Response> => {
      fetched = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;
    await assert.rejects(
      callCriticDirect({
        prompt: "Judge the evidence.",
        env: DIRECT_ENV,
        profile: "default",
        termsAllowed: false,
        fetchImpl: watchingFetch,
      }),
      (error: unknown) =>
        error instanceof Error &&
        error.name === "TermsGateRefusedError" &&
        (error as { reason?: string }).reason === "terms-refused",
    );
    assert.equal(fetched, false, "no request left the process");
  });

  it("the critic's credentials are never in the proposer's environment", () => {
    const proposerEnv = buildCallEnvironment({
      role: "proposer",
      profile: "default",
      authTier: 1,
      processEnv: {
        PATH: "/usr/bin",
        HOME: "/home/consumer",
        SPECSTRIDE_CLAUDE_CRITIC_API_KEY: KEY,
        ANTHROPIC_API_KEY: KEY,
      },
    });
    for (const name of CREDENTIAL_VARS.critic) {
      assert.equal(Object.keys(proposerEnv).includes(name), false, name);
    }
  });

  it("where no per-call cap is set, the doctor's warning condition holds (F125-FR-027)", () => {
    // the caps are data; the per-call cap stays null until capture confirms
    // it holds under a subscription login, and null is never guessed.
    assert.equal(budgetCapMissing(), true);
  });
});
