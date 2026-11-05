// CT-116-13 (F116-FR-013): the toolchain profile: its content, validation,
// the unknown field.
//
// A profile is data with the content of F116-FR-013: how the toolchain is
// detected, the patterns of class A, the patterns of test files, the cache
// locations with the environment that switches each off, the user-level
// configuration files, the patterns of suppression markers, the executables
// to pin, how the effective configuration is read (one fixed argument list of
// a pinned executable, or not at all), the seed paths of worker trees and the
// environment per worker. A profile that does not validate is refused at load
// with a finding and treated as absent. An unknown field is ignored with a
// finding. A profile names no command to run other than that reading.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KNOWN_PROFILE_FIELDS,
  validateProfile,
  loadToolchainProfiles,
} from "../../src/toolchain/load.ts";

/** A complete fictional profile, with every field of F116-FR-013. */
export const FICTIONAL: Record<string, unknown> = {
  schema: "specstride.toolchain/1",
  id: "fictional-13",
  version: "2",
  detect: { files: ["fictional.toolchain.json"] },
  classA: ["fictional.toolchain.json", "fictional/checks/**"],
  testFiles: ["fictional/tests/**"],
  caches: [{ path: ".fictional-cache", disableEnv: { FICTIONAL_CACHE: "0" } }],
  userConfig: ["~/.config/fictional/config.json"],
  suppressionMarkers: ["fictional-ignore"],
  executables: ["fictional"],
  effectiveConfig: ["fictional", "config", "--print"],
  workerSeeds: ["fictional/seed"],
  workerEnv: { FICTIONAL_CACHE: ".fictional-cache-<workerId>" },
};

test("CT-116-13 the profile content of F116-FR-013 is the declared field set", () => {
  for (const field of [
    "detect",
    "classA",
    "testFiles",
    "caches",
    "userConfig",
    "suppressionMarkers",
    "executables",
    "effectiveConfig",
    "workerSeeds",
    "workerEnv",
  ]) {
    assert.ok(
      (KNOWN_PROFILE_FIELDS as readonly string[]).includes(field),
      `the known field set holds ${field}`,
    );
    assert.ok(field in FICTIONAL, `the complete profile names ${field}`);
  }
  // The one command a profile may name is the fixed argument list that reads
  // the effective configuration; it is an argument list, not a command line.
  assert.ok(Array.isArray(FICTIONAL.effectiveConfig));
});

test("CT-116-13 a complete profile validates and loads", () => {
  const outcome = validateProfile(FICTIONAL);
  assert.equal(outcome.ok, true, JSON.stringify(outcome.findings));
  assert.equal(outcome.profile?.id, "fictional-13");
  assert.equal(outcome.profile?.version, "2");
  assert.equal(outcome.findings.length, 0);
});

test("CT-116-13 a profile that does not validate is refused at load with a finding", () => {
  const broken = { schema: "specstride.toolchain/1", id: "broken-13", version: "1" };
  const outcome = validateProfile(broken);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.findings.length >= 1);
  assert.ok(
    outcome.findings.some((f) => f.includes("classA")),
    JSON.stringify(outcome.findings),
  );
  // A refused profile is treated as absent.
  const loaded = loadToolchainProfiles({ userConfig: { "toolchains.broken-13": broken } });
  assert.deepEqual(
    loaded.profiles.filter((p) => p.profile.id === "broken-13"),
    [],
  );
});

test("CT-116-13 an unknown field is ignored with a finding, the profile still loads", () => {
  const withUnknown = {
    ...FICTIONAL,
    id: "fictional-13-unknown",
    aFieldTheProductDoesNotKnow: { nested: true },
  };
  const outcome = validateProfile(withUnknown);
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.unknownFields, ["aFieldTheProductDoesNotKnow"]);
  assert.ok(
    outcome.findings.some((f) => f.includes("aFieldTheProductDoesNotKnow")),
    "the unknown field is named in a finding",
  );
  // The unknown field is not carried into the loaded profile.
  const loaded = loadToolchainProfiles({
    userConfig: { "toolchains.fictional-13-unknown": withUnknown },
  });
  const profile = loaded.profiles.find((p) => p.profile.id === "fictional-13-unknown");
  assert.ok(profile);
  assert.equal("aFieldTheProductDoesNotKnow" in profile.profile, false);
});
