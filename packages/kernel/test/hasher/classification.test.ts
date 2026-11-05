/**
 * T007 — unit tests of the classification of the staleness verdict (annex X
 * §X.5, row "Classification of the staleness verdict"; F104-FR-024,
 * F104-FR-027; CQ-214).
 *
 * It is a pure function of the recorded hashes and the hashes now, and reads
 * no file. Features 102, 103 and 104 reach this one function and do not
 * compare hashes themselves.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { SourceReading } from "@specstride/contracts/ep/hasher";
import {
  CLOSED_SET_OF_THE_KINDS_OF_SOURCE,
  CLOSED_SET_OF_THE_NAMES_OF_THE_RUN_VERDICT,
  CLOSED_SET_OF_THE_STATES_OF_A_SOURCE,
  KINDS_OF_SOURCE,
  NAMES_OF_THE_RUN_VERDICT,
  STATES_OF_A_SOURCE,
  changedNames,
  classifySources,
  classifyStaleness,
  verdictOf,
} from "../../src/hasher/index.ts";

const SPEC: SourceReading = {
  logicalName: "spec",
  repositoryPath: "specs/104-spec-input/spec.md",
  recordedHash: "aaa",
  hashNow: "aaa",
};
const PLAN: SourceReading = {
  logicalName: "plan",
  repositoryPath: "specs/104-spec-input/plan.md",
  recordedHash: "bbb",
  hashNow: "bbb",
};
const TASKS: SourceReading = {
  logicalName: "tasks",
  repositoryPath: "specs/104-spec-input/tasks.md",
  recordedHash: "ccc",
  recordedHashIgnoringCheckboxes: "sss",
  hashNow: "ccc",
  hashNowIgnoringCheckboxes: "sss",
};

test("T007: the closed sets come from the one table of annex X §X.6", () => {
  assert.equal(CLOSED_SET_OF_THE_STATES_OF_A_SOURCE, 98);
  assert.equal(CLOSED_SET_OF_THE_KINDS_OF_SOURCE, 97);
  assert.equal(CLOSED_SET_OF_THE_NAMES_OF_THE_RUN_VERDICT, 50);
  assert.deepEqual([...STATES_OF_A_SOURCE], ["unchanged", "ticks-only", "changed", "unreadable"]);
  assert.deepEqual([...KINDS_OF_SOURCE], ["spec", "plan", "tasks", "other"]);
  assert.deepEqual([...NAMES_OF_THE_RUN_VERDICT], ["spec", "plan", "tasks"]);
});

test("T007: every source unchanged is a fresh verdict", () => {
  const result = classifyStaleness([SPEC, PLAN, TASKS]);
  assert.equal(result.verdict, "fresh");
  assert.deepEqual(result.sources, { spec: "unchanged", plan: "unchanged", tasks: "unchanged" });
});

test("T007: a task list whose boxes alone changed is `ticks-only`, and the verdict is fresh", () => {
  // Acceptance scenario 1 of the verdict story: only checkboxes changed.
  const ticked: SourceReading = { ...TASKS, hashNow: "ccc-ticked" };
  const result = classifyStaleness([SPEC, PLAN, ticked]);
  assert.equal(result.sources["tasks"], "ticks-only");
  assert.equal(result.verdict, "fresh");
  // And it is not more than ticks.
  const [, , classified] = classifySources([SPEC, PLAN, ticked]);
  assert.equal(classified?.moreThanTicks, false);
});

test("T007: a task list whose text changed is `changed`, and the verdict names it", () => {
  // Acceptance scenario 2: the text of one task changed.
  const edited: SourceReading = {
    ...TASKS,
    hashNow: "ccc-edited",
    hashNowIgnoringCheckboxes: "sss-edited",
  };
  const sources = classifySources([SPEC, PLAN, edited]);
  assert.equal(sources[2]?.state, "changed");
  assert.equal(sources[2]?.moreThanTicks, true);
  assert.equal(sources[2]?.name, "tasks");
  assert.equal(sources[2]?.path, "specs/104-spec-input/tasks.md");
  assert.equal(verdictOf(sources), "stale");
  assert.deepEqual([...changedNames(sources)], ["tasks"]);
});

test("T007: a changed plan with a ticked task list names the plan only", () => {
  // Acceptance scenario 3.
  const sources = classifySources([
    SPEC,
    { ...PLAN, hashNow: "bbb-edited" },
    { ...TASKS, hashNow: "ccc-ticked" },
  ]);
  assert.equal(verdictOf(sources), "stale");
  assert.deepEqual([...changedNames(sources)], ["plan"]);
  assert.equal(sources[2]?.state, "ticks-only");
});

test("T007: a recorded source that cannot be read is `unreadable` and stale", () => {
  // Acceptance scenario 4, and the edge case "a source listed at launch is
  // deleted later".
  const gone: SourceReading = { ...SPEC, hashNow: undefined };
  const sources = classifySources([gone, PLAN, TASKS]);
  assert.equal(sources[0]?.state, "unreadable");
  assert.equal(verdictOf(sources), "stale");
  assert.deepEqual([...changedNames(sources)], ["spec"]);
});

test("T007: a task list with no hash that ignores checkboxes now is `changed`, not `ticks-only`", () => {
  // F104-FR-022: a file that cannot be decoded gives no hash, and so a
  // difference.
  const undecodable: SourceReading = {
    ...TASKS,
    hashNow: "ccc-other",
    hashNowIgnoringCheckboxes: undefined,
  };
  const sources = classifySources([undecodable]);
  assert.equal(sources[0]?.state, "changed");
  assert.equal(sources[0]?.moreThanTicks, true);
});

test("T007: `ticks-only` is for a task list alone; the spec and the plan never get it", () => {
  const spec: SourceReading = {
    logicalName: "spec",
    repositoryPath: "specs/x/spec.md",
    recordedHash: "aaa",
    hashNow: "aaa-edited",
  };
  const sources = classifySources([spec]);
  assert.equal(sources[0]?.state, "changed");
  assert.equal(sources[0]?.moreThanTicks, undefined, "no `moreThanTicks` outside a task list");
});

test("T007: the names are reported in the order recorded, with their index", () => {
  const sources = classifySources([
    { ...SPEC, hashNow: undefined },
    { ...PLAN, hashNow: "bbb-edited" },
    { ...TASKS, hashNow: "ccc-edited", hashNowIgnoringCheckboxes: "sss-edited" },
  ]);
  assert.deepEqual(
    sources.map((s) => [s.index, s.name, s.state]),
    [
      [0, "spec", "unreadable"],
      [1, "plan", "changed"],
      [2, "tasks", "changed"],
    ],
  );
  assert.deepEqual([...changedNames(sources)], ["spec", "plan", "tasks"]);
});

test("T007: under the `run` name rule a name outside closed set 50 gives a stale verdict", () => {
  // F104-FR-024: in the verdict of a run, a name outside `spec`, `plan` and
  // `tasks` gives a stale verdict, even where the hash is equal.
  const other: SourceReading = {
    logicalName: "research",
    repositoryPath: "specs/x/research.md",
    recordedHash: "ddd",
    hashNow: "ddd",
  };
  const run = classifySources([SPEC, other], { nameRule: "run" });
  assert.equal(run[1]?.state, "changed");
  assert.equal(run[1]?.nameOutsideTheRunVerdict, true);
  assert.equal(verdictOf(run), "stale");
  assert.equal(classifyStaleness([SPEC, other], { nameRule: "run" }).verdict, "stale");
});

test("T007: the name rule of the run does not apply to the sources of a launch contract", () => {
  // F104-FR-024: a launch contract records sources of any kind of annex X
  // §X.6 row 256, each identified by its index; the same classification is
  // applied to each and the name rule of the run is NOT applied.
  const contract: readonly SourceReading[] = [
    {
      logicalName: "constitution",
      repositoryPath: ".specify/memory/constitution.md",
      recordedHash: "k",
      hashNow: "k",
    },
    {
      logicalName: "research",
      repositoryPath: "specs/x/research.md",
      recordedHash: "r",
      hashNow: "r",
    },
    {
      logicalName: "contracts",
      repositoryPath: "specs/x/contracts/verdict.md",
      recordedHash: "c",
      hashNow: "c2",
    },
  ];
  const sources = classifySources(contract);
  assert.deepEqual(
    sources.map((s) => [s.index, s.state]),
    [
      [0, "unchanged"],
      [1, "unchanged"],
      [2, "changed"],
    ],
  );
  assert.equal(verdictOf(sources), "stale");
  // The default is no name rule, so the same call without options agrees.
  assert.deepEqual(classifySources(contract, { nameRule: "none" }), sources);
});

test("T007: two contract sources may share a name, and the index keeps them apart", () => {
  const contract: readonly SourceReading[] = [
    {
      logicalName: "contracts",
      repositoryPath: "specs/x/contracts/a.md",
      recordedHash: "1",
      hashNow: "1",
    },
    {
      logicalName: "contracts",
      repositoryPath: "specs/x/contracts/b.md",
      recordedHash: "2",
      hashNow: "9",
    },
  ];
  const sources = classifySources(contract);
  assert.equal(sources.length, 2);
  assert.deepEqual(
    sources.map((s) => [s.index, s.path, s.state]),
    [
      [0, "specs/x/contracts/a.md", "unchanged"],
      [1, "specs/x/contracts/b.md", "changed"],
    ],
  );
  // The shape of feature 100's interface is keyed by name, so a caller that
  // names sources by index uses `classifySources`; the verdict is the same.
  assert.equal(classifyStaleness(contract).verdict, "stale");
});

test("T007: the classification reads no file and is a pure function", () => {
  const readings = [SPEC, PLAN, TASKS];
  const first = classifyStaleness(readings);
  const second = classifyStaleness(readings);
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  // No input is mutated.
  assert.deepEqual(readings, [SPEC, PLAN, TASKS]);
});

test("T007: an empty set of recorded sources is fresh", () => {
  assert.equal(classifyStaleness([]).verdict, "fresh");
  assert.deepEqual(classifySources([]), []);
  assert.deepEqual([...changedNames([])], []);
});
