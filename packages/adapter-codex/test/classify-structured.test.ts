/**
 * T053 / CT-131-34 — no confidence `structured` while capture 1 has not
 * landed (F131-FR-034).
 *
 * The adapter MUST NOT report the confidence `structured` for a Codex quota
 * signal until capture 1 has recorded a structured quota record, or shown
 * that none exists. While the capture is not made (`fixtures/capture-1/
 * capture.json` says so), the shipped classifier carries no structured
 * entry, so no classification of this adapter can carry the confidence.
 * The entries are DATA: loading a different classifier file changes them
 * with no change of code — which is how the capture closes the gap when it
 * lands. The case that replays the captured record is a skip, with its
 * reason, until the fixture exists — never a pass (F131-FR-037).
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { classifyFailure, loadClassifier } from "../src/login-text.ts";

const CAPTURE_1 = new URL("../fixtures/capture-1/capture.json", import.meta.url);
const CAPTURE_1_STREAM = new URL("../fixtures/capture-1/stream.jsonl", import.meta.url);
const SHIPPED = loadClassifier();

function captureMade(): boolean {
  const capture = JSON.parse(readFileSync(CAPTURE_1, "utf8")) as {
    result?: string;
    made?: boolean;
    streamFixture?: string | null;
  };
  return (
    capture.made === true || (capture.streamFixture !== null && capture.streamFixture !== undefined)
  );
}

test("CT-131-34: capture 1 is not made, and the shipped classifier carries no structured entry", () => {
  assert.equal(captureMade(), false, "capture 1 landed: this test's premise changed");
  for (const entry of SHIPPED.entries) {
    assert.notEqual(
      entry.confidence,
      "structured",
      `entry ${entry.id} reports a structured confidence without the capture`,
    );
  }
  assert.match(SHIPPED.structured, /none until capture 1/);
});

test("CT-131-34: no classification of this adapter carries the confidence structured", () => {
  const cases: Parameters<typeof classifyFailure>[0][] = [
    { errorText: "You've hit your usage limit. Try again in 53m." },
    { stderr: "usage limit reached" },
    { reply: "Try again in 4h" },
    { status: 429, bodyCode: null },
    { status: 429, bodyCode: "insufficient_quota" },
    { status: 401, bodyCode: null },
    { status: 503, bodyCode: "undocumented", errorText: "boom" },
  ];
  for (const facts of cases) {
    const classification = classifyFailure(facts, SHIPPED);
    assert.notEqual(classification.confidence, "structured");
    // Until the capture, the classification is by text and by status only.
    assert.ok(["text", "status"].includes(classification.confidence));
  }
});

test("CT-131-34: the entries change as data — a structured entry loads with no change of code", () => {
  // The same interpreter, a classifier file that the capture would write:
  // only the data differs, the code of this adapter is untouched.
  const withStructured = {
    ...SHIPPED,
    structured: "capture 1 recorded a structured quota record",
    entries: [
      {
        id: "login-limit-structured",
        tier: 1,
        source: ["stream-error-record"],
        match: { bodyCode: "usage_limit_reached" },
        class: "quota_window",
        confidence: "structured",
        retryable: true,
        resetsAt: "field resets_at",
      },
      ...SHIPPED.entries,
    ],
  };
  const dir = mkdtempSync(join(tmpdir(), "codex-classifier-"));
  const path = join(dir, "classifier.json");
  writeFileSync(path, JSON.stringify(withStructured));
  const loaded = loadClassifier(path);
  const classification = classifyFailure({ status: 0, bodyCode: "usage_limit_reached" }, loaded);
  assert.equal(classification.class, "quota_window");
  assert.equal(classification.confidence, "structured");
});

const fixtureExists = existsSync(CAPTURE_1_STREAM);

test(
  "CT-131-34: the captured record replays through the classifier once the fixture exists",
  {
    skip: fixtureExists
      ? false
      : "capture 1 is not made (paid, owner-run): no stream fixture of the login limit exists yet, so there is no captured record to replay (F131-FR-037)",
  },
  () => {
    const lines = readFileSync(CAPTURE_1_STREAM, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
    // The captured record replays as data; the classification carries whatever
    // confidence the capture showed — including `structured` where it saw one.
    const classification = classifyFailure({ errorText: lines.join("\n") }, SHIPPED);
    assert.ok(classification !== null);
  },
);
