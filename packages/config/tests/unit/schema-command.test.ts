/**
 * T018 — CT-110-111 (F110-FR-012).
 *
 * `config schema` prints the schema of this catalogue, with the version of the
 * schema, in a machine-readable form and in a form for people, within the token
 * budget of annex G §G.5. Its exit code is 0, and 3 for a usage error.
 *
 * The budget is the one its owner derives from §G.5 (F100-FR-187): the suite
 * measures the bytes of every host-facing form of both commands through the same
 * module the build's check uses, so the check in CI and this test can never
 * disagree. The two `--all` forms carry no §G.5 budget — a host skill never asks
 * for them — and the suite asserts that they are measured and reported rather
 * than silently dropped.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CATALOGUE, CATALOGUE_SIZE } from "../../src/schema/catalogue.ts";
import { CONFIG_SCHEMA_ID, CONFIG_SCHEMA_MAJOR } from "../../src/load/files.ts";
import {
  BYTES_PER_TOKEN,
  COMMAND_BYTE_BUDGET,
  COMMAND_TOKEN_BUDGET,
  DERIVATION,
  HOST_SKILL_TOKEN_BUDGET,
  SHARE_OF_THE_SKILL_BUDGET,
  byteLength,
  measure,
  reportLine,
  tokenBudgetOf,
} from "../../src/cli/budget.ts";
import {
  EXIT_INVALID_OR_USAGE,
  EXIT_OK,
  FLAGS,
  JSON_SCHEMA_ID,
  LINE_LABEL,
  SCHEMA_VERSION,
  namespaceSummaries,
  parseSchemaFlags,
  runConfigSchema,
} from "../../src/cli/schema.ts";
import { breaches, measurements } from "../../tools/token-budget-check.ts";

describe("CT-110-111 — `config schema` prints the schema with its version (F110-FR-012)", () => {
  it("the form for people names the version of the schema and the size of the catalogue", () => {
    const result = runConfigSchema([]);
    assert.equal(result.code, EXIT_OK);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, new RegExp(`^\\[${LINE_LABEL}\\] `));
    assert.match(result.stdout, /schema=specstride\.config\/1/);
    assert.match(result.stdout, new RegExp(`major=${CONFIG_SCHEMA_MAJOR}`));
    assert.match(result.stdout, new RegExp(`keys=${CATALOGUE_SIZE}`));
    assert.equal(SCHEMA_VERSION, CONFIG_SCHEMA_ID);
  });

  it("the machine-readable form is one record with a `schema` field (F100-FR-172)", () => {
    const result = runConfigSchema(["--json"]);
    assert.equal(result.code, EXIT_OK);
    const record = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(record["schema"], JSON_SCHEMA_ID);
    assert.equal(record["version"], CONFIG_SCHEMA_ID);
    assert.equal(record["major"], CONFIG_SCHEMA_MAJOR);
    assert.equal(record["keys"], CATALOGUE_SIZE);
    assert.deepEqual(Object.keys(record), ["schema", "version", "major", "keys", "namespaces"]);
  });

  it("both forms name every namespace of the schema, with its count and its owners", () => {
    const summaries = namespaceSummaries();
    assert.equal(
      summaries.reduce((n, s) => n + s.keys, 0),
      CATALOGUE_SIZE,
      "every key of the catalogue is counted once",
    );
    const text = runConfigSchema([]).stdout;
    const json = JSON.parse(runConfigSchema(["--json"]).stdout) as {
      namespaces: { namespace: string; keys: number; owners: string[] }[];
    };
    for (const summary of summaries) {
      assert.ok(text.includes(`${summary.namespace}: ${summary.keys} key`), summary.namespace);
      const row = json.namespaces.find((n) => n.namespace === summary.namespace);
      assert.deepEqual(row?.owners, [...summary.owners]);
    }
  });

  it("`--all` prints every one of the keys of the catalogue, in both forms", () => {
    const text = runConfigSchema(["--all"]).stdout;
    const json = JSON.parse(runConfigSchema(["--all", "--json"]).stdout) as {
      catalogue: { key: string; type: string; default: string; owners: string[] }[];
    };
    assert.equal(json.catalogue.length, CATALOGUE_SIZE);
    assert.deepEqual(
      json.catalogue.map((r) => r.key),
      CATALOGUE.map((e) => e.key),
    );
    for (const entry of CATALOGUE) {
      assert.ok(text.includes(`key: ${entry.key}`), entry.key);
    }
    // Every column of §K.1 is carried, verbatim.
    const first = json.catalogue[0];
    assert.equal(first?.type, CATALOGUE[0]?.cells.typeAndRange);
    assert.equal(first?.default, CATALOGUE[0]?.cells.default);
  });

  it("`--key` prints the row of one key, and an unknown key is a usage error", () => {
    const result = runConfigSchema(["--key", "loop.maxIter"]);
    assert.equal(result.code, EXIT_OK);
    assert.match(result.stdout, /key: loop\.maxIter/);
    assert.match(result.stdout, /type: whole number/);
    assert.match(result.stdout, /default: 30/);
    assert.match(result.stdout, /owner: 103/);

    // A template key is reached through a concrete segment.
    assert.equal(runConfigSchema(["--key", "phases.3.proposer.timeoutSec"]).code, EXIT_OK);

    const unknown = runConfigSchema(["--key", "loop.maxIterz"]);
    assert.equal(unknown.code, EXIT_INVALID_OR_USAGE);
    assert.equal(unknown.stdout, "");
    assert.match(unknown.stderr, /is not a key of the schema/);
  });

  it("the exit code is 3 for a usage error and 0 otherwise", () => {
    assert.deepEqual([...FLAGS], ["--all", "--json", "--key"]);
    for (const argv of [["--everything"], ["--key"], ["-x"]]) {
      const result = runConfigSchema(argv);
      assert.equal(result.code, EXIT_INVALID_OR_USAGE, argv.join(" "));
      assert.equal(result.stdout, "");
      assert.notEqual(result.stderr, "");
    }
    assert.equal(parseSchemaFlags(["--all", "--json"]).usageError, undefined);
    for (const argv of [[], ["--json"], ["--all"], ["--all", "--json"], ["--key=profile"]]) {
      assert.equal(runConfigSchema(argv).code, EXIT_OK, argv.join(" "));
    }
  });
});

describe("CT-110-111 — the token budget of §G.5 and the check the build runs (F110-FR-012)", () => {
  it("the budget is derived from the table of §G.5 itself, not written out here", () => {
    assert.equal(BYTES_PER_TOKEN, 2.8);
    assert.equal(tokenBudgetOf("Host skill `specstride-run`"), 8_000);
    assert.equal(HOST_SKILL_TOKEN_BUDGET, 8_000);
    assert.equal(SHARE_OF_THE_SKILL_BUDGET, 0.25);
    assert.equal(COMMAND_TOKEN_BUDGET, 2_000);
    assert.equal(COMMAND_BYTE_BUDGET, 5_600);
    assert.match(DERIVATION, /annex G §G\.5/);
    assert.throws(() => tokenBudgetOf("Host skill `nothing-of-the-sort`"), /holds no row/);
  });

  it("both forms of `config schema` are inside the derived budget", () => {
    for (const argv of [[], ["--json"], ["--key", "loop.maxIter"]]) {
      const m = measure(`config schema ${argv.join(" ")}`, runConfigSchema(argv).stdout);
      assert.equal(m.withinBudget, true, reportLine(m));
      assert.ok(m.bytes > 0, "the command printed something");
      assert.equal(m.limit, COMMAND_BYTE_BUDGET);
    }
  });

  it("the check the build runs measures eight outputs and finds no breach", () => {
    const taken = measurements();
    assert.equal(taken.length, 8);
    assert.deepEqual([...breaches(taken)], []);
    // The five host-facing forms carry the derived limit.
    const heldToTheLimit = taken.filter((m) => m.limit !== undefined);
    assert.equal(heldToTheLimit.length, 5);
    assert.deepEqual(
      heldToTheLimit.map((m) => m.subject),
      [
        "config show",
        "config show --json",
        "config schema",
        "config schema --json",
        "config schema --key loop.maxIter",
      ],
    );
    // The three `--all` forms are measured and reported, and carry no budget.
    const reported = taken.filter((m) => m.limit === undefined);
    assert.deepEqual(
      reported.map((m) => m.subject),
      ["config show --all", "config schema --all", "config schema --all --json"],
    );
    for (const m of reported) {
      assert.ok(m.bytes > COMMAND_BYTE_BUDGET, `${m.subject} is smaller than expected`);
      assert.match(reportLine(m), /no §G\.5 budget/);
    }
  });

  it("the check fails on a breach: a measurement over the limit is a breach", () => {
    const over = measure("a made-up form", "x".repeat(COMMAND_BYTE_BUDGET + 1));
    assert.equal(over.withinBudget, false);
    assert.equal(breaches([over]).length, 1);
    assert.match(reportLine(over), /OVER BUDGET/);
    // and exactly at the limit is not a breach.
    const exact = measure("a made-up form", "x".repeat(COMMAND_BYTE_BUDGET));
    assert.equal(exact.withinBudget, true);
    assert.equal(byteLength("x".repeat(COMMAND_BYTE_BUDGET)), COMMAND_BYTE_BUDGET);
  });
});
