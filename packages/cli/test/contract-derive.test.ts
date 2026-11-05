/**
 * `specstride contract derive` — the draft launch contract (feature 107,
 * F107-FR-002 to F107-FR-007; the command list of CLI protocol 1, features 119
 * and 145).
 *
 * The command is driven two ways: through the exported functions, and as the
 * EXECUTABLE the manifest names, spawned as a child process on a repository the
 * test builds. The second is what proves the command exists for a caller who has
 * only the package: a draft on disk, with its mode and its bytes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { COMMANDS, commandOf, main, unknownCommand } from "../src/cli.ts";
import {
  ARTIFACTS,
  COMPONENT,
  COMPONENT_VERSION,
  LAUNCH_CONTRACT_SCHEMA,
  buildContract,
  contractDerive,
  contractId,
  lines,
  obligationId,
  renderContract,
  resolveFeatures,
} from "../src/contract-derive.ts";

const PACKAGE = resolve(dirname(dirname(fileURLToPath(import.meta.url))));

/** A repository with one feature, as Spec Kit lays it out. */
function aRepository(options: { readonly approval?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "cli-derive-"));
  const feature = join(root, "specs", "001-greeting");
  mkdirSync(feature, { recursive: true });
  writeFileSync(join(root, "README.md"), "# greeting\n", "utf8");
  writeFileSync(
    join(feature, "spec.md"),
    "# Feature Specification: Greeting\n\n- **FR-001**: it greets.\n",
    "utf8",
  );
  writeFileSync(
    join(feature, "plan.md"),
    [
      "# Implementation Plan: Greeting",
      "",
      "## Verification",
      "",
      "```bash",
      "python3 -m unittest discover -s tests -v",
      "```",
      "",
      "## Prerequisites",
      "",
      "- PRE-001: the approval `approvals/release-approval.json` must exist.",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(feature, "tasks.md"),
    [
      "# Tasks: Greeting",
      "",
      "## Phase 1: Setup",
      "- [ ] T001 Create `src/greet.py`",
      "",
      "## Phase 2: Verify",
      "- [x] T002 [P] [US1] Add `tests/test_greet.py`",
      "",
    ].join("\n"),
    "utf8",
  );
  if (options.approval === true) {
    mkdirSync(join(root, "approvals"), { recursive: true });
    writeFileSync(join(root, "approvals", "release-approval.json"), "{}\n", "utf8");
  }
  return root;
}

test("the command list of the package and its manifest are the same list", () => {
  const manifest = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as {
    bin: Record<string, string>;
    specstride: { commands: string[] };
  };
  assert.deepEqual(
    [...manifest.specstride.commands].sort(),
    COMMANDS.map((c) => c.name).sort(),
    "`specstride.commands` of the manifest names exactly the commands the build runs",
  );
  // The executable the manifest names exists and is executable.
  const file = join(PACKAGE, manifest.bin["specstride"] as string);
  assert.ok((statSync(file).mode & 0o111) !== 0, `${file} is executable`);
});

test("a command the build does not have is refused with the list of the ones it has", () => {
  assert.equal(commandOf(["run"]), undefined);
  assert.match(unknownCommand(["run"]), /not a command of this build/);
  assert.match(unknownCommand(["run"]), /contract derive/);
  const found = commandOf(["contract", "derive", "--repo", "/x"]);
  assert.equal(found?.command.name, "contract derive");
  assert.deepEqual([...(found?.rest ?? [])], ["--repo", "/x"]);
});

