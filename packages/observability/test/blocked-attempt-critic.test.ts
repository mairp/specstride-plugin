/**
 * T023 — CT-111-109, CT-111-110 and CT-111-111: blocked, the units of work,
 * and the critic-class call (F111-FR-009, F111-FR-010, F111-FR-011).
 *
 * F111-FR-009: *A run that needs a human MUST be told by `blocked`, with a
 * reason of the six of annex E §E.2, what is needed, and, for
 * `source-changed`, which of `spec`, `plan` or `tasks` changed and its logical
 * name. `unblocked` MUST carry who answered, in the field `by`, and
 * `latencyMs` ... `by` is no closed set: it is kept as text and is a marked
 * free-text field; an answer through `resume` writes `operator`. `answerRef`
 * MUST be null where no record of an answer exists. A `blocked` written for a
 * refused `resume` MUST be marked `synthesized` ...*
 *
 * F111-FR-010: *... `attempt.ended` MUST carry `endCause`, a member of ...
 * (row 272) and `workProducts`, each with path, hash, whether kept, and where
 * carried. `phase.ended` MUST carry `outcome`, a member of ... (row 273).
 * `task.planned` and `task.ticked` MUST be written per task ... `run.launched`
 * MUST carry the reason of its launch ... `counters.reset` MUST be written
 * when `--reset-counts` is used.*
 *
 * F111-FR-011: *A critic-class call MUST be told by `critic.selected`
 * (harness, model, why, the result of the diversity test in the field
 * `diversity` ... and the critic-diversity warning in the field
 * `sameModelWarning`, which is true for the results `same-model` and
 * `unverified` and for no other) ... `critic.call` MUST carry the form of the
 * `completion` level in force (`tool-less` or `read-only-tools`) ... The nonce
 * MUST be in no event before its call has returned; afterwards only its hash
 * MUST be recorded.*
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { closedSet } from "@specstride/contracts/enums/all-sets";
import { BLOCKED_REASONS, SOURCES_COMPARED } from "@specstride/contracts/state/blocked-reasons";
import { CATALOGUE, CATALOGUE_BY_TYPE } from "../src/catalogue/index.ts";
import { checkRefinedData, refinedDataSchemaOf } from "../src/catalogue/types/index.ts";
import {
  BLOCKED_REASON_SOURCE_CHANGED,
  CHANGED_SOURCES,
  RESUME_ANSWERS_AS,
  blockedFindings,
} from "../src/catalogue/types/blocked.ts";
import {
  ATTEMPT_END_CAUSES,
  ATTEMPT_KINDS,
  LAUNCH_REASONS,
  PHASE_OUTCOMES,
  WORK_PRODUCT_FIELDS,
} from "../src/catalogue/types/units.ts";
import {
  COMPLETION_FORMS,
  DIVERSITY_RESULTS,
  NONCE_IS_IN_AN_EVENT_BEFORE_THE_CALL_RETURNS,
  SAME_MODEL_WARNING_FIELD,
  WARNS_FOR,
  criticFindings,
  nonceHash,
  sameModelWarningFor,
} from "../src/catalogue/types/critic.ts";

/* ------------------------------------------------------------------ *
 * CT-111-109 — blocked and unblocked.
 * ------------------------------------------------------------------ */

test("CT-111-109 `blocked` carries a reason of the six of annex E §E.2", () => {
  assert.equal(BLOCKED_REASONS.length, 6, "six reasons, as the annex has them");
  const schema = refinedDataSchemaOf("blocked");
  assert.ok(schema);
  assert.deepEqual(schema.properties.reason?.enum, BLOCKED_REASONS);
  assert.ok(schema.required.includes("reason"));
  assert.ok(schema.required.includes("needs"));
  for (const reason of BLOCKED_REASONS) {
    if (reason === BLOCKED_REASON_SOURCE_CHANGED) continue;
    assert.deepEqual(
      checkRefinedData("blocked", {
        reason,
        needs: "an answer",
        since: "2026-10-01T09:00:00.000Z",
      }),
      [],
      reason,
    );
  }
  assert.ok(
    checkRefinedData("blocked", { reason: "bored", needs: "x" }).some((f) => f.keyword === "enum"),
  );
});

