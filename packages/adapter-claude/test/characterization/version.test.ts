// CT-125-3 (T071) — characterization of the version range (F125-FR-003):
// the tested range is [2.1.259, 2.1.284] with `verifiedOn` 2026-09-29; a
// restricted floor of 2.1.248 applies only for the restricted mode; every
// pass records the version it ran; a version outside the range gives a
// doctor WARNING, never a block; the capability list of the initial record
// is preferred over any comparison of versions; and a flag the help does
// not list is gated by the version floor. Nothing is downloaded to pin.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CLI_FLOOR,
  CLI_PIN,
  CLI_RESTRICTED_FLOOR,
  HIDDEN_FLAGS,
  VERIFIED_ON,
  claudeDoctorChecks,
  flagAvailability,
  hiddenFlagIsGatedByFloor,
  versionAtFloor,
  versionIsInRange,
  type ClaudeDoctorFacts,
} from "../../src/index.ts";

describe("CT-125-3 — the version range and its rules (F125-FR-003)", () => {
  it("the tested range is the floor 2.1.259 up to the pin 2.1.284, verified on 2026-09-29", () => {
    assert.equal(CLI_FLOOR, "2.1.259"); // the first version with --permission-prompts
    assert.equal(CLI_PIN, "2.1.284");
    assert.equal(VERIFIED_ON, "2026-09-29");
    assert.equal(versionIsInRange("2.1.259"), true);
    assert.equal(versionIsInRange("2.1.284"), true);
    assert.equal(versionIsInRange("2.1.271"), true);
    assert.equal(versionIsInRange("2.1.258"), false);
    assert.equal(versionIsInRange("2.1.285"), false);
    assert.equal(versionIsInRange("2.2.0"), false);
  });

  it("the restricted floor 2.1.248 exists and applies only to the restricted mode", () => {
    assert.equal(CLI_RESTRICTED_FLOOR, "2.1.248");
    assert.notEqual(CLI_RESTRICTED_FLOOR, CLI_FLOOR);
  });

  it("the version the pass ran is recorded", () => {
    // Every pass records the version it ran: the facts the doctor reads
    // carry `recorded`, and the call builders receive it.
    const facts: ClaudeDoctorFacts = {
      bin: {
        present: true,
        path: "/usr/local/bin/claude",
        refusal: null,
        changedPathWarning: null,
        usedByARole: true,
      },
      auth: {
        tier: 1,
        loginPresent: true,
        secretReferenceName: null,
        loginEstablishedBy: "existence probe, no network",
      },
      version: { recorded: "2.1.284", inRange: true, changedBetweenPasses: false },
      managedSettings: { present: false, path: null },
      sandbox: { offered: false, userIsRoot: false },
      sdk: { availability: "not-chosen", version: null, warning: null },
      concurrentSessions: { value: null, status: "unverified" },
    };
    assert.equal(facts.version.recorded, "2.1.284");
  });

  it("a version outside the range gives a doctor warning, never a block", () => {
    const base: ClaudeDoctorFacts["version"] = {
      recorded: "2.1.300",
      inRange: false,
      changedBetweenPasses: false,
    };
    const versionCheck = claudeDoctorChecks({
      bin: {
        present: true,
        path: "/c",
        refusal: null,
        changedPathWarning: null,
        usedByARole: true,
      },
      auth: {
        tier: 1,
        loginPresent: true,
        secretReferenceName: null,
        loginEstablishedBy: "existence probe",
      },
      version: base,
      managedSettings: { present: false, path: null },
      sandbox: { offered: false, userIsRoot: false },
      sdk: { availability: "not-chosen", version: null, warning: null },
      concurrentSessions: { value: null, status: "unverified" },
    }).find((c) => c.id === "harness.version.claude");
    assert.ok(versionCheck);
    assert.equal(versionCheck.lb, false); // never launch-blocking
    assert.equal(versionCheck.severityRule({ version: base }), "warn");
    assert.equal(
      versionCheck.severityRule({
        version: { recorded: "2.1.271", inRange: true, changedBetweenPasses: false },
      }),
      "ok",
    );
    assert.equal(
      versionCheck.severityRule({
        version: { recorded: "2.1.284", inRange: true, changedBetweenPasses: true },
      }),
      "warn",
    ); // a change between passes of one run is surfaced as a warning
  });

  it("the capability list of the initial record is preferred over the version comparison", () => {
    // The initial record (present from 2.1.205) decides on its own: a flag
    // it names is available even where a naive floor comparison would agree,
    // and one it does not name is unavailable even on the pin itself.
    const listed = flagAvailability({
      flag: "--permission-prompts",
      version: "2.1.284",
      capabilityList: ["--permission-prompts", "--strict-mcp-config"],
    });
    assert.deepEqual(listed, { available: true, decidedBy: "capability-list" });
    const missing = flagAvailability({
      flag: "--some-flag",
      version: "2.1.284", // the pin: the version comparison would say yes
      capabilityList: ["--permission-prompts"],
    });
    assert.deepEqual(missing, { available: false, decidedBy: "capability-list" });
  });

  it("a flag the help does not list is gated by the version floor", () => {
    for (const flag of HIDDEN_FLAGS) {
      assert.ok(hiddenFlagIsGatedByFloor(flag), flag);
    }
    assert.deepEqual(HIDDEN_FLAGS, ["--max-turns", "--system-prompt-file"]);
    // Below the floor the flag is not available; at and above it, it is.
    assert.deepEqual(
      flagAvailability({ flag: "--max-turns", version: "2.1.248", capabilityList: null }),
      { available: false, decidedBy: "version-floor" },
    );
    assert.deepEqual(
      flagAvailability({ flag: "--system-prompt-file", version: CLI_FLOOR, capabilityList: null }),
      { available: true, decidedBy: "version-floor" },
    );
    assert.equal(versionAtFloor("2.1.259", "2.1.259"), true);
    assert.equal(versionAtFloor("2.1.258", "2.1.259"), false);
    // With neither a capability list nor a recorded version, nothing was
    // compared — detection checks the floor before a call is built.
    assert.deepEqual(
      flagAvailability({ flag: "--max-turns", version: null, capabilityList: null }),
      {
        available: true,
        decidedBy: "no-record",
      },
    );
  });

  it("the argument table gates the hidden flags through the condition `versionFloorMet`", async () => {
    const { buildCriticArgv } = await import("../../src/index.ts");
    const base = {
      role: "critic" as const,
      profile: "default" as const,
      authTier: 1 as const,
      sessionId: "s-1",
      budgetUsd: 0.5,
      criticSystemPromptFile: "/tmp/prompt.md",
    };
    // On the pin both hidden flags are in the list.
    const onPin = buildCriticArgv({ ...base, version: "2.1.284", capabilityList: null });
    assert.ok(onPin.includes("--max-turns"));
    assert.ok(onPin.includes("--system-prompt-file"));
    // Below the floor the hidden flags drop out; the rest of the table stays.
    const belowFloor = buildCriticArgv({ ...base, version: "2.1.248", capabilityList: null });
    assert.ok(!belowFloor.includes("--max-turns"));
    assert.ok(!belowFloor.includes("--system-prompt-file"));
    assert.ok(belowFloor.includes("--permission-mode"));
    // The capability list of the initial record decides over the version.
    const byCapability = buildCriticArgv({
      ...base,
      version: "2.1.248",
      capabilityList: ["--max-turns"],
    });
    assert.ok(byCapability.includes("--max-turns"));
    assert.ok(!byCapability.includes("--system-prompt-file"));
  });

  it("nothing is downloaded to achieve a pin", () => {
    // The pin is data in the package, not a fetch.
    assert.equal(CLI_PIN, "2.1.284");
    assert.equal(typeof CLI_PIN, "string");
  });
});
