/**
 * CT-126-Foundation — the closed sets of the stream seam are bound from the
 * data of `@specstride/contracts` (T004): the members live only there, the
 * unknown-value rule of each row holds, and the as-is texts of the route
 * reasons are those of F126-FR-014.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  diagnosticCodesOfTheStreamSeam,
  drainDiagnostics,
  diagnosticOf,
  finalizationDecisions,
  invocationStatusOrDefault,
  kindsOfNormalizedStreamRecord,
  observabilityModeOrDegraded,
  reasonCodesOfAnInvocationResult,
  recordKindOrDrop,
  routeReasonText,
  sourcesOfAnInvocationResult,
  sourceOfResult,
  streamSignals,
  toolNameOrPassThrough,
} from "../src/stream/closed-sets.ts";

test("row 38 kinds hold their members from contracts, with no second list here", () => {
  assert.deepEqual(
    [...kindsOfNormalizedStreamRecord.members],
    ["init", "text", "tool", "usage", "error", "terminal"],
  );
  assert.equal(kindsOfNormalizedStreamRecord.number, 38);
  assert.equal(kindsOfNormalizedStreamRecord.owner.startsWith("126"), true);
});

test("an unknown record kind is dropped with a diagnostic (F126-FR-002)", () => {
  assert.deepEqual(drainDiagnostics(), []);
  assert.equal(recordKindOrDrop("result"), null);
  const drained = drainDiagnostics();
  assert.equal(drained.length, 1);
  assert.equal(drained[0].code, "unknown_record_kind");
  assert.match(drained[0].message, /"result"/);
  assert.equal(recordKindOrDrop("terminal"), "terminal");
});

test("rows 169 to 177 carry their unknown-value rules", () => {
  // Row 169: a mode outside the set reads as `degraded`.
  assert.equal(observabilityModeOrDegraded("structured"), "structured");
  assert.equal(observabilityModeOrDegraded("who-knows"), "degraded");
  // Row 173: a status outside the set reads as `error`.
  assert.equal(invocationStatusOrDefault("timeout"), "timeout");
  assert.equal(invocationStatusOrDefault("mystery"), "error");
  // Row 175: a decision outside the set reads as `continue`.
  assert.equal(finalizationDecisions.onUnknown("stop_everything").treatedAs, "continue");
  // Row 176: a tool name outside the vocabulary passes through unchanged.
  assert.equal(toolNameOrPassThrough("Bash"), "Bash");
  assert.equal(toolNameOrPassThrough("My_Custom_Tool"), "My_Custom_Tool");
  // Row 177: the source follows the reason code (F126-FR-032).
  assert.equal(sourceOfResult("missing_terminal"), "synthesized");
  assert.equal(sourceOfResult("producer_nonzero"), "reconciled");
  assert.equal(sourcesOfAnInvocationResult.onUnknown("odd").treatedAs, "reconciled");
  // Row 174 is open by the provider: a foreign code is shown as text.
  assert.equal(reasonCodesOfAnInvocationResult.has("provider_overloaded"), false);
  // Row 170: an unknown signal refuses (thrown by the registry, checked there).
  assert.equal(streamSignals.has("evidence"), true);
  assert.equal(diagnosticCodesOfTheStreamSeam.has("line_too_long"), true);
  diagnosticOf("totally_unknown", "shown as text");
  assert.deepEqual(drainDiagnostics()[0].code, "totally_unknown");
});

test("the as-is route reason texts are those of F126-FR-014", () => {
  assert.equal(
    routeReasonText("structured capture disabled", "claude"),
    "structured capture disabled by SPECSTRIDE_AGENT_STREAM=false — parsing plain output",
  );
  assert.equal(
    routeReasonText("no registered adapter", "mystic"),
    "stream format 'mystic' has no registered adapter — parsing plain output",
  );
  assert.equal(
    routeReasonText("adapter failed to start", "mystic"),
    "stream adapter for 'mystic' failed to start — parsing plain output",
  );
});
