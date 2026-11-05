// CT-125-10 (T048) — the assertions on the initial record (F125-FR-016):
// a proposer warning that never stops the pass, a critic refusal, managed
// settings that still apply as the backstop, and no host hook of
// Specstride's own plugin inside a proposer child.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CriticConfigError,
  HOST_PLUGIN_ID,
  assertInitialRecordForCritic,
  assertInitialRecordForProposer,
  customisationFindings,
  customisationOffMode,
  hostPluginHookFindings,
  type HostHook,
  type InitialRecord,
} from "../../src/index.ts";

const CLEAN: InitialRecord = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  tools: [],
  servers: [],
  plugins: [],
  model: "claude-opus-4-8",
  capabilities: [],
};

const WITH_CUSTOMISATIONS: InitialRecord = {
  sessionId: "22222222-2222-4222-8222-222222222222",
  tools: ["Read"],
  servers: ["mcp__docs"],
  plugins: ["third-party-linter@marketplace"],
  model: "claude-opus-4-8",
  capabilities: [],
};

const HOST_HOOKS: readonly HostHook[] = [
  { source: `${HOST_PLUGIN_ID}@1.0.0`, event: "PreToolUse" },
  { source: "managed-settings", event: "SessionStart" },
];

describe("CT-125-10 — the assertions on the initial record (F125-FR-016)", () => {
  it("the customisation-off mode states every kind off, native memory included", () => {
    const mode = customisationOffMode({ role: "proposer" });
    assert.equal(mode.customisation, "off");
    for (const kind of [
      "plugins",
      "host-hooks",
      "skills",
      "tool-servers",
      "project-instructions",
      "native-memory",
    ]) {
      assert.ok(mode.off.includes(kind as never), `${kind} is off`);
    }
  });

  it("a proposer warning is recorded and the pass goes on", () => {
    const warning = assertInitialRecordForProposer({
      initialRecord: WITH_CUSTOMISATIONS,
      hooks: HOST_HOOKS,
      skills: ["pdf"],
    });
    assert.equal(warning.event, "warning");
    assert.equal(warning.kind, "customisation-present");
    assert.equal(warning.passContinues, true, "a warning never stops a proposer pass (CQ-144)");
    assert.deepEqual(warning.findings.map((f) => f.kind).sort(), [
      "host-hook",
      "host-hook",
      "plugin",
      "skill",
      "tool-server",
    ]);
  });

  it("a clean record raises no finding at all", () => {
    const warning = assertInitialRecordForProposer({ initialRecord: CLEAN, hooks: [], skills: [] });
    assert.deepEqual([...warning.findings], []);
    assert.deepEqual(
      [...customisationFindings({ initialRecord: CLEAN, hooks: [], skills: [] })],
      [],
    );
  });

  it("a critic refusal: a plugin, host hook, skill or tool server refuses the call", () => {
    for (const input of [
      { initialRecord: WITH_CUSTOMISATIONS, hooks: [], skills: [] },
      { initialRecord: CLEAN, hooks: HOST_HOOKS, skills: [] },
      { initialRecord: CLEAN, hooks: [], skills: ["pdf"] },
      { initialRecord: { ...CLEAN, servers: ["mcp__docs"] }, hooks: [], skills: [] },
    ]) {
      assert.throws(
        () => assertInitialRecordForCritic(input),
        (error: unknown) => {
          assert.ok(error instanceof CriticConfigError);
          assert.equal((error as CriticConfigError).reason, "critic_not_toolless");
          assert.match(error.message, /critic_not_toolless/);
          return true;
        },
      );
    }
    assert.doesNotThrow(() =>
      assertInitialRecordForCritic({ initialRecord: CLEAN, hooks: [], skills: [] }),
    );
  });

  it("administrator-managed settings still apply: the assertions are the backstop", () => {
    // A hook that comes from the managed settings of an administrator is a
    // finding exactly like any other: the mode tries to switch hooks off,
    // the record is the fact, and the finding is recorded either way.
    const warning = assertInitialRecordForProposer({
      initialRecord: CLEAN,
      hooks: [{ source: "managed-settings", event: "SessionStart" }],
      skills: [],
    });
    assert.ok(
      warning.findings.some(
        (f) => f.kind === "host-hook" && f.detail === "managed-settings:SessionStart",
      ),
    );
  });

  it("no host hook of Specstride's own plugin runs inside a proposer child", () => {
    const found = hostPluginHookFindings([
      { source: `${HOST_PLUGIN_ID}@1.0.0`, event: "PreToolUse" },
      { source: "SpecStride-Host", event: "PostToolUse" },
      { source: "managed-settings", event: "SessionStart" },
    ]);
    assert.deepEqual(
      [...found].map((h) => h.source).sort(),
      ["SpecStride-Host", "specstride@1.0.0"],
      "the host's own hooks are detected wherever the record shows them",
    );
    // In the state the customisation-off mode produces the record shows
    // none: the child loads no host hook of Specstride's plugin.
    assert.deepEqual([...hostPluginHookFindings([])], []);
  });
});
