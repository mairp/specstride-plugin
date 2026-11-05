/**
 * T110 — own test CT-101-33: a planted CANARY secret in the reply of the
 * critic, in the reply of the diagnostician and in the error message of the
 * harness reaches NO line of the engine log, NO halt banner, NO field of an
 * event and NO span; with the redactor unavailable the mark of dropped
 * content stands in its place and the verdict and the counts are unchanged;
 * and no module of this feature redacts.
 *
 * proves: F101-FR-052.
 * fixtures: FX-02 and FX-08, port side only, with a canary in the reply of the
 * stub critic (and FX-03 and FX-06, whose halt banner and failed call carry
 * the other two texts the requirement names).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INGRESS_REQUIREMENT_OF_FEATURE_100,
  MARK_OF_DROPPED_CONTENT,
  OUTSIDE_TEXT_KINDS,
  PLACES_THAT_NEED_THE_INGRESS,
  THIS_FEATURE_REDACTS,
  BANNER_SECTIONS_THAT_NEED_THE_INGRESS,
  fatalThroughTheIngress,
  isTheMarkOfDroppedContent,
  throughTheIngress,
  warningThroughTheIngress,
  type Ingress,
} from "../../src/gate/lines.ts";
import {
  FIELDS_THAT_CARRY_AN_EXCERPT,
  KIND_OF_THE_FIELD,
  SPAN_ATTRIBUTES_THAT_CARRY_AN_EXCERPT,
  dataThroughTheIngress,
  emitThroughTheIngress,
  spanAttributesThroughTheIngress,
} from "../../src/gate/events.ts";
import { haltBannerThroughTheIngress } from "../../src/gate/halts.ts";
import { MARK_WHEN_THE_REDACTOR_CANNOT_RUN } from "@specstride/contracts/ep/event-sink";
import { marksOfDroppedContent } from "../../../contracts/src/enums/sets-110-119.ts";
import {
  CANARY,
  runFixture,
  FX_02_CANARY,
  FX_02_CANARY_REDACTOR_DOWN,
  FX_03_CANARY,
  FX_03_CANARY_REDACTOR_DOWN,
  FX_06_CANARY,
  FX_08_CANARY,
  FX_08_CANARY_REDACTOR_DOWN,
} from "./run-harness.ts";

/** An ingress that redacts the canary, as feature 111's redactor would. */
const REDACTING: Ingress = {
  enter: (text) => ({ text: text.split(CANARY).join("[redacted]") }),
};

/** An ingress whose redactor cannot run: the content is DROPPED (F100-FR-205). */
const DOWN: Ingress = {
  enter: () => ({ text: "", dropped: true, mark: MARK_OF_DROPPED_CONTENT }),
};

/** An ingress that THROWS; the mark must still stand, never the raw text. */
const BROKEN: Ingress = {
  enter: () => {
    throw new Error("the pattern set is invalid");
  },
};

test("CT-101-33: the three texts, the four places, and the mark of feature 100", () => {
  assert.equal(INGRESS_REQUIREMENT_OF_FEATURE_100, "F100-FR-009");
  assert.deepEqual(
    [...OUTSIDE_TEXT_KINDS],
    ["critic-reply", "diagnostician-reply", "harness-error", "harness-warning"],
  );
  assert.deepEqual(
    [...PLACES_THAT_NEED_THE_INGRESS],
    ["the engine log", "the halt banner", "a field of an event", "a span"],
  );
  // The mark belongs to feature 100 and is imported, never written here.
  assert.equal(MARK_OF_DROPPED_CONTENT, MARK_WHEN_THE_REDACTOR_CANNOT_RUN);
  assert.equal(isTheMarkOfDroppedContent(MARK_OF_DROPPED_CONTENT), true);
  // And the reason of a drop is a member of row 90 of annex X §X.6.
  assert.equal(marksOfDroppedContent.members.includes("redactor-unavailable"), true);
  // The fields and the span attributes that carry an excerpt.
  assert.deepEqual([...FIELDS_THAT_CARRY_AN_EXCERPT], ["reason", "error", "note"]);
  assert.deepEqual([...SPAN_ATTRIBUTES_THAT_CARRY_AN_EXCERPT], ["reason", "error"]);
  for (const field of FIELDS_THAT_CARRY_AN_EXCERPT) {
    assert.equal(
      (OUTSIDE_TEXT_KINDS as readonly string[]).includes(KIND_OF_THE_FIELD[field] ?? ""),
      true,
      field,
    );
  }
  assert.deepEqual(
    [...BANNER_SECTIONS_THAT_NEED_THE_INGRESS],
    ["latest feedback", "diagnostician hint", "acceleration note", "rejection trail:"],
  );
});

