/**
 * T008 — unit tests of the registry, its priority and its detection order
 * (F104-FR-005, F104-FR-006, F104-FR-008, F104-FR-009).
 *
 * The three built-in adapters land in phase 3 (T014 to T016), so the tests
 * here drive the registry with stub adapters that stand in for them: what is
 * under test is the ORDER and the priority bands the registry owns, not the
 * path and content predicates, which belong to each adapter's `detect`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { DetectInput } from "@specstride/contracts/ep/spec-format";
import {
  ADAPTERS_NOT_REGISTERED,
  ADAPTER_ERRORS,
  DETECTION_ORDER,
  DETECTION_RUNS_ONCE,
  EXIT_OF_AN_UNKNOWN_FORMAT,
  FORMATS_OF_WAVE_1,
  FORMAT_WHEN_DETECTION_FAILS,
  PRIORITY_BANDS,
  PRIORITY_BAND_ORDER,
  SpecFormatRegistry,
  UnknownFormatError,
  createRegistry,
  priorityInBand,
  type PriorityBandName,
  type RegisteredAdapter,
} from "../src/registry.ts";

/** A stub adapter that claims the inputs whose path matches. */
function stub(
  name: string,
  band: PriorityBandName,
  options: {
    claims?: (input: DetectInput) => boolean;
    priority?: number;
    builtIn?: boolean;
    step?: number;
    throws?: boolean;
  } = {},
): RegisteredAdapter {
  const adapter: RegisteredAdapter = {
    name,
    band,
    builtIn: options.builtIn ?? false,
    ...(options.step === undefined ? {} : { step: options.step }),
    detect: (input) => {
      if (options.throws === true) throw new Error(`${name} cannot detect`);
      return {
        claims: options.claims?.(input) ?? true,
        priority: options.priority ?? PRIORITY_BANDS[band].floor,
      };
    },
  };
  return adapter;
}

const INPUT: DetectInput = { path: "specs/x/tasks.md", head: "## Phase 1\n- [ ] T001 a\n" };

/** The three built-in adapters of Wave 1, as phase 3 will register them. */
function withTheBuiltInThree(): SpecFormatRegistry {
  const registry = createRegistry();
  // Registration order is the order F104-FR-006's error message lists.
  registry.register(stub("native", "fallback", { builtIn: true, step: 6, claims: () => true }));
  registry.register(
    stub("speckit-tasks", "builtInName", {
      builtIn: true,
      step: 3,
      claims: (i) => /tasks\.md$/i.test(i.path),
    }),
  );
  registry.register(
    stub("openspec-change", "builtInPath", {
      builtIn: true,
      step: 2,
      claims: (i) => /openspec\/changes\/[^/]+\/tasks\.md$/.test(i.path),
    }),
  );
  return registry;
}

/* ---------------------------------------------------------------- *
 * The detection order of F104-FR-005.
 * ---------------------------------------------------------------- */

test("T008: the detection order is the six steps of F104-FR-005, with the added format at 5.5", () => {
  assert.deepEqual(
    DETECTION_ORDER.map((s) => [s.step, s.kind]),
    [
      [1, "explicit"],
      [2, "path"],
      [3, "path"],
      [4, "content"],
      [5, "content"],
      [5.5, "added"],
      [6, "fallback"],
    ],
  );
  // The formats the fixed steps give.
  assert.equal(DETECTION_ORDER.find((s) => s.step === 2)?.format, "openspec-change");
  assert.equal(DETECTION_ORDER.find((s) => s.step === 3)?.format, "speckit-tasks");
  assert.equal(DETECTION_ORDER.find((s) => s.step === 4)?.format, "speckit-tasks");
  assert.equal(DETECTION_ORDER.find((s) => s.step === 5)?.format, "openspec-change");
  assert.equal(DETECTION_ORDER.find((s) => s.step === 6)?.format, "native");
  // An added format is asked AFTER the built-in rules and BEFORE the
  // fallback (CQ-040, closed 2026-09-30).
  const added = DETECTION_ORDER.findIndex((s) => s.kind === "added");
  const lastBuiltIn = DETECTION_ORDER.map((s) => s.kind).lastIndexOf("content");
  const fallback = DETECTION_ORDER.findIndex((s) => s.kind === "fallback");
  assert.ok(lastBuiltIn < added && added < fallback, "5.5 sits between the two");
});

test("T008: detection runs once, and a failure gives `native` with no error", () => {
  assert.equal(DETECTION_RUNS_ONCE, true);
  assert.equal(FORMAT_WHEN_DETECTION_FAILS, "native");
  // No adapter claims the input: the format is the fallback, no throw.
  const registry = createRegistry();
  registry.register(stub("speckit-tasks", "builtInName", { builtIn: true, claims: () => false }));
  assert.equal(registry.detectFormat(INPUT), "native");
  // An empty registry does the same.
  assert.equal(createRegistry().detectFormat(INPUT), "native");
});

