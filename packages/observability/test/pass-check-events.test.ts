/**
 * T022 — CT-111-107 and CT-111-108: the pass, the tool, the prompt, the check,
 * the job, the resource and the unit (F111-FR-007, F111-FR-008).
 *
 * F111-FR-007: *A pass MUST be explained by its events. `pass.started` MUST
 * carry the `sessionId`; every event inside the pass MUST carry it; the
 * activity of a subagent MUST carry `parentSessionId`. `pass.ended` MUST carry
 * `endCause`, a member of the closed set ... (annex X §X.6 row 271), the split
 * of time into model, tool, wait and idle time, `firstEditAt`, `usageComplete`
 * and a reference to the raw transcript by logical name, hash and size.
 * `tool.call` MUST carry a category ... and a duration, the references
 * `argsRef` and `resultRef` ... and the four marks `redacted`, `truncated`,
 * `originalBytes` and `retainedBytes` ... `prompt.built` MUST be written for
 * every pass and every critic-class call, with the bytes and the token
 * estimate of each block, the blocks dropped, and the total, and never the
 * text.*
 *
 * F111-FR-008: *`check.started` and `check.ended` MUST be written for every
 * check whoever runs it (`runner`: `runtime` or `proposer`) ... `job.step`,
 * `job.first_failure` and `job.ended` with `msAfterFirstFailure` MUST be
 * written for a long job. `resource.wait` MUST be written when a check or a
 * job waits on a declared exclusive resource. `microloop.unit` MUST carry the
 * unit, the result (`kept`, `repair`, `unresolved`, row 136) and, where the
 * layer went off, in `layerOff` the cause ... and in `fallbackReason` the
 * fallback reason of annex X §X.6 row 59 where one applies ... While the layer
 * stays on, both fields MUST be null.*
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { closedSet } from "@specstride/contracts/enums/all-sets";
import { CONTENT_REFERENCE_FIELDS } from "@specstride/contracts/envelope/event";
import { CATALOGUE_BY_TYPE, closedSetMembersOf } from "../src/catalogue/index.ts";
import {
  REFINED_REQUIREMENTS,
  checkRefinedData,
  consistencyFindings,
  refinementsOfRequirement,
  refinedDataSchemaOf,
} from "../src/catalogue/types/index.ts";
import {
  PASS_END_CAUSES,
  TIME_BREAKDOWN_PARTS,
  TOOL_CALL_MARKS,
  TOOL_CALL_REFERENCES,
  sessionFindings,
} from "../src/catalogue/types/pass.ts";
import {
  CHECK_RUNNERS,
  LAYER_OFF_CAUSES,
  MICROLOOP_RESULTS,
  microloopFindings,
} from "../src/catalogue/types/checks.ts";

const TRANSCRIPT = { logicalName: "run:r:transcript", hash: "a".repeat(64), size: 1024 };
const BREAKDOWN = { model: 1200, tool: 300, wait: 50, idle: 10 };

const PASS_ENDED = {
  endCause: "evidence",
  timeBreakdown: BREAKDOWN,
  firstEditAt: "2026-10-01T09:00:00.000Z",
  usageComplete: true,
  transcriptRef: TRANSCRIPT,
  evidence: "gates/GATE3-EVIDENCE.md",
};

/* ------------------------------------------------------------------ *
 * CT-111-107 — the pass.
 * ------------------------------------------------------------------ */

test("CT-111-107 `pass.started` carries the `sessionId`, and a subagent its parent", () => {
  const schema = refinedDataSchemaOf("pass.started");
  assert.ok(schema);
  assert.ok(schema.required.includes("sessionId"));
  assert.deepEqual(checkRefinedData("pass.started", { iter: 1, sessionId: "s-1" }), []);
  assert.ok(
    checkRefinedData("pass.started", { iter: 1 }).some((f) => f.path.includes("sessionId")),
  );

  // Every event INSIDE the pass carries it, in the envelope.
  assert.deepEqual(sessionFindings({ type: "tool.call", sessionId: "s-1" }, true), []);
  assert.ok(
    sessionFindings({ type: "tool.call" }, true).some((f) => f.includes("sessionId")),
    "an event inside a pass without `sessionId` is a finding",
  );
  // The activity of a subagent carries `parentSessionId`.
  assert.deepEqual(
    sessionFindings({ type: "tool.call", sessionId: "s-2", parentSessionId: "s-1" }, true, true),
    [],
  );
  assert.ok(
    sessionFindings({ type: "tool.call", sessionId: "s-2" }, true, true).some((f) =>
      f.includes("parentSessionId"),
    ),
  );
});

