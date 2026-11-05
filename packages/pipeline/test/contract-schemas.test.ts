/**
 * T003 of feature 107 — the item schemas of the launch contract, validated in
 * the build, and the closed sets read from `@specstride/contracts`, where
 * feature 100 generates them (specs/107-launch-contract/tasks.md, T003;
 * F107-FR-012: one schema is the validator).
 *
 * What this test holds:
 *
 * - each of the six schemas of `src/contract/schemas/` carries the `$id` of
 *   the internal form `urn:specstride:schema:internal:107:<name>/1` (row 32 of
 *   the table "What the other features must follow" of feature 100);
 * - each schema compiles under the one schema validator of the product (Ajv,
 *   draft 2020-12, the choice of feature 100's research.md D-2), accepts an
 *   item the way the baseline writes it, and refuses an item that breaks one
 *   named rule of it (an unknown member, a closed set with no such member);
 * - every closed set the schemas write for a row of annex X §X.6 equals the
 *   members of the set read from `@specstride/contracts` through
 *   `src/contract/schemas/closed-sets.ts` — the literal members as their
 *   `enum`, the parameterized members (`specstride-phase:<n>`, `before:<stage>`,
 *   `after:<stage>`, `stage:<id>`) as their `pattern` — the sets are never
 *   copied by hand, so a set that changes in the table of feature 100 fails
 *   this test here;
 * - the member names are the ones of data-model.md ("Member names"), and the
 *   members the record schema `launch-contract.schema.json` of
 *   `@specstride/contracts` gives to `configuration` are the members this
 *   feature owns (`relaunch`, `comment`, `scopes`, `verification`) with the
 *   block `learning` of feature 106 as a pass-through.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  CONTRACT_CLOSED_SETS,
  ROWS_OF_CONTRACT_CLOSED_SETS,
  type ContractClosedSet,
} from "../src/contract/schemas/closed-sets.ts";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMAS = join(PACKAGE_ROOT, "src", "contract", "schemas");
const RECORD_SCHEMA = join(
  PACKAGE_ROOT,
  "..",
  "contracts",
  "schemas",
  "launch-contract.schema.json",
);

/** The six item schemas this feature owns (T003). */
const ITEM_SCHEMAS = [
  "source",
  "inventory",
  "configuration",
  "coverage",
  "finding",
  "stage",
] as const;

type ItemName = (typeof ITEM_SCHEMAS)[number];

