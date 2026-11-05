/**
 * T006 — unit tests of the canonical model, the source record and the closed
 * sets (F104-FR-010, F104-FR-023 to F104-FR-026; `contracts/verdict.md`,
 * `data-model.md`).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { closedSetRows } from "@specstride/contracts/enums";
import { readCanonicalSpecModel } from "@specstride/contracts/records/canonical-spec-model";
import { canonicalRecordHash, contentHash } from "@specstride/kernel/hasher";
import {
  CLASSIFICATION_OWNER,
  CLOSED_SETS_OF_THIS_FEATURE,
  CRITERIA_HEADING,
  EP_03_GAINS_AN_OPERATION_FOR_THE_VERDICT,
  EP_03_OPERATIONS,
  EP_03_POINT_ID,
  FALLBACK_FORMAT,
  FORMAT_ALIASES,
  FORMAT_NAMES,
  FORMAT_WITHOUT_CONTEXT_DOCUMENTS,
  KIND_WITH_A_CHECKBOX_INSENSITIVE_HASH,
  MODEL_SCHEMA_ID,
  TASK_LIST_LOGICAL_NAME,
  TASK_LIST_SCHEMA_ID,
  UNKNOWN_SOURCE_KIND,
  UNKNOWN_SOURCE_STATE,
  VERDICT_LINES,
  VERDICT_RESULTS,
  WRITES_THE_TASK_LIST_RECORD,
  carriesACheckboxInsensitiveHash,
  closedSetOfRow,
  errorsOfASpecFormatAdapter,
  filesOfTheStalenessVerdict,
  isFormatName,
  isSourceKind,
  isSourceState,
  kindsOfSourceOfASpecification,
  phaseNumbers,
  phaseOf,
  phaseViews,
  readSourceKind,
  resolveFormatName,
  sourceOfKind,
  sourceOfName,
  specFormats,
  statesOfASourceInAStalenessVerdict,
  subcommandsOfTheCommandSpec,
  type CanonicalSpecModel,
  type SpecSource,
} from "../src/model.ts";

/* ---------------------------------------------------------------- *
 * The closed sets come from the one table, not from this module.
 * ---------------------------------------------------------------- */

test("T006: every closed set is read from its row of annex X §X.6, and feature 104 owns it", () => {
  const sets = {
    49: specFormats,
    50: filesOfTheStalenessVerdict,
    97: kindsOfSourceOfASpecification,
    98: statesOfASourceInAStalenessVerdict,
    99: errorsOfASpecFormatAdapter,
    100: subcommandsOfTheCommandSpec,
  };
  assert.deepEqual(
    Object.values(CLOSED_SETS_OF_THIS_FEATURE).sort((a, b) => a - b),
    [49, 50, 97, 98, 99, 100],
  );
  for (const [number, set] of Object.entries(sets)) {
    const row = closedSetRows.find((r) => r.number === Number(number));
    assert.notEqual(row, undefined, `annex X §X.6 holds row ${number}`);
    assert.equal(set.number, Number(number));
    assert.equal(set.name, row?.name);
    // The members are the row's literals: the module writes none out itself.
    assert.deepEqual([...set.members], [...(row?.literals ?? [])]);
    assert.match(row?.owner ?? "", /^104/, `feature 104 owns row ${number}`);
  }
});

test("T006: a row the table does not hold is refused, not invented", () => {
  assert.throws(() => closedSetOfRow(99999), /closed set 99999/);
});

test("T006: the members of the six sets are the ones the annex names", () => {
  assert.deepEqual(
    [...specFormats.members],
    ["native", "speckit-tasks", "openspec-change", "openspec"],
  );
  assert.deepEqual([...filesOfTheStalenessVerdict.members], ["spec", "plan", "tasks"]);
  assert.deepEqual([...kindsOfSourceOfASpecification.members], ["spec", "plan", "tasks", "other"]);
  assert.deepEqual(
    [...statesOfASourceInAStalenessVerdict.members],
    ["unchanged", "ticks-only", "changed", "unreadable"],
  );
  assert.deepEqual(
    [...errorsOfASpecFormatAdapter.members],
    ["invalid-spec", "ambiguous-candidates", "unknown-format"],
  );
  // The eleven subcommands of `contracts/spec-verb.md` (F104-FR-019).
  assert.deepEqual(
    [...subcommandsOfTheCommandSpec.members],
    [
      "feature-slug",
      "detect",
      "context",
      "render-context",
      "validate",
      "tick",
      "numbers",
      "title",
      "shape",
      "slice",
      "first-unapproved",
    ],
  );
});