test("CT-111-107 `endCause` of `pass.ended` is a member of its closed set (row 271)", () => {
  assert.deepEqual([...PASS_END_CAUSES], [...(closedSet(271)?.members ?? [])]);
  assert.deepEqual(
    [...PASS_END_CAUSES],
    [
      "evidence",
      "completed",
      "yield",
      "no_progress",
      "error",
      "killed",
      "hard_cap",
      "quota_pause",
      "stopped",
      "crash",
    ],
  );
  assert.deepEqual(closedSetMembersOf("pass.ended", "endCause"), PASS_END_CAUSES);
  for (const member of PASS_END_CAUSES) {
    // A killed pass is the one end cause that cannot claim complete usage
    // (F111-FR-006); every other member is admitted as the record stands.
    const usageComplete = member !== "killed";
    assert.deepEqual(
      checkRefinedData("pass.ended", { ...PASS_ENDED, endCause: member, usageComplete }),
      [],
      `${member} is admitted`,
    );
  }
  const refused = checkRefinedData("pass.ended", { ...PASS_ENDED, endCause: "finished" });
  assert.ok(refused.some((f) => f.keyword === "enum"));
});

test("CT-111-107 `pass.ended` carries the split of time, the first edit, the usage and the transcript", () => {
  const schema = refinedDataSchemaOf("pass.ended");
  assert.ok(schema);
  for (const field of [
    "endCause",
    "timeBreakdown",
    "firstEditAt",
    "usageComplete",
    "transcriptRef",
  ]) {
    assert.ok(schema.required.includes(field), `${field} is required`);
  }
  assert.deepEqual([...TIME_BREAKDOWN_PARTS], ["model", "tool", "wait", "idle"]);
  const missingAPart = checkRefinedData("pass.ended", {
    ...PASS_ENDED,
    timeBreakdown: { model: 1, tool: 2, wait: 3 },
  });
  assert.ok(missingAPart.some((f) => f.path.includes("idle")));
  // The transcript is a REFERENCE: logical name, hash and size, never a body.
  assert.deepEqual([...CONTENT_REFERENCE_FIELDS], ["logicalName", "hash", "size"]);
  const withABody = checkRefinedData("pass.ended", {
    ...PASS_ENDED,
    transcriptRef: { ...TRANSCRIPT, body: "the whole transcript" },
  });
  assert.ok(withABody.some((f) => f.path.includes("transcriptRef")));
});

/* ------------------------------------------------------------------ *
 * CT-111-107 — the tool call.
 * ------------------------------------------------------------------ */

test("CT-111-107 `tool.call` carries `argsRef`, `resultRef` and THE FOUR MARKS", () => {
  assert.deepEqual([...TOOL_CALL_REFERENCES], ["argsRef", "resultRef"]);
  assert.deepEqual(
    [...TOOL_CALL_MARKS],
    ["redacted", "truncated", "originalBytes", "retainedBytes"],
  );
  const schema = refinedDataSchemaOf("tool.call");
  assert.ok(schema);
  for (const field of [...TOOL_CALL_REFERENCES, ...TOOL_CALL_MARKS, "category", "durationMs"]) {
    assert.ok(schema.required.includes(field), `${field} is required on tool.call`);
  }
  assert.deepEqual(schema.properties.category?.enum, closedSet(95)?.members);

  const sound = {
    tool: "Edit",
    category: "edit",
    durationMs: 120,
    argsRef: { logicalName: "run:r:tool:1:args", hash: "b".repeat(64), size: 40 },
    resultRef: { logicalName: "run:r:tool:1:result", hash: "c".repeat(64), size: 12 },
    redacted: false,
    truncated: false,
    originalBytes: 40,
    retainedBytes: 40,
  };
  assert.deepEqual(checkRefinedData("tool.call", sound), []);
  const badCategory = checkRefinedData("tool.call", { ...sound, category: "write" });
  assert.ok(badCategory.some((f) => f.keyword === "enum"));
  for (const mark of TOOL_CALL_MARKS) {
    const { [mark]: _gone, ...without } = sound as Record<string, unknown>;
    assert.ok(
      checkRefinedData("tool.call", without).some((f) => f.path.includes(mark)),
      `${mark} is one of the four marks and cannot be left out`,
    );
  }
});

