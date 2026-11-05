/**
 * T066 — CT-109-39, the proof of the second form (`read-only-tools`) of a
 * critic-class call (F109-FR-039).
 *
 * The proof is the read-only sandbox mode, the network off and the
 * confirmation of the read denial; a configured critic without it is refused
 * and an automatically picked one is passed over; and a write and a reach for
 * the network are recorded as refused.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fixFormBeforeCall } from "../../src/proof/forms.ts";
import {
  WITHHELD_LOCATIONS,
  confirmationIsComplete,
  refuseAct,
  proveSecondForm,
  ActJournal,
} from "../../src/proof/second-form.ts";

const SECOND = fixFormBeforeCall("read-only-tools") as Exclude<
  ReturnType<typeof fixFormBeforeCall>,
  { accepted: false }
>;
const CONFIRMED = { confirmed: true, deniedLocations: [...WITHHELD_LOCATIONS] };

test("CT-109-39: proven by sandbox mode, network off and the confirmation", () => {
  assert.equal(confirmationIsComplete(CONFIRMED), true);
  const proof = proveSecondForm({
    fixed: SECOND,
    sandboxMode: "read-only",
    networkOff: true,
    confirmation: CONFIRMED,
    provenance: "configured",
  });
  assert.deepEqual(proof, {
    accepted: true,
    proofKind: "read-only-sandbox",
    sandboxMode: "read-only",
    networkOff: true,
    confirmationRecorded: true,
  });
});

test("CT-109-39: a missing fact refuses a configured critic", () => {
  const calls = [
    { sandboxMode: "none", networkOff: true, confirmation: CONFIRMED },
    { sandboxMode: "read-only", networkOff: false, confirmation: CONFIRMED },
    {
      sandboxMode: "read-only",
      networkOff: true,
      confirmation: { confirmed: true, deniedLocations: ["workspace-part"] },
    },
    { sandboxMode: "read-only", networkOff: true, confirmation: null },
    {
      sandboxMode: "read-only",
      networkOff: true,
      confirmation: { confirmed: false, deniedLocations: [...WITHHELD_LOCATIONS] },
    },
  ] as const;
  for (const partial of calls) {
    const refusal = proveSecondForm({
      fixed: SECOND,
      sandboxMode: partial.sandboxMode,
      networkOff: partial.networkOff,
      confirmation: partial.confirmation,
      provenance: "configured",
    });
    assert.equal(refusal.accepted, false);
    if (!refusal.accepted && !("outcome" in refusal)) {
      assert.equal(refusal.failure, "critic_not_toolless");
      assert.equal(refusal.stopReason, "critic_config");
      assert.equal(refusal.engineExitCode, 3);
      assert.equal(refusal.replyRead, false);
    }
  }
});

test("CT-109-39: a configured critic is refused; a picked one is passed over", () => {
  const call = {
    fixed: SECOND,
    sandboxMode: "unrestricted" as const,
    networkOff: false,
    confirmation: null,
  };
  const configured = proveSecondForm({ ...call, provenance: "configured" });
  assert.equal(configured.accepted, false);
  assert.ok(!("outcome" in configured));
  assert.equal((configured as { failure: string }).failure, "critic_not_toolless");

  const picked = proveSecondForm({ ...call, provenance: "automatically-picked" });
  assert.equal(picked.accepted, false);
  if ("outcome" in picked) {
    assert.equal(picked.outcome, "passed-over");
    assert.equal(picked.announced, true);
    assert.equal(picked.recorded, true);
    assert.equal(picked.takes, "the next candidate of the critic order");
  }
});

test("CT-109-39: a write and a reach for the network are recorded as refused", () => {
  const journal = new ActJournal();
  const write = journal.record(refuseAct("write", "/workspace/notebook.md"));
  const network = journal.record(refuseAct("network", "10.0.0.7:8080"));
  assert.deepEqual(write, { act: "write", target: "/workspace/notebook.md", refused: true });
  assert.deepEqual(network, { act: "network", target: "10.0.0.7:8080", refused: true });
  assert.equal(journal.acts.length, 2);
  assert.equal(journal.allRefused, true);
});
