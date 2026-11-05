/**
 * T024 — CT-111-112, CT-111-113, CT-111-114 and CT-111-115: the rulings, the
 * quota, the stream and the parallel units (F111-FR-012, F111-FR-013,
 * F111-FR-014, F111-FR-015).
 *
 * F111-FR-012: *`route.decided` MUST be written for every decision of the
 * router, including one that changes nothing, with the table id, the table
 * version, the decision point, the rule id, the signals read and the choice. A
 * model-tier bump MUST be recorded as `attempt.tier_bumped` and its skip as
 * `attempt.tier_bump_skipped` with the reason; an escalation that was skipped
 * MUST be recorded as `escalation.skipped` with the reason, a member of annex
 * X §X.6 row 140 ... when the quota of the target had none left, the reason is
 * `quota`. No routing decision MUST reach a critic-class call through an
 * event.*
 *
 * F111-FR-013: *Quota, pause, fallback and alerts MUST be defined here ... A
 * quota pause MUST add no count to any event that counts a reject, an
 * iteration, a MALFORMED reply, an error or a relaunch.*
 *
 * F111-FR-014: *`stream.missing_terminal` MUST be written when a stream ends
 * with no terminal record; a pass that exits successfully and did nothing MUST
 * end with the `endCause` `no_progress`; an unknown value MUST be null. A
 * violation of the framing of a stream ... MUST give `stream.diagnostic` and
 * MUST NOT give any other record.*
 *
 * F111-FR-015: *The seven types ... MUST carry `groupId` and `workerId` in
 * `data` only, and the envelope fields `workerId` and `wseq` MUST be absent on
 * them ... `parallel.admission` MUST carry `taskId`, the check and its result,
 * one event for each check of each task; `parallel.integration` MUST carry
 * `step` and `pathCount`, a count of paths and never a path. They MUST project
 * to nothing.*
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { closedSet } from "@specstride/contracts/enums/all-sets";
import { WORKER_FIELDS } from "@specstride/contracts/envelope/event";
import { CATALOGUE_BY_TYPE } from "../src/catalogue/index.ts";
import { checkRefinedData, refinedDataSchemaOf } from "../src/catalogue/types/index.ts";
import {
  ROUTING_FIELDS,
  SKIP_REASONS,
  SKIP_REASON_FOR_NO_QUOTA,
  routingReachesACriticCall,
} from "../src/catalogue/types/rulings.ts";
import {
  ALERT_KINDS,
  ALERT_LEVELS,
  BUDGET_DIMENSIONS,
  COUNTING_EVENTS,
  QUOTA_CONFIDENCES,
  quotaPauseAddsNoCount,
} from "../src/catalogue/types/quota.ts";
import {
  DIAGNOSTIC_CODES,
  DIAGNOSTIC_SEVERITIES,
  NO_PROGRESS,
  recordsForAFramingViolation,
  streamFindings,
} from "../src/catalogue/types/stream.ts";
import {
  PARALLEL_TYPES,
  PARALLEL_TYPES_PROJECT_TO,
  parallelEnvelopeFindings,
} from "../src/catalogue/types/parallel.ts";

/* ------------------------------------------------------------------ *
 * CT-111-112 — the decisions of the rulings.
 * ------------------------------------------------------------------ */

test("CT-111-112 `route.decided` carries the table, the point, the rule, the signals and the choice", () => {
  const schema = refinedDataSchemaOf("route.decided");
  assert.ok(schema);
  assert.deepEqual(
    [...schema.required],
    ["tableId", "tableVersion", "point", "ruleId", "signals", "choice"],
  );
  const sound = {
    tableId: "router.default",
    tableVersion: "3",
    point: "proposer-selection",
    ruleId: "r-7",
    signals: { tier: "a", rejects: 0 },
    choice: "keep",
  };
  assert.deepEqual(checkRefinedData("route.decided", sound), []);
  // A decision that CHANGES NOTHING is still written: `keep` is a choice.
  assert.deepEqual(checkRefinedData("route.decided", { ...sound, choice: "no-change" }), []);
  for (const field of schema.required) {
    const { [field]: _gone, ...without } = sound as Record<string, unknown>;
    assert.ok(
      checkRefinedData("route.decided", without).some((f) => f.path.includes(field)),
      `${field} cannot be left out`,
    );
  }
});

