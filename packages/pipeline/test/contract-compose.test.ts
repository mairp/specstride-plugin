/**
 * T005 of feature 107 — the composed validator of the launch contract
 * (specs/107-launch-contract/tasks.md, T005; F107-FR-012: one schema is the
 * validator; research.md row 14: the post-schema rule of the declarations of
 * scope).
 *
 * What this test holds:
 *
 * - the composed schema is the record schema of `@specstride/contracts` with
 *   the item schemas of T003 joined by reference: every joined position
 *   carries `$ref` of the internal `$id`, and the `$id`s are the six of
 *   T003 (`urn:specstride:schema:internal:107:<name>/1`); the record schema
 *   file itself stays verbatim on disk;
 * - the composition is strict where the loose record schema is loose: a
 *   finding with an unknown member is refused by the composed validator
 *   although the record schema alone accepts it;
 * - the record-level validator is the one of `@specstride/contracts`, handed
 *   through as the very same function objects (`RECORD_LEVEL_VALIDATOR`) —
 *   no second implementation of the record rules (F107-FR-012, no rule in
 *   two places);
 * - the post-schema rule of research.md row 14: every entry of
 *   `configuration.scopes.tasks` and `configuration.scopes.commands` carries
 *   a `source` member of the closed set of row 261 (`user-config`,
 *   `environment`, `flag`); `verification-plan` is refused;
 * - `validateLaunchContract` runs the composed schema and then the
 *   post-schema rule, and nothing else — the record-level readings stay the
 *   record validator's.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";

import {
  RECORD_SCHEMA_ID,
  internalSchemaId,
  ITEM_SCHEMA_NAMES,
  JOINED_POSITIONS,
  composedSchema,
  validateComposed,
  RECORD_LEVEL_VALIDATOR,
  DECLARED_SOURCES,
  REFUSED_SCOPE_SOURCES,
  declaredProvenanceProblems,
  validateLaunchContract,
} from "../src/contract/validate/compose.ts";
import { isLaunchContract } from "@specstride/contracts/records/launch-contract";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("T005: the composed schema joins the item schemas of T003 by reference", () => {
  assert.equal(ITEM_SCHEMA_NAMES.length, 6);
  for (const name of ITEM_SCHEMA_NAMES) {
    assert.equal(internalSchemaId(name), `urn:specstride:schema:internal:107:${name}/1`);
  }
  const composed = composedSchema();
  assert.equal(composed.$id, RECORD_SCHEMA_ID);
  const properties = composed.properties as Record<string, Record<string, unknown>>;
  for (const name of ITEM_SCHEMA_NAMES) {
    const { property, at } = JOINED_POSITIONS[name];
    const ref = { $ref: internalSchemaId(name) };
    if (at === "items") {
      assert.deepEqual(properties[property]!.items, ref, property);
    } else {
      assert.deepEqual(properties[property], ref, property);
    }
  }
  // The record schema file on disk is untouched: it still carries its own
  // words at every joined position (the join composes, never edits).
  const onDisk = JSON.parse(
    readFileSync(
      join(PACKAGE_ROOT, "..", "contracts", "schemas", "launch-contract.schema.json"),
      "utf8",
    ),
  ) as { properties: Record<string, Record<string, unknown>> };
  const composedProps = composed.properties as Record<string, Record<string, unknown>>;
  for (const name of ITEM_SCHEMA_NAMES) {
    const { property } = JOINED_POSITIONS[name];
    assert.notDeepEqual(composedProps[property], onDisk.properties[property], property);
  }
});

test("T005: the composed validator is strict where the record schema is loose", () => {
  // The record schema alone accepts a finding with an unknown member (its
  // `findings.items` is loose); the item schema of T003 refuses it, through
  // the reference of the join.
  const loose = new Ajv2020({ strict: false, allErrors: true }).compile(
    JSON.parse(
      readFileSync(
        join(PACKAGE_ROOT, "..", "contracts", "schemas", "launch-contract.schema.json"),
        "utf8",
      ),
    ),
  );
  const looseRecord = minimalRecord();
  (looseRecord as Record<string, unknown>).findings = [
    { kind: "risk", severity: "high", noSuchMember: 1 },
  ];
  assert.equal(loose(looseRecord), true);

  const composed = validateComposed(looseRecord);
  assert.equal(composed.ok, false);
  if (!composed.ok) {
    assert.ok(
      composed.errors.some((one) => one.path.startsWith("/findings/0")),
      JSON.stringify(composed.errors),
    );
  }
});

test("T005: the record-level validator IS the one of @specstride/contracts", () => {
  // The very same function objects, no second implementation (F107-FR-012).
  assert.equal(RECORD_LEVEL_VALIDATOR.isLaunchContract, isLaunchContract);
  assert.equal(RECORD_LEVEL_VALIDATOR.unknownTopLevelKeyRefused, true);
  assert.equal(RECORD_LEVEL_VALIDATOR.ignoredKeyPrefix, "x-");
  assert.equal(typeof RECORD_LEVEL_VALIDATOR.readLaunchContract, "function");
});

test("T005: the post-schema rule of row 14 — every scope entry names a source of row 261", () => {
  assert.deepEqual([...DECLARED_SOURCES].sort(), ["environment", "flag", "user-config"]);
  assert.deepEqual([...REFUSED_SCOPE_SOURCES], ["verification-plan"]);
  const bad = declaredProvenanceProblems({
    configuration: {
      verification: {},
      scopes: { tasks: { "tasks/**": { source: "verification-plan" } } },
    },
  });
  assert.equal(bad.length, 1);
  assert.match(bad[0]!.message, /does not carry its provenance/);
  assert.equal(bad[0]!.path, "/configuration/scopes/tasks/tasks/**/source");
  const good = declaredProvenanceProblems({
    configuration: {
      verification: {},
      scopes: {
        tasks: { "tasks/**": { source: "user-config" } },
        commands: {
          "cmd-a": { source: "flag" },
          "cmd-b": { source: "environment" },
        },
      },
    },
  });
  assert.deepEqual(good, []);
});

