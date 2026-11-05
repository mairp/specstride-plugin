/**
 * T017 — unit tests of the four caller errors of F104-FR-018.
 *
 * What is under test is that each failure has ONE kind, that the kind is a
 * member of row 99 of annex X §X.6, that every one maps to the result code 3,
 * and that the two look-alike texts of F104-FR-018 and F104-FR-015 differ.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CALLER_FAILURES,
  CRITIC_FEATURE_ORDER,
  IS_A_FIELD_OF_A_RESULT_RECORD,
  KIND_OF_A_FAILURE,
  PhaseNotFoundError,
  RESULT_CODE_OF_A_CALLER_ERROR,
  SpecCallerError,
  SpecsNotFoundError,
  UnknownFormatError,
  UnreadableSpecError,
  callerSpecsNotFound,
  criticFeatureSlug,
  isACallerError,
  operatingSystemMessage,
  resultCodeOf,
  specModuleNotFound,
} from "../src/errors.ts";
import { errorsOfASpecFormatAdapter } from "../src/model.ts";

test("T017: the four failures of F104-FR-018, each with one kind of row 99", () => {
  assert.equal(CALLER_FAILURES.length, 4);
  for (const failure of CALLER_FAILURES) {
    const kind = KIND_OF_A_FAILURE[failure];
    assert.ok(
      errorsOfASpecFormatAdapter.members.includes(kind),
      `${failure} → ${kind} is a member of "${errorsOfASpecFormatAdapter.name}"`,
    );
  }
});

test("T017: every caller error carries the result code 3 and nothing else", () => {
  const errors = [
    new SpecsNotFoundError("/w/a.md"),
    new PhaseNotFoundError(3, "/w/a.md"),
    new UnknownFormatError("yaml", ["native"]),
    new UnreadableSpecError("/w/a.md", new Error("EACCES: permission denied")),
  ];
  assert.equal(errors.length, CALLER_FAILURES.length, "one error class per failure");
  assert.deepEqual(errors.map((error) => error.failure).sort(), [...CALLER_FAILURES].sort());
  for (const error of errors) {
    assert.ok(error instanceof SpecCallerError, error.name);
    assert.ok(error instanceof Error, error.name);
    assert.equal(error.resultCode, RESULT_CODE_OF_A_CALLER_ERROR);
    assert.equal(resultCodeOf(error), 3);
    assert.equal(isACallerError(error), true);
    assert.equal(KIND_OF_A_FAILURE[error.failure], error.kind);
    assert.ok(error.message.length > 0);
    // LR-6: a field of a record, so no exit code and no stream of its own.
    assert.ok(!("exitCode" in error));
    assert.ok(!("stream" in error));
  }
  assert.equal(IS_A_FIELD_OF_A_RESULT_RECORD, true);
});

test("T017: the critic's text and the spec module's text are not the same", () => {
  // F104-FR-018 says so in as many words; this measures it.
  assert.equal(callerSpecsNotFound("/w/a.md"), "specs not found: /w/a.md");
  assert.equal(specModuleNotFound("/w/a.md"), "spec not found: /w/a.md");
  assert.notEqual(callerSpecsNotFound("/w/a.md"), specModuleNotFound("/w/a.md"));
  // Neither is a prefix of the other read as a whole line, so a consumer
  // matching on the start of the line cannot confuse them.
  assert.ok(!callerSpecsNotFound("/w/a.md").startsWith(specModuleNotFound("")));
});

test("T017: the operating system's message is carried through as it came", () => {
  const error = new UnreadableSpecError("/w/a.md", new Error("EISDIR: illegal operation"));
  assert.equal(error.message, "spec: EISDIR: illegal operation");
  assert.equal(error.operatingSystemError, "EISDIR: illegal operation");
  assert.equal(error.path, "/w/a.md");
  assert.ok(error.cause instanceof Error);
  // A cause that is not an `Error` is still reported, never swallowed.
  assert.equal(operatingSystemMessage("plain string"), "plain string");
  assert.equal(new UnreadableSpecError("/w/a.md", "boom").message, "spec: boom");
});

test("T017: the critic's feature slug follows the order of F104-FR-018", () => {
  assert.deepEqual([...CRITIC_FEATURE_ORDER], ["--feature", "spec.feature", "the spec location"]);
  // The flag wins over the key; the key wins over the location; the location
  // wins over `default`.
  assert.deepEqual(
    { ...criticFeatureSlug({ featureFlag: "a", featureKey: "b" }) },
    {
      slug: "a",
      source: "explicit",
    },
  );
  assert.deepEqual(
    { ...criticFeatureSlug({ featureKey: "b" }) },
    {
      slug: "b",
      source: "explicit",
    },
  );
  assert.deepEqual(
    { ...criticFeatureSlug({ specPath: "/w/openspec/changes/add-x/tasks.md" }) },
    { slug: "add-x", source: "openspec-change" },
  );
  assert.deepEqual({ ...criticFeatureSlug({}) }, { slug: "default", source: "default" });
  // An EMPTY flag is no flag, and the key is read instead.
  assert.equal(criticFeatureSlug({ featureFlag: "", featureKey: "b" }).slug, "b");
});

test("T017: an unknown-format error never guesses and lists the registry in order", () => {
  const error = new UnknownFormatError("openspec-changes", [
    "native",
    "speckit-tasks",
    "openspec-change",
  ]);
  assert.equal(
    error.message,
    "spec: unknown spec format: openspec-changes (native, speckit-tasks, openspec-change)",
  );
  assert.equal(error.value, "openspec-changes");
  assert.deepEqual([...error.registered], ["native", "speckit-tasks", "openspec-change"]);
  // The list is a copy: a caller cannot change the registry through the error.
  assert.throws(() => (error.registered as string[]).push("x"));
});