test("CT-111-107 no event of the pass holds TEXT: the body is a reference", () => {
  for (const type of ["tool.call", "prompt.built", "pass.ended"]) {
    const entry = CATALOGUE_BY_TYPE.get(type);
    assert.ok(entry, type);
    for (const field of entry.dataFields) {
      assert.doesNotMatch(
        field,
        /^(text|prompt|reply|body|output|content|stdout|stderr)$/,
        `${type}.${field} would be a body`,
      );
    }
  }
  // `prompt.built` names the prompt by reference and gives sizes, never text.
  const schema = refinedDataSchemaOf("prompt.built");
  assert.ok(schema);
  assert.deepEqual([...schema.required], ["promptRef", "blocks", "totalTokensEst"]);
  assert.deepEqual(
    checkRefinedData("prompt.built", {
      promptRef: { logicalName: "run:r:prompt:1", hash: "d".repeat(64), size: 900 },
      blocks: [
        { name: "spec", bytes: 400, tokensEst: 100, dropped: false },
        { name: "history", bytes: 500, tokensEst: 120, dropped: true },
      ],
      totalTokensEst: 220,
    }),
    [],
  );
  const withText = checkRefinedData("prompt.built", {
    promptRef: { logicalName: "run:r:prompt:1", hash: "d".repeat(64), size: 900 },
    blocks: [{ name: "spec", bytes: 400, tokensEst: 100, dropped: false, text: "the prompt" }],
    totalTokensEst: 100,
  });
  assert.ok(
    withText.some((f) => f.path.includes("text")),
    "a block never carries its text",
  );
});

/* ------------------------------------------------------------------ *
 * CT-111-108 — the check, the job, the resource and the unit.
 * ------------------------------------------------------------------ */

test("CT-111-108 `check.started` and `check.ended` carry the runner, the batch and the slot", () => {
  assert.deepEqual([...CHECK_RUNNERS], ["runtime", "proposer"]);
  const started = refinedDataSchemaOf("check.started");
  assert.ok(started);
  for (const field of ["checkId", "commandRef", "runner", "batch", "slot"]) {
    assert.ok(started.required.includes(field), `check.started carries ${field}`);
  }
  assert.deepEqual(started.properties.runner?.enum, CHECK_RUNNERS);
  const ended = refinedDataSchemaOf("check.ended");
  assert.ok(ended);
  for (const field of ["checkId", "result", "durationMs", "batch", "slot", "concurrent"]) {
    assert.ok(ended.required.includes(field), `check.ended carries ${field}`);
  }

  const soundStart = {
    checkId: "c-1",
    commandRef: { logicalName: "run:r:check:c-1:cmd", hash: "e".repeat(64), size: 20 },
    runner: "proposer",
    batch: 1,
    slot: 2,
  };
  assert.deepEqual(checkRefinedData("check.started", soundStart), []);
  assert.ok(
    checkRefinedData("check.started", { ...soundStart, runner: "someone-else" }).some(
      (f) => f.keyword === "enum",
    ),
  );
  assert.deepEqual(
    checkRefinedData("check.ended", {
      checkId: "c-1",
      result: "pass",
      durationMs: 900,
      batch: 1,
      slot: 2,
      concurrent: true,
    }),
    [],
  );
  // The command is a REFERENCE, never the command line itself in the open.
  assert.ok(
    checkRefinedData("check.started", { ...soundStart, commandRef: "npm run test" }).length > 0,
  );
});

test("CT-111-108 a long job gives `job.step`, `job.first_failure` and `job.ended`", () => {
  assert.deepEqual(
    checkRefinedData("job.step", { jobId: "j-1", cycle: 3, stepTs: "2026-10-01T09:00:00.000Z" }),
    [],
  );
  assert.ok(checkRefinedData("job.step", { cycle: 3 }).some((f) => f.path.includes("jobId")));
  assert.deepEqual(
    checkRefinedData("job.first_failure", { jobId: "j-1", failedAt: "2026-10-01T09:00:01.000Z" }),
    [],
  );
  const ended = refinedDataSchemaOf("job.ended");
  assert.ok(ended);
  assert.ok(ended.required.includes("msAfterFirstFailure"));
  assert.deepEqual(
    checkRefinedData("job.ended", {
      kind: "live",
      msAfterFirstFailure: 4200,
      logRef: { logicalName: "n", hash: "f".repeat(64), size: 1 },
    }),
    [],
  );
  assert.deepEqual(checkRefinedData("job.ended", { kind: "live", msAfterFirstFailure: null }), []);
});

