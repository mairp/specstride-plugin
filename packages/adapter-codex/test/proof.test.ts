/**
 * T038 / CT-131-20 — the proof of a form (a) call (F131-FR-020).
 *
 * The call record shows the five facts — the sandbox mode, the network
 * setting, the ephemeral flag, the session id of the first record of the
 * stream and `confirmed` — each with the source it came from, and names
 * case (2) of F100-FR-230. A record that lacks a fact, or shows another
 * mode, another network setting, a session that is not ephemeral or no
 * session id, fails the proof: a configured critic is refused with
 * `critic_not_toolless`, which halts the run (engine exit 3, stop reason
 * `critic_config`), and an automatically picked critic is passed over with
 * the announcement.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CRITIC_CONFIG_EXIT,
  CRITIC_CONFIG_STOP_REASON,
  CRITIC_NOT_TOOLLESS,
  SESSION_PROOF_CASE,
  buildFormACallRecord,
  buildFormAInvocation,
  passOverCritic,
  proofOfFormA,
  readDenialProbe,
  type DenialProbeLocation,
} from "../src/critic-readonly.ts";

const PROBE = readDenialProbe({
  record: {
    deny: ["workspace-part", "control-plane", "event-stream", "worker-root", "tree-store"],
    moved: [],
    confirmed: null,
  },
  runnable: true,
  reads: ["workspace-part", "control-plane", "event-stream", "worker-root", "tree-store"].map(
    (location) => ({ location, planted: true, readSucceeded: false }) as DenialProbeLocation,
  ),
});

/** A call whose stream states nothing itself: the sources show it. */
function recordFrom(
  streamText: string,
  overrides: {
    sandboxMode?: string | null;
    networkFromStream?: string | null;
    ephemeralFromStream?: boolean | null;
  } = {},
) {
  return buildFormACallRecord({
    invocation: buildFormAInvocation({ workdir: "/w", model: "gpt-5" }),
    streamText,
    probe: PROBE,
    streamStatesSandboxMode: overrides.sandboxMode ?? null,
    networkFromStream: overrides.networkFromStream ?? null,
    ephemeralFromStream: overrides.ephemeralFromStream ?? null,
  });
}

const GOOD_STREAM = '{"type":"thread.started","thread_id":"critic-session-abc"}\n';

test("CT-131-20: the record shows the five facts and names case (2) of F100-FR-230", () => {
  const record = recordFrom(GOOD_STREAM);
  assert.equal(record.sandboxMode.value, "read-only");
  assert.equal(record.networkSetting.value, "off");
  assert.equal(record.ephemeral.value, true);
  assert.equal(record.sessionId.value, "critic-session-abc");
  assert.equal(record.confirmed.value, true);
  assert.equal(record.sessionProofCase, SESSION_PROOF_CASE);
  assert.match(SESSION_PROOF_CASE, /F100-FR-230 case 2/);
});

test("CT-131-20: each fact names its source — the stream where it states it, else the adapter's own record", () => {
  // The first record states no mode: all but the session id come from the
  // adapter's record of the invocation, and the record says so.
  const fromAdapter = recordFrom(GOOD_STREAM);
  assert.equal(fromAdapter.sandboxMode.source, "adapter-invocation-record");
  assert.equal(fromAdapter.networkSetting.source, "adapter-invocation-record");
  assert.equal(fromAdapter.ephemeral.source, "adapter-invocation-record");
  assert.equal(fromAdapter.sessionId.source, "stream-first-record");
  assert.equal(fromAdapter.confirmed.source, "read-denial-probe");
  // Where the first record DOES state a fact, the fact comes from it.
  const fromStream = recordFrom(GOOD_STREAM, {
    sandboxMode: "read-only",
    networkFromStream: "off",
    ephemeralFromStream: true,
  });
  assert.equal(fromStream.sandboxMode.source, "stream-first-record");
  assert.equal(fromStream.networkSetting.source, "stream-first-record");
  assert.equal(fromStream.ephemeral.source, "stream-first-record");
});

test("CT-131-20: a good record passes the proof", () => {
  const proof = proofOfFormA({
    record: recordFrom(GOOD_STREAM),
    passSessionIds: ["pass-session-1"],
  });
  assert.equal(proof.ok, true);
});

for (const [name, record] of [
  ["another mode", recordFrom(GOOD_STREAM, { sandboxMode: "workspace-write" })],
  ["another network setting", recordFrom(GOOD_STREAM, { networkFromStream: "on" })],
  ["a session that is not ephemeral", recordFrom(GOOD_STREAM, { ephemeralFromStream: false })],
  ["no session id", recordFrom('{"type":"turn.started"}\n')],
] as const) {
  test(`CT-131-20: a record showing ${name} fails the proof with critic_not_toolless, exit 3, critic_config`, () => {
    const proof = proofOfFormA({ record, passSessionIds: [] });
    assert.equal(proof.ok, false);
    if (proof.ok) return;
    assert.equal(proof.refusal, CRITIC_NOT_TOOLLESS);
    assert.equal(proof.engineExit, CRITIC_CONFIG_EXIT);
    assert.equal(proof.stopReason, CRITIC_CONFIG_STOP_REASON);
  });
}

test("CT-131-20: an unconfirmed read denial fails the proof the same way", () => {
  const record = buildFormACallRecord({
    invocation: buildFormAInvocation({ workdir: "/w", model: "gpt-5" }),
    streamText: GOOD_STREAM,
    probe: { confirmed: false, locations: [], reason: "a read succeeded" },
  });
  const proof = proofOfFormA({ record, passSessionIds: [] });
  assert.equal(proof.ok, false);
  if (proof.ok) return;
  assert.equal(proof.refusal, CRITIC_NOT_TOOLLESS);
  assert.ok(proof.problems.some((problem) => problem.includes("confirmed")));
});

test("CT-131-20: a session id a pass used fails the proof (F131-FR-021 rides the same refusal)", () => {
  const proof = proofOfFormA({
    record: recordFrom('{"type":"thread.started","thread_id":"pass-session-1"}\n'),
    passSessionIds: ["pass-session-1", "pass-session-2"],
  });
  assert.equal(proof.ok, false);
  if (proof.ok) return;
  assert.equal(proof.refusal, CRITIC_NOT_TOOLLESS);
  assert.equal(proof.engineExit, CRITIC_CONFIG_EXIT);
  assert.ok(proof.problems.some((problem) => problem.includes("equals one a pass")));
});

test("CT-131-20: a failed proof passes an automatically picked critic over with the announcement", () => {
  const proof = proofOfFormA({
    record: recordFrom(GOOD_STREAM, { sandboxMode: "allow-all" }),
    passSessionIds: [],
  });
  assert.equal(proof.ok, false);
  const order = ["codex-readonly-sandbox", "codex-direct-call"];
  const passOver = passOverCritic(order, "codex-readonly-sandbox");
  assert.equal(passOver.passedOver, "codex-readonly-sandbox");
  assert.equal(passOver.next, "codex-direct-call");
  assert.ok(passOver.announcement.includes(CRITIC_NOT_TOOLLESS));
  assert.ok(passOver.announcement.includes("passed over"));
});
