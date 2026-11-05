/**
 * T073 — contract tests CT-100-313, CT-100-314 and CT-100-315 for the
 * normalization contract (annex X, §X.8; F100-FR-213, F100-FR-214,
 * F100-FR-215).
 */
import test from "node:test";
import assert from "node:assert/strict";
import normalizationData from "../data/normalization.json" with { type: "json" };
import oldSideData from "../data/layout-old-side.json" with { type: "json" };
import {
  FIRST_RULE,
  HERMETIC_ENVIRONMENT_MAPPING,
  LAST_RULE,
  N_02_APPLIES_TO_MESSAGE_TEXT,
  NormalizationError,
  RULE_COUNT,
  STUB_TRANSCRIPTS_ARE_A_COMPARED_SURFACE,
  STUB_TRANSCRIPT_FORM_IS_TRANSPORT_NEUTRAL,
  A_RULE_THAT_REPLACES_NOTHING_FAILS_THE_SUITE,
  assertRules,
  hermeticEnvironment,
  launchContractKey,
  launchContractKeyMap,
  modeMap,
  resumeExitCode,
  resumeExitCodeMap,
  rule,
  rules,
} from "../src/profile/normalization.ts";
import {
  APPROVAL_MARKER_LOGICAL_NAME,
  AS_IS_DIRECTORY_PLACEHOLDERS,
  ITEM_COUNT,
  RULE_FOR_A_REGISTRY_ENTRY_NOT_CARRIED,
  comparedRows,
  componentNameOf,
  componentNames,
  environmentAliases,
  itemsHandledByARule,
  join,
  joinAll,
  oldSideItems,
  placeholders,
} from "../src/profile/layout-old-side.ts";
import { holdsLogicalName } from "../src/ids/logical-names.ts";

test("CT-100-313: the normalization rules are exactly N-01 to N-29 (F100-FR-213)", () => {
  assert.equal(RULE_COUNT, 29);
  assert.equal(FIRST_RULE, "N-01");
  assert.equal(LAST_RULE, "N-29");
  assert.equal(rules.length, 29);
  assert.equal((normalizationData as { rules: unknown[] }).rules.length, 29);
  assert.deepEqual(
    rules.map((r) => r.id),
    Array.from({ length: 29 }, (_, i) => `N-${String(i + 1).padStart(2, "0")}`),
  );
  for (const r of rules) {
    assert.notEqual(r.subject.trim(), "", `${r.id} names its subject`);
    assert.notEqual(r.rule.trim(), "", `${r.id} states its rule`);
  }
  assert.equal(rule("N-15")?.subject, "Implementation names in text");
  assert.equal(rule("N-99"), undefined);
  // The loader asserts: a rule that is missing, and a rule added without a
  // register row, are both refused.
  assert.doesNotThrow(() => assertRules());
  assert.throws(() => assertRules(rules.slice(1)), NormalizationError);
  const added = [...rules, { id: "N-30", subject: "s", rule: "r" }];
  assert.throws(() => assertRules(added), /carries no row of the divergence register/);
  assert.doesNotThrow(() => assertRules(added, (id) => (id === "N-30" ? "DV-999" : undefined)));
  // N-02 applies to the text of messages as well as to captured trees, and a
  // rule that replaces nothing fails the suite.
  assert.equal(N_02_APPLIES_TO_MESSAGE_TEXT, true);
  assert.equal(A_RULE_THAT_REPLACES_NOTHING_FAILS_THE_SUITE, true);
});

test("CT-100-313: the mode map, the exit-code map of resume and the key-name map (F100-FR-213)", () => {
  assert.deepEqual({ ...modeMap }, { generate: "dry-run", run: "run", auto: "run" });
  assert.ok(resumeExitCodeMap.length > 0);
  for (const row of resumeExitCodeMap) {
    assert.equal(typeof row.asIs, "number");
    assert.equal(typeof row.next, "number");
    assert.notEqual(row.cause.trim(), "");
  }
  assert.equal(resumeExitCode(1), 5);
  assert.equal(resumeExitCode(999), undefined);
  // The key map of the launch contract, as amended on 2026-09-30 (T297): it now
  // holds the second pair `schema_version` -> `schema` beside the first.
  assert.deepEqual(
    { ...launchContractKeyMap },
    { "configuration.auto": "configuration.relaunch", schema_version: "schema" },
  );
  assert.equal(launchContractKey("configuration.auto"), "configuration.relaunch");
  assert.equal(launchContractKey("schema_version"), "schema");
  assert.equal(launchContractKey("nothing"), undefined);
});