test("CT-111-109 for `source-changed`, `blocked` names WHICH source and its logical name", () => {
  assert.equal(BLOCKED_REASON_SOURCE_CHANGED, "source-changed");
  assert.deepEqual([...CHANGED_SOURCES], ["spec", "plan", "tasks"]);
  assert.deepEqual([...CHANGED_SOURCES], [...SOURCES_COMPARED]);
  const sound = {
    reason: BLOCKED_REASON_SOURCE_CHANGED,
    needs: "the owner decides",
    changedSource: "plan",
    changedRef: "feature:111:plan",
    since: "2026-10-01T09:00:00.000Z",
  };
  assert.deepEqual(checkRefinedData("blocked", sound), []);
  assert.deepEqual(blockedFindings(sound), []);
  const { changedSource: _a, ...withoutWhich } = sound;
  assert.ok(
    blockedFindings(withoutWhich).some((f) => f.includes("changedSource")),
    "a source-changed block says which of spec, plan or tasks changed",
  );
  const { changedRef: _b, ...withoutName } = sound;
  assert.ok(blockedFindings(withoutName).some((f) => f.includes("changedRef")));
  assert.ok(
    checkRefinedData("blocked", { ...sound, changedSource: "readme" }).some(
      (f) => f.keyword === "enum",
    ),
  );
});

test("CT-111-109 `by` of `unblocked` is TEXT and no closed set, and a resume writes `operator`", () => {
  assert.equal(RESUME_ANSWERS_AS, "operator");
  const entry = CATALOGUE_BY_TYPE.get("unblocked");
  assert.ok(entry);
  assert.deepEqual(
    entry.freeTextFields.map((m) => m.field),
    ["by"],
    "`by` is a MARKED free-text field",
  );
  const schema = refinedDataSchemaOf("unblocked");
  assert.ok(schema);
  assert.equal(schema.properties.by?.enum, undefined, "no closed set stands behind `by`");
  assert.ok(schema.required.includes("by"));
  assert.ok(schema.required.includes("latencyMs"));
  for (const by of ["operator", "a person who was passing", "the owner"]) {
    assert.deepEqual(checkRefinedData("unblocked", { by, latencyMs: 90_000, answerRef: null }), []);
  }
  // `answerRef` is null where no record of an answer exists.
  assert.deepEqual(
    checkRefinedData("unblocked", { by: "operator", latencyMs: 1, answerRef: null }),
    [],
  );
  assert.ok(
    checkRefinedData("unblocked", { by: "operator" }).some((f) => f.path.includes("latencyMs")),
  );
});

test("CT-111-109 a `blocked` for a REFUSED resume is marked synthesized", () => {
  const schema = refinedDataSchemaOf("blocked");
  assert.ok(schema);
  assert.ok(Object.hasOwn(schema.properties, "synthesized"));
  assert.deepEqual(
    checkRefinedData("blocked", {
      reason: BLOCKED_REASON_SOURCE_CHANGED,
      needs: "the owner decides",
      changedSource: "spec",
      changedRef: "feature:111:spec",
      synthesized: true,
    }),
    [],
  );
  // And the `run.launched` with the reason `resume` links to it through the
  // ENVELOPE field `cause`, which is no `data` field of any type.
  for (const entry of CATALOGUE) {
    assert.equal(entry.dataFields.includes("cause"), false, entry.type);
  }
});

/* ------------------------------------------------------------------ *
 * CT-111-110 — the units of work.
 * ------------------------------------------------------------------ */

test("CT-111-110 `attempt.started` carries the kind and the strategy", () => {
  assert.deepEqual([...ATTEMPT_KINDS], ["plain", "diagnosed", "accelerated", "bumped"]);
  assert.deepEqual([...ATTEMPT_KINDS], [...(closedSet(9)?.members ?? [])]);
  const schema = refinedDataSchemaOf("attempt.started");
  assert.ok(schema);
  assert.ok(schema.required.includes("kind"));
  assert.ok(schema.required.includes("strategy"));
  assert.deepEqual(
    checkRefinedData("attempt.started", { phase: 3, attempt: 1, kind: "plain", strategy: "micro" }),
    [],
  );
  assert.ok(
    checkRefinedData("attempt.started", {
      phase: 3,
      attempt: 1,
      kind: "hopeful",
      strategy: "micro",
    }).some((f) => f.keyword === "enum"),
  );
});

test("CT-111-110 `endCause` of `attempt.ended` is a member of row 272", () => {
  assert.deepEqual([...ATTEMPT_END_CAUSES], [...(closedSet(272)?.members ?? [])]);
  assert.deepEqual(
    [...ATTEMPT_END_CAUSES],
    [
      "approved",
      "rejected",
      "malformed",
      "verification-failed",
      "no-evidence",
      "budget",
      "blocked",
      "stopped",
      "error",
      "crash",
    ],
  );
  for (const endCause of ATTEMPT_END_CAUSES) {
    assert.deepEqual(
      checkRefinedData("attempt.ended", { phase: 3, attempt: 1, endCause, workProducts: [] }),
      [],
      endCause,
    );
  }
  assert.ok(
    checkRefinedData("attempt.ended", {
      phase: 3,
      attempt: 1,
      endCause: "gave-up",
      workProducts: [],
    }).some((f) => f.keyword === "enum"),
  );
});

