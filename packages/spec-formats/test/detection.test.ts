/**
 * T016 — unit tests of the BUILT-IN detection rules the registry gained, and of
 * the two inputs (F104-FR-005, F104-FR-006, F104-FR-007, F104-FR-009).
 *
 * `test/registry.test.ts` (T008) drives the registry with stubs and tests the
 * ORDER it owns. These tests drive it with the real built-in adapters and test
 * that they land in the right band for the right input — in particular that an
 * adapter which carries two steps of F104-FR-005 (`openspec-change` carries 2
 * and 5, `speckit-tasks` carries 3 and 4) does not lift its lower step into its
 * higher step's band.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ADAPTERS_NOT_REGISTERED,
  PRIORITY_BANDS,
  STEP_PRIORITY,
  UnknownFormatError,
  createDefaultRegistry,
  defaultRegistry,
  detectFormat,
  nativeDetection,
  openspecChangeDetection,
  priorityInBand,
  speckitTasksDetection,
} from "../src/registry.ts";

const SPECKIT = "## Phase 1: Setup\n\n- [ ] T001 a\n";
const OPENSPEC = "## 1. Setup\n\n- [ ] 1.1 a\n";
const NATIVE = "## Phase 1\n\n### Acceptance criteria\n\n- [ ] a\n";

test("T016: the registry holds exactly the three formats of Wave 1, in registration order", () => {
  const registry = createDefaultRegistry();
  assert.deepEqual([...registry.names()], ["native", "speckit-tasks", "openspec-change"]);
  for (const adapter of registry.adapters()) assert.equal(adapter.builtIn, true);
  for (const name of ADAPTERS_NOT_REGISTERED) {
    assert.equal(registry.adapterOf(name), undefined, name);
  }
  // The package's default registry is one of these.
  assert.deepEqual([...defaultRegistry.names()], [...registry.names()]);
});

test("T016: a step of a two-step adapter stays in its own band", () => {
  const openspec = openspecChangeDetection();
  const speckit = speckitTasksDetection();
  // `openspec-change`: step 2 is `builtInPath`, step 5 is `builtInContent`.
  assert.equal(openspec.bandOf?.({ path: "openspec/changes/a/tasks.md", head: "" }), "builtInPath");
  assert.equal(openspec.bandOf?.({ path: "work/change.md", head: OPENSPEC }), "builtInContent");
  // `speckit-tasks`: step 3 is `builtInName`, step 4 is `builtInContent`.
  assert.equal(speckit.bandOf?.({ path: "specs/a/tasks.md", head: "" }), "builtInName");
  assert.equal(speckit.bandOf?.({ path: "work/plan.md", head: SPECKIT }), "builtInContent");
  // And each step's priority sits inside the band it claims in.
  assert.equal(priorityInBand("builtInPath", STEP_PRIORITY[2] as number), STEP_PRIORITY[2]);
  assert.equal(priorityInBand("builtInName", STEP_PRIORITY[3] as number), STEP_PRIORITY[3]);
  assert.equal(priorityInBand("builtInContent", STEP_PRIORITY[4] as number), STEP_PRIORITY[4]);
  assert.equal(priorityInBand("builtInContent", STEP_PRIORITY[5] as number), STEP_PRIORITY[5]);
  assert.equal(priorityInBand("fallback", STEP_PRIORITY[6] as number), STEP_PRIORITY[6]);
  // Step 4 before step 5 inside the shared band.
  assert.ok((STEP_PRIORITY[4] as number) > (STEP_PRIORITY[5] as number));
  // `native` claims every input, at the bottom.
  assert.deepEqual(nativeDetection().detect({ path: "x", head: "" }), {
    claims: true,
    priority: PRIORITY_BANDS.fallback.floor,
  });
});

test("T016: the base-name rule beats the content rule of the other format", () => {
  // `specs/x/tasks.md` whose content LOOKS like an OpenSpec change is still a
  // `speckit-tasks` file: step 3 comes before step 5.
  assert.equal(detectFormat("specs/x/tasks.md", OPENSPEC), "speckit-tasks");
  // And `openspec/changes/a/tasks.md` whose content looks like Spec Kit is
  // still an `openspec-change`: step 2 comes before step 3.
  assert.equal(detectFormat("openspec/changes/a/tasks.md", SPECKIT), "openspec-change");
  // Content alone, under a name neither path rule claims.
  assert.equal(detectFormat("work/plan.md", SPECKIT), "speckit-tasks");
  assert.equal(detectFormat("work/change.md", OPENSPEC), "openspec-change");
  assert.equal(detectFormat("work/spec.md", NATIVE), "native");
});

test("T016: content that satisfies step 4 AND step 5 is `speckit-tasks`", () => {
  // A file with both shapes: a phase heading with a `T` task line, and a
  // numbered heading with a dotted task line. Step 4 comes first.
  const both = [
    "## Phase 1: Setup",
    "",
    "- [ ] T001 a",
    "",
    "## 2. More",
    "",
    "- [ ] 2.1 b",
    "",
  ].join("\n");
  assert.equal(detectFormat("work/both.md", both), "speckit-tasks");
  // Without the `T` line, step 4 declines and step 5 answers.
  const onlyOpenspec = ["## Phase 1: Setup", "", "## 2. More", "", "- [ ] 2.1 b", ""].join("\n");
  assert.equal(detectFormat("work/openspec-only.md", onlyOpenspec), "openspec-change");
});

test("T016: the alias and the unknown-format error over the real registry", () => {
  assert.equal(detectFormat("work/spec.md", NATIVE, "openspec"), "openspec-change");
  assert.equal(detectFormat("work/spec.md", NATIVE, "openspec-change"), "openspec-change");
  assert.equal(detectFormat("work/spec.md", NATIVE, "speckit-tasks"), "speckit-tasks");
  assert.throws(() => detectFormat("work/spec.md", NATIVE, "sample"), UnknownFormatError);
  // An ADDED format is reachable by name, and loses to a built-in rule on a
  // file the built-in claims (F104-FR-009).
  const registry = createDefaultRegistry();
  registry.register({
    name: "sample",
    band: "added",
    builtIn: false,
    detect: () => ({ claims: true, priority: 1_000_000 }),
  });
  assert.equal(registry.detectFormat({ path: "specs/x/tasks.md", head: SPECKIT }), "speckit-tasks");
  assert.equal(registry.detectFormat({ path: "x.weird", head: "nothing\n" }), "sample");
  assert.equal(registry.detectFormat({ path: "x.weird", head: "nothing\n" }, "sample"), "sample");
  assert.deepEqual([...registry.names()], ["native", "speckit-tasks", "openspec-change", "sample"]);
});

test("T016: an empty file and an empty override are both answered, not thrown", () => {
  assert.equal(detectFormat("work/empty.md", ""), "native");
  assert.equal(detectFormat("work/empty.md", "", ""), "native");
  assert.equal(detectFormat("specs/x/tasks.md", ""), "speckit-tasks", "the name still decides");
});