test("T005: validateLaunchContract runs the composed schema and then the post-schema rule", () => {
  // A well-formed minimal record passes both.
  assert.deepEqual(validateLaunchContract(minimalRecord()), {
    ok: true,
    record: minimalRecord(),
  });
  // An unknown top-level key: refused by the record schema's
  // `additionalProperties: false` (the record-level rule, at schema level).
  const unknown = validateComposed({ schema: "specstride.launch-contract/1", noSuch: true });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) {
    assert.ok(unknown.errors.some((one) => one.keyword === "additionalProperties"));
  }
  // An entry whose source is outside row 261 (`verification-plan`) is
  // refused: the item schema of `configuration` carries the enum of row 261,
  // so the refusal is the schema's, at the source path — the same rule is
  // not written twice (F107-FR-012); `declaredProvenanceProblems` above is
  // the post-schema reading of the same refusal for the callers that work
  // past the schema.
  const withBadScope = minimalRecord() as Record<string, unknown>;
  (withBadScope as Record<string, unknown>).configuration = {
    verification: {},
    scopes: { commands: { "cmd-a": { source: "verification-plan" } } },
  };
  const refused = validateLaunchContract(withBadScope);
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.ok(
      refused.errors.some((one) => one.path === "/configuration/scopes/commands/cmd-a/source"),
      JSON.stringify(refused.errors),
    );
  }
});

/** A minimal record the record schema accepts as-is (its own rules, loose). */
function minimalRecord(): Record<string, unknown> {
  return {
    schema: "specstride.launch-contract/1",
    id: "pipeline:demo:contract",
    status: "validated",
    repository: { root: ".", head: "02354db" },
    authorized_roots: ["."],
    sources: [],
    coverage: [],
    findings: [],
    stages: [],
  };
}
