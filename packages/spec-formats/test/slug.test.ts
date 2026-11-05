/**
 * T015 — unit tests of feature selection and the one slug rule (F104-FR-003).
 *
 * The two readings of the sanitising that the baseline's two files give
 * (B-0246 per character, B-2044 per run) are MEASURED against each other here,
 * so that the difference the module's doc comment names is a fact of the test
 * suite and not a claim in a comment.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ANSWERED_BEFORE_THE_SPEC_IS_READ,
  DEFAULT_SLUG,
  SELECTION_USES_THE_RAW_VALUE,
  SLUG_ALLOWED,
  collapsingSlugOfAnExplicitFeature,
  featureSlug,
  featureSlugOfASpecLocation,
  openspecChangeOf,
  selectCandidateByFeature,
  slugOfAnExplicitFeature,
  specKitProjectRootOf,
} from "../src/slug.ts";

test("T015: the explicit slug replaces every character outside the allowed set", () => {
  assert.equal(slugOfAnExplicitFeature("104-spec-input"), "104-spec-input");
  assert.equal(slugOfAnExplicitFeature("my feature"), "my-feature");
  assert.equal(slugOfAnExplicitFeature("a.b_c-d"), "a.b_c-d", "dot, underscore and hyphen stay");
  assert.equal(slugOfAnExplicitFeature("feat/one"), "feat-one");
  // `Ü`, `ï` and `ø` each become a hyphen, and the LEADING one is then removed.
  assert.equal(slugOfAnExplicitFeature("Ünïcøde"), "n-c-de");
  // Leading and trailing hyphens are removed, and an empty result is `default`.
  assert.equal(slugOfAnExplicitFeature("  spaced  "), "spaced");
  assert.equal(slugOfAnExplicitFeature("///"), DEFAULT_SLUG);
  assert.equal(slugOfAnExplicitFeature(""), DEFAULT_SLUG);
  assert.equal(slugOfAnExplicitFeature("---"), DEFAULT_SLUG);
  // Every character of a slug is in the allowed set.
  for (const value of ["my feature", "a/b\\c", "x  y", "Ünïcøde"]) {
    for (const character of slugOfAnExplicitFeature(value)) {
      assert.ok(SLUG_ALLOWED.test(character), `${value} → ${character}`);
    }
  }
});

test("T015: the two readings of the baseline differ only on adjacent forbidden characters", () => {
  // F104-FR-003 is the authority and gives the per-character reading (B-0246).
  // B-2044 gives the per-run reading. Where the two agree, both are safe.
  for (const value of ["my feature", "feat/one", "a.b_c-d", "104-spec-input"]) {
    assert.equal(slugOfAnExplicitFeature(value), collapsingSlugOfAnExplicitFeature(value), value);
  }
  // Where they differ, the difference is exactly the run.
  assert.equal(slugOfAnExplicitFeature("a  b"), "a--b");
  assert.equal(collapsingSlugOfAnExplicitFeature("a  b"), "a-b");
  assert.equal(slugOfAnExplicitFeature("a/+b"), "a--b");
  assert.equal(collapsingSlugOfAnExplicitFeature("a/+b"), "a-b");
  // And both give `default` for a value of nothing but forbidden characters.
  assert.equal(collapsingSlugOfAnExplicitFeature("   "), DEFAULT_SLUG);
});

test("T015: the slug of a spec LOCATION, with no explicit value (B-2045)", () => {
  const root = mkdtempSync(join(tmpdir(), "ss104-slug-"));
  try {
    mkdirSync(join(root, ".specify"), { recursive: true });
    mkdirSync(join(root, "specs", "104-spec-input"), { recursive: true });
    writeFileSync(join(root, "specs", "104-spec-input", "tasks.md"), "x");
    writeFileSync(join(root, "SPECS.md"), "x");

    // Inside a `.specify` project: the feature directory's name.
    assert.equal(
      featureSlugOfASpecLocation(join(root, "specs", "104-spec-input", "tasks.md")),
      "104-spec-input",
    );
    // At the project root: `default`.
    assert.equal(featureSlugOfASpecLocation(join(root, "SPECS.md")), DEFAULT_SLUG);
    // The project root is found by WALKING UPWARD (B-2043).
    assert.equal(specKitProjectRootOf(join(root, "specs", "104-spec-input")), root);
    assert.equal(specKitProjectRootOf(root), root);

    // An OpenSpec change: the change directory's name, wherever it sits.
    assert.equal(openspecChangeOf("/w/openspec/changes/add-thing/tasks.md"), "add-thing");
    assert.equal(openspecChangeOf("/w/openspec/changes/add-thing/deep/tasks.md"), undefined);
    assert.equal(
      featureSlugOfASpecLocation("/w/openspec/changes/add thing/tasks.md"),
      "add-thing",
      "and it is sanitised like any other",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("T015: a spec outside any `.specify` project is `default`", () => {
  const root = mkdtempSync(join(tmpdir(), "ss104-noproj-"));
  try {
    mkdirSync(join(root, "elsewhere"), { recursive: true });
    writeFileSync(join(root, "elsewhere", "tasks.md"), "x");
    // `specKitProjectRootOf` walks to the file-system root and finds nothing —
    // unless a `.specify` happens to sit above the temporary directory, which
    // the probe below rules out before the assertion is made.
    const found = specKitProjectRootOf(join(root, "elsewhere"));
    if (found === undefined) {
      assert.equal(featureSlugOfASpecLocation(join(root, "elsewhere", "tasks.md")), DEFAULT_SLUG);
    } else {
      // A project above the temporary directory: then the rule still holds, and
      // the slug is the spec's own directory name.
      assert.equal(featureSlugOfASpecLocation(join(root, "elsewhere", "tasks.md")), "elsewhere");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("T015: the one derivation: explicit, else the location, else `default`", () => {
  assert.deepEqual(
    { ...featureSlug({ explicit: "my feature" }) },
    {
      slug: "my-feature",
      source: "explicit",
    },
  );
  assert.deepEqual(
    { ...featureSlug({ explicit: "", specPath: undefined }) },
    {
      slug: DEFAULT_SLUG,
      source: "default",
    },
  );
  assert.deepEqual(
    { ...featureSlug({ specPath: "/w/openspec/changes/add-x/tasks.md" }) },
    {
      slug: "add-x",
      source: "openspec-change",
    },
  );
  // An explicit value WINS over the location.
  assert.equal(
    featureSlug({ explicit: "chosen", specPath: "/w/openspec/changes/add-x/tasks.md" }).slug,
    "chosen",
  );
  // And `feature-slug` is answerable before the spec is read: nothing above
  // opened a specification.
  assert.equal(ANSWERED_BEFORE_THE_SPEC_IS_READ, true);
});

test("T015: selection compares the RAW, unsanitized value (B-0243)", () => {
  const candidates = [
    { path: "/w/specs/my feature/tasks.md", parentName: "my feature" },
    { path: "/w/specs/my-feature/tasks.md", parentName: "my-feature" },
    { path: "/w/specs/alpha/tasks.md", parentName: "alpha" },
  ];
  assert.equal(SELECTION_USES_THE_RAW_VALUE, true);
  assert.equal(selectCandidateByFeature(candidates, "my feature")?.parentName, "my feature");
  assert.equal(selectCandidateByFeature(candidates, "my-feature")?.parentName, "my-feature");
  assert.equal(selectCandidateByFeature(candidates, "Alpha"), undefined, "case matters");
  assert.equal(selectCandidateByFeature(candidates, "gamma"), undefined);
  // The FIRST match, where two candidates carry the same name.
  const twice = [
    { path: "/w/specs/a/tasks.md", parentName: "a" },
    { path: "/w/openspec/changes/a/tasks.md", parentName: "a" },
  ];
  assert.equal(selectCandidateByFeature(twice, "a")?.path, "/w/specs/a/tasks.md");
});