/* ---------------------------------------------------------------- *
 * The formats and the alias.
 * ---------------------------------------------------------------- */

test("T006: the formats of Wave 1 are row 49 without its aliases", () => {
  assert.deepEqual([...FORMAT_NAMES], ["native", "speckit-tasks", "openspec-change"]);
  assert.equal(FALLBACK_FORMAT, "native");
  for (const name of FORMAT_NAMES) assert.equal(isFormatName(name), true);
  // A model's `format` is never the alias (`data-model.md`, the row Model).
  assert.equal(isFormatName("openspec"), false);
  assert.equal(specFormats.has("openspec"), true, "but row 49 holds it as a member");
});

test("T006: `openspec` is an alias of `openspec-change` (F104-FR-006)", () => {
  assert.deepEqual(FORMAT_ALIASES, { openspec: "openspec-change" });
  assert.equal(resolveFormatName("openspec"), "openspec-change");
  assert.equal(resolveFormatName("openspec-change"), "openspec-change");
  assert.equal(resolveFormatName("native"), "native");
  assert.equal(resolveFormatName("speckit-tasks"), "speckit-tasks");
  // An unknown format is not guessed: it has no resolution at all.
  assert.equal(resolveFormatName("yaml"), undefined);
  assert.equal(resolveFormatName(""), undefined);
});

test("T006: each format has the criteria heading F104-FR-014 gives it", () => {
  assert.equal(CRITERIA_HEADING["native"], "Acceptance criteria (the phase spec)");
  assert.equal(
    CRITERIA_HEADING["speckit-tasks"],
    "Tasks to complete (each `- [ ]` is a required deliverable)",
  );
  assert.equal(
    CRITERIA_HEADING["openspec-change"],
    "OpenSpec tasks to complete (each `- [ ]` is required)",
  );
  assert.deepEqual(Object.keys(CRITERIA_HEADING).sort(), [...FORMAT_NAMES].sort());
  assert.equal(FORMAT_WITHOUT_CONTEXT_DOCUMENTS, "native");
});

/* ---------------------------------------------------------------- *
 * The source record of `contracts/verdict.md`.
 * ---------------------------------------------------------------- */

const SPEC_SOURCE: SpecSource = {
  kind: "spec",
  name: "spec",
  path: "specs/104-spec-input/spec.md",
  contentHash: contentHash("# spec\n"),
};
const TASKS_SOURCE: SpecSource = {
  kind: "tasks",
  name: "tasks",
  path: "specs/104-spec-input/tasks.md",
  contentHash: contentHash("- [ ] T001 a\n"),
  checkboxInsensitiveHash: contentHash("- [ ] T001 a\n"),
};