test("CT-111-112 a model-tier bump and its skip are their own events", () => {
  assert.deepEqual(
    checkRefinedData("attempt.tier_bumped", { fromTier: "a", toTier: "b", k: 2, rejections: 2 }),
    [],
  );
  assert.ok(
    checkRefinedData("attempt.tier_bumped", { toTier: "b" }).some((f) =>
      f.path.includes("fromTier"),
    ),
  );
  assert.deepEqual(
    checkRefinedData("attempt.tier_bump_skipped", { reason: "the ladder has no rung above" }),
    [],
  );
  assert.ok(
    checkRefinedData("attempt.tier_bump_skipped", {}).some((f) => f.path.includes("reason")),
  );
});

test("CT-111-112 `escalation.skipped` carries a reason of row 140, `quota` for no quota", () => {
  assert.deepEqual([...SKIP_REASONS], [...(closedSet(140)?.members ?? [])]);
  assert.equal(SKIP_REASON_FOR_NO_QUOTA, "quota");
  assert.ok(SKIP_REASONS.includes(SKIP_REASON_FOR_NO_QUOTA));
  for (const reason of SKIP_REASONS) {
    assert.deepEqual(checkRefinedData("escalation.skipped", { reason }), [], reason);
  }
  assert.ok(
    checkRefinedData("escalation.skipped", { reason: "did not feel like it" }).some(
      (f) => f.keyword === "enum",
    ),
  );
  assert.ok(checkRefinedData("escalation.skipped", {}).some((f) => f.path.includes("reason")));
});

test("CT-111-112 NO routing decision reaches a critic-class call through an event", () => {
  assert.deepEqual(
    [...ROUTING_FIELDS],
    ["tableId", "tableVersion", "point", "ruleId", "signals", "choice"],
  );
  for (const type of ["critic.selected", "critic.started", "critic.call"]) {
    const entry = CATALOGUE_BY_TYPE.get(type);
    assert.ok(entry, type);
    const routing: readonly string[] = ROUTING_FIELDS;
    const leaked = entry.dataFields.filter((field) => routing.includes(field));
    assert.deepEqual(leaked, [], `${type} carries no routing field`);
    assert.equal(routingReachesACriticCall(type), false);
  }
  assert.equal(
    routingReachesACriticCall("route.decided"),
    false,
    "the router's own event is not a critic call",
  );
});

/* ------------------------------------------------------------------ *
 * CT-111-113 — quota, pause, fallback and alerts.
 * ------------------------------------------------------------------ */

test("CT-111-113 `quota.signal` carries the class, the confidence, the reset and its source", () => {
  assert.deepEqual([...QUOTA_CONFIDENCES], [...(closedSet(47)?.members ?? [])]);
  const schema = refinedDataSchemaOf("quota.signal");
  assert.ok(schema);
  for (const field of [
    "class",
    "confidence",
    "rateLimitType",
    "utilization",
    "resetsAt",
    "resetsAtSource",
    "status",
  ]) {
    assert.ok(schema.required.includes(field), `quota.signal carries ${field}`);
  }
  assert.deepEqual(
    checkRefinedData("quota.signal", {
      class: "five-hour",
      confidence: "structured",
      rateLimitType: "tokens",
      utilization: 0.9,
      resetsAt: "2026-10-01T14:00:00.000Z",
      resetsAtSource: "header",
      status: "near",
      evidence: "x-ratelimit-remaining: 10",
    }),
    [],
  );
  assert.ok(
    checkRefinedData("quota.signal", {
      class: "five-hour",
      confidence: "a hunch",
      rateLimitType: "tokens",
      utilization: 0.9,
      resetsAt: null,
      resetsAtSource: "header",
      status: "near",
    }).some((f) => f.keyword === "enum"),
  );
});

