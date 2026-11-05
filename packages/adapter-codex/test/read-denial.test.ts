/**
 * T037 / CT-131-19 — the read-denial probe (F131-FR-019).
 *
 * Before every call of form (a) the adapter confirms that the sandbox denies
 * reads of every `deny` location, by a probe that plants a file at each
 * location and reads it under the same sandbox settings, with no model call.
 * Where the probe cannot run, or a read succeeds, `confirmed` is false and
 * form (a) is not used: a configured critic is refused with
 * `critic_not_toolless`, and an automatically picked critic is passed over
 * for the next candidate of the critic order, announced and recorded.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CRITIC_CONFIG_EXIT,
  CRITIC_CONFIG_STOP_REASON,
  CRITIC_NOT_TOOLLESS,
  buildFormACallRecord,
  passOverCritic,
  proofOfFormA,
  readDenialProbe,
  type DenialProbeLocation,
} from "../src/critic-readonly.ts";
import { buildFormAInvocation } from "../src/critic-readonly.ts";

/** The record of withheld paths with the five deny locations. */
const RECORD = {
  deny: ["workspace-part", "control-plane", "event-stream", "worker-root", "tree-store"],
  moved: [],
  confirmed: null,
};

/** A per-location probe result set: every read refused. */
function allReadsRefused(): DenialProbeLocation[] {
  return ["workspace-part", "control-plane", "event-stream", "worker-root", "tree-store"].map(
    (location) => ({ location, planted: true, readSucceeded: false }) as DenialProbeLocation,
  );
}

function confirmedProbe() {
  return readDenialProbe({ record: RECORD, runnable: true, reads: allReadsRefused() });
}

function callRecord(probe: ReturnType<typeof readDenialProbe>) {
  return buildFormACallRecord({
    invocation: buildFormAInvocation({ workdir: "/w", model: "gpt-5" }),
    streamText: '{"type":"thread.started","thread_id":"critic-session-1"}\n',
    probe,
  });
}

test("CT-131-19: a probe whose reads are all refused confirms the denial, with no model call", () => {
  const probe = confirmedProbe();
  assert.equal(probe.confirmed, true);
  assert.equal(probe.reason, null);
  assert.equal(probe.locations.length, 5);
  assert.equal(
    probe.locations.every((one) => one.readSucceeded === false),
    true,
  );
});

test("CT-131-19: a read that succeeds leaves the denial unconfirmed", () => {
  const reads = allReadsRefused().map((one) =>
    one.location === "control-plane" ? { ...one, readSucceeded: true } : one,
  );
  const probe = readDenialProbe({ record: RECORD, runnable: true, reads });
  assert.equal(probe.confirmed, false);
  assert.ok(probe.reason?.includes("control-plane"));
});

test("CT-131-19: a probe that cannot be run leaves the denial unconfirmed", () => {
  const probe = readDenialProbe({ record: RECORD, runnable: false, reads: [] });
  assert.equal(probe.confirmed, false);
  assert.ok(probe.reason?.includes("could not be run"));
});

test("CT-131-19: an unconfirmed denial refuses a CONFIGURED critic with critic_not_toolless", () => {
  const proof = proofOfFormA({
    record: callRecord(
      readDenialProbe({
        record: RECORD,
        runnable: true,
        reads: allReadsRefused().map((one) => ({ ...one, readSucceeded: true })),
      }),
    ),
    passSessionIds: [],
  });
  assert.equal(proof.ok, false);
  if (proof.ok) return;
  assert.equal(proof.refusal, CRITIC_NOT_TOOLLESS);
  assert.equal(proof.engineExit, CRITIC_CONFIG_EXIT);
  assert.equal(proof.stopReason, CRITIC_CONFIG_STOP_REASON);
  assert.ok(proof.problems.some((problem) => problem.includes("read denial is not confirmed")));
});

test("CT-131-19: an automatically picked critic is passed over, announced and recorded", () => {
  const order = ["codex-readonly-sandbox", "codex-direct-call", "claude-subprocess"];
  const passOver = passOverCritic(order, "codex-readonly-sandbox");
  assert.equal(passOver.passedOver, "codex-readonly-sandbox");
  assert.equal(passOver.next, "codex-direct-call");
  assert.ok(passOver.announcement.includes("passed over"), "the pass-over is announced");
  assert.ok(passOver.announcement.includes("codex-direct-call"));
  assert.ok(
    passOver.announcement.includes(CRITIC_NOT_TOOLLESS),
    "the announcement records the refusal",
  );
  // The last candidate passes over to nothing.
  assert.equal(passOverCritic(order, "claude-subprocess").next, null);
});

test("CT-131-19: the probe makes no model call — it judges planted files only", () => {
  // The probe's inputs are the record and the per-location reads; nothing in
  // its result carries a model call, a prompt or a stream.
  const probe = confirmedProbe();
  const serialised = JSON.stringify(probe);
  assert.equal(serialised.includes("prompt"), false);
  assert.equal(serialised.includes("exec"), false);
});
