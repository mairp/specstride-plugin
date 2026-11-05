// CT-116-136 (IR-36; F116-FR-009): executables, search path, configuration of
// the toolchain.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  searchPathAtLaunch,
  pinExecutable,
  verifyPin,
  effectiveConfigHash,
} from "../../src/pins/verify.ts";

function makeBin(name: string, body: string): { dir: string; exe: string } {
  const dir = mkdtempSync(join(tmpdir(), `integrity-116-${name}-`));
  const exe = join(dir, name);
  writeFileSync(exe, body);
  chmodSync(exe, 0o755);
  return { dir, exe };
}

test("IR-36 executables are pinned through the search path at launch and verified before each check", () => {
  const { dir, exe } = makeBin("tool", "v1");
  const pathEnv = `${dir}:/usr/bin`;
  const launchPath = searchPathAtLaunch({ PATH: pathEnv });
  const pin = pinExecutable(exe, launchPath);
  assert.equal(verifyPin(pin, launchPath).ok, true);
  writeFileSync(exe, "v2");
  assert.equal(verifyPin(pin, launchPath).ok, false);
});

test("IR-36 the search path is the value at launch, not a later one", () => {
  assert.equal(searchPathAtLaunch({ PATH: "/launch/bin" }), "/launch/bin");
  assert.notEqual(searchPathAtLaunch({ PATH: "/later/bin" }), "/launch/bin");
});

test("IR-36 the effective configuration is read where the profile names how, as a fixed argv", async () => {
  const { exe } = makeBin("printconfig", "#!/bin/sh\necho fixed-config\n");
  const one = await effectiveConfigHash([exe], {});
  const two = await effectiveConfigHash([exe], {});
  assert.equal(one, two); // deterministic for the same configuration
  const { exe: other } = makeBin("printconfig2", "#!/bin/sh\necho other\n");
  assert.notEqual(one, await effectiveConfigHash([other], {}));
});