test("CT-111-113 the pause is a PAIR and the resume carries `pausedMs`", () => {
  assert.equal(CATALOGUE_BY_TYPE.get("run.paused")?.partner, "run.resumed");
  assert.equal(CATALOGUE_BY_TYPE.get("run.resumed")?.partner, "run.paused");
  assert.ok(refinedDataSchemaOf("run.resumed")?.required.includes("pausedMs"));
  assert.deepEqual(
    checkRefinedData("run.resumed", { pausedMs: 300_000, how: "the window opened" }),
    [],
  );
  assert.ok(checkRefinedData("run.resumed", { how: "x" }).some((f) => f.path.includes("pausedMs")));
});

test("CT-111-113 `alert` and `budget.exceeded` carry their closed sets and their numbers", () => {
  assert.deepEqual([...ALERT_KINDS], [...(closedSet(205)?.members ?? [])]);
  assert.deepEqual([...ALERT_LEVELS], ["info", "warn", "loud"]);
  assert.deepEqual([...BUDGET_DIMENSIONS], [...(closedSet(206)?.members ?? [])]);
  assert.deepEqual(
    checkRefinedData("alert", {
      kind: "budget-threshold",
      level: "warn",
      role: "proposer",
      threshold: 0.8,
      value: 0.85,
      limit: 100,
    }),
    [],
  );
  assert.ok(
    checkRefinedData("alert", {
      kind: "budget-threshold",
      level: "shouty",
      role: "proposer",
      threshold: 1,
      value: 1,
      limit: 1,
    }).some((f) => f.keyword === "enum"),
  );
  assert.deepEqual(
    checkRefinedData("budget.exceeded", {
      dimension: "costUsd",
      limit: 10,
      used: 11,
      role: "proposer",
      resumable: true,
    }),
    [],
  );
  assert.ok(
    checkRefinedData("budget.exceeded", { dimension: "patience", limit: 1, used: 2 }).some(
      (f) => f.keyword === "enum",
    ),
  );
});

test("CT-111-113 a QUOTA PAUSE adds no count to a reject, an iteration, a MALFORMED, an error or a relaunch", () => {
  assert.deepEqual(
    [...COUNTING_EVENTS],
    ["rejects", "iterations", "malformed", "errors", "relaunches"],
  );
  const before = { rejects: 2, iterations: 7, malformed: 1, errors: 0, relaunches: 3 };
  assert.deepEqual(quotaPauseAddsNoCount(before, { ...before }), [], "nothing moved: no finding");
  assert.deepEqual(
    quotaPauseAddsNoCount(before, { ...before, iterations: 8 }).length,
    1,
    "an iteration counted across a quota pause is a finding",
  );
  for (const counter of COUNTING_EVENTS) {
    const after = { ...before, [counter]: (before as Record<string, number>)[counter]! + 1 };
    assert.ok(
      quotaPauseAddsNoCount(before, after).some((f) => f.includes(counter)),
      `${counter} must not rise across a quota pause`,
    );
  }
  // `pass.ended` with the end cause `quota_pause` carries no count field.
  const entry = CATALOGUE_BY_TYPE.get("pass.ended");
  assert.ok(entry);
  assert.deepEqual(
    checkRefinedData("pass.ended", {
      endCause: "quota_pause",
      timeBreakdown: { model: 0, tool: 0, wait: 10, idle: 0 },
      firstEditAt: null,
      usageComplete: true,
      transcriptRef: { logicalName: "n", hash: "a".repeat(64), size: 1 },
    }),
    [],
  );
});

/* ------------------------------------------------------------------ *
 * CT-111-114 — the stream told truthfully.
 * ------------------------------------------------------------------ */

