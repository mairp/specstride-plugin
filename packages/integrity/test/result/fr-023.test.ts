// CT-116-23 (F116-FR-023) — both records validate against their schema files
// and carry their schema id; an entry of `commands` has `id` and `exit`,
// written from `commandId` and `exitCode` of the value that the check runner
// returns; the `$id` of each of the three schema files is
// `urn:specstride:schema:<schema id>`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validatorFor } from "../../../../packages/contracts/src/records/compile.ts";
import {
  CHECK_RESULT_SCHEMA,
  PROTECTED_SET_SCHEMA,
  commandFromRunnerValue,
  writeCheckResultRecord,
  writeProtectedSetRecord,
} from "../../src/result/record.ts";
import { CLEAN_CONDITIONS } from "../../src/protected/compare.ts";

const SCHEMAS_DIR = "../../../../packages/contracts/schemas";

const protectedSetRecord = writeProtectedSetRecord({
  phase: 2,
  profiles: [{ id: "vitest", version: "1" }],
  basic: false,
  classAPatterns: ["toolchain/**"],
  ignoredListings: [{ path: "node_modules", listingHash: "a".repeat(64), contentHashed: [] }],
  classBFiles: [{ path: "test/a.test.ts", hash: "b".repeat(64) }],
  authorised: { "task-1": ["src/a.ts"] },
  atLaunch: { set: "s0", tree: "t0" },
  atPhaseEntry: { set: "s1", tree: "t1" },
  exclusions: ["node_modules"],
  effectiveConfig: "c".repeat(64),
});

const checkResultRecord = writeCheckResultRecord({
  unitId: "unit-1",
  ordinal: 1,
  treeBefore: "t0",
  treeAfter: "t1",
  protectedBefore: "s0",
  protectedAfter: "s1",
  commands: [
    commandFromRunnerValue(
      {
        commandId: "cmd-1",
        exitCode: 0,
        durationMs: 12,
        output: { logicalName: "cmd-1.out", hash: "d".repeat(64), size: 100 },
      },
      CLEAN_CONDITIONS,
    ),
  ],
  excluded: [],
});

test("CT-116-23 both records validate against their schema files and carry their schema id", () => {
  const protectedSetValidate = validatorFor("specstride.protected-set/1").validate;
  const checkResultValidate = validatorFor("specstride.check-result/1").validate;
  assert.equal(protectedSetValidate(protectedSetRecord), true);
  assert.equal(checkResultValidate(checkResultRecord), true);
  assert.equal(protectedSetRecord.schema, PROTECTED_SET_SCHEMA);
  assert.equal(protectedSetRecord.schema, "specstride.protected-set/1");
  assert.equal(checkResultRecord.schema, CHECK_RESULT_SCHEMA);
  assert.equal(checkResultRecord.schema, "specstride.check-result/1");
});

test("CT-116-23 a command entry has id and exit, written from commandId and exitCode of the runner value", () => {
  const entry = checkResultRecord.commands[0];
  assert.equal(entry.id, "cmd-1");
  assert.equal(entry.exit, 0);
  assert.ok(!("commandId" in entry));
  assert.ok(!("exitCode" in entry));
});

test("CT-116-23 the $id of each of the three schema files is urn:specstride:schema:<schema id>", () => {
  for (const [file, schemaId] of [
    ["toolchain.schema.json", "specstride.toolchain/1"],
    ["protected-set.schema.json", "specstride.protected-set/1"],
    ["check-result.schema.json", "specstride.check-result/1"],
  ] as const) {
    const parsed = JSON.parse(
      readFileSync(new URL(`${SCHEMAS_DIR}/${file}`, import.meta.url), "utf8"),
    ) as { $id: string };
    assert.equal(parsed.$id, `urn:specstride:schema:${schemaId}`, file);
  }
});
