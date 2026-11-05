/**
 * T014 — unit tests of resolution, the explicit path and the listings
 * (F104-FR-001, F104-FR-002, F104-FR-004).
 *
 * The parity tests of `tests/parity/104/resolution.test.ts` and
 * `explicit-spec.test.ts` measure the port against the behaviour inventory.
 * These tests cover what the inventory does not reach: the ORDER between the
 * three steps when more than one of them could answer, and the edges of
 * `.specify/feature.json`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CANDIDATE_ROOTS,
  EXIT_OF_A_FAILED_RESOLUTION,
  FEATURE_DIRECTORY_KEY,
  FEATURE_JSON_FALLS_THROUGH_SILENTLY,
  RESOLUTION_ORDER,
  RESOLUTION_REASON_KINDS,
  ROOT_SPEC_NAME,
  TRIED_LOCATIONS,
  ambiguousCandidateLines,
  candidatesOf,
  canonicalSpecPath,
  disambiguatingCommands,
  hasAFeatureJson,
  resolveSpec,
  specOfTheFeatureJson,
} from "../src/resolve.ts";

/** A throw-away workspace. */
function ws(tree: Readonly<Record<string, string>>): {
  directory: string;
  at: (p: string) => string;
  remove: () => void;
} {
  const directory = mkdtempSync(join(tmpdir(), "ss104-res-"));
  for (const [path, content] of Object.entries(tree)) {
    const file = join(directory, ...path.split("/"));
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, content);
  }
  return {
    directory,
    at: (p: string) => join(directory, ...p.split("/")),
    remove: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function withWs<T>(
  tree: Readonly<Record<string, string>>,
  body: (w: ReturnType<typeof ws>) => T,
): T {
  const w = ws(tree);
  try {
    return body(w);
  } finally {
    w.remove();
  }
}

const TASKS = "## Phase 1: Setup\n\n- [ ] T001 a\n";

test("T014: the order is data, and every step has its rule", () => {
  assert.equal(RESOLUTION_ORDER.length, 4);
  for (const step of RESOLUTION_ORDER) {
    assert.ok(step.rule.length > 10, step.kind);
    assert.ok(Number.isInteger(step.step));
  }
  assert.deepEqual(
    CANDIDATE_ROOTS.map((root) => root.parts.join("/")),
    ["specs", "openspec/changes"],
  );
});

test("T014: step 1 beats steps 2 and 3, step 2 beats step 3", () => {
  // All three could answer; the first that can, does.
  withWs(
    {
      [ROOT_SPEC_NAME]: "# root\n\n## Phase 1\n\n### Acceptance criteria\n\n- [ ] a\n",
      ".specify/feature.json": `{"${FEATURE_DIRECTORY_KEY}":"specs/alpha"}`,
      "specs/alpha/tasks.md": TASKS,
      "specs/beta/tasks.md": TASKS,
    },
    (w) => {
      assert.equal(resolveSpec({ workspace: w.directory }).resolved, true);
      const first = resolveSpec({ workspace: w.directory });
      assert.ok(first.resolved && first.step === 1);
      // Remove step 1's file and step 2 answers.
      rmSync(w.at(ROOT_SPEC_NAME));
      const second = resolveSpec({ workspace: w.directory });
      assert.ok(second.resolved && second.step === 2 && /alpha/.test(second.path));
      // Remove step 2's marker and step 3 is ambiguous, because two remain.
      rmSync(w.at(".specify/feature.json"));
      const third = resolveSpec({ workspace: w.directory });
      assert.equal(third.resolved, false);
      assert.ok(!third.resolved && third.failure.case === "ambiguous-candidates");
    },
  );
});

test("T014: `.specify/feature.json`, with every way it can fall through", () => {
  assert.equal(FEATURE_JSON_FALLS_THROUGH_SILENTLY, true);
  const cases: readonly [string, string][] = [
    ["not json at all", "unparseable"],
    ["{}", "no feature_directory"],
    ['{"feature_directory":""}', "an empty value"],
    ['{"feature_directory":42}', "a value that is not a string"],
    ['{"feature_directory":"specs/absent"}', "a directory with no tasks.md"],
    ["[]", "a JSON array, not an object"],
    ["null", "JSON null"],
  ];
  for (const [content, why] of cases) {
    withWs({ ".specify/feature.json": content }, (w) => {
      assert.equal(specOfTheFeatureJson(w.directory), undefined, why);
      assert.equal(hasAFeatureJson(w.directory), true, why);
    });
  }
  // And the forms that DO answer: a relative value against the workspace, and
  // an absolute one.
  withWs(
    {
      ".specify/feature.json": '{"feature_directory":"specs/alpha"}',
      "specs/alpha/tasks.md": TASKS,
    },
    (w) => {
      assert.equal(specOfTheFeatureJson(w.directory), w.at("specs/alpha/tasks.md"));
    },
  );
  withWs({ "specs/alpha/tasks.md": TASKS }, (w) => {
    mkdirSync(w.at(".specify"), { recursive: true });
    writeFileSync(
      w.at(".specify/feature.json"),
      JSON.stringify({ feature_directory: w.at("specs/alpha") }),
    );
    assert.equal(specOfTheFeatureJson(w.directory), w.at("specs/alpha/tasks.md"));
  });
});

test("T014: one candidate is used; several with no feature select nothing", () => {
  withWs({ "specs/alpha/tasks.md": TASKS }, (w) => {
    const only = resolveSpec({ workspace: w.directory });
    assert.ok(only.resolved && only.step === 3);
  });
  withWs({ "openspec/changes/add-x/tasks.md": TASKS }, (w) => {
    const only = resolveSpec({ workspace: w.directory });
    assert.ok(only.resolved && /add-x/.test(only.path), "an OpenSpec candidate counts too");
    assert.equal(candidatesOf(w.directory)[0]?.kind, "openspec");
  });
  // A directory under `specs/` with no `tasks.md` is no candidate at all.
  withWs({ "specs/alpha/tasks.md": TASKS, "specs/beta/plan.md": "x" }, (w) => {
    assert.equal(candidatesOf(w.directory).length, 1);
    assert.ok(resolveSpec({ workspace: w.directory }).resolved);
  });
});

test("T014: the ambiguity listing names every candidate and two commands each", () => {
  withWs({ "specs/alpha/tasks.md": TASKS, "openspec/changes/add-x/tasks.md": TASKS }, (w) => {
    const found = candidatesOf(w.directory);
    const lines = ambiguousCandidateLines(w.directory, found);
    assert.equal(lines.length, 1 + found.length * 3);
    for (const candidate of found) {
      const [withSpecs, withFeature] = disambiguatingCommands(w.directory, candidate);
      assert.ok(lines.includes(`    ${withSpecs}`), withSpecs);
      assert.ok(lines.includes(`    ${withFeature}`), withFeature);
      assert.ok(withSpecs.includes(`-w ${w.directory}`), "the command names the workspace");
      assert.ok(withFeature.endsWith(candidate.parentName));
    }
    // And the failure record carries them unchanged.
    const resolution = resolveSpec({ workspace: w.directory });
    assert.ok(!resolution.resolved);
    if (!resolution.resolved) {
      assert.deepEqual([...resolution.failure.lines], [...lines]);
      assert.equal(resolution.failure.exitCode, EXIT_OF_A_FAILED_RESOLUTION);
      assert.ok(RESOLUTION_REASON_KINDS.includes(resolution.failure.reason));
      assert.equal(resolution.failure.candidates.length, 2);
    }
  });
});

test("T014: the `tried:` list holds the four locations of F104-FR-004", () => {
  assert.deepEqual(
    [...TRIED_LOCATIONS],
    [
      "SPECS.md",
      ".specify/feature.json → feature_directory/tasks.md",
      "specs/*/tasks.md",
      "openspec/changes/*/tasks.md",
    ],
  );
});

test("T014: the canonical path survives a relative workspace and a `..` segment", () => {
  withWs({ "specs/alpha/tasks.md": TASKS }, (w) => {
    const viaDots = join(w.directory, "specs", "beta", "..", "alpha", "tasks.md");
    assert.equal(canonicalSpecPath(viaDots), w.at("specs/alpha/tasks.md"));
    // A path that cannot be resolved at all comes back absolute, not thrown.
    const absent = join(w.directory, "no", "such", "dir", "tasks.md");
    assert.equal(canonicalSpecPath(absent), absent);
  });
});
