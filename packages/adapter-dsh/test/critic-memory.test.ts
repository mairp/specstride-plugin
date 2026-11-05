/**
 * T071 — characterization test CT-130-45 of the critic role and the native
 * memory (F130-FR-045; CQ-232).
 *
 * Outside `parity` the critic role is refused with `memory-not-off` and the
 * typed failure `capability_absent` while the state of native memory is
 * neither `off` nor `absent`, and the doctor check of the refusal is
 * launch-blocking. A fixture capture that shows `absent` admits the role. A
 * fixture capture that shows a customisation loaded into a critic-class call
 * that the patch does not cover refuses the role with `memory-not-off`
 * (CQ-232). `harnesses.dsh.proposerCustomisations` has no effect on a
 * critic-class call. The record of every critic-class call holds the state of
 * each kind. Under `parity` no check is made.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  criticMemoryRefusal,
  criticCustomisationRefusal,
  criticClassRecord,
  MEMORY_NOT_OFF,
  CRITIC_MEMORY_TYPED_FAILURE,
} from "../src/customisations/critic.ts";
import type { CustomisationCapture } from "../src/customisations/index.ts";
import { dshDoctorFindings, defaultDshDoctorObserved } from "../src/doctor/index.ts";
import { CUSTOMISATION_KINDS } from "../src/descriptor/index.ts";

const STRICT = "strict";
const PIN = "0.1.0-rc.8";

test("CT-130-45: outside parity the critic role is refused with memory-not-off and capability_absent", () => {
  const refusal = criticMemoryRefusal({
    profile: STRICT,
    memoryOptIn: true,
    customisationsOptIn: true,
  });
  assert.equal(refusal.refused, true, "no opt-in lifts the refusal");
  assert.equal(refusal.reason, MEMORY_NOT_OFF);
  assert.equal(refusal.typedFailure, CRITIC_MEMORY_TYPED_FAILURE);
  assert.equal(refusal.memoryState, "not-switchable");
});

test("CT-130-45: a fixture capture that shows absent admits the role", () => {
  const capture: CustomisationCapture = {
    capture: "capture 6",
    pin: PIN,
    memory: "absent",
    kinds: {},
  };
  const refusal = criticMemoryRefusal({ profile: STRICT, capture });
  assert.equal(refusal.refused, false, "absent admits the role");
  const off: CustomisationCapture = { ...capture, memory: "off" };
  assert.equal(criticMemoryRefusal({ profile: STRICT, capture: off }).refused, false);
});

test("CT-130-45: a customisation loaded into a critic-class call and not covered by the patch refuses with memory-not-off (CQ-232)", () => {
  const capture: CustomisationCapture = {
    capture: "capture 6",
    pin: PIN,
    memory: "absent",
    kinds: { plugins: "off" },
    criticLoadedKinds: ["skills", "host-hooks"],
  };
  // No patch coverage: skills and host-hooks refuse the role.
  const refusal = criticCustomisationRefusal({ profile: STRICT, capture });
  assert.equal(refusal.refused, true);
  assert.equal(refusal.reason, MEMORY_NOT_OFF, "the refusal is the memory-not-off one (CQ-232)");
  assert.deepEqual([...refusal.kinds].sort(), ["host-hooks", "skills"]);
  // The patch covering both kinds lifts this half; the memory is absent, so the role is admitted.
  const covered = criticCustomisationRefusal({
    profile: STRICT,
    capture,
    patchCoveredKinds: ["skills", "host-hooks"],
  });
  assert.equal(covered.refused, false);
  // A kind the patch covers is not listed as a trigger.
  const partly = criticCustomisationRefusal({
    profile: STRICT,
    capture,
    patchCoveredKinds: ["skills"],
  });
  assert.deepEqual([...partly.kinds], ["host-hooks"]);
});

test("CT-130-45: harnesses.dsh.proposerCustomisations has no effect on a critic-class call", () => {
  const without = criticClassRecord({ profile: STRICT, customisationsOptIn: false });
  const withOptIn = criticClassRecord({ profile: STRICT, customisationsOptIn: true });
  assert.deepEqual(withOptIn.customisations, without.customisations);
  assert.deepEqual(withOptIn.refusal, without.refusal);
  assert.deepEqual(
    withOptIn.customisations.map((c) => c.state),
    CUSTOMISATION_KINDS.map(() => "not-switchable"),
    "no kind of a critic-class call reads the proposer opt-in",
  );
});

test("CT-130-45: the record of every critic-class call holds the state of each kind", () => {
  const capture: CustomisationCapture = {
    capture: "capture 6",
    pin: PIN,
    memory: "absent",
    kinds: { plugins: "off" },
    criticLoadedKinds: ["tool-servers"],
  };
  const record = criticClassRecord({ profile: STRICT, capture });
  assert.equal(record.role, "critic");
  assert.equal(record.memory.state, "absent");
  for (const kind of CUSTOMISATION_KINDS) {
    const entry = record.customisations.find((c) => c.kind === kind);
    assert.ok(entry, `the record holds the state of ${kind}`);
    assert.equal(entry!.state, kind === "plugins" ? "off" : "not-switchable");
  }
});

test("CT-130-45: the doctor check of the critic role is launch-blocking", () => {
  const findings = dshDoctorFindings(defaultDshDoctorObserved({ profile: STRICT, role: "critic" }));
  const finding = findings.find((f) => f.id === "dsh.critic-memory");
  assert.ok(finding, "the doctor carries the critic-memory check");
  assert.equal(finding!.severity, "fail");
  assert.equal(finding!.lb, true, "launch-blocking when dsh is the critic");
  assert.ok(finding!.message.includes(MEMORY_NOT_OFF));
  // And for the proposer the same check is not registered as a failure.
  const proposer = dshDoctorFindings(
    defaultDshDoctorObserved({ profile: STRICT, role: "proposer" }),
  );
  const proposerFinding = proposer.find((f) => f.id === "dsh.critic-memory");
  assert.equal(proposerFinding!.lb, false, "never launch-blocking for the proposer");
});

test("CT-130-45: under parity no check is made", () => {
  const refusal = criticMemoryRefusal({ profile: "parity", memoryOptIn: false });
  assert.equal(refusal.refused, false, "no check is made under parity");
  assert.equal(refusal.memoryState, "as-is");
  const record = criticClassRecord({ profile: "parity" });
  assert.equal(record.refusal.refused, false);
  assert.deepEqual(
    record.customisations.map((c) => c.state),
    CUSTOMISATION_KINDS.map(() => "as-is"),
  );
});
