/**
 * T032 / CT-131-14 — memory and customisations (F131-FR-014).
 *
 * Harness-native memory and project instruction files are off for every
 * critic-class call and off by default for the proposer. The opt-ins
 * `memory.native.proposer` and `harnesses.codex.proposerCustomisations`
 * (values `off` and `on`, default `off`) load into a proposer pass only,
 * never into a critic-class call, and are recorded per run. A customisation
 * with no known switch is reported as null in `capabilities`, and the
 * doctor warns. Under `parity` no flag about memory or customisation is
 * passed.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CODEX_ALLOW_ALL_FLAG,
  buildCriticReadonlyPlan,
  buildProposerPlan,
} from "../src/arguments.ts";
import {
  CODEX_CUSTOMISATIONS_OPT_IN_KEY,
  CODEX_CUSTOMISATION_WITHOUT_SWITCH,
  CODEX_MEMORY_OPT_IN_KEY,
  CODEX_OFF_SWITCHES,
  customisationSwitchCapability,
  customisationSwitchWarning,
  memorySwitches,
} from "../src/session.ts";

test("CT-131-14: memory and customisations are OFF by default for the proposer", () => {
  const state = memorySwitches({ role: "proposer", profile: "default" });
  assert.equal(state.memory, "off");
  assert.equal(state.customisations, "off");
  assert.deepEqual(state.flags, [
    CODEX_OFF_SWITCHES.userConfiguration,
    CODEX_OFF_SWITCHES.projectInstructionFiles,
  ]);
});

test("CT-131-14: the opt-ins are on the two recorded keys, `off`/`on`, default `off`", () => {
  assert.equal(CODEX_MEMORY_OPT_IN_KEY, "memory.native.proposer");
  assert.equal(CODEX_CUSTOMISATIONS_OPT_IN_KEY, "harnesses.codex.proposerCustomisations");
  const on = memorySwitches({
    role: "proposer",
    profile: "default",
    optIns: { memory: "on", customisations: "on" },
  });
  assert.equal(on.memory, "on");
  assert.equal(on.customisations, "on");
  // The switch for the user configuration comes off the list only where the
  // opt-in is on; the recorded state says so per run.
  assert.equal(on.flags.includes(CODEX_OFF_SWITCHES.userConfiguration), false);
  assert.equal(on.flags.includes(CODEX_OFF_SWITCHES.projectInstructionFiles), true);
});

test("CT-131-14: an opt-in loads into a PROPOSER pass only — never into a critic-class call", () => {
  const critic = memorySwitches({
    role: "critic",
    profile: "default",
    optIns: { memory: "on", customisations: "on" },
  });
  assert.equal(critic.memory, "off", "a critic-class call never loads the memory");
  assert.equal(critic.customisations, "off", "a critic-class call never loads the customisations");
  assert.deepEqual(critic.flags, [
    CODEX_OFF_SWITCHES.userConfiguration,
    CODEX_OFF_SWITCHES.projectInstructionFiles,
  ]);
  // And on the invocation of the critic of form (a) the switches stay on
  // whatever the proposer's opt-ins say.
  const criticPlan = buildCriticReadonlyPlan({ workdir: "/w", model: "gpt-5" });
  assert.equal(criticPlan.args.includes(CODEX_OFF_SWITCHES.userConfiguration), true);
  assert.equal(criticPlan.args.includes(CODEX_OFF_SWITCHES.projectInstructionFiles), true);
});

test("CT-131-14: the state of both opt-ins is recorded per run", () => {
  const runs = [
    memorySwitches({ role: "proposer", profile: "default" }),
    memorySwitches({
      role: "proposer",
      profile: "default",
      optIns: { memory: "on", customisations: "off" },
    }),
  ];
  for (const [index, run] of runs.entries()) {
    assert.equal(run.role, "proposer", `run ${index}`);
    assert.equal(run.profile, "default", `run ${index}`);
    assert.ok(typeof run.memory === "string" && typeof run.customisations === "string");
  }
  assert.notEqual(
    JSON.stringify(runs[0]),
    JSON.stringify(runs[1]),
    "two runs with different opt-ins record differently",
  );
});

test("CT-131-14: a customisation with no known switch is null in capabilities, and the doctor warns", () => {
  assert.equal(customisationSwitchCapability(), null);
  const warning = customisationSwitchWarning();
  assert.equal(warning.severity, "warn");
  assert.equal(warning.check, "harness.codex.unverified-facts");
  assert.match(warning.message, /no switch is known/);
  // The run that turned the switch-less customisation on records the gap.
  const on = memorySwitches({
    role: "proposer",
    profile: "default",
    optIns: { memory: "on" },
  });
  assert.equal(on.unknownSwitch, CODEX_CUSTOMISATION_WITHOUT_SWITCH);
  const off = memorySwitches({ role: "proposer", profile: "default" });
  assert.equal(off.unknownSwitch, null);
});

test("CT-131-14: under the parity profile no flag about memory or customisation is passed", () => {
  const state = memorySwitches({
    role: "proposer",
    profile: "parity",
    optIns: { memory: "on", customisations: "on" },
  });
  assert.deepEqual(state.flags, [], "no memory or customisation flag under parity");
  // And the parity argument list carries neither switch nor the allow-all
  // route to memory: it is exactly the baseline's list.
  const plan = buildProposerPlan({
    profile: "parity",
    prompt: "p",
    workdir: "/w",
    c0OptInValues: [{ value: "C0", source: "user-config" }],
  });
  assert.equal(plan.args.includes(CODEX_ALLOW_ALL_FLAG), true);
  assert.equal(plan.args.includes(CODEX_OFF_SWITCHES.userConfiguration), false);
  assert.equal(plan.args.includes(CODEX_OFF_SWITCHES.projectInstructionFiles), false);
});
