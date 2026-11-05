/**
 * T191 — contract tests CT-100-278 to CT-100-281 for the line grammar (annex G,
 * §G.3; F100-FR-178 to F100-FR-181), over `data/line-grammar.json` and the key
 * `componentNames` of `data/normalization.json`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import lineGrammar from "../data/line-grammar.json" with { type: "json" };
import normalization from "../data/normalization.json" with { type: "json" };
import {
  ANNEX_SECTION,
  A_LINE_BELONGS_TO,
  CLOSED_SET_ROW,
  FAMILY_NAMES,
  FORM,
  GRAMMAR_OWNER,
  LABELS,
  LABEL_PATTERN,
  LABEL_PATTERN_SOURCE,
  LABEL_WHEN_UNKNOWN,
  LINE_PATTERN,
  LabelInTwoFamiliesError,
  LineRefusedError,
  SEPARATOR,
  assertLabelsAreDisjoint,
  bodyIsPairs,
  families,
  family,
  familyOfLabel,
  formatLine,
  formatPairs,
  formatValue,
  isKnownLabel,
  loadFamilies,
  parseLine,
  parsePairs,
  printPairs,
  roundTrips,
  streamOfLabel,
  tryParseLine,
} from "../src/grammar/lines.ts";
import {
  CHILD_EXIT_STATES,
  DIGEST_KEYS,
  DIGEST_LABEL,
  DIGEST_STATES,
  FACTS_THE_BASELINE_DOES_NOT_KNOW,
  IS_THE_FINAL_LINE,
  LOOP_IN_DEFAULT_OUTPUT_ONLY,
  LOOP_KEYS_WITH_PARALLEL_UNITS_ON,
  LOOP_KEYS_WITH_THE_LAYER_OFF,
  LOOP_KEYS_WITH_THE_LAYER_ON,
  LOOP_LABEL,
  LOOP_PARITY_ROWS,
  LOOP_UNDER_PARITY_IS_PRINTED,
  NEITHER_IS_PRINTED_UNDER_PARITY,
  PRODUCED_BY,
  PRODUCED_FROM,
  PROTECTION_VALUES_OF_THE_LINE,
  STRATEGY_WITH_THE_LAYER_OFF,
  A_HOST_SKILL_PRINTS_IT_VERBATIM,
  digestIsTheFinalLine,
  endOfRunLines,
  formatDigest,
  formatLoopLine,
  isDigestState,
  loopLineIsPrinted,
  loopLineKeys,
  parallelKeysArePrinted,
  parseDigest,
  protectionOfTheLine,
} from "../src/grammar/digest.ts";
import {
  COMPONENT_NAMES,
  COMPONENT_NAME_OF,
  PRODUCT_LINE_PREFIX,
  SUPERVISOR_LINE_PREFIX,
  UnknownLineKeyError,
  componentNames,
  keysOfLabel,
  lineKeyRows,
  loadComponentNames,
  printLine,
  productLines,
  requiredKeysOf,
  rowOf,
  rowsOfLabel,
  streamOf,
  substituteComponentName,
  supervisorLines,
  textAfterTheName,
  textAfterTheNameIsEqual,
} from "../src/grammar/line-keys.ts";
import { closedSets } from "../src/enums/all-sets.ts";

test("CT-100-278: the form of a labelled line, and the seven families (F100-FR-178)", () => {
  assert.equal(ANNEX_SECTION, "annex G, §G.3");
  assert.equal(FORM, (lineGrammar as { form: string }).form);
  assert.equal(
    FORM,
    "opening square bracket, label, closing square bracket, one space, body, end of line",
  );
  assert.equal(LABEL_PATTERN_SOURCE, (lineGrammar as { label: string }).label);
  assert.equal(LABEL_PATTERN_SOURCE, "^[A-Z0-9-]+$");
  assert.equal(SEPARATOR, " ");
  assert.equal(families.length, (lineGrammar as { families: unknown[] }).families.length);
  assert.equal(families.length, 7);
  assert.deepEqual(loadFamilies(), families);
  assert.deepEqual(
    [...FAMILY_NAMES],
    [
      "Runtime lines",
      "Digest",
      "Supervisor lines",
      "Loop line",
      "Product lines",
      "Status line",
      "Engine and front-door lines",
    ],
  );
  for (const name of FAMILY_NAMES) {
    const f = family(name);
    assert.notEqual(f, undefined, name);
    assert.notEqual(f?.body, "", name);
    assert.notEqual(f?.printedBy, "", name);
    assert.notEqual(f?.streamCell, "", name);
  }
  // The product lines carry a prefix instead of a list; the status line has no
  // label at all.
  assert.equal(family("Product lines")?.labelPrefix, "SPECSTRIDE-");
  assert.equal(family("Status line")?.unlabelled, true);
  assert.equal(family("Loop line")?.defaultOutputOnly, true);
});

test("CT-100-278: the parser and the formatter of a labelled line (F100-FR-178)", () => {
  // The form: label in square brackets, one space, body.
  assert.equal(formatLine("READY", "the run is ready"), "[READY] the run is ready");
  const parsed = parseLine("[READY] the run is ready");
  assert.equal(parsed.label, "READY");
  assert.equal(parsed.body, "the run is ready");
  assert.equal(parsed.family?.family, "Runtime lines");
  assert.ok(roundTrips("SPECSTRIDE-LAUNCH", "run=r-1 state=running"));
  assert.ok(LINE_PATTERN.test("[DIGEST] state=completed"));

  // A line that does not follow the form is refused.
  for (const bad of ["READY the run", "[READY]no space", "", "[ready] lower case"]) {
    const result = tryParseLine(bad);
    assert.equal(result.ok, false, bad);
    if (!result.ok) assert.ok(result.error instanceof LineRefusedError);
  }
  assert.throws(() => parseLine("no label at all"), LineRefusedError);
  // A label outside the pattern is refused by the formatter too.
  assert.throws(() => formatLine("lower", "body"), LineRefusedError);
  assert.equal(LABEL_PATTERN.test("MOL-GATE"), true);
  assert.equal(LABEL_PATTERN.test("Mol-Gate"), false);

  // Row 81 of annex X §X.6: a parser IGNORES a line whose label it does not
  // know, so the line parses and its family is `undefined`.
  const unknown = parseLine("[UNKNOWNLABEL] something");
  assert.equal(unknown.family, undefined);
  assert.equal(isKnownLabel("UNKNOWNLABEL"), false);
  assert.equal(LABEL_WHEN_UNKNOWN.outcome, "ignored-by-the-parser");
  assert.equal(CLOSED_SET_ROW, 81);
  const row81 = closedSets.get(81);
  assert.equal(row81?.name, "Labels of output lines");
  assert.deepEqual([...(row81?.members ?? [])], [...LABELS]);
});

test("CT-100-278: a label of one family never appears in another (F100-FR-178)", () => {
  assert.doesNotThrow(() => assertLabelsAreDisjoint());
  // Every listed label belongs to exactly one family.
  for (const label of LABELS) {
    const owners = families.filter((f) => f.labels.includes(label));
    assert.equal(owners.length, 1, label);
    assert.equal(familyOfLabel(label)?.family, owners[0]?.family, label);
  }
  // A family that listed a label of another is refused at load.
  assert.throws(
    () =>
      assertLabelsAreDisjoint([
        { ...families[0], family: "A" } as (typeof families)[number],
        { ...families[0], family: "B" } as (typeof families)[number],
      ]),
    (err: unknown) => {
      assert.ok(err instanceof LabelInTwoFamiliesError);
      assert.match(err.message, /F100-FR-178/);
      return true;
    },
  );
  // The streams of §G.3: `WARN`, `STALE` and `INVALID` go to standard error.
  for (const label of ["WARN", "STALE", "INVALID"]) {
    assert.equal(streamOfLabel(label), "stderr", label);
  }
  for (const label of ["READY", "DIGEST", "LOOP", "MOL-MODE"]) {
    assert.equal(streamOfLabel(label), "stdout", label);
  }
  assert.equal(streamOfLabel("NOSUCHLABEL"), undefined);
  // Who owns what.
  assert.equal(GRAMMAR_OWNER, "100");
  assert.equal(A_LINE_BELONGS_TO, "the feature that prints it");
  // The printer of a family of pairs.
  assert.ok(bodyIsPairs(family("Supervisor lines")!));
  assert.ok(bodyIsPairs(family("Product lines")!));
  assert.equal(formatValue("plain"), "plain");
  assert.equal(formatValue("with a space"), '"with a space"');
  assert.equal(formatValue(null), "none");
  assert.equal(formatValue(3), "3");
  assert.equal(
    formatPairs([
      ["a", 1],
      ["b", "x y"],
    ]),
    'a=1 b="x y"',
  );
  assert.equal(printPairs("LOOP", [["strategy", "micro"]]), "[LOOP] strategy=micro");
  assert.deepEqual(
    parsePairs("a=1 b=2").map(([k, v]) => `${k}:${v}`),
    ["a:1", "b:2"],
  );
});

test("CT-100-280: the digest is the final line, from events, printed verbatim", () => {
  assert.equal(DIGEST_LABEL, "DIGEST");
  assert.equal(IS_THE_FINAL_LINE, true);
  assert.equal(PRODUCED_FROM, "events");
  assert.equal(PRODUCED_BY, "the runtime");
  assert.equal(A_HOST_SKILL_PRINTS_IT_VERBATIM, true);
  // The states of the digest are the closed set of §G.3.
  assert.deepEqual(
    [...DIGEST_STATES],
    [...(lineGrammar as { digestStates: string[] }).digestStates],
  );
  assert.deepEqual([...DIGEST_STATES], ["completed", "failed", "stopped", "dry-run"]);
  assert.equal(isDigestState("completed"), true);
  assert.equal(isDigestState("blocked"), false);
  assert.deepEqual([...DIGEST_KEYS], ["state", "exit", "last-stage", "child-exit", "evidence"]);

  // The grammar of the body: `child-exit=` only on a failed or stopped stage.
  const completed = formatDigest({
    state: "completed",
    exit: 0,
    lastStage: "specstride",
    evidence: null,
  });
  assert.equal(completed, "[DIGEST] state=completed exit=0 last-stage=specstride evidence=none");
  assert.ok(!completed.includes("child-exit="));
  const failed = formatDigest({
    state: "failed",
    exit: 22,
    lastStage: "specstride",
    childExit: 2,
    evidence: "pipeline:p-1:digest",
  });
  assert.match(failed, /child-exit=2/);
  assert.deepEqual([...CHILD_EXIT_STATES], ["failed", "stopped"]);
  const stopped = formatDigest({ state: "stopped", exit: 22, lastStage: null, evidence: null });
  assert.match(stopped, /child-exit=none/);
  assert.match(stopped, /last-stage=none/);
  // The digest reads back.
  assert.deepEqual(parseDigest(failed), {
    state: "failed",
    exit: 22,
    lastStage: "specstride",
    childExit: 2,
    evidence: "pipeline:p-1:digest",
  });
  assert.throws(() => parseDigest("[LOOP] strategy=micro"), /no digest/);
  assert.throws(() => parseDigest("[DIGEST] state=blocked exit=0"), /closed set/);
  // It is the final line of a run.
  assert.equal(digestIsTheFinalLine(["[LOOP] strategy=micro", completed]), true);
  assert.equal(digestIsTheFinalLine([completed, "[LOOP] strategy=micro"]), false);
  assert.equal(digestIsTheFinalLine([]), false);
  // A fact the baseline does not know goes to `status --json` and to
  // `[SPECSTRIDE-DIGEST]`, and under `parity` neither is printed.
  assert.equal(FACTS_THE_BASELINE_DOES_NOT_KNOW.length, 5);
  assert.equal(NEITHER_IS_PRINTED_UNDER_PARITY, true);
});

test("CT-100-279: the rule of the `[LOOP]` line (F100-FR-179)", () => {
  assert.equal(LOOP_LABEL, "LOOP");
  assert.equal(LOOP_IN_DEFAULT_OUTPUT_ONLY, true);
  assert.equal(LOOP_UNDER_PARITY_IS_PRINTED, false);
  assert.deepEqual([...LOOP_PARITY_ROWS], [19, 20]);

  // Printed with the layer on, in default output.
  assert.equal(loopLineIsPrinted({ layerOn: true, outputMode: "default" }).printed, true);
  // Never under the `parity` profile.
  const underParity = loopLineIsPrinted({ layerOn: true, profile: "parity" });
  assert.equal(underParity.printed, false);
  if (!underParity.printed) assert.equal(underParity.reason, "parity-profile");
  // Default output only: not in compatibility output.
  const compat = loopLineIsPrinted({ layerOn: true, outputMode: "compat" });
  assert.equal(compat.printed, false);
  if (!compat.printed) assert.equal(compat.reason, "compatibility-output");
  // Only when a layer is on, or was switched off by rule with an announced
  // reason.
  const never = loopLineIsPrinted({ layerOn: false });
  assert.equal(never.printed, false);
  if (!never.printed) assert.equal(never.reason, "layer-never-engaged");
  assert.equal(
    loopLineIsPrinted({ layerOn: false, switchedOffByRule: true, reason: "quota" }).printed,
    true,
  );
  assert.equal(
    loopLineIsPrinted({ layerOn: false, switchedOffByRule: true, reason: "" }).printed,
    false,
    "a reason must be announced",
  );

  // The keys with the layer on, with the layer off, and with parallel units on.
  assert.equal(LOOP_KEYS_WITH_THE_LAYER_ON.length, 14);
  assert.deepEqual([...LOOP_KEYS_WITH_THE_LAYER_OFF], ["strategy", "reason"]);
  assert.equal(STRATEGY_WITH_THE_LAYER_OFF, "classic");
  assert.equal(LOOP_KEYS_WITH_PARALLEL_UNITS_ON.length, 8);
  assert.equal(parallelKeysArePrinted({ layerOn: true }), false);
  assert.equal(parallelKeysArePrinted({ layerOn: true, parallelUnitsOn: true }), true);
  assert.deepEqual([...loopLineKeys({ layerOn: false })], ["strategy", "reason"]);
  assert.deepEqual([...loopLineKeys({ layerOn: true })], [...LOOP_KEYS_WITH_THE_LAYER_ON]);
  assert.deepEqual(
    [...loopLineKeys({ layerOn: true, parallelUnitsOn: true })],
    [...LOOP_KEYS_WITH_THE_LAYER_ON, ...LOOP_KEYS_WITH_PARALLEL_UNITS_ON],
  );

  // The printer: the `parallel=` fields only with parallel units on.
  const values = {
    strategy: "micro",
    level: 1,
    containment: "C2",
    protection: "prevent",
    parallel: "on",
    workers: 2,
  };
  const withoutParallel = formatLoopLine({ layerOn: true }, values);
  assert.ok(withoutParallel !== null && !withoutParallel.includes("parallel="));
  const withParallel = formatLoopLine({ layerOn: true, parallelUnitsOn: true }, values);
  assert.match(String(withParallel), /parallel=on/);
  assert.match(String(withParallel), /workers=2/);
  // With the layer off: `strategy=classic reason=<reason>`.
  assert.equal(
    formatLoopLine({ layerOn: false, switchedOffByRule: true, reason: "quota" }, {}),
    "[LOOP] strategy=classic reason=quota",
  );
  // Under `parity` nothing is printed.
  assert.equal(formatLoopLine({ layerOn: true, profile: "parity" }, values), null);

  // `protection=` comes from the containment level (SL-6, T244).
  assert.deepEqual([...PROTECTION_VALUES_OF_THE_LINE], ["prevent", "detect", "detect,basic"]);
  assert.equal(
    protectionOfTheLine({ containment: "C0", sandboxDeniesControlPlaneWrites: true }),
    "detect",
  );
  assert.equal(
    protectionOfTheLine({ containment: "C1", sandboxDeniesControlPlaneWrites: true }),
    "detect",
  );
  assert.equal(
    protectionOfTheLine({ containment: "C2", sandboxDeniesControlPlaneWrites: true }),
    "prevent",
  );
  assert.equal(
    protectionOfTheLine({ containment: "C2", sandboxDeniesControlPlaneWrites: false }),
    "detect",
  );
  assert.equal(
    protectionOfTheLine({
      containment: "C1",
      sandboxDeniesControlPlaneWrites: false,
      onlyBasicProtection: true,
    }),
    "detect,basic",
  );

  // The loop line stands BEFORE the digest.
  const lines = endOfRunLines({ layerOn: true }, values, {
    state: "completed",
    exit: 0,
    lastStage: "specstride",
    evidence: null,
  });
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("[LOOP] "));
  assert.ok(digestIsTheFinalLine(lines));
  // With the line held back, the digest is still the final line.
  const onlyDigest = endOfRunLines({ layerOn: true, profile: "parity" }, values, {
    state: "completed",
    exit: 0,
    lastStage: "specstride",
    evidence: null,
  });
  assert.equal(onlyDigest.length, 1);
  assert.ok(digestIsTheFinalLine(onlyDigest));
});

test("CT-100-278: the keys of every supervisor line and every product line (F100-FR-178)", () => {
  const rawSupervisor = (lineGrammar as { supervisorLines: unknown[] }).supervisorLines;
  const rawProduct = (lineGrammar as { productLines: unknown[] }).productLines;
  assert.equal(supervisorLines.length, rawSupervisor.length);
  assert.equal(productLines.length, rawProduct.length);
  assert.equal(supervisorLines.length, 15, "fourteen labels; `[MOL-GATE]` has two rows");
  assert.equal(productLines.length, 6);
  assert.equal(lineKeyRows.length, 21);
  for (const row of lineKeyRows) {
    assert.match(row.label, LABEL_PATTERN, row.cell);
    assert.ok(row.keys.length > 0, row.cell);
    assert.notEqual(row.keysCell, "", row.cell);
  }
  // Every label of the two tables belongs to its own family of §G.3.
  for (const row of supervisorLines) {
    assert.ok(row.label.startsWith(SUPERVISOR_LINE_PREFIX), row.label);
    assert.equal(familyOfLabel(row.label)?.family, "Supervisor lines", row.label);
    assert.equal(streamOf(row.label), "stdout", row.label);
  }
  for (const row of productLines) {
    assert.ok(row.label.startsWith(PRODUCT_LINE_PREFIX), row.label);
    assert.equal(familyOfLabel(row.label)?.family, "Product lines", row.label);
    assert.notEqual(row.printedBy, null, row.label);
  }
  // `[MOL-GATE]` has two rows, one per discriminant.
  assert.equal(rowsOfLabel("MOL-GATE").length, 2);
  assert.deepEqual(
    keysOfLabel("MOL-GATE", "check").map((k) => k.key),
    ["check", "status", "reason", "detail"],
  );
  assert.deepEqual(
    keysOfLabel("MOL-GATE", "decision").map((k) => k.key),
    ["decision", "reason", "detail", "next"],
  );
  assert.deepEqual([...requiredKeysOf("MOL-GATE", "check")], ["check", "status"]);
  // The keys of a product line, as the table gives them.
  assert.deepEqual(
    keysOfLabel("SPECSTRIDE-LAUNCH").map((k) => k.key),
    ["run", "state"],
  );
  assert.deepEqual(
    keysOfLabel("SPECSTRIDE-DIGEST").map((k) => k.key),
    ["run", "comment", "changed", "delegated", "critic", "fallback", "alerts"],
  );
  assert.deepEqual([...requiredKeysOf("SPECSTRIDE-REFUSE")], ["action", "reason"]);

  // The printer: the keys in the order of the table, a text value quoted.
  assert.equal(
    printLine("SPECSTRIDE-LAUNCH", { state: "running", run: "r-1" }),
    "[SPECSTRIDE-LAUNCH] run=r-1 state=running",
  );
  assert.equal(
    printLine("SPECSTRIDE-REFUSE", { action: "resume", reason: "source-changed", file: "a b.md" }),
    '[SPECSTRIDE-REFUSE] action=resume reason=source-changed file="a b.md"',
  );
  // A key the table does not hold is refused: a feature does not add a key to a
  // line of the tables of §G.3.
  assert.throws(
    () => printLine("SPECSTRIDE-LAUNCH", { run: "r-1", secret: "x" }),
    (err: unknown) => {
      assert.ok(err instanceof UnknownLineKeyError);
      assert.match(err.message, /F100-FR-178/);
      return true;
    },
  );
  assert.equal(rowOf("NOSUCHLABEL"), undefined);
});

test("CT-100-281: an implementation file is named by its logical component (F100-FR-181)", () => {
  const raw = (normalization as { componentNames: unknown[] }).componentNames;
  assert.equal(componentNames.length, raw.length);
  assert.equal(componentNames.length, 16, "the sixteen rows of the component-name table");
  assert.deepEqual(loadComponentNames(), componentNames);
  assert.equal(COMPONENT_NAMES.length, 19, "three rows name more than one component");
  for (const row of componentNames) {
    assert.notEqual(row.asIs, "");
    assert.ok(row.names.length > 0, row.asIs);
  }
  assert.equal(COMPONENT_NAME_OF["The engine script of the Specstride baseline"], "engine");
  assert.equal(COMPONENT_NAME_OF["The pass-loop script"], "pass-loop");
  assert.equal(COMPONENT_NAME_OF["The critic module"], "critic");

  // The substitution leaves the text after the name EQUAL.
  const baseline = "The pass-loop script: phase 3, attempt 2, pass 5 ended";
  const ported = substituteComponentName(baseline);
  assert.equal(ported, "pass-loop: phase 3, attempt 2, pass 5 ended");
  assert.equal(textAfterTheName(baseline), ": phase 3, attempt 2, pass 5 ended");
  assert.ok(textAfterTheNameIsEqual(baseline, ported));
  // A prefix the table does not hold is compared as written (§X.8).
  const unknown = "Some other script: a message";
  assert.equal(substituteComponentName(unknown), unknown);
  assert.equal(textAfterTheName(unknown), unknown);
});
