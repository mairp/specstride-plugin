/**
 * T015 — CT-110-118, CT-110-119, CT-110-120 and CT-110-121 (F110-FR-021,
 * F110-FR-024, F110-FR-025, F110-FR-026).
 *
 * CT-110-118 (F110-FR-021): `--set <path>=<value>` reaches every key of the
 * catalogue, including keys of the class widening, from the command line only; it
 * is repeatable and the last one wins; it is rank 2; and the short flags of the
 * baseline keep working.
 *
 * CT-110-119 (F110-FR-024): every effective value has a source — the rank, and
 * where the rank has more than one place, the file or the name of the variable,
 * and for a learned value the id of its decision; a default the profile supplied
 * shows the name of the profile; the shadowed values are recorded with their
 * ranks; and the run record holds the same sources as `config show`.
 *
 * CT-110-120 (F110-FR-025): `config show` prints every key set above the default,
 * and with `--all` every key, each with its value, source and shadowed values, in
 * the output modes of §G.2; a secret reference is printed as written and never
 * resolved; the same layers and the same errors as a launch; exit 0, and 3 where
 * the configuration is invalid or the usage is wrong.
 *
 * CT-110-121 (F110-FR-026): a shadowed environment value is reported as shadowed
 * in `config show` and as a finding to the doctor, naming the key and the ranks;
 * the same holds for the environment value of a pinned key on `resume`.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { rankOfLayer } from "@specstride/contracts/envelope/config";

import { CATALOGUE, CATALOGUE_SIZE, catalogueEntry } from "../../src/schema/catalogue.ts";
import { parseSetFlag, setFlagFor } from "../../src/schema/spelling.ts";
import {
  loadConfigFiles,
  projectConfigPath,
  userConfigPath,
  type FileEnvironment,
} from "../../src/load/files.ts";
import { SHORT_FLAGS, flagOffers, resolveConfiguration } from "../../src/load/merge.ts";
import {
  RANKS_WITH_MORE_THAN_ONE_PLACE,
  isSetAboveTheDefault,
  provenanceTable,
  rankHasMoreThanOnePlace,
  runRecordSources,
  shadowedEnvironmentFindings,
  shadowedEnvironmentValues,
} from "../../src/load/provenance.ts";
import { FINDING_IDS } from "../../src/load/trust.ts";
import {
  EXIT_INVALID_OR_USAGE,
  EXIT_OK,
  JSON_SCHEMA_ID,
  LINE_LABEL,
  lineOf,
  parseShowFlags,
  runConfigShow,
} from "../../src/cli/show.ts";

const ROOTS: string[] = [];
after(() => {
  for (const root of ROOTS) rmSync(root, { recursive: true, force: true });
});

/** A throw-away machine with a home and a working tree. */
function machine(): FileEnvironment {
  const root = mkdtempSync(join(tmpdir(), "specstride-110-prov-"));
  ROOTS.push(root);
  const home = join(root, "home");
  const workspace = join(root, "work");
  mkdirSync(home, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  return {
    home,
    xdgConfigHome: join(home, "xdg-config"),
    xdgStateHome: join(home, "xdg-state"),
    workspaceRealPath: workspace,
    workspaceId: "ws-prov",
  };
}

function put(path: string, text: string): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text, "utf8");
  return path;
}