test("CT-111-110 `workProducts` each name a path, a hash, whether kept and where carried", () => {
  assert.deepEqual([...WORK_PRODUCT_FIELDS], ["path", "hash", "kept", "carriedInto"]);
  const sound = {
    phase: 3,
    attempt: 1,
    endCause: "rejected",
    workProducts: [
      { path: "src/a.ts", hash: "a".repeat(64), kept: true, carriedInto: "attempt-2" },
      { path: "src/b.ts", hash: "b".repeat(64), kept: false, carriedInto: null },
    ],
  };
  assert.deepEqual(checkRefinedData("attempt.ended", sound), []);
  const missingAField = {
    ...sound,
    workProducts: [{ path: "src/a.ts", hash: "a".repeat(64), kept: true }],
  };
  assert.ok(
    checkRefinedData("attempt.ended", missingAField).some((f) => f.path.includes("carriedInto")),
  );
});

test("CT-111-110 `outcome` of `phase.ended` is a member of row 273", () => {
  assert.deepEqual([...PHASE_OUTCOMES], [...(closedSet(273)?.members ?? [])]);
  assert.deepEqual([...PHASE_OUTCOMES], ["approved", "halted", "blocked", "stopped", "crash"]);
  for (const outcome of PHASE_OUTCOMES) {
    assert.deepEqual(
      checkRefinedData("phase.ended", { phase: 3, attempt: 1, outcome }),
      [],
      outcome,
    );
  }
  assert.ok(
    checkRefinedData("phase.ended", { phase: 3, outcome: "done" }).some(
      (f) => f.keyword === "enum",
    ),
  );
});

test("CT-111-110 tasks and counters are per task and per reset", () => {
  assert.deepEqual(checkRefinedData("task.planned", { taskId: "T007", estimateMs: 600_000 }), []);
  assert.deepEqual(checkRefinedData("task.planned", { taskId: "T007", estimateMs: null }), []);
  assert.ok(
    checkRefinedData("task.planned", { estimateMs: 1 }).some((f) => f.path.includes("taskId")),
  );
  assert.deepEqual(checkRefinedData("task.ticked", { taskId: "T007", elapsedMs: 540_000 }), []);
  assert.ok(
    checkRefinedData("task.ticked", { taskId: "T007" }).some((f) => f.path.includes("elapsedMs")),
  );

  assert.deepEqual([...LAUNCH_REASONS], ["first", "resume", "relaunch", "manual"]);
  assert.deepEqual([...LAUNCH_REASONS], [...(closedSet(82)?.members ?? [])]);
  for (const reason of LAUNCH_REASONS) {
    assert.deepEqual(
      checkRefinedData("run.launched", { reason, countsCarried: true, countsReset: false }),
      [],
      reason,
    );
  }
  assert.ok(
    checkRefinedData("run.launched", {
      reason: "because",
      countsCarried: true,
      countsReset: false,
    }).some((f) => f.keyword === "enum"),
  );
  assert.deepEqual(checkRefinedData("counters.reset", { which: "attempt", by: "operator" }), []);
  assert.ok(
    checkRefinedData("counters.reset", { by: "operator" }).some((f) => f.path.includes("which")),
  );
});

/* ------------------------------------------------------------------ *
 * CT-111-111 — the critic-class call.
 * ------------------------------------------------------------------ */

test("CT-111-111 `critic.call` carries the FORM of the completion level in force", () => {
  assert.deepEqual([...COMPLETION_FORMS], ["tool-less", "read-only-tools"]);
  assert.deepEqual([...COMPLETION_FORMS], [...(closedSet(28)?.members ?? [])]);
  const schema = refinedDataSchemaOf("critic.call");
  assert.ok(schema);
  for (const field of ["form", "outcome", "latencyMs", "usage"]) {
    assert.ok(schema.required.includes(field), `critic.call carries ${field}`);
  }
  for (const form of COMPLETION_FORMS) {
    assert.deepEqual(
      checkRefinedData("critic.call", {
        promptRef: { logicalName: "n", hash: "a".repeat(64), size: 1 },
        form,
        outcome: "APPROVED",
        latencyMs: 4200,
        usage: { inputTokens: 100, outputTokens: 20 },
      }),
      [],
      form,
    );
  }
  assert.ok(
    checkRefinedData("critic.call", {
      form: "full-tools",
      outcome: "APPROVED",
      latencyMs: 1,
      usage: {},
    }).some((f) => f.keyword === "enum"),
  );
});