/* ---------------------------------------------------------------- *
 * The priority bands: built-in formats win.
 * ---------------------------------------------------------------- */

test("T008: the priority bands run from the built-in path rule down to the fallback", () => {
  assert.deepEqual(
    [...PRIORITY_BAND_ORDER],
    ["builtInPath", "builtInName", "builtInContent", "added", "fallback"],
  );
  // The bands do not overlap, and each is above the next.
  for (let i = 0; i + 1 < PRIORITY_BAND_ORDER.length; i += 1) {
    const upper = PRIORITY_BANDS[PRIORITY_BAND_ORDER[i]];
    const lower = PRIORITY_BANDS[PRIORITY_BAND_ORDER[i + 1]];
    assert.ok(upper.floor > lower.ceiling, `${PRIORITY_BAND_ORDER[i]} is above the next`);
  }
});

test("T008: a priority is held inside its band, so an added format cannot outrank a built-in one", () => {
  // F104-FR-009: "Built-in formats MUST win". A host that returns a huge
  // priority for its own format is clamped into the added band.
  assert.equal(priorityInBand("added", 1_000_000), PRIORITY_BANDS.added.ceiling);
  assert.equal(priorityInBand("added", -5), PRIORITY_BANDS.added.floor);
  assert.equal(priorityInBand("added", 250), 250);
  assert.equal(priorityInBand("added", Number.NaN), PRIORITY_BANDS.added.floor);
  assert.ok(PRIORITY_BANDS.added.ceiling < PRIORITY_BANDS.builtInContent.floor);
});

test("T008: a built-in format wins over an added one that claims the same file", () => {
  // Acceptance scenario of the sample format: "the same format and a file that
  // a built-in format claims → the built-in format wins" (F104-FR-009).
  const registry = withTheBuiltInThree();
  registry.register(stub("sample", "added", { claims: () => true, priority: 1_000_000 }));
  assert.equal(registry.detectFormat(INPUT), "speckit-tasks");
});

test("T008: an added format is chosen where no built-in rule claims the file", () => {
  const registry = withTheBuiltInThree();
  registry.register(stub("sample", "added", { claims: (i) => i.path.endsWith(".sample") }));
  const input: DetectInput = { path: "specs/x/work.sample", head: "nothing familiar\n" };
  // `native` claims every path, but it sits in the fallback band and loses.
  assert.equal(registry.detectFormat(input), "sample");
  // And where it does not claim either, the fallback stands.
  assert.equal(registry.detectFormat({ path: "specs/x/readme.md", head: "plain\n" }), "native");
});

test("T008: the path rule of `openspec-change` beats the base-name rule of `speckit-tasks`", () => {
  // Step 2 before step 3: `openspec/changes/<change>/tasks.md` is an
  // `openspec-change`, although its base name is `tasks.md` too.
  const registry = withTheBuiltInThree();
  assert.equal(
    registry.detectFormat({ path: "openspec/changes/add-x/tasks.md", head: "## 1. g\n" }),
    "openspec-change",
  );
  assert.equal(registry.detectFormat(INPUT), "speckit-tasks");
});

/* ---------------------------------------------------------------- *
 * The explicit override, the alias and the unknown format.
 * ---------------------------------------------------------------- */

test("T008: an explicit override decides, and no adapter is asked", () => {
  const registry = withTheBuiltInThree();
  let asked = 0;
  registry.register(
    stub("counting", "added", {
      claims: () => {
        asked += 1;
        return true;
      },
    }),
  );
  assert.equal(registry.detectFormat(INPUT, "native"), "native");
  assert.equal(asked, 0, "step 1 short-circuits the rest");
  // An empty override is no override.
  assert.equal(registry.detectFormat(INPUT, ""), "speckit-tasks");
});

test("T008: the alias `openspec` is accepted as an explicit override (F104-FR-006)", () => {
  const registry = withTheBuiltInThree();
  assert.equal(registry.resolveExplicit("openspec"), "openspec-change");
  assert.equal(registry.detectFormat(INPUT, "openspec"), "openspec-change");
  assert.equal(registry.adapterOf("openspec")?.name, "openspec-change");
});

test("T008: an added format is chosen at once when it is named explicitly", () => {
  // The acceptance scenario: "a sample format registered from the test tree,
  // its file named explicitly → it is chosen" (F104-FR-009).
  const registry = withTheBuiltInThree();
  registry.register(stub("sample", "added", { claims: () => false }));
  assert.equal(registry.detectFormat(INPUT, "sample"), "sample");
});

