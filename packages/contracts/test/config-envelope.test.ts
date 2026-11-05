/**
 * T065 — contract tests CT-100-301, CT-100-302 and CT-100-303 for the config
 * envelope, the ranks and the trust classes (annex X, §X.2; F100-FR-201,
 * F100-FR-202, F100-FR-203).
 */
import test from "node:test";
import assert from "node:assert/strict";
import configRanksData from "../data/config-ranks.json" with { type: "json" };
import schema from "../schemas/config-envelope.schema.json" with { type: "json" };
import {
  INSTALL_ROOT_FILE_IS_READ,
  KEY_CLASSES,
  KEY_CLASS_DEFAULT,
  RANK_LAYERS,
  authTierKey,
  configRanks,
  effectiveRank,
  rankOfLayer,
  resolveKey,
} from "../src/envelope/config.ts";
import {
  NAMED_WIDENING_KEYS,
  PROJECT_RANK,
  TRUST_CLASSES,
  TRUST_CLASS_DEFAULT,
  defaultStricter,
  filterProjectConfiguration,
  filterProjectKey,
  trustClassRows,
} from "../src/envelope/trust-classes.ts";
import {
  AS_IS_VARIABLES,
  FREE_PREFIX,
  MAJOR,
  SCHEMA_ID,
  envelopeIsValid,
  environmentAliases,
  keyOfEnvironmentVariable,
  launchIsRefused,
  validateConfigFile,
} from "../src/envelope/config-validate.ts";

