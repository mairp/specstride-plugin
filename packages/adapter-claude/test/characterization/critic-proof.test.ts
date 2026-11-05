// CT-125-18 (T039) — the proof refuses EVERY bad initial record
// (F125-FR-024; FX-05): a record with a tool, with a tool server, with a
// plugin, with a foreign session id, with a proposer session id, and a
// stream with no record at all. The refusal is `critic_not_toolless`, a
// critic configuration error (engine exit 3, stop reason `critic_config`),
// and the result of the proof is recorded in the call record of the call,
// refused ones included. Surfaces: state (the call record), exit.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CRITIC_ENGINE_EXIT,
  CRITIC_NOT_TOOLLESS,
  CRITIC_STOP_REASON,
  CriticConfigError,
  PROOF_OUTCOMES,
  assertProofHolds,
  callCriticCli,
  lastCriticCallRecordOf,
  proveToolless,
  readInitialRecord,
} from "../../src/critic-cli.ts";

const MINTED = "1a2b3c4d-5e6f-4918-8276-4561237890ab";
const PROPOSER = "9f8e7d6c-5b4a-4918-8276-4561237890ab";
const FOREIGN = "00000000-1111-4222-8333-4561237890ab";
const PROPOSER_IDS = new Set([PROPOSER]);

/** The initial-record line of a stream, from the shape capture D describes. */
function initLine(fields: Record<string, unknown>): string {
  return JSON.stringify({ type: "system", subtype: "init", ...fields });
}
const VERDICT_LINE = JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "text", text: "VERDICT: APPROVED" }] },
});

const BASE_INPUT = {
  mintedSessionId: MINTED,
  proposerSessionIds: PROPOSER_IDS,
};