describe("CT-110-118 — `--set` reaches every key, from the command line only (F110-FR-021)", () => {
  it("the flag is spelled for every one of the keys of the catalogue, and reads back", () => {
    let reached = 0;
    for (const entry of CATALOGUE) {
      // A template key is bound to a concrete segment, as §K.2 rule 4 has it.
      const key = entry.key.replace(/<[A-Za-z]+>/g, "x");
      const flag = setFlagFor(key, "v");
      const parsed = parseSetFlag(flag);
      assert.equal(parsed?.key, key, entry.key);
      assert.equal(parsed?.rawValue, "v", entry.key);
      reached += 1;
    }
    assert.equal(reached, CATALOGUE_SIZE);
    assert.equal(reached, 259);
  });

  it("`--set` reaches a key of the class widening", () => {
    const resolved = resolveConfiguration({
      argv: ["--set", "telemetry.loki.url=http://elsewhere:3100"],
    });
    assert.equal(catalogueEntry("telemetry.loki.url")?.trust, "W");
    assert.equal(resolved.values.get("telemetry.loki.url")?.value, "http://elsewhere:3100");
    assert.equal(resolved.values.get("telemetry.loki.url")?.source, "flag");
  });

  it("it is rank 2, and it is repeatable with the last one winning", () => {
    const { offers } = flagOffers(["--set", "loop.maxIter=9", "--set=loop.maxIter=3"]);
    assert.equal(offers.length, 2);
    assert.ok(offers.every((o) => o.layer === "flag"));
    assert.equal(rankOfLayer["flag"], 2);
    const resolved = resolveConfiguration({
      argv: ["--set", "loop.maxIter=9", "--set", "loop.maxIter=3"],
    });
    assert.equal(resolved.values.get("loop.maxIter")?.value, 3);
    assert.equal(resolved.values.get("loop.maxIter")?.rank, 2);
  });

  it("from the command line only: no environment name sets a key at rank 2", () => {
    const resolved = resolveConfiguration({
      environment: { SPECSTRIDE_LOOP_MAX_ITER: "7" },
    });
    assert.equal(resolved.values.get("loop.maxIter")?.rank, 4);
    assert.equal(resolved.values.get("loop.maxIter")?.source, "environment");
    // and the text `--set loop.maxIter=3` in a variable reaches no key.
    const strange = resolveConfiguration({
      environment: { SPECSTRIDE_SET: "loop.maxIter=3" },
    });
    assert.deepEqual([...strange.unknownEnvironmentNames], ["SPECSTRIDE_SET"]);
    assert.equal(strange.values.get("loop.maxIter")?.source, "default");
  });

  it("the short flags of the baseline keep working, each at rank 2 (§K.10)", () => {
    assert.deepEqual(
      SHORT_FLAGS.map((f) => f.flag),
      ["--telemetry", "--loki-url", "--otel", "--otel-url"],
    );
    const resolved = resolveConfiguration({
      argv: [
        "--telemetry",
        "--loki-url",
        "http://here:3100",
        "--otel",
        "--otel-url",
        "http://here:4318",
      ],
    });
    assert.equal(resolved.values.get("telemetry.enabled")?.value, true);
    assert.equal(resolved.values.get("telemetry.enabled")?.rank, 2);
    assert.equal(resolved.values.get("telemetry.loki.url")?.value, "http://here:3100");
    assert.equal(resolved.values.get("telemetry.otel.enabled")?.value, true);
    assert.equal(resolved.values.get("telemetry.otel.url")?.value, "http://here:4318");
  });

  it("the rule of the telemetry flags of §K.10: `-j` with a URL flag (F128-FR-005)", () => {
    const bare = resolveConfiguration({ argv: ["-j"] });
    assert.equal(bare.values.get("telemetry.enabled")?.value, true);
    assert.equal(bare.values.get("telemetry.otel.enabled")?.value, false);

    const withOtelUrl = resolveConfiguration({ argv: ["-j", "--otel-url", "http://here:4318"] });
    assert.equal(withOtelUrl.values.get("telemetry.enabled")?.value, false);
    assert.equal(withOtelUrl.values.get("telemetry.otel.enabled")?.value, true);
  });
});

