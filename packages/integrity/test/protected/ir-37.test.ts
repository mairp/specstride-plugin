// CT-116-137 (IR-37; F116-FR-009): caches; cached is not a pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubProfile } from "./helpers.ts";
import { cacheDisableEnv, cachedCondition, resultIsPass } from "../../src/pins/verify.ts";

test("IR-37 the environment switches every cache location of the profile off", () => {
  const env = cacheDisableEnv(stubProfile);
  assert.deepEqual(env, { STUB_DISABLE_CACHE: "1" });
});

test("IR-37 a result reported as replayed from a cache carries cached", () => {
  assert.notEqual(cachedCondition(true), false);
});

test("IR-37 cached is not a pass, even with exit 0", () => {
  const result = {
    commands: [
      {
        id: "c1",
        exit: 0,
        conditions: {
          tainted: false,
          cached: cachedCondition(true),
          flaky: false,
          interrupted: false,
          unchecked: false,
        },
      },
    ],
  };
  assert.equal(resultIsPass(result), false);
});