describe("CT-125-18 — the proof of the tool-less critic (F125-FR-024)", () => {
  it("a good record is proven: empty tools, empty servers, the minted session id", () => {
    const record = readInitialRecord(
      [
        initLine({ session_id: MINTED, tools: [], mcp_servers: [], plugins: [] }),
        VERDICT_LINE,
      ].join("\n"),
    );
    assert.ok(record !== null);
    const proof = proveToolless({ ...BASE_INPUT, initialRecord: record });
    assert.deepEqual(proof, {
      outcome: "proven",
      toolsEmpty: true,
      serversEmpty: true,
      sessionMatches: true,
      sessionNotProposer: true,
    });
    assert.doesNotThrow(() => assertProofHolds(proof));
  });

  it("a record with a TOOL is refused", () => {
    const proof = proveToolless({
      ...BASE_INPUT,
      initialRecord: readInitialRecord(
        initLine({ session_id: MINTED, tools: ["Bash"], mcp_servers: [], plugins: [] }),
      ),
    });
    assert.equal(proof.outcome, "refused-tool");
    assertProofIsAConfigurationError(proof);
  });

  it("a record with a tool SERVER is refused", () => {
    const proof = proveToolless({
      ...BASE_INPUT,
      initialRecord: readInitialRecord(
        initLine({ session_id: MINTED, tools: [], mcp_servers: [{ name: "fs" }], plugins: [] }),
      ),
    });
    assert.equal(proof.outcome, "refused-server");
    assertProofIsAConfigurationError(proof);
  });

  it("a record with a PLUGIN is refused", () => {
    const proof = proveToolless({
      ...BASE_INPUT,
      initialRecord: readInitialRecord(
        initLine({ session_id: MINTED, tools: [], mcp_servers: [], plugins: ["audit-hook"] }),
      ),
    });
    assert.equal(proof.outcome, "refused-plugin");
    assertProofIsAConfigurationError(proof);
  });

  it("a FOREIGN session id is refused", () => {
    const proof = proveToolless({
      ...BASE_INPUT,
      initialRecord: readInitialRecord(
        initLine({ session_id: FOREIGN, tools: [], mcp_servers: [], plugins: [] }),
      ),
    });
    assert.equal(proof.outcome, "refused-session-foreign");
    assert.equal(proof.sessionMatches, false);
    assertProofIsAConfigurationError(proof);
  });

  it("a PROPOSER session id is refused, even though it equals the record's id", () => {
    const proof = proveToolless({
      ...BASE_INPUT,
      mintedSessionId: PROPOSER, // a proposer id minted as the critic's own
      initialRecord: readInitialRecord(
        initLine({ session_id: PROPOSER, tools: [], mcp_servers: [], plugins: [] }),
      ),
    });
    assert.equal(proof.outcome, "refused-session-proposer");
    assert.equal(proof.sessionNotProposer, false);
    assertProofIsAConfigurationError(proof);
  });

  it("NO record at all is refused — the proof cannot be read", () => {
    assert.equal(readInitialRecord("prose line\n\n{not json}\n"), null);
    const proof = proveToolless({ ...BASE_INPUT, initialRecord: null });
    assert.equal(proof.outcome, "refused-no-record");
    assertProofIsAConfigurationError(proof);
  });

  it("the outcomes are the closed set of the data model", () => {
    assert.deepEqual(
      [...PROOF_OUTCOMES],
      [
        "proven",
        "refused-tool",
        "refused-server",
        "refused-plugin",
        "refused-session-foreign",
        "refused-session-proposer",
        "refused-no-record",
      ],
    );
  });

  it("the refusal is recorded in the call record, with no verdict, before the error is raised", async () => {
    const badStream = [
      initLine({ session_id: MINTED, tools: ["Bash"], mcp_servers: [], plugins: [] }),
      VERDICT_LINE,
    ].join("\n");
    await assert.rejects(
      callCriticCli({
        prompt: "Judge the evidence.",
        model: "claude-opus-4-8",
        executable: "/usr/local/bin/claude",
        sessionId: MINTED,
        proposerSessionIds: PROPOSER_IDS,
        termsAllowed: true,
        processEnv: { PATH: "/usr/bin", HOME: "/home/consumer" },
        spawnCritic: () => ({ pid: 4245, stream: Promise.resolve(badStream) }),
      }),
      (error: unknown) =>
        error instanceof CriticConfigError &&
        error.reason === "critic_not_toolless" &&
        error.engineExit === CRITIC_ENGINE_EXIT &&
        error.stopReason === CRITIC_STOP_REASON,
    );
    // state: the result of the proof is IN the call record (F125-FR-024).
    const record = lastCriticCallRecordOf();
    assert.ok(record !== null);
    assert.equal(record.proof.outcome, "refused-tool");
    assert.equal(record.verdict, null);
    assert.equal(CRITIC_NOT_TOOLLESS, "critic_not_toolless");
    assert.equal(CRITIC_ENGINE_EXIT, 3);
    assert.equal(CRITIC_STOP_REASON, "critic_config");
  });

  it("a proven call records its proof on the call record too", async () => {
    const goodStream = [
      initLine({ session_id: MINTED, tools: [], mcp_servers: [], plugins: [] }),
      VERDICT_LINE,
    ].join("\n");
    const record = await callCriticCli({
      prompt: "Judge the evidence.",
      model: "claude-opus-4-8",
      executable: "/usr/local/bin/claude",
      sessionId: MINTED,
      proposerSessionIds: PROPOSER_IDS,
      termsAllowed: true,
      processEnv: { PATH: "/usr/bin", HOME: "/home/consumer" },
      spawnCritic: () => ({ pid: 4246, stream: Promise.resolve(goodStream) }),
    });
    assert.equal(record.proof.outcome, "proven");
    assert.equal(record.verdict, "VERDICT: APPROVED");
  });
});

/** The refusal of the proof is a critic configuration error that halts the run. */
function assertProofIsAConfigurationError(proof: { outcome: string }): void {
  assert.throws(
    () => assertProofHolds(proof as never),
    (error: unknown) =>
      error instanceof CriticConfigError &&
      error.reason === "critic_not_toolless" &&
      error.engineExit === 3 &&
      error.stopReason === "critic_config",
  );
}
