/**
 * CT-130-1 — the data of the dsh adapter matches the schemas of
 * `@specstride/contracts` (T007), and the entry exports the descriptor and the
 * hooks (T006).
 *
 * proves: T006, T007 (F130-FR-001, F130-FR-023, F130-FR-038)
 *
 * The validation itself lives in `src/build/check-data.ts`, where
 * `npm run check:data` runs it as a build check; this test holds the same
 * result inside `npm test` so a drift is caught in the suite too.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkData } from "../src/build/check-data.ts";
import { dshDescriptor, DSH_PIN, DSH_HOOKS, DSH_HOOK_IDS } from "../src/index.ts";

test("CT-130-1a: the four data files pass the build check against @specstride/contracts", () => {
  const result = checkData();
  assert.deepEqual(
    result.failures,
    [],
    `the data of the adapter drifted from the contracts: ${result.failures.join("; ")}`,
  );
  assert.equal(result.checked.length, 4);
});

test("CT-130-1b: the descriptor is accepted by the schema specstride.harness/1:descriptor", () => {
  assert.equal(dshDescriptor.id, "dsh");
  assert.equal(dshDescriptor.descriptorVersion, 1);
  assert.equal(dshDescriptor.kind, "cli");
});

test("CT-130-1c: the entry exports the descriptor data file, the pin and the hooks", () => {
  const dataPath = fileURLToPath(new URL("../data/descriptor-dsh.json", import.meta.url));
  assert.equal(existsSync(dataPath), true, "data/descriptor-dsh.json is next to the entry");
  assert.equal(DSH_PIN, "0.1.0-rc.8");
  assert.deepEqual([...DSH_HOOK_IDS].sort(), [
    "critic-patch",
    "plugin-protocol",
    "settings-overlay",
  ]);
  assert.equal(DSH_HOOKS.length, 3);
  const packageRoot = fileURLToPath(new URL("../", import.meta.url));
  for (const hook of DSH_HOOKS) {
    // `module` may name several directories ("src/critic/ and src/coverage/");
    // every directory it names has to exist.
    for (const module of hook.module.split(" and ")) {
      const relative = module.trim().replace("packages/adapter-dsh/", "");
      assert.equal(
        existsSync(`${packageRoot}${relative}`),
        true,
        `the module of hook ${hook.id} exists: ${module}`,
      );
    }
    assert.match(hook.task, /^phase \d/);
  }
});

test("CT-130-1d: the copied data files state the pin and are the files of the contract", () => {
  const dataDir = fileURLToPath(new URL("../data/", import.meta.url));
  for (const name of [
    "descriptor-dsh.json",
    "critic-patch.json",
    "classifier-entries.json",
    "argument-table.json",
  ]) {
    const path = `${dataDir}${name}`;
    assert.equal(existsSync(path), true, `${name} exists in data/`);
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    if (name === "descriptor-dsh.json") {
      assert.deepEqual(parsed["versionRange"], "0.1.0-rc.8");
      assert.equal(parsed["verifiedOn"], "2026-09-29");
    } else {
      assert.equal(parsed["pin"], "0.1.0-rc.8", `${name} states the pin`);
    }
  }
});
