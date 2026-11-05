/**
 * T009 — CT-124-24 and CT-124-25 (F124-FR-024, F124-FR-025, F124-SC-005).
 *
 * CT-124-24: the proposer comes from one of FOUR sources — a flag, the
 * environment, the configuration, the shipped default — and the plan records
 * which; discovery never sets or changes the proposer; an absent proposer
 * refuses the launch and names the candidates.
 *
 * CT-124-25: with no role named, the default harness plays the proposer and
 * the critic on different model tiers.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  resolveProposer,
  defaultRoles,
  sourceOfTheProposer,
  absentProposerRefusal,
} from "../../src/roles/proposer.ts";
import { SOURCES_OF_THE_PROPOSER } from "../../src/roles/proposer.ts";
import { resolveRoles } from "../../src/roles/resolve.ts";
import { bare, optional, allowAll, preflightOk, configuration } from "./helpers.ts";

const REGISTRY = [
  optional("endpoint-stub", "provider/model", "proposer", "critic"),
  bare("flag-stub", "proposer", "critic"),
  bare("default-harness", "proposer", "critic"),
];

const proposerInput = {
  defaultHarness: "default-harness",
  registry: REGISTRY,
};

test("CT-124-24 the four sources, in order, each recorded", () => {
  assert.deepEqual(SOURCES_OF_THE_PROPOSER, ["flag", "environment", "configuration", "default"]);
  assert.deepEqual(sourceOfTheProposer({ ...proposerInput, flag: "flag-stub" }), {
    spec: "flag-stub",
    source: "flag",
  });
  assert.deepEqual(sourceOfTheProposer({ ...proposerInput, environment: "flag-stub" }), {
    spec: "flag-stub",
    source: "environment",
  });
  assert.deepEqual(sourceOfTheProposer({ ...proposerInput, configuration: "flag-stub" }), {
    spec: "flag-stub",
    source: "configuration",
  });
  assert.deepEqual(sourceOfTheProposer(proposerInput), {
    spec: "default-harness",
    source: "default",
  });
  // The winner is the first source that names one.
  assert.equal(
    sourceOfTheProposer({ ...proposerInput, flag: "flag-stub", environment: "endpoint-stub" })
      .source,
    "flag",
  );
});

test("CT-124-24 the plan records the source of the proposer", () => {
  for (const [override, expected] of [
    [{ flag: "flag-stub" }, "flag"],
    [{ environment: "flag-stub" }, "environment"],
    [{ configuration: "flag-stub" }, "configuration"],
    [{}, "default"],
  ] as const) {
    const resolved = resolveRoles({
      registry: REGISTRY,
      roles: ["proposer", "critic"],
      configuration: configuration({
        phases: ["1"],
        defaultHarness: "default-harness",
        proposer: override,
      }),
      termsGate: allowAll(),
      preflight: preflightOk(),
      surface: "launch",
    });
    assert.equal(resolved.outcome, "resolved");
    if (resolved.outcome !== "resolved") return;
    const entry = resolved.plan["1"]?.proposer?.[0];
    assert.equal(entry?.source, expected, JSON.stringify(override));
  }
});

test("CT-124-24 discovery never sets or changes the proposer", () => {
  // The input of the proposer takes no discovery result at all: adding a
  // discovered harness to the registry cannot change a proposer named by a
  // flag, and cannot name one where no source named it.
  const withDiscovered = [...REGISTRY, bare("discovered-stub", "proposer", "critic")];
  assert.equal(
    resolveProposer({ ...proposerInput, flag: "flag-stub", registry: withDiscovered }).ok,
    true,
  );
  if (resolveProposer({ ...proposerInput, flag: "flag-stub", registry: withDiscovered }).ok) {
    const { proposer } = resolveProposer({
      ...proposerInput,
      flag: "flag-stub",
      registry: withDiscovered,
    }) as { ok: true; proposer: { name: string; source: string } };
    assert.equal(proposer.name, "flag-stub");
    assert.equal(proposer.source, "flag");
  }
  // No input field of the proposer is a discovery result.
  const text = readFileSync(new URL("../../src/roles/proposer.ts", import.meta.url), "utf8");
  assert.equal(
    /discovered\s*\??:|discovery\s*\??:/.test(text),
    false,
    "proposer.ts never takes a discovery result as input",
  );
});

test("CT-124-24 an absent proposer refuses and names the candidates", () => {
  const emptyRegistry = [bare("endpoint-stub", "critic")];
  const refusal = absentProposerRefusal({ ...proposerInput, registry: emptyRegistry });
  assert.equal(refusal.exitCodeLaunch, 4);
  assert.match(refusal.line, /\[SPECSTRIDE-ROLES\]/);
  assert.match(refusal.line, /refused/);
  // The refusal names the harnesses that support the role — here, none do,
  // so the list is empty and the line says the registry holds nothing for it.
  assert.equal(refusal.line.includes("endpoint-stub"), false);
  const populated = absentProposerRefusal({ ...proposerInput, registry: REGISTRY });
  assert.match(populated.line, /endpoint-stub\[:provider\/model\] \| flag-stub \| default-harness/);
  // And the resolver ends the launch with it.
  const resolved = resolveRoles({
    registry: emptyRegistry,
    roles: ["proposer", "critic"],
    configuration: configuration({ phases: ["1"], defaultHarness: "default-harness" }),
    termsGate: allowAll(),
    preflight: preflightOk(),
    surface: "launch",
  });
  assert.equal(resolved.outcome, "refused");
  if (resolved.outcome !== "refused") return;
  assert.equal(resolved.exitCode, 4);
});

test("CT-124-24 the default proposer must be in the registry, or the launch is refused", () => {
  const result = resolveProposer({
    ...proposerInput,
    defaultHarness: "no-such-default",
  });
  assert.equal(result.ok, false);
});

test("CT-124-25 the default roles: one harness, both roles, different model tiers", () => {
  const defaults = defaultRoles({
    defaultHarness: "default-harness",
    phases: ["1", "2"],
  });
  for (const phase of ["1", "2"]) {
    const proposerEntry = defaults.find((d) => d.phase === phase && d.role === "proposer");
    const criticEntry = defaults.find((d) => d.phase === phase && d.role === "critic");
    assert.equal(proposerEntry?.harness, "default-harness");
    assert.equal(criticEntry?.harness, "default-harness");
    assert.equal(proposerEntry?.modelTier, "proposer");
    assert.equal(criticEntry?.modelTier, "critic");
    assert.notEqual(proposerEntry?.modelTier, criticEntry?.modelTier);
    assert.equal(proposerEntry?.source, "default");
  }
});

test("CT-124-25 with no role named the resolver plans both roles on the default harness", () => {
  const resolved = resolveRoles({
    registry: REGISTRY,
    roles: ["proposer", "critic"],
    configuration: configuration({ phases: ["1"], defaultHarness: "default-harness" }),
    termsGate: allowAll(),
    preflight: preflightOk(),
    surface: "launch",
  });
  assert.equal(resolved.outcome, "resolved");
  if (resolved.outcome !== "resolved") return;
  assert.equal(resolved.plan["1"]?.proposer?.[0]?.harness, "default-harness");
  assert.equal(resolved.plan["1"]?.proposer?.[0]?.modelTier, "proposer");
  assert.equal(resolved.plan["1"]?.critic?.[0]?.harness, "default-harness");
  assert.equal(resolved.plan["1"]?.critic?.[0]?.modelTier, "critic");
  // A named critic is not overridden by the default (F124-FR-026).
  const namedCritic = resolveRoles({
    registry: REGISTRY,
    roles: ["proposer", "critic"],
    configuration: configuration({
      phases: ["1"],
      defaultHarness: "default-harness",
      critic: { flag: "endpoint-stub" },
    }),
    termsGate: allowAll(),
    preflight: preflightOk(),
    surface: "launch",
  });
  assert.equal(namedCritic.outcome, "resolved");
  if (namedCritic.outcome !== "resolved") return;
  assert.equal(namedCritic.plan["1"]?.critic?.[0]?.harness, "endpoint-stub");
});