/** A schema of `schemas/`, read off disk. */
function schemaOf(name: ItemName): Record<string, unknown> {
  const file = join(SCHEMAS, `${name}.schema.json`);
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

/** Compile one schema under the one validator of the product (Ajv, draft 2020-12). */
function compile(schema: Record<string, unknown>): (value: unknown) => boolean {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return ajv.compile(schema) as (value: unknown) => boolean;
}

/**
 * The closed set a schema writes at one path: the literal members as their
 * `enum`, the parameterized members (a `<n>` in the table of feature 100) as
 * their `pattern`, under an `anyOf`. A property name of the record beats a
 * JSON-Schema keyword of the same name (the `items` of `judgment` is a
 * property; the `items` of an array is the keyword).
 */
function closedSetAt(
  schema: Record<string, unknown>,
  path: readonly string[],
): { readonly literals: string[]; readonly patterns: string[] } {
  let node: Record<string, unknown> = schema;
  for (const step of path) {
    if (step === "const-set") {
      // the $defs of the stage schema, held by name
      node = node.$defs as Record<string, unknown>;
      continue;
    }
    const byName = (node.properties as Record<string, unknown> | undefined)?.[step];
    if (byName !== undefined) {
      node = byName as Record<string, unknown>;
      continue;
    }
    const byKeyword = node[step] as Record<string, unknown> | undefined;
    if (byKeyword !== undefined) {
      node = byKeyword;
      continue;
    }
    throw new Error(`no property or keyword ${step} at ${path.join(".")}`);
  }
  const literals: string[] = [];
  const patterns: string[] = [];
  if (Array.isArray(node.enum)) literals.push(...(node.enum as string[]));
  const anyOf = node.anyOf as Record<string, unknown>[] | undefined;
  if (anyOf !== undefined) {
    for (const branch of anyOf) {
      if (Array.isArray(branch.enum)) literals.push(...(branch.enum as string[]));
      if (typeof branch.pattern === "string") patterns.push(branch.pattern);
    }
  }
  if (literals.length === 0 && patterns.length === 0) {
    throw new Error(`no closed set at ${path.join(".")}`);
  }
  return { literals, patterns };
}

/** A value of the parameterized member that is a member in fact (the baseline writes it). */
const SAMPLE_INSTANTIATIONS: Readonly<Record<string, string>> = {
  "before:<stage>": "before:implement-feature",
  "after:<stage>": "after:implement-feature",
  "specstride-phase:<n>": "specstride-phase:1",
  "stage:<id>": "stage:implement-feature",
};

/** A 64-hex character hash, as the canonical hasher writes one. */
const HASH = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// ---------------------------------------------------------------------------
// The $id of the internal form, one per item schema
// ---------------------------------------------------------------------------

test("CT-107-schemas: every item schema carries the $id of the internal form", () => {
  for (const name of ITEM_SCHEMAS) {
    const schema = schemaOf(name);
    assert.equal(
      schema.$id,
      `urn:specstride:schema:internal:107:${name}/1`,
      `${name}.schema.json carries no $id of the internal form (row 32)`,
    );
  }
});

test("CT-107-schemas: the closed sets the schemas cite are the rows the spec names", () => {
  assert.deepEqual(
    [...ROWS_OF_CONTRACT_CLOSED_SETS].sort((a, b) => a - b),
    [...CONTRACT_CLOSED_SETS.keys()].sort((a, b) => a - b),
    "the rows of the module and the sets it holds differ",
  );
  // Every set the module holds is a set of the table of feature 100 with its row.
  for (const [row, set] of CONTRACT_CLOSED_SETS) {
    assert.equal(set.number, row, `the set of row ${row} carries the row ${set.number}`);
    assert.ok(set.members.length > 0, `the set of row ${row} holds no members`);
  }
});

// ---------------------------------------------------------------------------
// The closed sets of annex X §X.6, read from @specstride/contracts, are the
// closed sets the schemas write: the literal members as their enum, the
// parameterized members as their patterns
// ---------------------------------------------------------------------------

test("CT-107-schemas: the closed sets of the schemas equal the closed sets of @specstride/contracts", () => {
  const cases: Array<{ name: ItemName; path: readonly string[]; row: number }> = [
    { name: "source", path: ["kind"], row: 256 },
    { name: "inventory", path: ["judgment", "items", "items", "kind"], row: 259 },
    { name: "inventory", path: ["judgment", "items", "items", "choices", "items"], row: 285 },
    { name: "inventory", path: ["judgment", "answers", "items", "choice"], row: 285 },
    { name: "inventory", path: ["judgment", "answers", "items", "provenance", "route"], row: 260 },
    { name: "configuration", path: ["verification", "mode"], row: 52 },
    { name: "configuration", path: ["comment", "changed", "items", "option"], row: 283 },
    {
      name: "configuration",
      path: ["scopes", "tasks", "additionalProperties", "source"],
      row: 261,
    },
    {
      name: "configuration",
      path: ["scopes", "commands", "additionalProperties", "source"],
      row: 261,
    },
    { name: "coverage", path: ["timing"], row: 257 },
    { name: "coverage", path: ["producer"], row: 258 },
    { name: "stage", path: ["const-set", "check", "timing"], row: 282 },
    { name: "finding", path: ["provenance", "route"], row: 260 },
  ];
  for (const { name, path, row } of cases) {
    const set: ContractClosedSet = CONTRACT_CLOSED_SETS.get(row) as ContractClosedSet;
    const { literals, patterns } = closedSetAt(schemaOf(name), path);
    const literalMembers = set.members.filter((member) => !member.includes("<")).sort();
    assert.deepEqual(
      [...literals].sort(),
      literalMembers,
      `${name}.schema.json at ${path.join(".")} holds no enum of the literal members of the closed set of row ${row} ${set.name}`,
    );
    const parameterized = set.members.filter((member) => member.includes("<"));
    // Every parameterized member is one of the patterns, by a value of it.
    for (const member of parameterized) {
      const sample = SAMPLE_INSTANTIATIONS[member];
      assert.ok(sample !== undefined, `no sample instantiation of the member ${member}`);
      const matching = patterns.filter((pattern) => new RegExp(pattern).test(sample));
      assert.equal(
        matching.length,
        1,
        `${name}.schema.json at ${path.join(".")} holds no pattern that matches ${member} (row ${row} ${set.name})`,
      );
    }
    // Every pattern is the one of a member, not of another value.
    for (const pattern of patterns) {
      const matched = parameterized.filter((member) =>
        new RegExp(pattern).test(SAMPLE_INSTANTIATIONS[member] as string),
      );
      assert.equal(
        matched.length,
        1,
        `${name}.schema.json at ${path.join(".")} holds a pattern that matches no member of the closed set of row ${row} ${set.name}`,
      );
    }
    assert.equal(
      patterns.length,
      parameterized.length,
      `${name}.schema.json at ${path.join(".")} holds no one pattern per parameterized member of row ${row} ${set.name}`,
    );
  }
  // The members of row 79 that the table itself holds (`draft`, `validated`)
  // are the statuses the record schema writes; the kinds, dispositions,
  // severities and statuses the table leaves to annex G §G.8 are the ones the
  // record schema of @specstride/contracts names in its words.
  const record = JSON.parse(readFileSync(RECORD_SCHEMA, "utf8")) as Record<string, unknown>;
  const recordCoverage = (record.properties as Record<string, Record<string, unknown>>).coverage;
  const recordCoverageWords = String(recordCoverage.description ?? "");
  for (const member of [
    "implementation",
    "prerequisite",
    "verification",
    "decision",
    "operation",
    "mapped",
    "optional",
    "out-of-scope",
    "unresolved",
    "unsupported",
  ]) {
    assert.ok(
      recordCoverageWords.includes(member),
      `the record schema of @specstride/contracts names no such coverage member: ${member}`,
    );
  }
  const kinds = closedSetAt(schemaOf("coverage"), ["kind"]).literals;
  const dispositions = closedSetAt(schemaOf("coverage"), ["disposition"]).literals;
  assert.deepEqual(
    [...kinds].sort(),
    ["decision", "implementation", "operation", "prerequisite", "verification"].sort(),
    "the kinds of a coverage obligation are not the members of annex G §G.8",
  );
  assert.deepEqual(
    [...dispositions].sort(),
    ["mapped", "optional", "out-of-scope", "unresolved", "unsupported"].sort(),
    "the dispositions of a coverage obligation are not the members of annex G §G.8",
  );
  const recordFindings = (record.properties as Record<string, Record<string, unknown>>).findings;
  const recordFindingsWords = String(recordFindings.description ?? "");
  for (const member of ["info", "warning", "blocker", "open", "resolved", "accepted"]) {
    assert.ok(
      recordFindingsWords.includes(member),
      `the record schema of @specstride/contracts names no such finding member: ${member}`,
    );
  }
});

// ---------------------------------------------------------------------------
// The member names of data-model.md stand in the schemas
// ---------------------------------------------------------------------------

test("CT-107-schemas: the member names of data-model.md stand in the schemas", () => {
  const members = (name: ItemName, path: readonly string[] = []): readonly string[] => {
    let node: Record<string, unknown> = schemaOf(name);
    for (const step of path)
      node = (node.properties as Record<string, unknown>)[step] as Record<string, unknown>;
    return Object.keys((node.properties as Record<string, unknown>) ?? {});
  };

  assert.deepEqual(
    members("source").sort(),
    ["lines", "path", "kind", "semantic_sha256", "sha256"].sort(),
    "the members of a source are not the ones of data-model.md",
  );
  assert.deepEqual(
    members("inventory").sort(),
    ["judgment", "prerequisites", "shell_candidates", "tasks", "verification_documents"].sort(),
    "the members of the inventory are not the ones of data-model.md",
  );
  assert.deepEqual(
    members("inventory", ["judgment"]).sort(),
    ["answers", "items"].sort(),
    "the record inventory.judgment holds no items and answers",
  );
  assert.deepEqual(
    members("configuration").sort(),
    [
      // The five the data-model names, plus the five as-is members the
      // baseline writes (the schemas hold no rule of them; DV-038).
      "agent_stream",
      "color",
      "comment",
      "learning",
      "live_detail",
      "relaunch",
      "scopes",
      "specstride_live",
      "telemetry",
      "verification",
    ].sort(),
    "the members of configuration are not the ones of data-model.md",
  );
  assert.deepEqual(
    members("coverage").sort(),
    [
      "disposition",
      "evidence",
      "id",
      "kind",
      "producer",
      "rationale",
      "source",
      "stage_ids",
      "timing",
      "verification_ids",
    ].sort(),
    "the members of a coverage obligation are not the ones of data-model.md",
  );
  assert.deepEqual(
    members("finding").sort(),
    ["id", "severity", "status", "message", "source", "resolution", "provenance"].sort(),
    "the members of a finding are not the ones of data-model.md",
  );
  assert.deepEqual(
    members("stage").sort(),
    [
      "action",
      "cwd",
      "depends_on",
      "evidence",
      "id",
      "kind",
      "postconditions",
      "preconditions",
      "recovery",
      "resume",
      "writes",
    ].sort(),
    "the members of a stage are not the ones of data-model.md",
  );
  // The record schema of @specstride/contracts names the same configuration
  // members; this feature owns relaunch, comment, scopes and verification, and
  // the block learning of feature 106 stays a pass-through.
  const record = JSON.parse(readFileSync(RECORD_SCHEMA, "utf8")) as Record<string, unknown>;
  const recordConfiguration = (record.properties as Record<string, Record<string, unknown>>)[
    "configuration"
  ] as Record<string, unknown>;
  assert.deepEqual(
    Object.keys((recordConfiguration.properties as Record<string, unknown>) ?? {}).sort(),
    ["comment", "learning", "relaunch", "scopes", "verification"].sort(),
    "the record schema of @specstride/contracts names no such configuration members",
  );
  assert.deepEqual(
    (recordConfiguration.required as readonly string[]) ?? [],
    ["verification"],
    "the record schema requires a different member of configuration",
  );
});

// ---------------------------------------------------------------------------
// Every schema compiles, accepts the item the way the baseline writes it, and
// refuses the item that breaks one named rule of it
// ---------------------------------------------------------------------------

test("CT-107-schemas: the source schema accepts the baseline's entry and refuses its refusals", () => {
  const isSource = compile(schemaOf("source"));
  const entry = {
    path: "specs/001-greeting/tasks.md",
    kind: "tasks",
    sha256: HASH,
    lines: 7,
    semantic_sha256: HASH,
  };
  assert.ok(isSource(entry), "the entry the baseline writes is refused");
  assert.ok(
    isSource({ path: "specs/001-greeting/plan.md", kind: "plan", sha256: HASH, lines: 17 }),
    "a source that is no task list is refused",
  );
  assert.ok(
    !isSource({ path: "specs/001-greeting/tasks.md", kind: "tasks", sha256: HASH, lines: 7 }),
    "a task list without the hash that ignores checkboxes is accepted",
  );
  assert.ok(
    !isSource({ path: "x.md", kind: "prose", sha256: HASH, lines: 1 }),
    "a kind that is no member of the closed set of row 256 is accepted",
  );
  assert.ok(!isSource({ ...entry, extra: "x" }), "an unknown member of a source is accepted");
});

test("CT-107-schemas: the inventory schema accepts the baseline's record and refuses its refusals", () => {
  const isInventory = compile(schemaOf("inventory"));
  const record = {
    tasks: [
      {
        id: "T001",
        phase: 1,
        line: 4,
        checked: false,
        parallel_marker: false,
        story: null,
        text: "Create `src/greet.py` with `greet(name)`",
        source: "specs/001-greeting/tasks.md",
      },
    ],
    shell_candidates: [
      {
        path: "specs/001-greeting/plan.md",
        start_line: 12,
        end_line: 12,
        text: "python3 -m unittest discover -s tests -v",
        classification: "candidate-only",
      },
    ],
    prerequisites: [
      {
        id: "PRE-001",
        source: { path: "specs/001-greeting/plan.md", line: 17, anchor: "PRE-001" },
        path: "approvals/release-approval.json",
        resolved: "approvals/release-approval.json",
        present: true,
      },
    ],
    verification_documents: [
      {
        path: "specs/001-greeting/verification-commands.json",
        valid_json: false,
        error: "no such file",
      },
    ],
  };
  assert.ok(isInventory(record), "the inventory the baseline writes is refused");
  // The judgment exchange, as the first --next-batch writes it.
  const judged = {
    ...record,
    judgment: {
      items: [
        {
          id: "JT-001",
          kind: "settle-prerequisite",
          anchor: "PRE-001",
          choices: ["mapped", "keep-blocker"],
          question: "Is the prerequisite mapped, optional, or a kept blocker?",
          excerpt: "approvals/release-approval.json:17",
          source: { path: "specs/001-greeting/plan.md", line: 17 },
        },
      ],
      answers: [
        {
          item: "JT-001",
          choice: "mapped",
          provenance: { who: "the host", route: "host-model", batch: "B-0001" },
          settled: ["PRE-001"],
        },
      ],
    },
  };
  assert.ok(isInventory(judged), "the inventory with the record of the exchange is refused");
  const wrongKind = structuredClone(judged);
  (wrongKind.judgment.items[0] as Record<string, unknown>).kind = "guess";
  assert.ok(
    !isInventory(wrongKind),
    "a kind that is no member of the closed set of row 259 is accepted",
  );
  const wrongRoute = structuredClone(judged);
  (wrongRoute.judgment.answers[0] as Record<string, unknown>).provenance = {
    who: "the host",
    route: "telepathy",
    batch_id: "B-0001",
  };
  assert.ok(
    !isInventory(wrongRoute),
    "a route that is no member of the closed set of row 260 is accepted",
  );
  const wrongChoice = structuredClone(judged);
  (wrongChoice.judgment.answers[0] as Record<string, unknown>).choice = "whatever";
  assert.ok(
    !isInventory(wrongChoice),
    "a choice that is no member of the closed set of row 285 is accepted",
  );
});

test("CT-107-schemas: the configuration schema accepts the draft's record and refuses its refusals", () => {
  const isConfiguration = compile(schemaOf("configuration"));
  assert.ok(
    isConfiguration({ verification: { mode: "required", reason: "the plan declares it" } }),
    "the configuration of the draft is refused",
  );
  const withComment = {
    verification: { mode: "required", reason: "the plan declares it" },
    relaunch: { max_relaunches: 2, wall_clock_seconds: 21600 },
    comment: { hash: HASH, changed: [{ option: "features", value: ["001-greeting"] }] },
    scopes: {
      tasks: { T002: { scope: ["src"], source: "user-config" } },
      commands: { "c-1": { reads: [], writes: ["out.log"], source: "flag" } },
    },
  };
  assert.ok(isConfiguration(withComment), "the configuration with comment and scopes is refused");
  assert.ok(!isConfiguration({}), "a configuration without the verification mode is accepted");
  assert.ok(
    !isConfiguration({ verification: { mode: "loud", reason: "the plan declares it" } }),
    "a mode that is no member of the closed set of row 52 is accepted",
  );
  const widening = structuredClone(withComment);
  (widening.comment.changed[0] as Record<string, unknown>).option = "budget";
  assert.ok(
    !isConfiguration(widening),
    "an option that is no member of the closed set of row 283 is accepted",
  );
  const unproven = structuredClone(withComment);
  (unproven.scopes.tasks as Record<string, Record<string, unknown>>).T002.source =
    "repository-text";
  assert.ok(
    !isConfiguration(unproven),
    "a source that is no member of the closed set of row 261 is accepted",
  );
  assert.ok(
    !isConfiguration({
      verification: { mode: "required", reason: "the plan declares it" },
      relaunch: { max_relaunches: 6, wall_clock_seconds: 60 },
    }),
    "a relaunch budget above the ceiling of 5 is accepted",
  );
});

test("CT-107-schemas: the coverage schema accepts the baseline's entry and refuses its refusals", () => {
  const isCoverage = compile(schemaOf("coverage"));
  const entry = {
    id: "OBL-DF4BD387EE2A",
    source: { path: "specs/001-greeting/tasks.md", line: 4, anchor: "T001" },
    kind: "implementation",
    timing: "specstride-phase:1",
    producer: "unclassified",
    disposition: "unresolved",
    stage_ids: [],
    verification_ids: [],
    rationale: "Create `src/greet.py` with `greet(name)`",
    evidence: [],
  };
  assert.ok(isCoverage(entry), "the entry the bootstrap writes is refused");
  assert.ok(
    !isCoverage({ ...entry, id: "OBL-DF4BD387EE2" }),
    "an id that is no OBL- plus 12 hexadecimal characters is accepted",
  );
  assert.ok(
    !isCoverage({ ...entry, timing: "whenever" }),
    "a timing that is no member of the closed set of row 257 is accepted",
  );
  assert.ok(
    !isCoverage({ ...entry, producer: "the host" }),
    "a producer that is no member of the closed set of row 258 is accepted",
  );
});

test("CT-107-schemas: the finding schema accepts the bootstrap finding and refuses its refusals", () => {
  const isFinding = compile(schemaOf("finding"));
  const bootstrap = {
    id: "semantic-derivation-required",
    severity: "blocker",
    status: "open",
    message: "The derivation of the stages is not done; the host judges the batches.",
    source: { path: "specs/001-greeting/tasks.md", line: 4, anchor: "T001" },
    resolution: "Derive from the facts and the answers of the judgment exchange.",
  };
  assert.ok(isFinding(bootstrap), "the bootstrap finding is refused");
  const judged = {
    ...bootstrap,
    status: "resolved",
    provenance: { who: "the host", route: "host-model", batch_id: "B-0001" },
  };
  assert.ok(isFinding(judged), "a finding the answer wrote, with its provenance, is refused");
  assert.ok(
    !isFinding({ ...bootstrap, severity: "loud" }),
    "a severity of annex G §G.8 is refused",
  );
  assert.ok(!isFinding({ ...bootstrap, status: "done" }), "a status of annex G §G.8 is refused");
  assert.ok(
    !isFinding({
      ...judged,
      provenance: { who: "the host", route: "telepathy", batch_id: "B-0001" },
    }),
    "a route that is no member of the closed set of row 260 is accepted",
  );
});

test("CT-107-schemas: the stage schema accepts the baseline's stage and refuses its refusals", () => {
  const isStage = compile(schemaOf("stage"));
  // The stage the deterministic completion of the baseline writes.
  const stage = {
    id: "implement-feature",
    kind: "specstride",
    depends_on: [],
    cwd: ".",
    action: ["specstride", "run", "-w", ".", "-s", "specs/001-greeting/tasks.md"],
    preconditions: [
      { check: "file_exists", path: "approvals/release-approval.json", timing: "preflight" },
      { check: "command_available", name: "specstride", timing: "preflight" },
    ],
    postconditions: [{ check: "file_exists", path: "src/greet.py" }],
    evidence: ["src/greet.py"],
  };
  assert.ok(isStage(stage), "the stage the completion writes is refused");
  const withRecovery = {
    ...stage,
    recovery: {
      max_attempts: 2,
      retry_exit_codes: [1],
      backoff_seconds: 5,
      total_timeout_seconds: 3600,
      reason: ["crash"],
    },
    writes: ["src/greet.py"],
  };
  assert.ok(isStage(withRecovery), "a stage with recovery and the optional writes is refused");
  const noArgv = structuredClone(withRecovery);
  noArgv.action = [];
  assert.ok(!isStage(noArgv), "an action without an argument list is accepted");
  const wrongTiming = structuredClone(stage);
  (wrongTiming.preconditions as unknown[] as Record<string, unknown>[])[0].timing = "sometimes";
  assert.ok(
    !isStage(wrongTiming),
    "a timing that is no member of the closed set of row 282 is accepted",
  );
  const untypedCheck = {
    ...stage,
    postconditions: [{ type: "file_exists", path: "src/greet.py" }],
  };
  assert.ok(!isStage(untypedCheck), "a check without its registry id (`check`) is accepted");
});
