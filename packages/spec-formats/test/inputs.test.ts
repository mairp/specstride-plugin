/**
 * T049 — CT-104-6, the test of `inputs` and the source records (F104-FR-023).
 *
 * Four claims, each measured over a real tree of each of the three formats:
 *
 *   1. `inputs` lists the SOURCES OF EACH FORMAT — the three files of a Spec
 *      Kit feature, the three of an OpenSpec change under their own names, and
 *      the ONE file of a native spec;
 *   2. every record carries `kind`, the logical `name`, the repository-relative
 *      `path` and the HASHES, and the task list also carries the hash that
 *      ignores checkboxes;
 *   3. an UNKNOWN kind is read as `other` — the rule of row 97 of annex X §X.6,
 *      which is what a launch contract's other sources go through;
 *   4. every hash is the KERNEL's: this module computes none of its own, and
 *      the values are compared with the hasher's over the same bytes.
 *
 * The hashes are not restated as literals: the claim of F104-FR-021 is that
 * the hasher owns them, so the test takes the same bytes to the hasher and
 * compares. `HASHES_OF_ITS_OWN` is the module's own statement of that, and the
 * test measures it against the module's import list as well.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  contentHash,
  taskListHashIgnoringCheckboxes,
  taskListHashIgnoringCheckboxesOfBytes,
} from "@specstride/kernel/hasher";
import {
  KIND_WITH_A_CHECKBOX_INSENSITIVE_HASH,
  UNKNOWN_SOURCE_KIND,
  kindsOfSourceOfASpecification,
  readSourceKind,
} from "../src/model.ts";
import {
  DECLARED_SOURCES,
  HASHES_OF_ITS_OWN,
  HASH_OWNER,
  NATIVE_SOURCE_NAME,
  OPENSPEC_SOURCES,
  ORDER_OF_THE_RUN_VERDICT,
  SPECKIT_SOURCES,
  directoryOfTheSources,
  hashesOfBytes,
  hashesOfText,
  inputs,
  otherSourceOfTheLaunchContract,
  readSourceBytes,
  recordOfName,
  repositoryPath,
  sourceRecordOf,
  sourcesOfTheLaunchContractFromInputs,
} from "../src/sources.ts";

const TASKS = [
  "# Tasks",
  "",
  "## Phase 1: Setup",
  "",
  "- [ ] T001 [P] create the package",
  "- [x] T002 the second task",
  "",
].join("\n");
const SPEC = "# Feature Specification\n\n## Requirements\n\n- FR-001 a requirement\n";
const PLAN = "# Implementation Plan\n\nThe plan.\n";

/** A throw-away workspace with the given tree, removed by the caller. */
function workspace(tree: Readonly<Record<string, string>>): {
  readonly root: string;
  readonly at: (path: string) => string;
  readonly remove: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "ss104-inputs-"));
  for (const [path, content] of Object.entries(tree)) {
    const file = join(root, ...path.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return {
    root,
    at: (path: string) => join(root, ...path.split("/")),
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("CT-104-6: `inputs` lists the sources of a `speckit-tasks` feature", () => {
  const ws = workspace({
    "specs/104-spec-input/spec.md": SPEC,
    "specs/104-spec-input/plan.md": PLAN,
    "specs/104-spec-input/tasks.md": TASKS,
    "specs/104-spec-input/research.md": "# research\n",
  });
  try {
    const sources = inputs({
      root: ws.root,
      format: "speckit-tasks",
      specPath: ws.at("specs/104-spec-input/tasks.md"),
    });
    // The three DECLARED sources, in the order of the verdict, and nothing
    // else: `research.md` exists and is NOT an input of a run.
    assert.deepEqual(
      sources.map((source) => [source.kind, source.name, source.path]),
      [
        ["spec", "spec", "specs/104-spec-input/spec.md"],
        ["plan", "plan", "specs/104-spec-input/plan.md"],
        ["tasks", "tasks", "specs/104-spec-input/tasks.md"],
      ],
    );
    assert.deepEqual(
      sources.map((source) => source.name),
      [...ORDER_OF_THE_RUN_VERDICT],
    );
    assert.deepEqual([...SPECKIT_SOURCES], [...DECLARED_SOURCES["speckit-tasks"]]);

    // Every record carries the HASHES, and the task list carries both.
    for (const source of sources) {
      assert.match(source.contentHash, /^[0-9a-f]{64}$/, source.name);
      // The hash is the KERNEL's over the same bytes, not a value of this
      // module's own.
      const bytes = readFileSync(ws.at(source.path));
      assert.equal(source.contentHash, contentHash(bytes), source.name);
      if (source.kind === KIND_WITH_A_CHECKBOX_INSENSITIVE_HASH) {
        assert.equal(
          source.checkboxInsensitiveHash,
          taskListHashIgnoringCheckboxesOfBytes(bytes),
          source.name,
        );
        assert.equal(source.checkboxInsensitiveHash, taskListHashIgnoringCheckboxes(TASKS));
        assert.notEqual(source.checkboxInsensitiveHash, source.contentHash);
        continue;
      }
      assert.equal(source.checkboxInsensitiveHash, undefined, `${source.name}: spec and plan only`);
    }

    // Only the files THAT EXIST are listed: with `plan.md` gone, the record of
    // `plan` is gone with it, and the other two are unchanged.
    rmSync(ws.at("specs/104-spec-input/plan.md"));
    const fewer = inputs({
      root: ws.root,
      format: "speckit-tasks",
      specPath: ws.at("specs/104-spec-input/tasks.md"),
    });
    assert.deepEqual(
      fewer.map((source) => source.name),
      ["spec", "tasks"],
    );
    assert.equal(recordOfName(fewer, "plan"), undefined);
    assert.deepEqual(recordOfName(fewer, "tasks"), recordOfName(sources, "tasks"));
    // The launch contract takes its three from `inputs` in the same order, and
    // a name `inputs` did not list is simply left out.
    assert.deepEqual(
      sourcesOfTheLaunchContractFromInputs(fewer).map((source) => source.name),
      ["spec", "tasks"],
    );
  } finally {
    ws.remove();
  }
});

test("CT-104-6: `inputs` lists the sources of an `openspec-change` under their own names", () => {
  const ws = workspace({
    "openspec/changes/add-thing/proposal.md": SPEC,
    "openspec/changes/add-thing/design.md": PLAN,
    "openspec/changes/add-thing/tasks.md": "## 1. Setup\n\n- [ ] 1.1 do it\n",
  });
  try {
    const sources = inputs({
      root: ws.root,
      format: "openspec-change",
      specPath: ws.at("openspec/changes/add-thing/tasks.md"),
    });
    // The LOGICAL name is the verdict's (`spec`, `plan`, `tasks`) while the
    // FILE is the OpenSpec one — which is the whole point of CQ-043.
    assert.deepEqual(
      sources.map((source) => [source.kind, source.name, source.path]),
      [
        ["spec", "spec", "openspec/changes/add-thing/proposal.md"],
        ["plan", "plan", "openspec/changes/add-thing/design.md"],
        ["tasks", "tasks", "openspec/changes/add-thing/tasks.md"],
      ],
    );
    assert.deepEqual([...OPENSPEC_SOURCES], [...DECLARED_SOURCES["openspec-change"]]);
    // The task list of a change carries the checkbox-insensitive hash too, and
    // the widened mark rule makes a tick of a dotted id invisible to it.
    const tasks = recordOfName(sources, "tasks");
    assert.equal(
      tasks?.checkboxInsensitiveHash,
      taskListHashIgnoringCheckboxes("## 1. Setup\n\n- [ ] 1.1 do it\n"),
    );
    assert.equal(
      tasks?.checkboxInsensitiveHash,
      taskListHashIgnoringCheckboxes("## 1. Setup\n\n- [x] 1.1 do it\n"),
    );
  } finally {
    ws.remove();
  }
});

test("CT-104-6: `inputs` of a `native` spec is the ONE file, as `spec`", () => {
  const ws = workspace({ "SPEC.md": "# A spec\n\n## Phase 1 — Setup\n" });
  try {
    const sources = inputs({ root: ws.root, format: "native", specPath: ws.at("SPEC.md") });
    assert.deepEqual(
      sources.map((source) => [source.kind, source.name, source.path]),
      [["spec", NATIVE_SOURCE_NAME, "SPEC.md"]],
    );
    assert.equal(NATIVE_SOURCE_NAME, "spec");
    // It has no task list and so no hash that ignores checkboxes.
    assert.equal(sources[0]?.checkboxInsensitiveHash, undefined);
    assert.deepEqual([...DECLARED_SOURCES["native"]], []);
    // A native spec that does not exist lists NOTHING, rather than a record
    // with no hash in it.
    assert.deepEqual(inputs({ root: ws.root, format: "native", specPath: ws.at("nope.md") }), []);
    // The directory rule the task formats use: the directory of the spec file.
    assert.equal(directoryOfTheSources("specs/alpha/tasks.md"), "specs/alpha");
    assert.equal(directoryOfTheSources("tasks.md"), ".");
    assert.equal(directoryOfTheSources("/abs/specs/alpha/tasks.md"), "/abs/specs/alpha");
  } finally {
    ws.remove();
  }
});

test("CT-104-6: an UNKNOWN kind is read as `other`", () => {
  // The rule itself: row 97's closed set, with `other` as the fall-back.
  assert.equal(UNKNOWN_SOURCE_KIND, "other");
  // The members are READ from row 97 of annex X §X.6, never written out here.
  const kinds = kindsOfSourceOfASpecification.members;
  assert.ok(kinds.includes("other"), "row 97 holds `other`");
  for (const known of kinds) assert.equal(readSourceKind(known), known);
  for (const unknown of ["constitution", "research", "quickstart", "", "TASKS", "tasks "]) {
    assert.equal(readSourceKind(unknown), UNKNOWN_SOURCE_KIND, unknown);
  }

  const ws = workspace({
    ".specify/memory/constitution.md": "# the constitution\n",
    "specs/104-spec-input/research.md": "# research\n",
    "specs/104-spec-input/tasks.md": TASKS,
  });
  try {
    // A record built with a kind this feature does not know comes out `other`,
    // and so carries the CONTENT hash alone — the checkbox-insensitive hash
    // belongs to the one kind `tasks`.
    const constitution = sourceRecordOf({
      root: ws.root,
      path: ".specify/memory/constitution.md",
      name: "constitution",
      kind: "constitution",
    });
    assert.equal(constitution?.kind, "other");
    assert.equal(constitution?.name, "constitution", "the logical NAME is kept as given");
    assert.equal(constitution?.path, ".specify/memory/constitution.md");
    assert.equal(
      constitution?.contentHash,
      contentHash(readFileSync(ws.at(".specify/memory/constitution.md"))),
    );
    assert.equal(constitution?.checkboxInsensitiveHash, undefined);

    // Which is exactly the route a launch contract's OTHER sources take: the
    // kinds of annex X §X.6 row 256 belong to feature 107, and a kind this
    // feature does not hold becomes `other` instead of throwing.
    const other = otherSourceOfTheLaunchContract({
      root: ws.root,
      path: "specs/104-spec-input/research.md",
      name: "research",
    });
    assert.equal(other?.kind, "other");
    assert.equal(other?.name, "research");
    const named = otherSourceOfTheLaunchContract({
      root: ws.root,
      path: "specs/104-spec-input/research.md",
      name: "research",
      kind: "verification-commands",
    });
    assert.equal(named?.kind, "other");
    // A kind the set DOES hold is kept: `other` is a fall-back, not a default.
    const asTasks = sourceRecordOf({
      root: ws.root,
      path: "specs/104-spec-input/tasks.md",
      name: "tasks",
      kind: "tasks",
    });
    assert.equal(asTasks?.kind, "tasks");
    assert.match(asTasks?.checkboxInsensitiveHash ?? "", /^[0-9a-f]{64}$/);
    // A file that cannot be read gives NO record, and nothing throws.
    assert.equal(
      sourceRecordOf({ root: ws.root, path: "nope.md", name: "x", kind: "other" }),
      undefined,
    );
    const failed = readSourceBytes(ws.at("nope.md"));
    assert.equal(failed.ok, false);
    assert.equal(failed.ok === false && failed.error.length > 0, true);
  } finally {
    ws.remove();
  }
});

test("CT-104-6: every hash is the kernel's, and the path rule holds", () => {
  // The module says it computes none of its own, and the claim is measurable
  // on the module: its WHOLE import list of a hash is `@specstride/kernel`.
  assert.equal(HASHES_OF_ITS_OWN, 0);
  assert.equal(HASH_OWNER, "@specstride/kernel");
  const source = readFileSync(new URL("../src/sources.ts", import.meta.url), "utf8");
  // The import of the hasher is there, and the three operations it brings are
  // the only hashes this module can reach.
  assert.match(source, /from "@specstride\/kernel\/hasher";/);
  for (const operation of [
    "contentHash",
    "taskListHashIgnoringCheckboxes",
    "taskListHashIgnoringCheckboxesOfBytes",
  ]) {
    assert.ok(source.includes(operation), `the module calls \`${operation}\` of the kernel`);
  }
  // The CODE, with every comment stripped: the doc comments name `sha256` to
  // describe a record's fields, and prose must not make the check pass or fail
  // by accident.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  for (const forbidden of ["createHash", "node:crypto", "sha256", "digest("]) {
    assert.ok(!code.includes(forbidden), `the code of \`sources.ts\` holds no ${forbidden}`);
  }
  // The stripping is falsifiable: the prose DOES name `sha256`, and the code
  // does not — so neither half of this check is vacuous.
  assert.ok(source.includes("sha256"), "the doc comment names `sha256`");
  assert.ok(!code.includes("sha256"));

  // The two helpers agree with the hasher, over bytes and over text.
  const bytes = Buffer.from(TASKS, "utf8");
  assert.deepEqual(hashesOfBytes(bytes, "tasks"), {
    contentHash: contentHash(bytes),
    checkboxInsensitiveHash: taskListHashIgnoringCheckboxes(TASKS),
  });
  assert.deepEqual(hashesOfBytes(bytes, "spec"), { contentHash: contentHash(bytes) });
  assert.deepEqual(hashesOfText(TASKS, "tasks"), {
    contentHash: contentHash(TASKS),
    checkboxInsensitiveHash: taskListHashIgnoringCheckboxes(TASKS),
  });
  assert.deepEqual(hashesOfText(TASKS, "other"), { contentHash: contentHash(TASKS) });
  // Bytes that are not UTF-8 give NO checkbox-insensitive hash, which is
  // itself a difference (F104-FR-022).
  const notUtf8 = Uint8Array.from([0xff, 0xfe, 0x00, 0x41]);
  assert.deepEqual(hashesOfBytes(notUtf8, "tasks"), { contentHash: contentHash(notUtf8) });
  assert.equal(taskListHashIgnoringCheckboxesOfBytes(notUtf8), undefined);

  // The PATH rule: repository-relative with `/`, and absolute when outside.
  const ws = workspace({ "specs/alpha/tasks.md": TASKS });
  try {
    assert.equal(repositoryPath(ws.root, ws.at("specs/alpha/tasks.md")), "specs/alpha/tasks.md");
    assert.equal(repositoryPath(ws.root, "specs/alpha/tasks.md"), "specs/alpha/tasks.md");
    assert.equal(repositoryPath(ws.root, "/elsewhere/tasks.md"), "/elsewhere/tasks.md");
    // A record built from a RELATIVE path and one built from the absolute path
    // of the same file are the same record, so a record moves unchanged.
    const relative = sourceRecordOf({
      root: ws.root,
      path: "specs/alpha/tasks.md",
      name: "tasks",
      kind: "tasks",
    });
    const absolute = sourceRecordOf({
      root: ws.root,
      path: ws.at("specs/alpha/tasks.md"),
      name: "tasks",
      kind: "tasks",
    });
    assert.deepEqual(relative, absolute);
  } finally {
    ws.remove();
  }
});