test("F107-FR-005: the draft holds the members the specification requires, and no other configuration member", () => {
  const root = aRepository({ approval: true });
  const contract = buildContract(root, resolveFeatures(root, ["specs/001-greeting"]));
  assert.equal(contract["schema"], LAUNCH_CONTRACT_SCHEMA);
  assert.equal(contract["schema_version"], undefined, "the as-is field is not written (DV-120)");
  assert.equal(contract["status"], "draft");
  assert.deepEqual(contract["stages"], []);
  assert.deepEqual(contract["authorized_roots"], [root]);
  assert.deepEqual(contract["generated_by"], { tool: COMPONENT, version: COMPONENT_VERSION });
  assert.equal(COMPONENT, "contract-derive", "the logical component, never an implementation file");
  // F107-FR-024: none of the five configuration keys of the baseline; F107-FR-036:
  // the verification mode and nothing else.
  assert.deepEqual(Object.keys(contract["configuration"] as object), ["verification"]);
  for (const key of ["color", "specstride_live", "agent_stream", "live_detail", "telemetry"]) {
    assert.equal((contract["configuration"] as Record<string, unknown>)[key], undefined);
  }
  // One coverage entry per task, with the timing of its phase.
  const coverage = contract["coverage"] as Record<string, unknown>[];
  assert.equal(coverage.length, 2);
  assert.deepEqual(
    coverage.map((c) => c["timing"]),
    ["specstride-phase:1", "specstride-phase:2"],
  );
  for (const entry of coverage) {
    assert.match(entry["id"] as string, /^OBL-[0-9A-F]{12}$/);
    assert.equal(entry["kind"], "implementation");
    assert.equal(entry["producer"], "unclassified");
    assert.equal(entry["disposition"], "unresolved");
    assert.deepEqual(entry["stage_ids"], []);
    assert.deepEqual(entry["verification_ids"], []);
    assert.deepEqual(entry["evidence"], []);
  }
  // Exactly one finding, with the source of the first coverage entry.
  const findings = contract["findings"] as Record<string, unknown>[];
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.["id"], "semantic-derivation-required");
  assert.equal(findings[0]?.["severity"], "blocker");
  assert.equal(findings[0]?.["status"], "open");
  assert.deepEqual(findings[0]?.["source"], coverage[0]?.["source"]);
  // The feature record, and the artifacts present and absent.
  const features = contract["features"] as Record<string, unknown>[];
  assert.equal(features.length, 1);
  assert.equal(features[0]?.["slug"], "001-greeting");
  assert.equal(features[0]?.["task_count"], 2);
  assert.deepEqual(features[0]?.["artifacts_present"], ["spec.md", "plan.md", "tasks.md"]);
  assert.deepEqual(
    features[0]?.["artifacts_absent"],
    ARTIFACTS.filter((n) => !["spec.md", "plan.md", "tasks.md"].includes(n)),
  );
});

test("F107-FR-004: the inventory holds the tasks, the fenced blocks and the prerequisites, and only existence is recorded", () => {
  for (const approval of [true, false]) {
    const root = aRepository({ approval });
    const contract = buildContract(root, resolveFeatures(root, ["specs/001-greeting"]));
    const inventory = contract["inventory"] as Record<string, unknown>;
    const tasks = inventory["tasks"] as Record<string, unknown>[];
    assert.deepEqual(
      tasks.map((t) => [t["id"], t["phase"], t["checked"], t["story"], t["parallel_marker"]]),
      [
        ["T001", 1, false, null, false],
        ["T002", 2, true, "US1", true],
      ],
    );
    const candidates = inventory["shell_candidates"] as Record<string, unknown>[];
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.["classification"], "candidate-only");
    assert.equal(candidates[0]?.["text"], "python3 -m unittest discover -s tests -v");
    const prerequisites = inventory["prerequisites"] as Record<string, unknown>[];
    assert.equal(prerequisites.length, 1);
    assert.equal(prerequisites[0]?.["id"], "PRE-001");
    assert.equal(prerequisites[0]?.["path"], "approvals/release-approval.json");
    assert.equal(prerequisites[0]?.["present"], approval);
    assert.deepEqual(inventory["verification_documents"], []);
  }
});

test("F107-FR-003: the id of the contract, and a repository that is no working tree has no revision", () => {
  const root = aRepository();
  const contract = buildContract(root, resolveFeatures(root, ["specs/001-greeting"]));
  assert.equal(contract["id"], "001-greeting");
  assert.deepEqual(contract["repository"], { root, revision: null, dirty: null });
  assert.equal(contractId(["/a/b/Feature_01"]), "feature-01");
  assert.equal(contractId(["/a/b/001-x", "/a/b/002-y"]), "001-x-and-002-y");
  assert.equal(contractId(["/a/b/---"]), "pipeline");
});