test("CT-101-33: the three texts pass the ingress, and a drop leaves the mark", () => {
  const reply = `T001 is not met. The key is ${CANARY}.`;
  assert.equal(throughTheIngress(REDACTING, reply, "critic-reply").includes(CANARY), false);
  assert.equal(
    throughTheIngress(REDACTING, `the hint: ${CANARY}`, "diagnostician-reply").includes(CANARY),
    false,
  );
  assert.equal(
    fatalThroughTheIngress(REDACTING, `HTTP 401 with ${CANARY}`).includes(CANARY),
    false,
  );
  assert.equal(
    warningThroughTheIngress(REDACTING, `HTTP 429 with ${CANARY}`).includes(CANARY),
    false,
  );
  // A redactor that cannot run: the content is DROPPED and the mark stands.
  assert.equal(throughTheIngress(DOWN, reply, "critic-reply"), MARK_OF_DROPPED_CONTENT);
  assert.equal(fatalThroughTheIngress(DOWN, reply), `critic: FATAL: ${MARK_OF_DROPPED_CONTENT}`);
  // An ingress that THROWS may never let the raw text through either.
  assert.equal(throughTheIngress(BROKEN, reply, "critic-reply"), MARK_OF_DROPPED_CONTENT);
});

test("CT-101-33: the fields of an event and the attributes of a span pass the ingress", () => {
  const data = { phase: 1, attempt: 2, reason: `not met: ${CANARY}`, error: `HTTP 401 ${CANARY}` };
  const passed = dataThroughTheIngress(data, REDACTING);
  assert.equal(JSON.stringify(passed).includes(CANARY), false);
  // The fields that carry no excerpt are untouched.
  assert.equal(passed["phase"], 1);
  assert.equal(passed["attempt"], 2);
  // With the redactor down the mark stands in the field, and the event is
  // still emitted: dropping it would lose the record of the rejection.
  const dropped = dataThroughTheIngress(data, DOWN);
  assert.equal(dropped["reason"], MARK_OF_DROPPED_CONTENT);
  assert.equal(dropped["error"], MARK_OF_DROPPED_CONTENT);
  const envelope = emitThroughTheIngress({
    type: "verdict.recorded",
    seq: 1,
    ts: "2026-10-03T00:00:00.000Z",
    identity: { runId: "r", launchId: "l" },
    data,
    ingress: REDACTING,
  });
  assert.equal(JSON.stringify(envelope).includes(CANARY), false);
  // The span of a critic-class call.
  const span = spanAttributesThroughTheIngress(
    { name: "critic.call", reason: `not met: ${CANARY}`, error: `HTTP 401 ${CANARY}` },
    REDACTING,
  );
  assert.equal(JSON.stringify(span).includes(CANARY), false);
  assert.equal(
    JSON.stringify(spanAttributesThroughTheIngress({ reason: `x ${CANARY}` }, DOWN)).includes(
      CANARY,
    ),
    false,
  );
});