describe("CT-110-119 — every effective value has a source (F110-FR-024)", () => {
  it("every key the catalogue states a default for has a source and a rank", () => {
    const resolved = resolveConfiguration({});
    const records = provenanceTable(resolved.values);
    const stated = CATALOGUE.filter((e) => e.default.kind !== "deferred");
    assert.equal(records.length, stated.length);
    for (const record of records) {
      assert.ok(record.source !== undefined, record.key);
      assert.equal(record.sourceRank, rankOfLayer[record.source], record.key);
    }
    // The keys with no source are exactly those whose default their owner supplies.
    const withASource = new Set(records.map((r) => r.key));
    const without = CATALOGUE.filter((e) => !withASource.has(e.key));
    assert.deepEqual(
      without.map((e) => e.default.kind),
      without.map(() => "deferred"),
    );
  });

  it("the place is carried for the ranks that have more than one place, and not otherwise", () => {
    assert.deepEqual(
      [...RANKS_WITH_MORE_THAN_ONE_PLACE],
      [
        "flag",
        "environment",
        "project-configuration",
        "user-configuration",
        "learned-value",
        "default",
      ],
    );
    assert.equal(rankHasMoreThanOnePlace("launch-contract-pin"), false);
    assert.equal(rankHasMoreThanOnePlace("run-snapshot"), false);

    const env = machine();
    put(userConfigPath(env), "schema: 1\nloop:\n  maxIter: 10\n");
    const files = loadConfigFiles(env);
    const resolved = resolveConfiguration({
      argv: ["--set", "loop.maxRejects=1"],
      environment: { SPECSTRIDE_LOOP_OSC_MAX: "4" },
      user: files.user,
    });
    const records = provenanceTable(resolved.values);
    const byKey = new Map(records.map((r) => [r.key, r]));
    assert.equal(byKey.get("loop.maxIter")?.place, userConfigPath(env), "the file");
    assert.equal(byKey.get("loop.oscMax")?.place, "SPECSTRIDE_LOOP_OSC_MAX", "the variable");
    assert.equal(byKey.get("loop.maxRejects")?.place, "--set loop.maxRejects=1", "the flag");
    // The contract pin has one place, so the record carries none.
    const pinned = provenanceTable(
      resolveConfiguration({ pins: { "learning.mode": "apply" } }).values,
    ).find((r) => r.key === "learning.mode");
    assert.equal(pinned?.source, "launch-contract-pin");
    assert.equal(pinned?.place, undefined);
  });

  it("a learned value carries the id of its decision", () => {
    const resolved = resolveConfiguration({
      learningMode: "apply",
      learned: { "loop.yield.pollSec": { value: 20, decisionId: "learn-abc123def456" } },
    });
    const record = provenanceTable(resolved.values).find((r) => r.key === "loop.yield.pollSec");
    assert.equal(record?.value, 20);
    assert.equal(record?.source, "learned-value");
    assert.equal(record?.sourceRank, 7);
    assert.equal(record?.decisionId, "learn-abc123def456");
  });

  it("a default the profile supplied shows the name of the profile", () => {
    const resolved = resolveConfiguration({ argv: ["--set", "profile=parity"] });
    const record = provenanceTable(resolved.values).find((r) => r.key === "loop.strategy");
    assert.equal(record?.value, "classic");
    assert.equal(record?.source, "default");
    assert.equal(record?.profile, "parity");
    // A built-in default shows no profile name.
    const bare = provenanceTable(resolveConfiguration({}).values).find(
      (r) => r.key === "loop.strategy",
    );
    assert.equal(bare?.profile, undefined);
    assert.equal(bare?.value, "micro");
  });

  it("the values a higher rank shadowed are recorded with their ranks", () => {
    const env = machine();
    put(userConfigPath(env), "schema: 1\nloop:\n  maxIter: 10\n");
    put(projectConfigPath(env), "schema: 1\nloop:\n  maxIter: 5\n");
    const files = loadConfigFiles(env);
    const resolved = resolveConfiguration({
      argv: ["--set", "loop.maxIter=3"],
      environment: { SPECSTRIDE_LOOP_MAX_ITER: "7" },
      user: files.user,
      project: files.project,
    });
    const record = provenanceTable(resolved.values).find((r) => r.key === "loop.maxIter");
    assert.equal(record?.value, 3);
    assert.equal(record?.source, "flag");
    assert.deepEqual(
      record?.shadowed.map((s) => [s.source, s.rank, s.value]),
      [
        ["environment", 4, 7],
        ["project-configuration", 5, 5],
        ["user-configuration", 6, 10],
        ["default", 8, 30],
      ],
    );
  });

  it("the run record holds the same sources as `config show`", () => {
    const resolved = resolveConfiguration({
      argv: ["--set", "loop.maxIter=3"],
      environment: { SPECSTRIDE_LOOP_MAX_ITER: "7" },
    });
    const outcome = runConfigShow({ resolved, argv: ["--json"] });
    const printed = JSON.parse(outcome.stdout) as { sources: Record<string, unknown> };
    const records = provenanceTable(resolved.values).filter(isSetAboveTheDefault);
    assert.deepEqual(printed.sources, JSON.parse(JSON.stringify(runRecordSources(records))));
    assert.deepEqual(Object.keys(printed.sources), ["loop.maxIter"]);
  });
});