test("CT-111-114 `stream.missing_terminal` is written when a stream ends with no terminal record", () => {
  assert.ok(refinedDataSchemaOf("stream.missing_terminal")?.required.includes("passId"));
  assert.deepEqual(checkRefinedData("stream.missing_terminal", { passId: "p-1" }), []);
  assert.ok(checkRefinedData("stream.missing_terminal", {}).some((f) => f.path.includes("passId")));
});

test("CT-111-114 a pass that exits successfully and did nothing ends with `no_progress`", () => {
  assert.equal(NO_PROGRESS, "no_progress");
  assert.deepEqual(
    streamFindings({ exitedSuccessfully: true, changedAnything: false, endCause: NO_PROGRESS }),
    [],
  );
  assert.ok(
    streamFindings({
      exitedSuccessfully: true,
      changedAnything: false,
      endCause: "completed",
    }).some((f) => f.includes(NO_PROGRESS)),
  );
  assert.deepEqual(
    streamFindings({ exitedSuccessfully: true, changedAnything: true, endCause: "completed" }),
    [],
  );
});

test("CT-111-114 an UNKNOWN value is null, never a guess and never absent", () => {
  assert.deepEqual(
    checkRefinedData("stream.result", {
      model: null,
      costUsd: null,
      durationMs: null,
      isError: false,
    }),
    [],
  );
  assert.ok(
    streamFindings({ unknownValues: { costUsd: undefined } }).some((f) => f.includes("null")),
    "an unknown value that is left out rather than written as null is a finding",
  );
  assert.deepEqual(streamFindings({ unknownValues: { costUsd: null } }), []);
});

test("CT-111-114 a framing violation gives `stream.diagnostic` AND NO OTHER RECORD", () => {
  assert.deepEqual([...recordsForAFramingViolation()], ["stream.diagnostic"]);
  assert.deepEqual([...DIAGNOSTIC_CODES], [...(closedSet(222)?.members ?? [])]);
  assert.deepEqual([...DIAGNOSTIC_SEVERITIES], ["error", "warning"]);
  const schema = refinedDataSchemaOf("stream.diagnostic");
  assert.ok(schema);
  assert.ok(schema.required.includes("code"));
  assert.ok(schema.required.includes("severity"));
  assert.deepEqual(
    checkRefinedData("stream.diagnostic", {
      code: "malformed_json",
      severity: "error",
      message: "a line of 2 MB",
    }),
    [],
  );
  assert.ok(
    checkRefinedData("stream.diagnostic", { code: "too-long", severity: "error" }).some(
      (f) => f.keyword === "enum",
    ),
  );
  // Tool output in the shape of a stream record is a framing violation and
  // gives the diagnostic alone: no `stream.text`, no `tool.call`.
  assert.equal(recordsForAFramingViolation().includes("stream.text"), false);
  assert.equal(recordsForAFramingViolation().includes("tool.call"), false);
});

/* ------------------------------------------------------------------ *
 * CT-111-115 — the parallel units, on the main line.
 * ------------------------------------------------------------------ */

test("CT-111-115 the SEVEN parallel types are the ones F111-FR-015 names", () => {
  assert.deepEqual(
    [...PARALLEL_TYPES],
    [
      "parallel.plan",
      "parallel.admission",
      "parallel.group.started",
      "parallel.group.ended",
      "parallel.worker.started",
      "parallel.worker.ended",
      "parallel.integration",
    ],
  );
  assert.equal(PARALLEL_TYPES.length, 7);
  for (const type of PARALLEL_TYPES) {
    assert.ok(CATALOGUE_BY_TYPE.has(type), `${type} is a type of the catalogue`);
    assert.ok(
      CATALOGUE_BY_TYPE.get(type)?.dataFields.includes("groupId"),
      `${type} names its group in data`,
    );
  }
  assert.equal(PARALLEL_TYPES_PROJECT_TO, null, "they project to nothing");
});

