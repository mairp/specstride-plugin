/**
 * T003 — the closed sets of the spec as data (F119-FR-030).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  FAILURE_REASONS,
  FIX_TEXTS,
  LINE_LABELS,
  RECORD_VERBS,
  schemaIdOf,
  isFailureReason,
  fixTextOf,
} from "../../src/output/closed-sets.ts";

test("T003: the reasons are exactly the closed set of F119-FR-030", () => {
  assert.deepEqual(
    [...FAILURE_REASONS],
    [
      "no-state",
      "no-feature",
      "no-log",
      "no-events",
      "no-verdicts",
      "no-verdict-for-phase",
      "no-feedback",
      "no-spec",
      "spec-invalid",
      "usage",
      "unknown-subcommand",
      "internal",
    ],
  );
});

test("T003: every reason has exactly one fixed fix text", () => {
  for (const reason of FAILURE_REASONS) {
    const fix = FIX_TEXTS[reason];
    assert.equal(typeof fix, "string");
    assert.ok(fix.length > 0, `${reason} has a fix text`);
    assert.equal(fixTextOf(reason), fix);
  }
});

test("T003: membership and refusal outside the set", () => {
  assert.equal(isFailureReason("no-state"), true);
  assert.equal(isFailureReason("made-up-reason"), false);
});

test("T003: the labels and the schema ids of the inspection verbs", () => {
  assert.equal(LINE_LABELS.phases, "[SPECSTRIDE-PHASES]");
  assert.equal(LINE_LABELS.tail, "[SPECSTRIDE-TAIL]");
  assert.equal(schemaIdOf("events"), "specstride.inspect.events/1");
  assert.deepEqual([...RECORD_VERBS], ["phases", "feedback", "verdicts", "events", "tail"]);
});