describe("CT-110-120 — `config show` (F110-FR-025)", () => {
  it("it prints every key set above the default, and with `--all` every key", () => {
    const resolved = resolveConfiguration({ argv: ["--set", "loop.maxIter=3"] });
    const terse = runConfigShow({ resolved });
    assert.equal(terse.code, EXIT_OK);
    assert.equal(terse.stdout.trim().split("\n").length, 1);
    assert.match(terse.stdout, /key=loop\.maxIter value=3 source=flag rank=2/);

    const all = runConfigShow({ resolved, argv: ["--all"] });
    assert.equal(all.code, EXIT_OK);
    const lines = all.stdout.trim().split("\n");
    assert.equal(lines.length, resolved.values.size);
    assert.ok(lines.length > 200, `only ${lines.length} keys were printed`);
    // Each line carries the value, the source and the shadowed values.
    for (const line of lines) {
      assert.match(line, /^\[SPECSTRIDE-CONFIG\] key=\S+ value=.* source=\S+ rank=\d/);
      assert.match(line, /shadowed=/);
    }
  });

  it("the two output modes of §G.2: a product line, and the pairs alone", () => {
    const resolved = resolveConfiguration({ argv: ["--set", "loop.maxIter=3"] });
    const record = provenanceTable(resolved.values).find((r) => r.key === "loop.maxIter")!;
    assert.equal(lineOf(record, "default").startsWith(`[${LINE_LABEL}] `), true);
    assert.equal(lineOf(record, "compat").startsWith("["), false);
    assert.equal(
      lineOf(record, "compat"),
      lineOf(record, "default").slice(`[${LINE_LABEL}] `.length),
    );
    // Under `parity` the compatibility form is the one in force.
    const underParity = runConfigShow({
      resolved: resolveConfiguration({
        argv: ["--set", "profile=parity", "--set", "loop.maxIter=3"],
      }),
    });
    assert.equal(underParity.stdout.includes(`[${LINE_LABEL}]`), false);
    assert.match(underParity.stdout, /key=loop\.maxIter/);
  });

  it("a secret reference is printed as written and is never resolved", () => {
    const env = machine();
    put(userConfigPath(env), "schema: 1\nroles:\n  critic:\n    credential: env:CANARY_KEY\n");
    const files = loadConfigFiles(env);
    const resolved = resolveConfiguration({ user: files.user });
    const record = provenanceTable(resolved.values).find(
      (r) => r.key === "roles.critic.credential",
    );
    assert.equal(record?.value, "env:CANARY_KEY");
    assert.equal(record?.isSecretReference, true);

    const outcome = runConfigShow({ resolved });
    assert.match(outcome.stdout, /value="env:CANARY_KEY"/);
    assert.match(outcome.stdout, /secret=reference/);
    // The negative half: nothing of the environment of this process is read, so
    // no value of the variable can appear, even when the variable is set.
    assert.equal(outcome.stdout.includes("the-secret-itself"), false);
    const json = JSON.parse(runConfigShow({ resolved, argv: ["--json"] }).stdout) as {
      sources: Record<string, { value: unknown }>;
    };
    assert.equal(json.sources["roles.critic.credential"]?.value, "env:CANARY_KEY");
  });

  it("a secret value in clear is the error `inline-secret` and exit 3", () => {
    const env = machine();
    const path = put(
      userConfigPath(env),
      "schema: 1\nroles:\n  critic:\n    credential: sk-the-secret-itself\n",
    );
    const files = loadConfigFiles(env);
    const resolved = resolveConfiguration({ user: files.user });
    const outcome = runConfigShow({ resolved });
    assert.equal(outcome.code, EXIT_INVALID_OR_USAGE);
    assert.equal(outcome.errors.length, 1);
    assert.equal(outcome.stdout, "", "nothing is printed when the configuration is invalid");
    // The value is never repeated, in the message or on either stream.
    assert.equal(outcome.stderr.includes("sk-the-secret-itself"), false);
    assert.match(outcome.stderr, /holds a value in clear/);
    // and the secret is still on disk only, where the consumer put it.
    assert.match(readFileSync(path, "utf8"), /sk-the-secret-itself/);
  });

  it("the exit code is 3 for a usage error and 0 otherwise", () => {
    assert.equal(parseShowFlags(["--all", "--json"]).usageError, undefined);
    const bad = runConfigShow({ argv: ["--everything"] });
    assert.equal(bad.code, EXIT_INVALID_OR_USAGE);
    assert.match(bad.stderr, /is not a flag of the command/);
    assert.equal(bad.stdout, "");
    assert.equal(runConfigShow({}).code, EXIT_OK);
  });

  it("it reads the same layers as a launch and reports the same errors", () => {
    const env = machine();
    put(userConfigPath(env), "schema: 1\nloop:\n  maxIterz: 10\n");
    const files = loadConfigFiles(env);
    const resolved = resolveConfiguration({ user: files.user });
    const outcome = runConfigShow({ resolved });
    assert.equal(outcome.code, EXIT_INVALID_OR_USAGE);
    assert.deepEqual(
      outcome.errors.map((e) => e.message),
      files.errors.map((e) => e.message),
      "the errors are the launch's own",
    );
    assert.match(outcome.stderr, /nearest known key is `loop\.maxIter`/);
  });

  it("the `--json` record carries its schema id and no secret value (F100-FR-172)", () => {
    const outcome = runConfigShow({ argv: ["--json"] });
    const record = JSON.parse(outcome.stdout) as Record<string, unknown>;
    assert.equal(record["schema"], JSON_SCHEMA_ID);
    assert.equal(record["command"], "config show");
    assert.equal(record["catalogueSize"], CATALOGUE_SIZE);
    assert.deepEqual(Object.keys(record), [
      "schema",
      "command",
      "all",
      "catalogueSize",
      "profile",
      "keys",
      "sources",
      "shadowedEnvironment",
      "ignored",
    ]);
  });
});

