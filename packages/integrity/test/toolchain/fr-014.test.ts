// CT-116-14 (F116-FR-014): shipped and consumer profiles; the key
// `toolchains.<id>` accepted from user configuration only; project
// configuration, the environment and a flag ignored; the fictional toolchain.
//
// The product ships profiles; a consumer profile is accepted only under the
// key `toolchains.<id>` of USER configuration and is stored under the logical
// name `user:toolchain:<id>`. The same key in project configuration, in the
// environment or as a flag is ignored, with a launch message and a doctor
// warning. The profiles a run used are recorded with their versions. A
// fictional toolchain, given in a test overlay, changes the protected set of
// a fixture with no file of the product changed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeRepo } from "../protected/helpers.ts";
import {
  loadToolchainProfiles,
  logicalNameOf,
  TOOLCHAINS_KEY_PREFIX,
} from "../../src/toolchain/load.ts";
import { captureAtLaunch } from "../../src/protected/entry.ts";

/** The fictional toolchain, given in a test overlay. */
const FICTIONAL = Object.freeze({
  schema: "specstride.toolchain/1",
  id: "fictional-14",
  version: "3",
  detect: { files: ["fictional.toolchain.json"] },
  classA: ["fictional.toolchain.json", "fictional/**"],
  testFiles: ["fictional/tests/**"],
  effectiveConfig: null,
});
const OVERLAY = Object.freeze({ "toolchains.fictional-14": FICTIONAL });

test("CT-116-14 the product ships profiles and each carries a version", () => {
  const loaded = loadToolchainProfiles({});
  assert.ok(loaded.profiles.length >= 1, "at least one shipped profile");
  for (const entry of loaded.profiles) {
    assert.equal(entry.source, "shipped");
    assert.match(entry.profile.version, /^\d/);
  }
});

test("CT-116-14 the key toolchains.<id> is accepted from user configuration only, under user:toolchain:<id>", () => {
  assert.equal(TOOLCHAINS_KEY_PREFIX, "toolchains.");
  assert.equal(logicalNameOf("fictional-14"), "user:toolchain:fictional-14");
  const loaded = loadToolchainProfiles({ userConfig: OVERLAY });
  const entry = loaded.profiles.find((p) => p.profile.id === "fictional-14");
  assert.ok(entry, "the consumer profile is loaded");
  assert.equal(entry.source, "user");
  assert.equal(entry.logicalName, "user:toolchain:fictional-14");
  assert.deepEqual(
    loaded.usedProfiles.filter((p) => p.id === "fictional-14"),
    [{ id: "fictional-14", version: "3" }],
  );
});

test("CT-116-14 the same key in project configuration is ignored, with a launch message and a doctor warning", () => {
  const loaded = loadToolchainProfiles({ projectConfig: OVERLAY });
  assert.deepEqual(
    loaded.profiles.filter((p) => p.profile.id === "fictional-14"),
    [],
  );
  assert.ok(loaded.launchMessages.some((m) => m.includes("toolchains.fictional-14")));
  assert.ok(loaded.doctorWarnings.some((w) => w.includes("toolchains.fictional-14")));
});

test("CT-116-14 the environment and a flag are ignored, with the same finding", () => {
  const fromEnv = loadToolchainProfiles({
    env: { SPECSTRIDE_TOOLCHAINS: JSON.stringify(OVERLAY) },
  });
  assert.deepEqual(
    fromEnv.profiles.filter((p) => p.profile.id === "fictional-14"),
    [],
  );
  assert.ok(fromEnv.doctorWarnings.length >= 1);
  const fromFlag = loadToolchainProfiles({ flags: { toolchains: OVERLAY } });
  assert.deepEqual(
    fromFlag.profiles.filter((p) => p.profile.id === "fictional-14"),
    [],
  );
  assert.ok(fromFlag.doctorWarnings.length >= 1);
});

test("CT-116-14 the fictional toolchain in a test overlay changes the protected set of a fixture", async () => {
  const root = makeRepo({});
  mkdirSync(join(root, "fictional"), { recursive: true });
  writeFileSync(join(root, "fictional.toolchain.json"), "{}\n");
  writeFileSync(join(root, "fictional", "check.txt"), "x\n");

  const without = await captureAtLaunch({ phase: 1, root, profiles: [] });
  const loaded = loadToolchainProfiles({ userConfig: OVERLAY, overlay: OVERLAY });
  const withProfile = await captureAtLaunch({
    phase: 1,
    root,
    profiles: loaded.profiles.map((p) => p.profile),
  });
  // The profile of the fictional toolchain is in the protected set now.
  assert.ok(withProfile.classA.patterns.includes("fictional/**"));
  assert.ok(without.classA.patterns.includes("fictional/**") === false);
  assert.deepEqual(
    withProfile.profiles.filter((p) => p.id === "fictional-14"),
    [{ id: "fictional-14", version: "3" }],
  );
  // No file of the product changed: the run wrote nothing next to the source.
});