test("CT-111-111 `diversity` and `sameModelWarning` are on `critic.selected` AND on `critic.call`", () => {
  assert.equal(SAME_MODEL_WARNING_FIELD, "sameModelWarning");
  assert.deepEqual([...DIVERSITY_RESULTS], [...(closedSet(183)?.members ?? [])]);
  assert.deepEqual(
    [...DIVERSITY_RESULTS],
    ["diverse", "same-provider", "same-model", "unverified"],
  );
  for (const type of ["critic.selected", "critic.call"]) {
    const entry = CATALOGUE_BY_TYPE.get(type);
    assert.ok(entry, type);
    assert.ok(entry.dataFields.includes("diversity"), `${type} carries diversity`);
    assert.ok(entry.dataFields.includes("sameModelWarning"), `${type} carries sameModelWarning`);
    const schema = refinedDataSchemaOf(type);
    assert.deepEqual(schema?.properties.diversity?.enum, DIVERSITY_RESULTS);
  }
  const selected = refinedDataSchemaOf("critic.selected");
  assert.ok(selected);
  for (const field of ["harness", "model", "why", "diversity", "sameModelWarning"]) {
    assert.ok(selected.required.includes(field), `critic.selected carries ${field}`);
  }
});

test("CT-111-111 the warning is TRUE for `same-model` and `unverified` AND FOR NO OTHER", () => {
  assert.deepEqual([...WARNS_FOR], ["same-model", "unverified"]);
  for (const diversity of DIVERSITY_RESULTS) {
    const expected = diversity === "same-model" || diversity === "unverified";
    assert.equal(sameModelWarningFor(diversity), expected, diversity);
    const sound = {
      harness: "claude",
      model: "opus",
      why: "the registry chose it",
      diversity,
      sameModelWarning: expected,
    };
    assert.deepEqual(criticFindings("critic.selected", sound), [], diversity);
    // The other way round is a finding, each way.
    const wrong = { ...sound, sameModelWarning: !expected };
    assert.ok(
      criticFindings("critic.selected", wrong).some((f) => f.includes("sameModelWarning")),
      `${diversity} with the warning ${!expected} is a finding`,
    );
  }
});

test("CT-111-111 the NONCE is in no event, and only its hash is recorded", () => {
  assert.equal(NONCE_IS_IN_AN_EVENT_BEFORE_THE_CALL_RETURNS, false);
  // No type of the catalogue has a field that would carry the nonce itself.
  for (const entry of CATALOGUE) {
    for (const field of entry.dataFields) {
      assert.doesNotMatch(field, /^nonce$/, `${entry.type}.${field} would carry the nonce`);
    }
  }
  // `verdict.recorded` says whether the nonce matched, and no more.
  const schema = refinedDataSchemaOf("verdict.recorded");
  assert.ok(schema);
  for (const field of ["verdictId", "result", "nonceOk", "malformedStreak"]) {
    assert.ok(schema.required.includes(field), `verdict.recorded carries ${field}`);
  }
  assert.equal(Object.hasOwn(schema.properties, "nonce"), false);
  assert.deepEqual(
    checkRefinedData("verdict.recorded", {
      verdictId: "v-1",
      result: "APPROVED",
      nonceOk: true,
      malformedStreak: 0,
    }),
    [],
  );
  // Afterwards only the HASH: a stable 64-character digest, never the value.
  const hash = nonceHash("a-secret-nonce-value");
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, nonceHash("a-secret-nonce-value"), "the hash is stable");
  assert.notEqual(hash, nonceHash("another"));
  assert.equal(hash.includes("a-secret-nonce-value"), false);
});

test("CT-111-111 `verdict.adjudicated` refers to the verdict by `verdictId`", () => {
  const schema = refinedDataSchemaOf("verdict.adjudicated");
  assert.ok(schema);
  assert.ok(schema.required.includes("verdictId"));
  assert.ok(schema.required.includes("falseNegative"));
  assert.deepEqual(
    checkRefinedData("verdict.adjudicated", {
      verdictId: "v-1",
      falseNegative: true,
      by: "the owner",
    }),
    [],
  );
  assert.ok(
    checkRefinedData("verdict.adjudicated", { falseNegative: true }).some((f) =>
      f.path.includes("verdictId"),
    ),
  );
});