test("F107-FR-004: the obligation id is the content hash of the task's own four parts", () => {
  const task = {
    id: "T001",
    phase: 1,
    line: 4,
    checked: false,
    parallel_marker: false,
    story: null,
    text: "Create `src/greet.py`",
    source: "specs/001-greeting/tasks.md",
  } as const;
  const first = obligationId(task);
  assert.match(first, /^OBL-[0-9A-F]{12}$/);
  // The same task gives the same id; one changed part gives another.
  assert.equal(obligationId({ ...task }), first);
  assert.notEqual(obligationId({ ...task, line: 5 }), first);
  assert.notEqual(obligationId({ ...task, text: `${task.text} ` }), first);
});

test("F107-FR-006: the draft is rendered with sorted keys, an indent of two and a final line end", () => {
  const text = renderContract({ b: 1, a: { d: [1, 2], c: null } });
  assert.equal(
    text,
    '{\n  "a": {\n    "c": null,\n    "d": [\n      1,\n      2\n    ]\n  },\n  "b": 1\n}\n',
  );
  assert.equal(lines("one\ntwo\n").length, 2, "a final line end closes the last line");
  assert.equal(lines("one\ntwo").length, 2);
});

test("F107-FR-002: a bad repository, a bad feature path and an ambiguous feature each stop derivation with their message", () => {
  const root = aRepository();
  assert.throws(
    () => resolveFeatures(root, ["specs/does-not-exist"]),
    /feature path is not a directory/,
  );
  mkdirSync(join(root, "specs", "002-farewell"), { recursive: true });
  writeFileSync(join(root, "specs", "002-farewell", "tasks.md"), "# Tasks\n", "utf8");
  assert.throws(() => resolveFeatures(root, []), /feature is ambiguous; pass --feature/);
  // And the command reports the failure with exit 2 and nothing on standard output.
  assert.equal(contractDerive(["--repo", join(root, "nowhere")]), 2);
  assert.equal(main(["contract", "derive", "--repo", join(root, "nowhere")]), 2);
});

test("F107-FR-006: the executable writes the draft atomically, at mode 0600, and exits 0", () => {
  const root = aRepository({ approval: true });
  const output = join(root, "launch-contract.json");
  const result = spawnSync(
    process.execPath,
    [
      join(PACKAGE, "bin", "specstride"),
      "contract",
      "derive",
      "--repo",
      root,
      "--feature",
      "specs/001-greeting",
      "--output",
      output,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  // The pipeline's derive owns the verb now: with `--output` the draft goes
  // to the file, and the one line of standard output is the product line
  // that names the contract by its LOGICAL name (F107-FR-039).
  assert.match(result.stdout, /^\[SPECSTRIDE-DERIVE\] contract=pipeline:001-greeting:contract /);
  assert.equal(
    result.stdout.split("\n").filter((one) => one !== "").length,
    1,
    "the line is the only thing on standard output",
  );
  // The draft is on disk, read back through a path the command did not hand out.
  const text = readFileSync(output, "utf8");
  assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.ok(text.endsWith("}\n"));
  const parsed = JSON.parse(text) as Record<string, unknown>;
  assert.equal(parsed["schema"], LAUNCH_CONTRACT_SCHEMA);
  assert.equal((parsed["generated_by"] as Record<string, unknown>)["tool"], COMPONENT);
  // And a second run over the same repository gives the same bytes.
  const again = spawnSync(
    process.execPath,
    [
      join(PACKAGE, "bin", "specstride"),
      "contract",
      "derive",
      "--repo",
      root,
      "--feature",
      "specs/001-greeting",
      "--output",
      join(root, "second.json"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(again.status, 0, again.stderr);
  assert.equal(readFileSync(join(root, "second.json"), "utf8"), text);
});

test("without `--output` the draft is written to the contract's place under the state", () => {
  const root = aRepository({ approval: true });
  const result = spawnSync(
    process.execPath,
    [
      join(PACKAGE, "bin", "specstride"),
      "contract",
      "derive",
      "--repo",
      root,
      "--feature",
      "specs/001-greeting",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  // The default output is the contract's logical place under the state of
  // the pipeline (annex B §B.5), and the one line names it the same way.
  const output = join(root, ".specstride", "state", "pipeline", "001-greeting", "contract");
  const parsed = JSON.parse(readFileSync(output, "utf8")) as Record<string, unknown>;
  assert.equal(parsed["status"], "draft");
  assert.match(result.stdout, /^\[SPECSTRIDE-DERIVE\] contract=pipeline:001-greeting:contract /);
});
