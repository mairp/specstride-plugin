/**
 * T189 — contract tests CT-100-275, CT-100-276 and CT-100-277 for the output
 * modes (annex G, §G.2; F100-FR-175, F100-FR-176, F100-FR-177), over the key
 * `outputModes` of `data/cli-protocol.json` and row 80 of
 * `data/closed-sets.json`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import cliProtocol from "../data/cli-protocol.json" with { type: "json" };
import {
  ANNEX_SECTION,
  A_PHYSICAL_PATH_IS_COMPARED_THROUGH,
  BYTE_FOR_BYTE_CASES,
  CLOSED_SET_ROW,
  COMPARED_STREAMS,
  COMPAT_PRINTS_ONLY_AS_IS_LINES,
  DEFAULT_MODE,
  DEFAULT_OUTPUT_ECHOES_OUTSIDE_TEXT,
  DEFAULT_OUTPUT_REFERS_BY,
  KEY,
  MODE_NAMES,
  MODE_UNDER_PARITY,
  MODE_WHEN_UNKNOWN,
  NEW_LINE_PARITY_ROW,
  OUTPUT_MODES,
  PARITY_ROW,
  STATE_IS_NAMED_BY,
  TEXT_FROM_OUTSIDE,
  loadOutputModes,
  mayBeWritten,
  messageIsAllowedInDefaultOutput,
  modeInForce,
  outputModeRow,
  outputModeRows,
  profileRowOfTheMode,
} from "../src/grammar/output-modes.ts";
import { closedSets } from "../src/enums/all-sets.ts";

test("CT-100-275: exactly the two output modes of §G.2 (F100-FR-175)", () => {
  assert.equal(ANNEX_SECTION, "annex G, §G.2");
  const raw = (cliProtocol as { outputModes: unknown[] }).outputModes;
  assert.equal(outputModeRows.length, raw.length);
  assert.equal(outputModeRows.length, 2);
  assert.deepEqual(loadOutputModes(), outputModeRows);
  assert.deepEqual([...OUTPUT_MODES], ["default", "compat"]);
  assert.equal(MODE_NAMES["default"], "Default output");
  assert.equal(MODE_NAMES["compat"], "Compatibility output");
  assert.equal(outputModeRow("default")?.name, "Default output");
  assert.equal(outputModeRow("compat")?.name, "Compatibility output");
  // What each prints, and when, as the table states it.
  assert.match(outputModeRow("default")?.whatItPrints ?? "", /Terse lines/);
  assert.match(outputModeRow("default")?.whatItPrints ?? "", /\[SPECSTRIDE-/);
  assert.match(outputModeRow("compat")?.whatItPrints ?? "", /byte for byte/);
  assert.match(outputModeRow("compat")?.when ?? "", /output\.compat/);
  assert.match(outputModeRow("compat")?.when ?? "", /parity/);
  assert.equal(COMPAT_PRINTS_ONLY_AS_IS_LINES, true);
  // The three cases F100-FR-175 names by name.
  assert.deepEqual(
    [...BYTE_FOR_BYTE_CASES],
    [
      "the literal for an absent child exit code",
      "the quoting of the old language in the relaunch line",
      "the hold line on every unchanged poll",
    ],
  );
  // Row 80 of annex X §X.6 is the closed set of the modes.
  assert.equal(CLOSED_SET_ROW, 80);
  const row80 = closedSets.get(80);
  assert.equal(row80?.name, "Output modes");
  assert.deepEqual([...(row80?.members ?? [])], [...OUTPUT_MODES]);
  assert.equal(MODE_WHEN_UNKNOWN.outcome, "configuration-error");
  assert.match(row80?.onUnknown("verbose").message ?? "", /Output modes/);
});

test("CT-100-275: the mode in force, from the key and the profile (row 18 of §X.7)", () => {
  assert.equal(KEY, "output.compat");
  assert.equal(PARITY_ROW, 18);
  assert.equal(DEFAULT_MODE, "default");
  assert.equal(MODE_UNDER_PARITY, "compat");
  assert.equal(modeInForce({}), "default");
  assert.equal(modeInForce({ outputCompat: true }), "compat");
  assert.equal(modeInForce({ profile: "parity" }), "compat");
  assert.equal(
    modeInForce({ outputCompat: false, profile: "parity" }),
    "compat",
    "compatibility output always, under the `parity` profile",
  );
  // Row 18 of the profile carries the key and its value under `parity`.
  const row = profileRowOfTheMode();
  assert.notEqual(row, undefined);
  assert.ok((row?.keys ?? []).includes("output.compat"));
  assert.equal(row?.parity, "compatibility output");
});

test("CT-100-276: a line with no as-is equivalent and the compared streams", () => {
  assert.deepEqual([...COMPARED_STREAMS], ["stdout", "stderr"]);
  assert.equal(NEW_LINE_PARITY_ROW, 19);

  // A line that HAS an as-is equivalent is always allowed.
  for (const stream of COMPARED_STREAMS) {
    assert.equal(mayBeWritten({ stream, hasAnAsIsEquivalent: true }).allowed, true);
    assert.equal(mayBeWritten({ stream, hasAnAsIsEquivalent: true }, "parity").allowed, true);
  }
  // Under the `parity` profile a line with no as-is equivalent is printed on NO
  // stream.
  for (const stream of COMPARED_STREAMS) {
    const refused = mayBeWritten(
      { stream, hasAnAsIsEquivalent: false, featureIsOn: true },
      "parity",
    );
    assert.equal(refused.allowed, false);
    if (!refused.allowed) {
      assert.equal(refused.reason, "no-as-is-equivalent-on-a-compared-stream");
      assert.match(refused.message, /F100-FR-176/);
      assert.match(refused.message, new RegExp(stream));
    }
  }
  // Outside it, such a line is printed only when its feature is on.
  assert.equal(
    mayBeWritten({ stream: "stdout", hasAnAsIsEquivalent: false, featureIsOn: true }).allowed,
    true,
  );
  const off = mayBeWritten({ stream: "stdout", hasAnAsIsEquivalent: false, featureIsOn: false });
  assert.equal(off.allowed, false);
  if (!off.allowed) assert.equal(off.reason, "feature-is-off");
  // A line whose feature is not stated is not printed either.
  assert.equal(mayBeWritten({ stream: "stderr", hasAnAsIsEquivalent: false }).allowed, false);
});

test("CT-100-277: text from outside the runtime is never echoed (F100-FR-177)", () => {
  assert.deepEqual(
    [...TEXT_FROM_OUTSIDE],
    ["feedback of the critic", "names of tests", "messages of a harness"],
  );
  assert.equal(DEFAULT_OUTPUT_ECHOES_OUTSIDE_TEXT, false);
  assert.equal(DEFAULT_OUTPUT_REFERS_BY, "logical name");
  assert.equal(STATE_IS_NAMED_BY, "logical name");
  assert.equal(A_PHYSICAL_PATH_IS_COMPARED_THROUGH, "the layout table");

  // A message that names state by logical name is allowed.
  const ok = messageIsAllowedInDefaultOutput("the verdict is in run:<runId>:verdict", [
    "ReferenceError: x is not defined",
  ]);
  assert.equal(ok.allowed, true);
  // A message that echoes text from outside the runtime is not.
  const bad = messageIsAllowedInDefaultOutput("the check said: ReferenceError: x is not defined", [
    "ReferenceError: x is not defined",
  ]);
  assert.equal(bad.allowed, false);
  assert.match(String(bad.reason), /F100-FR-177/);
});
