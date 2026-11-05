/**
 * T070 — characterization test CT-130-44 of the native memory (F130-FR-044).
 *
 * The descriptor declares native memory as UNKNOWN with a null switch. The
 * run record holds the value asked and the state for the proposer and for
 * the critic-class calls. The opt-in is read from USER CONFIGURATION only.
 * Under `parity` no flag about memory is passed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { dshCapabilities } from "../src/descriptor/index.ts";
import {
  readMemorySwitch,
  resolveMemoryState,
  memoryLaunchLine,
  customisationRunRecord,
  customisationCallRecord,
  MEMORY_NATIVE_PROPOSER_SWITCH,
  CUSTOMISATION_SWITCH_DEFAULT,
} from "../src/customisations/index.ts";
import { criticClassRecord } from "../src/customisations/critic.ts";
import { proposerArgv, PROPOSER_ARGV_TEMPLATE } from "../src/proposer/index.ts";
import { criticArgv, CRITIC_ARGV_TEMPLATE } from "../src/critic/index.ts";
import { readRawDescriptorData } from "../src/descriptor/data.ts";

test("CT-130-44: the descriptor declares native memory as unknown with a null switch", () => {
  const capabilities = dshCapabilities().capabilities;
  const memorySwitch = capabilities.find((row) => row.id === "memory.native.switch");
  const memoryExists = capabilities.find((row) => row.id === "memory.native.exists");
  assert.ok(memorySwitch, "the capabilities carry the native memory switch");
  assert.ok(memoryExists, "the capabilities carry the native memory existence");
  assert.equal(memorySwitch!.value, null);
  assert.equal(memorySwitch!.status, "unverified");
  assert.equal(memoryExists!.value, "unverified", "the existence of a native memory is unknown");
  // The raw descriptor data states the same: memory unknown, switch null.
  const raw = readRawDescriptorData() as {
    "x-memory"?: Record<string, unknown>;
  };
  assert.ok(raw["x-memory"], "the descriptor data carries the memory row");
});

test("CT-130-44: the run record holds the value asked and the state for the proposer", () => {
  const run = customisationRunRecord({
    profile: "strict",
    memoryOptIn: false,
    memoryValue: "off",
  });
  assert.equal(run.memory.proposer.valueAsked, "off");
  assert.equal(run.memory.proposer.state, "not-switchable");
  const call = customisationCallRecord(run, "proposer");
  assert.equal(call.memoryValueAsked, "off");
  assert.equal(call.memory, "not-switchable");
  // With the opt-in `memory.native.proposer: on`, the state is opted-in.
  const optedIn = customisationRunRecord({ profile: "strict", memoryOptIn: true });
  assert.equal(optedIn.memory.proposer.state, "opted-in");
  assert.equal(memoryLaunchLine(optedIn.memory.proposer.state), null, "no launch line");
  // Without the opt-in the launch states it.
  assert.ok(memoryLaunchLine(run.memory.proposer.state) !== null);
});

test("CT-130-44: the run record holds the value asked and the state for the critic-class calls", () => {
  const run = customisationRunRecord({ profile: "strict" });
  // The value asked for every critic-class call is the FIXED off.
  assert.equal(run.memory.critic.valueAsked, "off");
  assert.equal(run.memory.critic.state, "not-switchable");
  // Even with the opt-in on, the critic-class call stays not-switchable.
  const optedIn = customisationRunRecord({ profile: "strict", memoryOptIn: true });
  assert.equal(optedIn.memory.critic.valueAsked, "off");
  assert.equal(optedIn.memory.critic.state, "not-switchable");
  const record = criticClassRecord({ profile: "strict", memoryOptIn: true });
  assert.equal(record.memory.valueAsked, "off");
  assert.equal(record.memory.state, "not-switchable");
});

test("CT-130-44: the opt-in is read from user configuration only", () => {
  // The key of the consumer configuration reads on.
  assert.equal(
    readMemorySwitch({ get: (k) => (k === MEMORY_NATIVE_PROPOSER_SWITCH ? "on" : undefined) }),
    "on",
  );
  // No key: the default off.
  assert.equal(readMemorySwitch(), CUSTOMISATION_SWITCH_DEFAULT);
  // An ENVIRONMENT alias has NO effect: the opt-in is user configuration only.
  assert.equal(
    readMemorySwitch({ env: { DSH_MEMORY_NATIVE: "on", DSH_MEMORY: "on", MEMORY_NATIVE: "on" } }),
    "off",
    "no environment variable lifts the opt-in",
  );
  // And a value anything but `on` reads off.
  assert.equal(
    readMemorySwitch({ get: (k) => (k === MEMORY_NATIVE_PROPOSER_SWITCH ? "yes" : undefined) }),
    "off",
  );
});

test("CT-130-44: under parity no flag about memory is passed", () => {
  const templates = [...PROPOSER_ARGV_TEMPLATE, ...CRITIC_ARGV_TEMPLATE];
  assert.deepEqual(
    templates.filter((part) => /memory/i.test(part)),
    [],
    "no template part mentions memory",
  );
  const proposer = proposerArgv({ bin: "dsh", profile: "parity", prompt: "grade this" });
  const critic = criticArgv({
    bin: "dsh",
    profile: "parity",
    patchPath: "/tmp/patch.json",
    chunks: ["grade", "this"],
  });
  for (const argv of [proposer, critic]) {
    assert.deepEqual(
      argv.filter((part) => /memory/i.test(part)),
      [],
      "no built argv carries a flag about memory",
    );
  }
  // And under parity the state of the memory is as-is, for both roles.
  assert.equal(resolveMemoryState({ profile: "parity", role: "proposer" }), "as-is");
  assert.equal(resolveMemoryState({ profile: "parity", role: "critic" }), "as-is");
});