test("CT-100-314: the old side is joined to the new side by logical name (F100-FR-214, F100-FR-056)", () => {
  assert.equal(oldSideItems.length, ITEM_COUNT);
  assert.equal((oldSideData as { items: unknown[] }).items.length, ITEM_COUNT);
  for (const item of oldSideItems) {
    assert.notEqual(item.item.trim(), "", "every item has its behaviour-item id");
    assert.notEqual(item.system.trim(), "", `${item.item} names its baseline`);
    assert.ok(item.asIsPaths.length > 0 || item.rule !== "", `${item.item} has a path or a rule`);
  }
  // An item with a logical name resolves through the resolver of T034; an
  // item with a rule reports the rule.
  const joined = joinAll();
  assert.equal(joined.length, oldSideItems.length);
  const byName = joined.filter((j) => j.kind === "logical-name");
  const byRule = joined.filter((j) => j.kind === "rule");
  assert.ok(byName.length > 0, "items resolve through the new side");
  assert.equal(byName.length + byRule.length, joined.length);
  for (const j of byName) {
    if (j.kind !== "logical-name") continue;
    assert.ok(holdsLogicalName(j.logicalName), `${j.item}: ${j.logicalName}`);
  }
  for (const j of byRule) {
    if (j.kind !== "rule") continue;
    assert.notEqual(j.rule ?? "", "", `${j.item} reports the rule that stands`);
  }
  assert.deepEqual(itemsHandledByARule().length, byRule.length);
  // The rule for a baseline registry entry the port does not carry.
  assert.equal(RULE_FOR_A_REGISTRY_ENTRY_NOT_CARRIED, "N-15");
  assert.notEqual(rule(RULE_FOR_A_REGISTRY_ENTRY_NOT_CARRIED), undefined);
  // The as-is approval marker maps to `gate:<N>:approved` (F100-FR-056).
  assert.equal(APPROVAL_MARKER_LOGICAL_NAME, "gate:<N>:approved");
  assert.ok(
    comparedRows.some((r) => r.logicalName === APPROVAL_MARKER_LOGICAL_NAME),
    "the old side maps the as-is approval marker",
  );
  const one = join(oldSideItems[0] as never);
  assert.ok(one.kind === "logical-name" || one.kind === "rule");
  // The as-is directory placeholders are data of this file and of no other.
  assert.ok(AS_IS_DIRECTORY_PLACEHOLDERS.includes("<state>"));
  assert.ok(Object.keys(placeholders).length > 0);
});

test("CT-100-314: the environment alias table and the component-name table (F100-FR-214)", () => {
  assert.ok(environmentAliases.length > 0);
  for (const row of environmentAliases) {
    assert.notEqual(row.asIs.trim(), "", "every row names the as-is variable");
    assert.notEqual(row.key.trim(), "", "every row names the key");
  }
  assert.ok(componentNames.length > 0);
  for (const row of componentNames) {
    assert.notEqual(row.asIsFile.trim(), "", "every row names the as-is file");
    assert.notEqual(row.componentName.trim(), "", "every row names the logical component");
  }
  assert.equal(componentNameOf("The engine script of the Specstride baseline"), "engine");
  assert.equal(componentNameOf("no such file"), undefined);
});

test("CT-100-315: the hermetic environment of the oracle is a documented mapping (F100-FR-215)", () => {
  assert.equal(HERMETIC_ENVIRONMENT_MAPPING, "environmentAliases");
  assert.ok(hermeticEnvironment.length > 0);
  for (const row of hermeticEnvironment) {
    assert.notEqual(row.variable.trim(), "", "every variable of the mapping is named");
    // Every variable maps to a key, or the table says in words that it maps
    // to none (the as-is hand-over of a prompt as a file, a variable accepted
    // without effect, a name that is not carried).
    assert.notEqual(
      row.key.trim() === "" ? row.note.trim() : row.key.trim(),
      "",
      `${row.variable} maps to a key or states why it maps to none`,
    );
    if (row.key.trim() === "") {
      assert.match(row.note, /No key|without effect|Not carried/i, `${row.variable}: ${row.note}`);
    }
  }
  assert.ok(hermeticEnvironment.some((r) => r.variable === "SPECSTRIDE_PROPOSER"));
  assert.equal(
    hermeticEnvironment.find((r) => r.variable === "SPECSTRIDE_PROPOSER")?.key,
    "roles.proposer.harness",
  );
  // Stub transcripts are a compared surface, neutral to the transport.
  assert.equal(STUB_TRANSCRIPTS_ARE_A_COMPARED_SURFACE, true);
  assert.equal(STUB_TRANSCRIPT_FORM_IS_TRANSPORT_NEUTRAL, true);
});
