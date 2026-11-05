/**
 * T046 (feature 112) — CT-112-113 (F112-FR-013, F112-FR-009): the harness
 * checks against a descriptor-only fixture.
 *
 * The fixture is a descriptor-only harness registry: no adapter is installed,
 * no version was probed, the entries are a tested adapter, a declared one and
 * a detected one. The doctor names each harness with its state and calls
 * every harness that is not `tested` `unverified`; an unverified harness
 * selected for a role is a warning; an installed version outside the tested
 * range warns and inside informs; a `verified-on` date older than
 * `doctor.staleAfterDays` is reported.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { HarnessEntry, ProbeBag } from "../src/registry/types.ts";
import {
  STALE_AFTER_DAYS_DEFAULT,
  harnessDiscoveredCheck,
  harnessStateCheckFor,
  harnessVersionCheckFor,
  harnessCapsCheckFor,
  harnessChecksOf,
  isUnverified,
  stateWord,
  versionInRange,
  verifiedOnAgeDays,
} from "../src/checks/harness.ts";
import { runDoctorChecks, makeProbeBag } from "../src/runner/run.ts";
import { findingOf, severityOf } from "./helpers.ts";

/** The descriptor-only fixture: three entries, no adapter installed anywhere. */
const DESCRIPTOR_ONLY: readonly HarnessEntry[] = [
  {
    id: "alpha",
    state: "tested",
    roles: ["proposer"],
    resolvedPath: "/usr/bin/alpha",
    version: "1.2.0",
    testedRange: { min: "1.0.0", max: "2.0.0" },
    verifiedOn: "2026-10-01",
  },
  {
    id: "beta",
    state: "declared",
    roles: ["critic"],
  },
  {
    id: "gamma",
    state: "detected",
  },
];

function bagWithHarnesses(
  entries: readonly HarnessEntry[],
  overrides?: Partial<ProbeBag>,
): ProbeBag {
  return makeProbeBag({
    ...overrides,
    registry: { ids: entries.map((e) => e.id), harnesses: entries },
  });
}

test("CT-112-113: each harness of the descriptor-only fixture is named with state unverified", async () => {
  const listed = await findingOf(harnessDiscoveredCheck, [], {
    registry: { ids: DESCRIPTOR_ONLY.map((e) => e.id), harnesses: DESCRIPTOR_ONLY },
  });
  // The listing names every harness, each with its state word.
  for (const entry of DESCRIPTOR_ONLY) {
    assert.ok(listed.message.includes(entry.id), `listing names ${entry.id}`);
  }
  assert.match(listed.message, /alpha tested/);
  assert.match(listed.message, /beta unverified \(declared\)/);
  assert.match(listed.message, /gamma unverified \(detected\)/);
  // Every harness that is not `tested` is called unverified (F112-FR-013).
  assert.deepEqual(
    DESCRIPTOR_ONLY.map((e) => stateWord(e)),
    ["tested", "unverified (declared)", "unverified (detected)"],
  );
  assert.equal(isUnverified(DESCRIPTOR_ONLY[1] as HarnessEntry), true);
  assert.equal(isUnverified(DESCRIPTOR_ONLY[0] as HarnessEntry), false);
});

test("CT-112-113: harness.state warns when an unverified harness is selected for a role", async () => {
  // `beta` is declared and selected as critic → warn.
  const warnState = harnessStateCheckFor("beta");
  assert.equal(
    await severityOf(warnState, [], {
      registry: { ids: ["beta"], harnesses: DESCRIPTOR_ONLY },
    }),
    "warn",
  );
  // `gamma` is detected but selected for no role → info.
  const plainState = harnessStateCheckFor("gamma");
  assert.equal(
    await severityOf(plainState, [], {
      registry: { ids: ["gamma"], harnesses: DESCRIPTOR_ONLY },
    }),
    "info",
  );
  // A tested harness selected for a role is info, not warn.
  const testedState = harnessStateCheckFor("alpha");
  assert.equal(
    await severityOf(testedState, [], {
      registry: { ids: ["alpha"], harnesses: DESCRIPTOR_ONLY },
    }),
    "info",
  );
  // The warning says what would verify it.
  const finding = await findingOf(warnState, [], {
    registry: { ids: ["beta"], harnesses: DESCRIPTOR_ONLY },
  });
  assert.match(finding.message, /beta unverified \(declared\)/);
  assert.match(finding.message, /conformance suite/);
});