test("CT-111-115 they are events of the MAIN LINE: `workerId` and `wseq` are absent", () => {
  assert.deepEqual([...WORKER_FIELDS], ["workerId", "wseq"]);
  for (const type of PARALLEL_TYPES) {
    assert.deepEqual(parallelEnvelopeFindings({ type, data: { groupId: "g-1" } }), [], type);
    assert.ok(
      parallelEnvelopeFindings({ type, workerId: "w-1", data: { groupId: "g-1" } }).some((f) =>
        f.includes("workerId"),
      ),
      `${type} carries no envelope workerId`,
    );
    assert.ok(
      parallelEnvelopeFindings({ type, wseq: 3, data: { groupId: "g-1" } }).some((f) =>
        f.includes("wseq"),
      ),
    );
  }
  // `parallel.worker.*` names the worker in DATA, which is right and no finding.
  assert.deepEqual(
    parallelEnvelopeFindings({
      type: "parallel.worker.started",
      data: { groupId: "g-1", workerId: "w-1" },
    }),
    [],
  );
  // An event PRODUCED INSIDE a worker's stream is none of the seven and DOES
  // carry the two envelope fields.
  assert.deepEqual(
    parallelEnvelopeFindings({ type: "tool.call", workerId: "w-1", wseq: 3, data: {} }),
    [],
  );
});

test("CT-111-115 `parallel.admission` carries `taskId`, the check and its result", () => {
  const schema = refinedDataSchemaOf("parallel.admission");
  assert.ok(schema);
  for (const field of ["groupId", "taskId", "check", "result"]) {
    assert.ok(schema.required.includes(field), `parallel.admission carries ${field}`);
  }
  assert.deepEqual(schema.properties.check?.enum, closedSet(61)?.members);
  for (const check of closedSet(61)?.members ?? []) {
    assert.deepEqual(
      checkRefinedData("parallel.admission", {
        groupId: "g-1",
        taskId: "t-1",
        check,
        result: "pass",
      }),
      [],
      check,
    );
  }
  assert.ok(
    checkRefinedData("parallel.admission", {
      groupId: "g-1",
      taskId: "t-1",
      check: "vibes",
      result: "pass",
    }).some((f) => f.keyword === "enum"),
  );
  assert.ok(
    checkRefinedData("parallel.admission", {
      groupId: "g-1",
      check: "marker",
      result: "pass",
    }).some((f) => f.path.includes("taskId")),
  );
});

test("CT-111-115 `parallel.integration` carries `step` and `pathCount`, a COUNT and never a path", () => {
  const schema = refinedDataSchemaOf("parallel.integration");
  assert.ok(schema);
  for (const field of ["groupId", "step", "pathCount"]) {
    assert.ok(schema.required.includes(field), `parallel.integration carries ${field}`);
  }
  assert.deepEqual(
    checkRefinedData("parallel.integration", {
      groupId: "g-1",
      step: "merge",
      pathCount: 12,
      result: "integrated",
    }),
    [],
  );
  // `pathCount` is a whole number. A list of paths is not a count.
  assert.ok(
    checkRefinedData("parallel.integration", {
      groupId: "g-1",
      step: "merge",
      pathCount: ["src/a.ts", "src/b.ts"],
    }).some((f) => f.path.includes("pathCount")),
  );
  assert.ok(
    checkRefinedData("parallel.integration", {
      groupId: "g-1",
      step: "merge",
      pathCount: "src/a.ts",
    }).some((f) => f.path.includes("pathCount")),
  );
  // And no type of the seven carries a path at all.
  for (const type of PARALLEL_TYPES) {
    for (const field of CATALOGUE_BY_TYPE.get(type)?.dataFields ?? []) {
      assert.doesNotMatch(field, /^(path|paths|file|files)$/, `${type}.${field}`);
    }
  }
});
