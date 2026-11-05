// CT-125-12 (T050) — harness-native memory (F125-FR-018): off for every
// critic-class call, off by default for the proposer with the opt-in
// `memory.native.proposer` of user configuration, recorded per run, and
// NOTHING about memory passed under the `parity` profile.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NATIVE_MEMORY_SWITCH,
  PROPOSER_MEMORY_OPT_IN,
  buildCallEnvironment,
  memorySwitchSetting,
  customisationOffMode,
} from "../../src/index.ts";

describe("CT-125-12 — the memory switch (F125-FR-018)", () => {
  it("native memory is off for every critic-class call", () => {
    const setting = memorySwitchSetting({ role: "critic", profile: "default" });
    assert.equal(setting.name, "CLAUDE_CODE_DISABLE_AUTO_MEMORY");
    assert.equal(setting.applied, true);
    assert.equal(setting.reason, "critic-always-off");
    const built = buildCallEnvironment({
      role: "critic",
      profile: "default",
      authTier: 1,
      processEnv: { PATH: "/usr/bin", HOME: "/home/consumer" },
      memoryOff: setting.applied,
    });
    assert.equal(built[NATIVE_MEMORY_SWITCH], "1");
  });

  it("native memory is off by default for the proposer, with the opt-in recorded per run", () => {
    const off = memorySwitchSetting({ role: "proposer", profile: "default" });
    assert.equal(off.applied, true);
    assert.equal(off.reason, "proposer-default-off");
    assert.equal(off.recordedOptIn, false);

    const on = memorySwitchSetting({
      role: "proposer",
      profile: "default",
      proposerNativeMemory: true,
    });
    assert.equal(on.applied, false, `the opt-in ${PROPOSER_MEMORY_OPT_IN} switches it on`);
    assert.equal(on.reason, "proposer-opt-in");
    assert.equal(on.recordedOptIn, true);
  });

  it("the opt-in flows through the call environment: the switch is passed only when off", () => {
    const withOptIn = buildCallEnvironment({
      role: "proposer",
      profile: "default",
      authTier: 1,
      processEnv: { PATH: "/usr/bin", HOME: "/home/consumer" },
      memoryOff: memorySwitchSetting({
        role: "proposer",
        profile: "default",
        proposerNativeMemory: true,
      }).applied,
    });
    assert.ok(!(NATIVE_MEMORY_SWITCH in withOptIn));

    const withoutOptIn = buildCallEnvironment({
      role: "proposer",
      profile: "default",
      authTier: 1,
      processEnv: { PATH: "/usr/bin", HOME: "/home/consumer" },
      memoryOff: memorySwitchSetting({ role: "proposer", profile: "default" }).applied,
    });
    assert.equal(withoutOptIn[NATIVE_MEMORY_SWITCH], "1");
  });

  it("under `parity` nothing about memory is passed", () => {
    for (const role of ["proposer", "critic"] as const) {
      const setting = memorySwitchSetting({
        role,
        profile: "parity",
        proposerNativeMemory: true,
      });
      assert.equal(setting.applied, false, `${role}: no switch under parity`);
      assert.equal(setting.reason, "parity-passes-nothing");
      const built = buildCallEnvironment({
        role,
        profile: "parity",
        authTier: 1,
        processEnv: {
          PATH: "/usr/bin",
          HOME: "/home/consumer",
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: "inherited-anyway",
        },
        memoryOff: true,
      });
      assert.ok(
        !(NATIVE_MEMORY_SWITCH in built),
        `${role}: the switch is not set under parity, whatever the caller asked`,
      );
    }
  });

  it("the mode and the switch agree on the role's native memory", () => {
    assert.equal(customisationOffMode({ role: "critic" }).nativeMemory, "off");
    assert.equal(customisationOffMode({ role: "proposer" }).nativeMemory, "off");
    assert.equal(
      customisationOffMode({ role: "proposer", proposerNativeMemory: true }).nativeMemory,
      "on-by-opt-in",
    );
    const proposerMode = customisationOffMode({ role: "proposer", proposerNativeMemory: true });
    assert.ok(!proposerMode.off.includes("native-memory"));
  });
});