test("CT-111-108 `resource.wait` names the resource, the holder and the wait", () => {
  const schema = refinedDataSchemaOf("resource.wait");
  assert.ok(schema);
  assert.deepEqual([...schema.required], ["resource", "holder", "ms"]);
  assert.deepEqual(
    checkRefinedData("resource.wait", { resource: "the port 8080", holder: "check c-2", ms: 300 }),
    [],
  );
  assert.ok(
    checkRefinedData("resource.wait", { resource: "x", holder: "y" }).some((f) =>
      f.path.includes("ms"),
    ),
  );
});

test("CT-111-108 the result of `microloop.unit` is a member of `kept`, `repair`, `unresolved`", () => {
  assert.deepEqual([...MICROLOOP_RESULTS], ["kept", "repair", "unresolved"]);
  assert.deepEqual([...MICROLOOP_RESULTS], [...(closedSet(136)?.members ?? [])]);
  for (const result of MICROLOOP_RESULTS) {
    assert.deepEqual(
      checkRefinedData("microloop.unit", {
        unitId: "u-1",
        check: "c-1",
        result,
        layerOff: null,
        fallbackReason: null,
      }),
      [],
    );
  }
  assert.ok(
    checkRefinedData("microloop.unit", {
      unitId: "u-1",
      check: "c-1",
      result: "fixed",
      layerOff: null,
      fallbackReason: null,
    }).some((f) => f.keyword === "enum"),
  );
});

test("CT-111-108 while the layer stays ON, `layerOff` and `fallbackReason` are both null", () => {
  const on = { unitId: "u-1", check: "c-1", result: "kept", layerOff: null, fallbackReason: null };
  assert.deepEqual(checkRefinedData("microloop.unit", on), []);
  assert.deepEqual(microloopFindings(on), []);
  assert.ok(
    microloopFindings({ ...on, fallbackReason: "no-check" }).some((f) => f.includes("layerOff")),
    "a fallback reason without a cause of the layer going off is a finding",
  );
});

test("CT-111-108 where the layer WENT OFF, `layerOff` holds one of the seven causes", () => {
  assert.deepEqual(
    [...LAYER_OFF_CAUSES],
    ["caps", "integrity", "check-error", "no-check", "single-unit", "layer-error", "breach"],
  );
  for (const cause of LAYER_OFF_CAUSES) {
    const fallbackReason = cause === "no-check" || cause === "single-unit" ? cause : null;
    const unit = {
      unitId: "u-1",
      check: "c-1",
      result: "unresolved",
      layerOff: cause,
      fallbackReason,
    };
    assert.deepEqual(checkRefinedData("microloop.unit", unit), [], cause);
    assert.deepEqual(microloopFindings(unit), [], cause);
  }
  // The fallback reason, where one applies, is a member of row 59.
  const row59 = closedSet(59)?.members ?? [];
  assert.ok(row59.includes("no-check") && row59.includes("single-unit"));
  assert.ok(
    checkRefinedData("microloop.unit", {
      unitId: "u-1",
      check: "c-1",
      result: "unresolved",
      layerOff: "caps",
      fallbackReason: "made-up",
    }).some((f) => f.keyword === "enum"),
  );
  // A cause that is not one of the seven is refused.
  assert.ok(
    checkRefinedData("microloop.unit", {
      unitId: "u-1",
      check: "c-1",
      result: "kept",
      layerOff: "tired",
      fallbackReason: null,
    }).some((f) => f.keyword === "enum"),
  );
});

/* ------------------------------------------------------------------ *
 * The guard over the whole folder of T025.
 * ------------------------------------------------------------------ */

test("CT-111-107/108 the `data` schemas of T025 and the catalogue say the same thing", () => {
  // A refinement that names a field no row has, or an `enum` that differs from
  // the closed set the catalogue reads, is a finding. Empty means the folder
  // and the data cannot have drifted apart.
  assert.deepEqual(consistencyFindings(), []);
  // Each of F111-FR-006 to F111-FR-015 has at least one type in the folder.
  assert.equal(REFINED_REQUIREMENTS.length, 10);
  for (const requirement of REFINED_REQUIREMENTS) {
    assert.ok(
      refinementsOfRequirement(requirement).length > 0,
      `${requirement} has a \`data\` schema in src/catalogue/types/`,
    );
  }
});