describe("CT-110-121 — a shadowed environment value is reported (F110-FR-026)", () => {
  it("the report names the key and both ranks, and the doctor receives a finding", () => {
    const resolved = resolveConfiguration({
      argv: ["--set", "loop.maxIter=3"],
      environment: { SPECSTRIDE_LOOP_MAX_ITER: "7" },
    });
    const records = provenanceTable(resolved.values);
    const reports = shadowedEnvironmentValues(records);
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.key, "loop.maxIter");
    assert.equal(reports[0]?.variable, "SPECSTRIDE_LOOP_MAX_ITER");
    assert.equal(reports[0]?.shadowedRank, 4);
    assert.equal(reports[0]?.byRank, 2);
    assert.match(reports[0]?.message ?? "", /`loop\.maxIter`/);
    assert.match(reports[0]?.message ?? "", /rank 4/);
    assert.match(reports[0]?.message ?? "", /rank 2/);

    const findings = shadowedEnvironmentFindings(records);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.id, FINDING_IDS.shadowedEnvironment);
    assert.match(findings[0]?.evidence ?? "", /SPECSTRIDE_LOOP_MAX_ITER/);

    // `config show` reports it too, in the same run.
    const outcome = runConfigShow({ resolved, argv: ["--json"] });
    const printed = JSON.parse(outcome.stdout) as {
      shadowedEnvironment: { key: string; shadowedRank: number; byRank: number }[];
    };
    assert.deepEqual(printed.shadowedEnvironment, [
      {
        key: "loop.maxIter",
        variable: "SPECSTRIDE_LOOP_MAX_ITER",
        shadowedRank: 4,
        byRank: 2,
        by: "flag",
        pinnedOnResume: false,
      },
    ]);
    assert.equal(
      outcome.findings.some((f) => f.id === FINDING_IDS.shadowedEnvironment),
      true,
    );
  });

  it("an environment value that nothing shadows is not reported", () => {
    const resolved = resolveConfiguration({ environment: { SPECSTRIDE_LOOP_MAX_ITER: "7" } });
    const records = provenanceTable(resolved.values);
    assert.equal(records.find((r) => r.key === "loop.maxIter")?.source, "environment");
    assert.deepEqual([...shadowedEnvironmentValues(records)], []);
  });

  it("on `resume` the environment value of a pinned key is reported as shadowed", () => {
    // `roles.proposer.harness` is `pinned` (snap p, §K.3), so on `resume` the
    // snapshot ranks above the environment and shadows it.
    assert.equal(catalogueEntry("roles.proposer.harness")?.snapshot, "p");
    const resolved = resolveConfiguration({
      onResume: true,
      snapshot: { "roles.proposer.harness": "claude" },
      environment: { SPECSTRIDE_ROLES_PROPOSER_HARNESS: "codex" },
    });
    const records = provenanceTable(resolved.values);
    const record = records.find((r) => r.key === "roles.proposer.harness");
    assert.equal(record?.value, "claude");
    assert.equal(record?.source, "run-snapshot");
    assert.equal(record?.class, "pinned");
    const reports = shadowedEnvironmentValues(records, { onResume: true });
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.pinnedOnResume, true);
    assert.match(reports[0]?.message ?? "", /on `resume` a pinned key ranks above the environment/);
    assert.equal(shadowedEnvironmentFindings(records, { onResume: true }).length, 1);
  });

  it("a tunable key on `resume` takes the environment value, so nothing is shadowed", () => {
    assert.equal(catalogueEntry("loop.maxIter")?.snapshot, "t");
    const resolved = resolveConfiguration({
      onResume: true,
      snapshot: { "loop.maxIter": 11 },
      environment: { SPECSTRIDE_LOOP_MAX_ITER: "7" },
    });
    const records = provenanceTable(resolved.values);
    const record = records.find((r) => r.key === "loop.maxIter");
    assert.equal(record?.value, 7, "an exported value works on a resume (F110-FR-022)");
    assert.equal(record?.source, "environment");
    assert.deepEqual([...shadowedEnvironmentValues(records, { onResume: true })], []);
  });
});
