/**
 * T069 — characterization test CT-130-43 of the customisations of the
 * profile (F130-FR-043; F130-FR-003).
 *
 * `capabilities` reports the switch of each kind of customisation as null.
 * With `harnesses.dsh.proposerCustomisations` at `off` the state is
 * `not-switchable`, the launch states the kinds in one line and the doctor
 * warns; with `on` the state is `opted-in` and no warning is raised. The run
 * record and the record of every pass hold the value asked and the state.
 * `off` and `absent` are never recorded without a capture. Under `parity`
 * the state is `as-is`, no flag is passed and no line is printed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { dshCapabilities, CUSTOMISATION_KINDS } from "../src/descriptor/index.ts";
import {
  readCustomisationsSwitch,
  resolveCustomisationStates,
  customisationsLaunchLine,
  customisationRunRecord,
  customisationCallRecord,
  PROPOSER_CUSTOMISATIONS_SWITCH,
  CUSTOMISATION_SWITCH_DEFAULT,
} from "../src/customisations/index.ts";
import { dshDoctorFindings, defaultDshDoctorObserved } from "../src/doctor/index.ts";
import { proposerArgv, PROPOSER_ARGV_TEMPLATE } from "../src/proposer/index.ts";

const STRICT = "strict";

test("CT-130-43: capabilities reports the switch of each kind of customisation as null", () => {
  const statement = dshCapabilities();
  assert.deepEqual(
    statement.customisations.map((c) => c.kind),
    [...CUSTOMISATION_KINDS],
  );
  for (const customisation of statement.customisations) {
    assert.equal(customisation.switch, null, customisation.kind);
    assert.equal(customisation.status, "unverified", customisation.kind);
  }
});

test("CT-130-43: with the switch at off the state of every kind is not-switchable", () => {
  const states = resolveCustomisationStates({
    profile: STRICT,
    customisationsOptIn: false,
    capture: null,
  });
  assert.deepEqual(
    states.map((s) => s.state),
    CUSTOMISATION_KINDS.map(() => "not-switchable"),
  );
  // The key reads off by default, and anything but `on` reads off.
  assert.equal(readCustomisationsSwitch(), CUSTOMISATION_SWITCH_DEFAULT);
  assert.equal(
    readCustomisationsSwitch({
      get: (k) => (k === PROPOSER_CUSTOMISATIONS_SWITCH ? "off" : undefined),
    }),
    "off",
  );
});

test("CT-130-43: with off the launch states the kinds in one line and the doctor warns", () => {
  const states = resolveCustomisationStates({ profile: STRICT, customisationsOptIn: false });
  const line = customisationsLaunchLine(states);
  assert.ok(line !== null, "the launch states the kinds");
  for (const kind of CUSTOMISATION_KINDS) {
    assert.ok(line.includes(kind), `the line names ${kind}: ${line}`);
  }
  assert.equal(line.split("\n").length, 1, "one line only");
  const findings = dshDoctorFindings(
    defaultDshDoctorObserved({ profile: STRICT, customisationsOptIn: false, role: "proposer" }),
  );
  const finding = findings.find((f) => f.id === "dsh.customisations");
  assert.ok(finding, "the doctor carries the customisations check");
  assert.equal(finding!.severity, "warn");
  assert.equal(finding!.lb, false, "the customisations warning never blocks");
});

test("CT-130-43: with on the state is opted-in and no warning is raised", () => {
  assert.equal(
    readCustomisationsSwitch({
      get: (k) => (k === PROPOSER_CUSTOMISATIONS_SWITCH ? "on" : undefined),
    }),
    "on",
  );
  const states = resolveCustomisationStates({ profile: STRICT, customisationsOptIn: true });
  assert.deepEqual(
    states.map((s) => s.state),
    CUSTOMISATION_KINDS.map(() => "opted-in"),
  );
  assert.equal(customisationsLaunchLine(states), null, "no launch line");
  const findings = dshDoctorFindings(
    defaultDshDoctorObserved({ profile: STRICT, customisationsOptIn: true, role: "proposer" }),
  );
  const finding = findings.find((f) => f.id === "dsh.customisations");
  assert.equal(finding!.severity, "ok", "no warning is raised");
});

test("CT-130-43: the run record and the record of every pass hold the value asked and the state", () => {
  const run = customisationRunRecord({
    profile: STRICT,
    customisationsOptIn: false,
    customisationsValue: "off",
  });
  for (const entry of run.customisations) {
    assert.equal(entry.valueAsked, "off");
    assert.equal(entry.state, "not-switchable");
  }
  // The record of every pass (call) repeats the state per kind.
  const call = customisationCallRecord(run, "proposer");
  assert.deepEqual(
    call.customisations.map((c) => ({ kind: c.kind, valueAsked: c.valueAsked, state: c.state })),
    run.customisations,
  );
  // And with the opt-in on, the records say opted-in.
  const optedIn = customisationRunRecord({ profile: STRICT, customisationsOptIn: true });
  assert.deepEqual(
    optedIn.customisations.map((c) => c.state),
    CUSTOMISATION_KINDS.map(() => "opted-in"),
  );
});

test("CT-130-43: off and absent are never recorded without a capture", () => {
  // No capture: no resolver path reaches off or absent.
  const withoutCapture = customisationRunRecord({ profile: STRICT, customisationsOptIn: false });
  for (const entry of withoutCapture.customisations) {
    assert.ok(entry.state !== "off" && entry.state !== "absent", entry.kind);
  }
  // Even a capture record that names nothing changes nothing: the states
  // stay not-switchable until the capture SHOWS the kind off or absent.
  const capture = {
    capture: "capture 6",
    pin: "0.1.0-rc.8",
    memory: null,
    kinds: { plugins: "off" as const },
  };
  const withCapture = customisationRunRecord({
    profile: STRICT,
    customisationsOptIn: false,
    capture,
  });
  const plugins = withCapture.customisations.find((c) => c.kind === "plugins");
  assert.equal(plugins!.state, "off", "a capture that shows plugins off admits off");
  assert.equal(withCapture.capture?.capture, "capture 6");
  const skills = withCapture.customisations.find((c) => c.kind === "skills");
  assert.equal(
    skills!.state,
    "not-switchable",
    "kinds the capture does not name stay not-switchable",
  );
});

test("CT-130-43: under parity the state is as-is, no flag is passed and no line is printed", () => {
  const states = resolveCustomisationStates({ profile: "parity", customisationsOptIn: false });
  assert.deepEqual(
    states.map((s) => s.state),
    CUSTOMISATION_KINDS.map(() => "as-is"),
  );
  assert.equal(customisationsLaunchLine(states), null, "no line is printed under parity");
  const run = customisationRunRecord({ profile: "parity" });
  assert.equal(run.launchLine, null);
  assert.deepEqual(
    run.customisations.map((c) => c.state),
    CUSTOMISATION_KINDS.map(() => "as-is"),
  );
  // No flag about customisations is passed: the argument list is the
  // template of F130-FR-007, and neither it nor a built argv carries one.
  assert.deepEqual(
    PROPOSER_ARGV_TEMPLATE.filter((part) =>
      /customisation|plugin|skill|hook|tool-server/i.test(part),
    ),
    [],
  );
  const argv = proposerArgv({ bin: "dsh", profile: "parity", prompt: "grade this" });
  assert.deepEqual(
    argv.filter((part) => /customisation/i.test(part)),
    [],
  );
});
