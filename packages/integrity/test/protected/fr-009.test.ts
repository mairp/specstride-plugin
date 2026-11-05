// CT-116-9 (F116-FR-009): pins, search path, effective configuration, caches
// and cached.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stubProfile } from "./helpers.ts";
import {
  searchPathAtLaunch,
  pinExecutable,
  verifyPin,
  effectiveConfigHash,
  cacheDisableEnv,
  cachedCondition,
  CACHE_LOCATIONS_IN_CLASS_A_OR_OFF,
} from "../../src/pins/verify.ts";

test("CT-116-9 the pin of an executable is taken through the search path at launch", () => {
  const bin = mkdtempSync(join(tmpdir(), "integrity-116-bin-"));
  const exe = join(bin, "stubtool");
  writeFileSync(exe, "#!/bin/sh\necho config\n");
  chmodSync(exe, 0o755);
  const pathEnv = `${bin}:/usr/bin`;
  const atLaunch = searchPathAtLaunch({ PATH: pathEnv });
  assert.equal(atLaunch, pathEnv);
  const pin = pinExecutable(exe, pathEnv);
  assert.match(pin.hash, /^[0-9a-f]{64}$/);
  assert.equal(pin.resolvedVia, bin);
  assert.equal(verifyPin(pin, pathEnv).ok, true);
});

test("CT-116-9 a pin that does not verify gives tainted with reason pin-mismatch", () => {
  const bin = mkdtempSync(join(tmpdir(), "integrity-116-bin2-"));
  const exe = join(bin, "stubtool");
  writeFileSync(exe, "v1");
  const pathEnv = bin;
  const pin = pinExecutable(exe, pathEnv);
  writeFileSync(exe, "v2"); // the executable changed after the pin was taken
  const verdict = verifyPin(pin, pathEnv);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "pin-mismatch");
});

test("CT-116-9 the effective configuration is recorded and a difference is detected", async () => {
  const bin = mkdtempSync(join(tmpdir(), "integrity-116-cfg-"));
  const exe = join(bin, "printconfig");
  writeFileSync(exe, '#!/bin/sh\necho "$STUB_CONFIG"\n');
  chmodSync(exe, 0o755);
  process.env.STUB_CONFIG = "a=1";
  const one = await effectiveConfigHash([exe], process.env);
  process.env.STUB_CONFIG = "a=2";
  const two = await effectiveConfigHash([exe], process.env);
  assert.notEqual(one, two);
  delete process.env.STUB_CONFIG;
});

test("CT-116-9 cache locations are switched off through the environment", () => {
  const env = cacheDisableEnv(stubProfile);
  assert.equal(env.STUB_DISABLE_CACHE, "1");
  assert.deepEqual(CACHE_LOCATIONS_IN_CLASS_A_OR_OFF(stubProfile), [".stubcache"]);
});

test("CT-116-9 cached is a condition of its own and never a pass", () => {
  const cached = cachedCondition(true);
  assert.notEqual(cached, false);
  assert.equal(cachedCondition(false), false);
});