test("CT-100-301: configuration is resolved through the eight ranks, with the rank recorded (F100-FR-201)", () => {
  assert.equal(configRanks.length, 8);
  assert.equal((configRanksData as { ranks: unknown[] }).ranks.length, 8);
  assert.deepEqual(
    configRanks.map((r) => r.rank),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.deepEqual(
    [...RANK_LAYERS],
    [
      "launch-contract-pin",
      "flag",
      "run-snapshot",
      "environment",
      "project-configuration",
      "user-configuration",
      "learned-value",
      "default",
    ],
  );
  assert.equal(rankOfLayer["flag"], 2);
  assert.equal(rankOfLayer["default"], 8);
  // The highest rank that offers a value wins, and the rank is recorded.
  const resolved = resolveKey("loop.strategy", [
    { layer: "default", value: "micro" },
    { layer: "flag", value: "classic" },
    { layer: "user-configuration", value: "micro" },
  ]);
  assert.deepEqual(resolved, {
    key: "loop.strategy",
    value: "classic",
    source: "flag",
    rank: 2,
    class: "pinned",
  });
  // A key no rank offers resolves to nothing.
  assert.equal(resolveKey("nothing", []), undefined);
  // The as-is file at the install root is not read.
  assert.equal(INSTALL_ROOT_FILE_IS_READ, false);
  // The auth tier of a role wins over the one of a harness.
  assert.equal(authTierKey("critic", "claude"), "roles.critic.tier");
  assert.equal(authTierKey(undefined, "claude"), "harnesses.claude.authTier");
});

test("CT-100-301: on resume a tunable key ranks below the environment and a pinned key above it", () => {
  assert.deepEqual([...KEY_CLASSES], ["pinned", "tunable"]);
  assert.equal(KEY_CLASS_DEFAULT, "pinned");
  const pinned = effectiveRank("run-snapshot", { class: "pinned", onResume: true });
  const tunable = effectiveRank("run-snapshot", { class: "tunable", onResume: true });
  assert.equal(pinned, 3);
  // Below flags (2) and above the environment (4).
  assert.ok((pinned as number) > rankOfLayer["flag"]);
  assert.ok((pinned as number) < rankOfLayer["environment"]);
  // Below the environment (4) and above project configuration (5).
  assert.ok((tunable as number) > rankOfLayer["environment"]);
  assert.ok((tunable as number) < rankOfLayer["project-configuration"]);
  // The environment then wins over a tunable snapshot value.
  const resolved = resolveKey(
    "pass.ceilingSec",
    [
      { layer: "run-snapshot", value: 100 },
      { layer: "environment", value: 200 },
    ],
    { class: "tunable", onResume: true },
  );
  assert.equal(resolved?.source, "environment");
  // And loses to a pinned one.
  const pinnedResolved = resolveKey(
    "pass.ceilingSec",
    [
      { layer: "run-snapshot", value: 100 },
      { layer: "environment", value: 200 },
    ],
    { class: "pinned", onResume: true },
  );
  assert.equal(pinnedResolved?.source, "run-snapshot");
});

test("CT-100-302: project configuration narrows a run and never widens it (F100-FR-202)", () => {
  assert.deepEqual([...TRUST_CLASSES], ["widening", "narrowing", "neutral", "pinnable"]);
  assert.equal(trustClassRows.length, 4);
  assert.equal(TRUST_CLASS_DEFAULT, "widening");
  assert.equal(PROJECT_RANK, 5);
  // A widening key is ignored, with a launch message and a doctor warning.
  const widening = filterProjectKey("roles.critic.tier", 3, "widening", undefined);
  assert.equal(widening.accepted, false);
  if (!widening.accepted) {
    assert.equal(widening.reason, "widening");
    assert.match(widening.launchMessage, /cannot widen a run/);
    assert.match(widening.doctorWarning, /widening key/);
  }
  // A key with no trust class is widening.
  assert.equal(filterProjectKey("anything", 1, undefined, undefined).accepted, false);
  for (const key of NAMED_WIDENING_KEYS) {
    assert.equal(filterProjectKey(key, 1, "widening", undefined).accepted, false, key);
  }
  // A narrowing key is accepted only where it is stricter.
  assert.equal(filterProjectKey("budget.maxSec", 10, "narrowing", 100).accepted, true);
  const loosened = filterProjectKey("budget.maxSec", 1000, "narrowing", 100);
  assert.equal(loosened.accepted, false);
  if (!loosened.accepted) assert.equal(loosened.reason, "not-stricter");
  assert.equal(defaultStricter(10, 100), true);
  assert.equal(defaultStricter(1000, 100), false);
  assert.equal(defaultStricter(false, true), true, "switching something off is stricter");
  // A neutral key is accepted.
  assert.equal(filterProjectKey("output.width", 100, "neutral", 80).accepted, true);
  // A whole file at once.
  const outcomes = filterProjectConfiguration(
    { "roles.critic.tier": 3, "budget.maxSec": 10 },
    (k) => (k === "budget.maxSec" ? "narrowing" : "widening"),
    () => 100,
  );
  assert.deepEqual(
    outcomes.map((o) => o.accepted),
    [false, true],
  );
});

test("CT-100-303: the config envelope, the free prefix, the inline secret and the aliases (F100-FR-203)", () => {
  assert.equal(SCHEMA_ID, "specstride.config/1");
  assert.equal(MAJOR, 1);
  assert.equal(FREE_PREFIX, "x-");
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);
  assert.ok((schema as { required: string[] }).required.includes("schema"));
  assert.ok(envelopeIsValid({ schema: 1 }));
  // `schema` is required.
  assert.equal(launchIsRefused(validateConfigFile({})), true);
  assert.equal(validateConfigFile({})[0]?.kind, "missing-schema");
  // A different major refuses the launch.
  const major = validateConfigFile({ schema: 2 });
  assert.equal(major[0]?.kind, "different-major");
  assert.equal(launchIsRefused(major), true);
  // An unknown key at any level refuses the launch.
  const unknown = validateConfigFile(
    { schema: 1, roles: { proposer: { harness: "x", nothing: 1 } } },
    { knownKeys: ["roles.proposer.harness"] },
  );
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0]?.kind, "unknown-key");
  assert.equal(unknown[0]?.key, "roles.proposer.nothing");
  assert.equal(launchIsRefused(unknown), true);
  // A key under `x-` is ignored.
  assert.deepEqual(
    [...validateConfigFile({ schema: 1, "x-mine": { anything: 1 } }, { knownKeys: [] })],
    [],
  );
  // An inline secret is an error; a reference is not.
  const secret = validateConfigFile({ schema: 1, apiToken: "sk-live" }, {});
  assert.equal(secret[0]?.kind, "inline-secret");
  assert.equal(launchIsRefused(secret), true);
  assert.deepEqual([...validateConfigFile({ schema: 1, apiToken: "env:TOKEN" }, {})], []);
  // The as-is environment variables are read through the alias table of §X.8.
  assert.ok(environmentAliases.length > 0);
  assert.ok(AS_IS_VARIABLES.includes("SPECSTRIDE_PROPOSER"));
  assert.equal(keyOfEnvironmentVariable("SPECSTRIDE_PROPOSER"), "roles.proposer.harness");
  assert.equal(keyOfEnvironmentVariable("SPECSTRIDE_CRITIC"), "roles.critic.harness");
  assert.equal(keyOfEnvironmentVariable("NOT_A_VARIABLE"), undefined);
});

test("CT-100-303: under the parity profile a value from an alias the baseline reads late is not refused at launch", () => {
  const key = "roles.proposer.lateKey";
  const strict = validateConfigFile(
    { schema: 1, roles: { proposer: { lateKey: "x" } } },
    { knownKeys: [], arrivedThroughLateAlias: [key] },
  );
  assert.equal(strict[0]?.refusesLaunch, true, "without the profile the launch is refused");
  const parity = validateConfigFile(
    { schema: 1, roles: { proposer: { lateKey: "x" } } },
    { knownKeys: [], parityProfile: true, arrivedThroughLateAlias: [key] },
  );
  assert.equal(parity[0]?.kind, "unknown-key");
  assert.equal(parity[0]?.refusesLaunch, false, "it fails where the baseline fails");
  assert.match(String(parity[0]?.message), /the baseline reads late/);
  assert.equal(launchIsRefused(parity), false);
});