test("CT-101-33: the halt banner passes every text that comes from outside", () => {
  const banner = haltBannerThroughTheIngress(
    {
      phase: 1,
      maxRejects: 3,
      latestEvidence: `evidence with ${CANARY}`,
      latestFeedback: `T001 is not met; the key is ${CANARY}`,
      diagnosticianHint: `the hint names ${CANARY}`,
      accelerationNote: `the note names ${CANARY}`,
      attemptHistory: [{ ordinal: 1, outcome: "rejected" }],
      rejectionTrail: [{ ordinal: 1, gist: `T001 is not met; ${CANARY}` }],
    },
    REDACTING,
  );
  assert.equal(banner.join("\n").includes(CANARY), false, banner.join("\n"));
  // With the redactor down the mark stands in each of those places.
  const down = haltBannerThroughTheIngress(
    {
      phase: 1,
      maxRejects: 3,
      latestEvidence: `evidence with ${CANARY}`,
      latestFeedback: `T001 is not met; ${CANARY}`,
      diagnosticianHint: `the hint names ${CANARY}`,
      accelerationNote: `the note names ${CANARY}`,
      attemptHistory: [{ ordinal: 1, outcome: "rejected" }],
      rejectionTrail: [{ ordinal: 1, gist: `T001 ${CANARY}` }],
    },
    DOWN,
  );
  assert.equal(down.join("\n").includes(CANARY), false);
  assert.ok(down.includes(`latest feedback: ${MARK_OF_DROPPED_CONTENT}`), down.join("\n"));
  assert.ok(down.includes(`diagnostician hint: ${MARK_OF_DROPPED_CONTENT}`));
  assert.ok(down.includes(`acceleration note: ${MARK_OF_DROPPED_CONTENT}`));
});

test("CT-101-33 (FX-02, FX-03, FX-06, FX-08): the canary reaches no line, no banner, no event and no span", async () => {
  for (const set of [FX_02_CANARY, FX_03_CANARY, FX_06_CANARY, FX_08_CANARY]) {
    const run = await runFixture(set);
    const where = `${set.family}/${set.scenario}`;
    // The ingress DID see the canary: the test would be empty otherwise.
    assert.equal(
      run.ingressCalls.some((call) => call.text.includes(CANARY)),
      true,
      `${where}: the ingress was handed the text`,
    );
    for (const line of run.lines) {
      assert.equal(line.includes(CANARY), false, `${where}: a line of the engine log: ${line}`);
    }
    for (const line of run.warnings) {
      assert.equal(line.includes(CANARY), false, `${where}: a warning: ${line}`);
    }
    for (const line of run.haltBanner) {
      assert.equal(line.includes(CANARY), false, `${where}: the halt banner: ${line}`);
    }
    for (const event of run.events) {
      assert.equal(
        JSON.stringify(event.data).includes(CANARY),
        false,
        `${where}: a field of ${event.type}`,
      );
    }
    for (const span of run.spans) {
      assert.equal(JSON.stringify(span).includes(CANARY), false, `${where}: a span`);
    }
  }
});

test("CT-101-33: with the redactor unavailable the verdict and the counts are unchanged", async () => {
  const pairs: readonly (readonly [typeof FX_02_CANARY, typeof FX_02_CANARY])[] = [
    [FX_02_CANARY, FX_02_CANARY_REDACTOR_DOWN],
    [FX_03_CANARY, FX_03_CANARY_REDACTOR_DOWN],
    [FX_08_CANARY, FX_08_CANARY_REDACTOR_DOWN],
  ];
  for (const [withRedactor, withoutIt] of pairs) {
    const a = await runFixture(withRedactor);
    const b = await runFixture(withoutIt);
    const where = `${withRedactor.family}/${withRedactor.scenario}`;
    // The VERDICT of every phase attempt is the same.
    assert.deepEqual(
      b.parses.map((entry) => [entry.phase, entry.ordinal, entry.parsed.result]),
      a.parses.map((entry) => [entry.phase, entry.ordinal, entry.parsed.result]),
      `${where}: the verdicts`,
    );
    // The COUNTS are the same, and so is the end of the run.
    assert.deepEqual([...b.counts.entries()], [...a.counts.entries()], `${where}: the counts`);
    assert.equal(b.exitCode, a.exitCode, `${where}: the exit code`);
    assert.equal(b.stopReason, a.stopReason, `${where}: the stop reason`);
    assert.deepEqual(b.stopFields, a.stopFields, `${where}: the as-is fields of the stop`);
    // And the MARK stands where the text would have been.
    const reasons = b.events
      .filter((event) => typeof event.data["reason"] === "string")
      .map((event) => event.data["reason"]);
    assert.ok(reasons.length > 0, `${where}: an event with a \`reason\``);
    for (const reason of reasons) {
      assert.equal(reason, MARK_OF_DROPPED_CONTENT, `${where}: the mark stands in \`reason\``);
    }
    for (const span of b.spans) {
      if (typeof span["reason"] !== "string") continue;
      assert.equal(span["reason"], MARK_OF_DROPPED_CONTENT, `${where}: the mark in the span`);
    }
    if (b.haltBanner.length > 0) {
      assert.ok(
        b.haltBanner.includes(`latest feedback: ${MARK_OF_DROPPED_CONTENT}`),
        `${where}: the mark in the banner`,
      );
    }
  }
});

