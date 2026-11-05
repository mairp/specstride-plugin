/**
 * T116 (F115-FR-039, F115-FR-041) — the doctor checks for the tripwire and
 * for the invariants: severity rules, probes over the record and the event
 * file, and registration through the kernel registry.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  doctorReadTripwire,
  doctorCheckInvariants,
  tripwireRecordCheck,
  phaseGateInvariantsCheck,
  registerTripwireChecks,
  TRIPWIRE_RECORD_CHECK_ID,
  PHASE_GATE_INVARIANTS_CHECK_ID,
} from "../src/checks/tripwire.ts";
import { registerDoctorCheck, registeredDoctorChecks } from "@specstride/kernel";

test("T116: the tripwire check fails while the record is breached, warns on an unreadable file", async () => {
  const home = mkdtempSync(join(tmpdir(), "tripwire-doctor-"));
  try {
    assert.deepEqual(doctorReadTripwire(home), { state: "absent" });
    const ok = await tripwireRecordCheck.probe({ home });
    assert.equal(tripwireRecordCheck.severityRule(ok), "ok");
    writeFileSync(join(home, "tripwire.json"), "{not json");
    const unreadable = await tripwireRecordCheck.probe({ home });
    assert.equal(tripwireRecordCheck.severityRule(unreadable), "warn");
    writeFileSync(
      join(home, "tripwire.json"),
      JSON.stringify({
        breached: true,
        breaches: [{ kind: "false-pass", ruleId: "IR-28", detail: "d", observedAt: "t" }],
      }),
    );
    const breached = await tripwireRecordCheck.probe({ home });
    assert.equal(tripwireRecordCheck.severityRule(breached), "fail");
    assert.equal(tripwireRecordCheck.lb, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("T116: the invariants check finds the breach kinds of row 141 in the event file", async () => {
  const clean = await phaseGateInvariantsCheck.probe({
    events: [{ type: "verdict.recorded", fields: { nonceOk: true } }],
  });
  assert.equal(phaseGateInvariantsCheck.severityRule(clean), "ok");
  const breached = await phaseGateInvariantsCheck.probe({
    events: [{ type: "check.started", fields: { checkId: "c" } }],
    outerCounters: { atLaunch: { reject: 1 }, now: { reject: 2 } },
  });
  assert.equal(phaseGateInvariantsCheck.severityRule(breached), "fail");
  assert.deepEqual(
    doctorCheckInvariants({
      events: [],
      passes: [{ unitId: "u", checkId: "ghost", result: "pass" }],
    }).map((b) => b.kind),
    ["false-pass"],
  );
});

test("T116: both checks register through the kernel registry, ids never renamed", () => {
  const before = registeredDoctorChecks().length;
  registerTripwireChecks(registerDoctorCheck);
  const ids = registeredDoctorChecks()
    .map((c) => c.id)
    .slice(before);
  assert.ok(ids.includes(TRIPWIRE_RECORD_CHECK_ID));
  assert.ok(ids.includes(PHASE_GATE_INVARIANTS_CHECK_ID));
  // Idempotent per id.
  registerTripwireChecks(registerDoctorCheck);
  assert.equal(registeredDoctorChecks().filter((c) => c.id === TRIPWIRE_RECORD_CHECK_ID).length, 1);
});