test("T006: the source record holds kind, name, path, contentHash — and for tasks the second hash", () => {
  // The field list of `contracts/verdict.md`, heading "Source record".
  assert.deepEqual(Object.keys(SPEC_SOURCE).sort(), ["contentHash", "kind", "name", "path"]);
  assert.deepEqual(Object.keys(TASKS_SOURCE).sort(), [
    "checkboxInsensitiveHash",
    "contentHash",
    "kind",
    "name",
    "path",
  ]);
  assert.equal(KIND_WITH_A_CHECKBOX_INSENSITIVE_HASH, "tasks");
  assert.equal(carriesACheckboxInsensitiveHash(TASKS_SOURCE), true);
  assert.equal(carriesACheckboxInsensitiveHash(SPEC_SOURCE), false);
  // The path is relative to the repository (F104-FR-023).
  assert.doesNotMatch(SPEC_SOURCE.path, /^\//);
});

test("T006: a kind that is unknown is read as `other` (row 97's rule)", () => {
  assert.equal(UNKNOWN_SOURCE_KIND, "other");
  assert.equal(readSourceKind("spec"), "spec");
  assert.equal(readSourceKind("plan"), "plan");
  assert.equal(readSourceKind("tasks"), "tasks");
  assert.equal(readSourceKind("other"), "other");
  assert.equal(readSourceKind("constitution"), "other");
  assert.equal(isSourceKind("constitution"), false);
  assert.equal(isSourceKind("tasks"), true);
  // The rule is the one the table states, not one this module invented.
  const row = closedSetRows.find((r) => r.number === 97);
  assert.match(row?.unknownValue ?? "", /other/);
});

test("T006: a state that is unknown is read as `changed` (row 98's rule)", () => {
  assert.equal(UNKNOWN_SOURCE_STATE, "changed");
  for (const state of ["unchanged", "ticks-only", "changed", "unreadable"]) {
    assert.equal(isSourceState(state), true, state);
  }
  assert.equal(isSourceState("fresh"), false);
  const row = closedSetRows.find((r) => r.number === 98);
  assert.match(row?.unknownValue ?? "", /changed/);
});

/* ---------------------------------------------------------------- *
 * The model.
 * ---------------------------------------------------------------- */

const MODEL: CanonicalSpecModel = {
  format: "speckit-tasks",
  feature: "104-spec-input",
  sources: [SPEC_SOURCE, TASKS_SOURCE],
  phases: [
    {
      number: 1,
      title: "Setup and captures",
      section: "## Phase 1: Setup and captures\n\n- [x] T001 confirm the fixtures\n",
      criteria: ["T001 confirm the fixtures"],
      tasks: [
        {
          id: "T001",
          markers: [],
          text: "confirm the fixtures",
          ticked: true,
          line: 14,
          file: "specs/104-spec-input/tasks.md",
        },
      ],
    },
    {
      number: 2,
      title: "Foundational",
      section: "## Phase 2: Foundational\n\n- [ ] T006 define the model\n",
      criteria: ["T006 define the model"],
      tasks: [
        {
          id: "T006",
          markers: ["[P]", "[US1]"],
          text: "define the model",
          ticked: false,
          line: 28,
          file: "specs/104-spec-input/tasks.md",
        },
      ],
    },
  ],
};

test("T006: the model holds the format, the feature, the sources and the phases", () => {
  assert.deepEqual(Object.keys(MODEL).sort(), ["feature", "format", "phases", "sources"]);
  assert.equal(MODEL.format, "speckit-tasks");
  assert.equal(isFormatName(MODEL.format), true);
  assert.notEqual(MODEL.format as string, "openspec", "`format` is never the alias");
});

test("T006: the model of this feature IS a record of `specstride.spec-format/1:model`", () => {
  // The schema of feature 100 (annex C §C.7) takes the further fields this
  // feature's `data-model.md` adds — a logical `name` on a source, the `file`
  // of a task — so no second, lossy shape is needed. `readCanonicalSpecModel`
  // throws where the value is no such record.
  assert.equal(MODEL_SCHEMA_ID, "specstride.spec-format/1:model");
  const read = readCanonicalSpecModel(MODEL);
  assert.equal(read.format, "speckit-tasks");
  assert.equal(read.feature, "104-spec-input");
  assert.equal(read.sources.length, 2);
  assert.equal(read.phases.length, 2);
  // The further fields survive the reading.
  assert.equal((read.sources[0] as { name?: string }).name, "spec");
  // A model that lacks a required field is refused.
  assert.throws(() => readCanonicalSpecModel({ format: "native" }), /canonical spec model/);
  // A phase without `tasks` is refused: the field is required, may be empty.
  assert.throws(
    () =>
      readCanonicalSpecModel({
        ...MODEL,
        phases: [{ number: 1, title: "t", section: "s", criteria: [] }],
      }),
    /canonical spec model/,
  );
});

test("T006: a task holds id, markers, text, ticked, line and file (F104-FR-010)", () => {
  const task = MODEL.phases[1].tasks[0];
  assert.deepEqual(Object.keys(task).sort(), ["file", "id", "line", "markers", "text", "ticked"]);
  // The parallel marker comes first, then one further bracketed tag.
  assert.deepEqual([...task.markers], ["[P]", "[US1]"]);
  assert.match(task.id, /^T\d+[A-Za-z]?$/);
  assert.equal(task.ticked, false);
  assert.equal(task.line, 28);
});

test("T006: the four-field view of a phase is a projection of the model", () => {
  const views = phaseViews(MODEL);
  assert.equal(views.length, 2);
  for (const view of views) {
    assert.deepEqual(Object.keys(view).sort(), ["criteria", "number", "section", "title"]);
  }
  assert.deepEqual(views[0], {
    number: 1,
    title: "Setup and captures",
    section: MODEL.phases[0].section,
    criteria: MODEL.phases[0].criteria,
  });
});

test("T006: a phase is reachable by number, and a missing one is no error", () => {
  assert.deepEqual([...phaseNumbers(MODEL)], [1, 2]);
  assert.equal(phaseOf(MODEL, 2)?.title, "Foundational");
  assert.equal(phaseOf(MODEL, 99), undefined, "a missing phase gives no error");
});

test("T006: a source is reachable by kind and by logical name", () => {
  assert.equal(sourceOfKind(MODEL, "tasks")?.path, "specs/104-spec-input/tasks.md");
  assert.equal(sourceOfKind(MODEL, "plan"), undefined);
  assert.equal(sourceOfName(MODEL, "spec")?.kind, "spec");
  assert.equal(sourceOfName(MODEL, "research"), undefined);
});

test("T006: the criteria of a phase carry no checkbox mark, so a tick cannot reach a shape", () => {
  for (const phase of MODEL.phases) {
    for (const criterion of phase.criteria) {
      assert.doesNotMatch(criterion, /^\s*-\s*\[/, criterion);
    }
  }
});

/* ---------------------------------------------------------------- *
 * The task-list reading and the verdict.
 * ---------------------------------------------------------------- */

test("T006: the task-list reading is the content of the engine's record, never written here", () => {
  assert.equal(TASK_LIST_SCHEMA_ID, "specstride.task-list/1");
  assert.equal(TASK_LIST_LOGICAL_NAME, "run:<runId>:task-list");
  assert.equal(WRITES_THE_TASK_LIST_RECORD, false);
  // A reading holds the id, the markers and the text, and nothing of the
  // file's state: ticks and line numbers never enter its hash (F104-FR-026).
  const tasks = MODEL.phases[1].tasks.map((t) => ({
    id: t.id,
    markers: t.markers,
    text: t.text,
  }));
  const reading = { phase: 2, tasks, hash: canonicalRecordHash(tasks) };
  for (const task of reading.tasks) {
    assert.deepEqual(Object.keys(task).sort(), ["id", "markers", "text"]);
  }
  // Ticking the task does not move the hash, because `ticked` is not in it.
  const afterATick = MODEL.phases[1].tasks.map((t) => ({
    id: t.id,
    markers: t.markers,
    text: t.text,
  }));
  assert.equal(canonicalRecordHash(afterATick), reading.hash);
});

test("T006: the verdict has the fields of `contracts/verdict.md`", () => {
  assert.deepEqual([...VERDICT_RESULTS], ["fresh", "stale"]);
  assert.equal(
    VERDICT_LINES.changed(0, "specs/x/spec.md"),
    "sources[0] hash changed: specs/x/spec.md",
  );
  assert.equal(
    VERDICT_LINES.unreadable(2, "specs/x/tasks.md", "No such file or directory"),
    "sources[2] cannot be read: specs/x/tasks.md: No such file or directory",
  );
});

test("T006: the classification belongs to the kernel, and EP-03 gains no operation", () => {
  // CQ-214: this package reads the files and builds the lines; the
  // classification is the pure operation of the canonical hasher.
  assert.equal(CLASSIFICATION_OWNER, "@specstride/kernel");
  assert.equal(EP_03_GAINS_AN_OPERATION_FOR_THE_VERDICT, false);
});

test("T006: the extension point and its five operations are feature 100's", () => {
  assert.equal(EP_03_POINT_ID, "specstride.spec-format/1");
  assert.deepEqual([...EP_03_OPERATIONS], ["detect", "parse", "validate", "tick", "inputs"]);
});

test("T041: a MODEL may carry the name of a format added through the open registry (F104-FR-009)", () => {
  // Row 49 is an OPEN set: an added format brings its own name, and
  // F104-FR-009 requires it to be parsed, validated and ticked. `format` is
  // therefore `ModelFormatName` — the three literals of Wave 1 OR an added
  // name — which is also what the schema of feature 100 says, where `format`
  // is a string. Phase 7 widened the field for exactly that reason; this test
  // is what makes the widening observable and not a silent type change.
  const added: CanonicalSpecModel = { ...MODEL, format: "a-format-from-a-host" };
  assert.equal(added.format, "a-format-from-a-host");
  assert.equal(isFormatName(added.format), false, "it is no format of Wave 1");
  assert.equal(resolveFormatName(added.format), undefined, "and no alias of one");

  // It is still a record of `specstride.spec-format/1:model`.
  const read = readCanonicalSpecModel(added);
  assert.equal(read.format, "a-format-from-a-host");
  assert.deepEqual(
    read.phases.map((phase) => phase.number),
    MODEL.phases.map((p) => p.number),
  );

  // And the three names of Wave 1 are unchanged by the widening.
  assert.deepEqual([...FORMAT_NAMES], ["native", "speckit-tasks", "openspec-change"]);
  assert.equal(FALLBACK_FORMAT, "native");
});