/* ------------------------------------------------------------------ *
 * The static test: no module of this feature redacts.
 * ------------------------------------------------------------------ */

/** The module groups of feature 101 under `packages/core/src/` (T001). */
const MODULE_GROUPS = ["engine", "gate", "approval", "recovery", "post-approval"] as const;

const CORE_SRC = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), "src");

function sourcesOfTheFeature(): readonly { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const group of MODULE_GROUPS) {
    const directory = join(CORE_SRC, group);
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      if (!statSync(path).isFile() || !name.endsWith(".ts")) continue;
      out.push({ path: `packages/core/src/${group}/${name}`, text: readFileSync(path, "utf8") });
    }
  }
  return out;
}

test("CT-101-33 (static): no module of this feature holds a redaction of its own", () => {
  assert.equal(THIS_FEATURE_REDACTS, false);
  const sources = sourcesOfTheFeature();
  assert.ok(
    sources.length >= 10,
    `the sources of the feature were found: ${String(sources.length)}`,
  );
  for (const source of sources) {
    // It calls no redactor and implements none.
    assert.doesNotMatch(source.text, /\.redact\s*\(/, `${source.path} calls a redactor`);
    assert.doesNotMatch(
      source.text,
      /from "@specstride\/kernel\/redactor"/,
      `${source.path} imports the redactor of the kernel`,
    );
    assert.doesNotMatch(
      source.text,
      /redactionPattern|patternSet|RedactionPatternSet/,
      `${source.path} names a pattern set`,
    );
    // It holds no replacement of its own: no literal mask and no `register`
    // of a secret value.
    assert.doesNotMatch(
      source.text,
      /\[REDACTED\]|\*{4,}|\bregister\s*\(\s*secret/i,
      `${source.path} holds a replacement of its own`,
    );
  }
});

test("CT-101-33 (static): the ONE place that hands outside text over, and the three that call it", () => {
  const sources = sourcesOfTheFeature();
  const byPath = new Map(sources.map((source) => [source.path, source.text]));
  // `lines.ts` declares the port and the one helper (T112).
  const lines = byPath.get("packages/core/src/gate/lines.ts") ?? "";
  assert.match(lines, /export function throughTheIngress/);
  assert.match(lines, /export type Ingress/);
  // `events.ts` and `halts.ts` call it FROM there and declare no second one.
  for (const path of ["packages/core/src/gate/events.ts", "packages/core/src/gate/halts.ts"]) {
    const text = byPath.get(path) ?? "";
    assert.match(text, /throughTheIngress/, path);
    assert.match(text, /from "\.\/lines\.ts"/, path);
    assert.doesNotMatch(text, /export function throughTheIngress/, `${path} declares a second one`);
  }
  // No other module of the feature declares an ingress of its own.
  for (const source of sources) {
    if (source.path === "packages/core/src/gate/lines.ts") continue;
    assert.doesNotMatch(
      source.text,
      /export (function throughTheIngress|type Ingress =)/,
      `${source.path} declares an ingress of its own`,
    );
  }
});
