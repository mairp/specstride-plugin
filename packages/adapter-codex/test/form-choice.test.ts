/**
 * T042 / CT-131-24 — the choice of the critic form (F131-FR-024).
 *
 * Form (a) where the credential is the consumer's login (auth tier 1); form
 * (b) where it is an API key (auth tier 2), which stays the form for a
 * consumer with a key. The form in use is announced at launch and recorded
 * for every call. Under the `parity` profile the critic is form (b).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  announceCriticForm,
  buildFormACallRecord,
  buildFormAInvocation,
  chooseCriticForm,
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

test("CT-131-24: form (a) at auth tier 1, form (b) at auth tier 2", () => {
  assert.equal(chooseCriticForm({ authTier: 1, profile: "default" }), "readonly-sandbox");
  assert.equal(chooseCriticForm({ authTier: 2, profile: "default" }), "direct-call");
});

test("CT-131-24: form (b) stays the form under the parity profile", () => {
  assert.equal(chooseCriticForm({ authTier: 1, profile: "parity" }), "direct-call");
  assert.equal(chooseCriticForm({ authTier: 2, profile: "parity" }), "direct-call");
});

test("CT-131-24: the form in use is announced at launch", () => {
  const formA = announceCriticForm("readonly-sandbox");
  const formB = announceCriticForm("direct-call");
  assert.match(formA, /form \(a\)/);
  assert.match(formA, /read-only sandbox/);
  assert.match(formB, /form \(b\)/);
  assert.match(formB, /direct call/);
});

test("CT-131-24: the form is recorded on EVERY form (a) call", () => {
  for (const id of ["critic-1", "critic-2", "critic-3"]) {
    const record = buildFormACallRecord({
      invocation: buildFormAInvocation({ workdir: "/w", model: "gpt-5" }),
      streamText: `{"type":"thread.started","thread_id":"${id}"}\n`,
      probe: PROBE,
    });
    assert.equal(record.form, "readonly-sandbox", `call ${id}`);
    assert.equal(record.announced, true, `call ${id}: the form was announced`);
  }
});

test("CT-131-24: a recorded form (a) call passes the proof only as form (a)", () => {
  const record = buildFormACallRecord({
    invocation: buildFormAInvocation({ workdir: "/w", model: "gpt-5" }),
    streamText: '{"type":"thread.started","thread_id":"critic-ok"}\n',
    probe: PROBE,
  });
  assert.equal(proofOfFormA({ record, passSessionIds: [] }).ok, true);
  // Form (b) is a different transport: the form (a) proof is not applied to
  // a direct-call record.
  assert.equal(chooseCriticForm({ authTier: 2, profile: "default" }), "direct-call");
});