test("CT-112-113: harness.version warns outside the tested range and informs inside", async () => {
  const rangeProbe = harnessVersionCheckFor("alpha");
  const entries: readonly HarnessEntry[] = [
    { ...(DESCRIPTOR_ONLY[0] as HarnessEntry), version: "0.9.0" }, // below min
  ];
  assert.equal(
    await severityOf(rangeProbe, [], {
      registry: { ids: ["alpha"], harnesses: entries },
    }),
    "warn",
  );
  const inside: readonly HarnessEntry[] = [
    { ...(DESCRIPTOR_ONLY[0] as HarnessEntry), version: "1.5.0" }, // inside
  ];
  assert.equal(
    await severityOf(rangeProbe, [], {
      registry: { ids: ["alpha"], harnesses: inside },
    }),
    "info",
  );
  // The message carries the range.
  const finding = await findingOf(rangeProbe, [], {
    registry: { ids: ["alpha"], harnesses: entries },
  });
  assert.match(finding.message, /alpha 0\.9\.0 outside >=1\.0\.0 <2\.0\.0/);
});

test("CT-112-113: an old verified-on is reported against doctor.staleAfterDays (default 90)", () => {
  const now = Date.parse("2026-10-15T00:00:00Z");
  assert.equal(verifiedOnAgeDays("2026-10-01", now), 14);
  assert.equal(verifiedOnAgeDays(undefined, now), undefined);
  assert.equal(STALE_AFTER_DAYS_DEFAULT, 90);
  // A date older than 90 days is stale; a fresh one is not.
  assert.ok(verifiedOnAgeDays("2026-06-01", now)! > STALE_AFTER_DAYS_DEFAULT);
  // Range comparison, stated once.
  assert.equal(versionInRange("1.5.0", { min: "1.0.0", max: "2.0.0" }), true);
  assert.equal(versionInRange("2.0.0", { min: "1.0.0", max: "2.0.0" }), false);
  assert.equal(versionInRange(undefined, { min: "1.0.0" }), undefined);
  assert.equal(versionInRange("1.5.0", undefined), undefined);
});

test("CT-112-113: harness.caps warns when a declared and a probed capability differ", async () => {
  const caps = harnessCapsCheckFor("alpha");
  const differing: readonly HarnessEntry[] = [
    {
      ...(DESCRIPTOR_ONLY[0] as HarnessEntry),
      declaredCaps: { window: 200000 },
      probedCaps: { window: 98000 },
    },
  ];
  assert.equal(
    await severityOf(caps, [], {
      registry: { ids: ["alpha"], harnesses: differing },
    }),
    "warn",
  );
  const agreeing: readonly HarnessEntry[] = [
    {
      ...(DESCRIPTOR_ONLY[0] as HarnessEntry),
      declaredCaps: { window: 200000 },
      probedCaps: { window: 200000 },
    },
  ];
  assert.equal(
    await severityOf(caps, [], {
      registry: { ids: ["alpha"], harnesses: agreeing },
    }),
    "ok",
  );
});

test("CT-112-113: the checks are produced from the resolved registry, not from a list of names", async () => {
  const checks = harnessChecksOf(DESCRIPTOR_ONLY);
  // One fixed listing plus five per-harness checks per entry.
  assert.equal(checks.length, 1 + 5 * DESCRIPTOR_ONLY.length);
  assert.deepEqual(
    checks.filter((c) => c.id.startsWith("bin.")).map((c) => c.id),
    ["bin.alpha", "bin.beta", "bin.gamma"],
  );
  // `bin.<id>` is launch-blocking (row 11) and fails when a role needs it.
  const binBeta = checks.find((c) => c.id === "bin.beta");
  assert.ok(binBeta, "bin.beta exists for a declared entry");
  assert.equal(binBeta.lb, true);
  const bag = bagWithHarnesses(DESCRIPTOR_ONLY);
  const result = await runDoctorChecks({ checks, bag });
  assert.equal(result.error, undefined);
  const binFinding = result.findings.find((f) => f.id === "bin.beta");
  assert.ok(binFinding, "bin.beta has a finding");
  assert.equal(binFinding.severity, "fail", "a role needs beta and it is absent");
  // Merely absent, no role: info.
  const binGamma = result.findings.find((f) => f.id === "bin.gamma");
  assert.equal(binGamma?.severity, "info");
  // Present: ok.
  const binAlpha = result.findings.find((f) => f.id === "bin.alpha");
  assert.equal(binAlpha?.severity, "ok");
});