test("T008: an unknown explicit format is an error, never a guess (F104-FR-006)", () => {
  const registry = withTheBuiltInThree();
  assert.throws(
    () => registry.resolveExplicit("yaml"),
    (error: unknown) => {
      assert.ok(error instanceof UnknownFormatError);
      assert.equal(error.kind, "unknown-format");
      // The as-is text, with the names in REGISTRATION order and the alias
      // not among them.
      assert.equal(
        error.message,
        "spec: unknown spec format: yaml (native, speckit-tasks, openspec-change)",
      );
      assert.deepEqual([...error.registered], ["native", "speckit-tasks", "openspec-change"]);
      assert.ok(!error.registered.includes("openspec"), "the alias is not listed");
      return true;
    },
  );
  assert.equal(EXIT_OF_AN_UNKNOWN_FORMAT, 3);
  assert.ok(ADAPTER_ERRORS.includes("unknown-format"));
});

test("T008: the names are in registration order, not sorted", () => {
  const registry = createRegistry();
  registry.register(stub("openspec-change", "builtInPath", { builtIn: true }));
  registry.register(stub("native", "fallback", { builtIn: true }));
  registry.register(stub("speckit-tasks", "builtInName", { builtIn: true }));
  assert.deepEqual([...registry.names()], ["openspec-change", "native", "speckit-tasks"]);
});

/* ---------------------------------------------------------------- *
 * The failure paths of the port.
 * ---------------------------------------------------------------- */

test("T008: an adapter that fails in `detect` is passed over (F104-FR-009)", () => {
  const registry = withTheBuiltInThree();
  registry.register(stub("broken", "builtInContent", { throws: true }));
  const claims = registry.claims(INPUT);
  assert.ok(!claims.some((c) => c.name === "broken"), "a throwing adapter makes no claim at all");
  // Detection still answers, from the adapters that did not fail.
  assert.equal(registry.detectFormat(INPUT), "speckit-tasks");
});

test("T008: a throwing adapter in the top band does not swallow the detection", () => {
  const registry = createRegistry();
  registry.register(stub("openspec-change", "builtInPath", { builtIn: true, throws: true }));
  registry.register(stub("speckit-tasks", "builtInName", { builtIn: true, claims: () => true }));
  assert.equal(
    registry.detectFormat({ path: "openspec/changes/a/tasks.md", head: "" }),
    "speckit-tasks",
  );
});

/* ---------------------------------------------------------------- *
 * The contents of the registry (F104-FR-008).
 * ---------------------------------------------------------------- */

test("T008: the registry holds the three formats of Wave 1", () => {
  assert.deepEqual([...FORMATS_OF_WAVE_1], ["native", "speckit-tasks", "openspec-change"]);
  const registry = withTheBuiltInThree();
  assert.deepEqual([...registry.names()].sort(), [...FORMATS_OF_WAVE_1].sort());
  assert.equal(registry.adapters().length, 3);
  for (const adapter of registry.adapters()) assert.equal(adapter.builtIn, true);
});

test("T008: Lisa's legacy adapter and its `chat` adapter are not registered", () => {
  assert.deepEqual([...ADAPTERS_NOT_REGISTERED], ["legacy", "chat"]);
  const registry = withTheBuiltInThree();
  for (const name of ADAPTERS_NOT_REGISTERED) {
    assert.equal(registry.adapterOf(name), undefined, name);
    assert.throws(() => registry.resolveExplicit(name), UnknownFormatError);
  }
});

test("T008: a built-in whose name is no member of row 49 is refused", () => {
  const registry = createRegistry();
  assert.throws(
    () => registry.register(stub("yaml-tasks", "builtInName", { builtIn: true })),
    /no member of the closed set/,
  );
  // An ADDED format brings its own name: row 49 is an open registry.
  registry.register(stub("yaml-tasks", "added"));
  assert.equal(registry.adapterOf("yaml-tasks")?.name, "yaml-tasks");
});

test("T008: one name cannot be registered twice", () => {
  const registry = createRegistry();
  registry.register(stub("native", "fallback", { builtIn: true }));
  assert.throws(() => registry.register(stub("native", "fallback", { builtIn: true })), /twice/);
});

test("T008: the claims are collected in band order, highest band first", () => {
  const registry = withTheBuiltInThree();
  registry.register(stub("sample", "added", { claims: () => true }));
  const claims = registry.claims({ path: "openspec/changes/a/tasks.md", head: "" });
  assert.deepEqual(
    claims.map((c) => c.band),
    ["builtInPath", "builtInName", "builtInContent", "added", "fallback"].filter((band) =>
      claims.some((c) => c.band === band),
    ),
  );
  assert.equal(claims[0]?.name, "openspec-change");
});
