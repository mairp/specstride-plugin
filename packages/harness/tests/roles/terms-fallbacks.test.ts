/**
 * T017 — CT-124-32, CT-124-33 and CT-124-36 (F124-FR-032, F124-FR-033,
 * F124-FR-036).
 *
 * CT-124-32: the terms gate is asked for EVERY entry of the plan, the
 * fallbacks included; a refused entry never enters the plan; a refused
 * primary refuses the launch.
 *
 * CT-124-33: fallbacks only by opt-in, accepted from user configuration, the
 * environment and flags only; without an opt-in the list is empty; the
 * product never adds a fallback by itself.
 *
 * CT-124-36: unknown terms are usable when the consumer named the harness,
 * and never otherwise — never a default, never an automatic pick, never a
 * product-added fallback.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { resolveRoles, acceptedFallbacks } from "../../src/roles/resolve.ts";
import type { RolePlanEntry } from "../../src/roles/types.ts";
import { bare, allowAll, preflightOk, configuration } from "./helpers.ts";

const REGISTRY = [
  bare("primary-stub", "proposer", "critic"),
  bare("fallback-stub", "proposer", "critic"),
  bare("default-harness", "proposer", "critic"),
];

const BASE = {
  registry: REGISTRY,
  roles: ["proposer", "critic"],
  termsGate: allowAll(),
  preflight: preflightOk(),
  surface: "launch" as const,
};

function gate(
  decisions: Record<string, { decision: "allowed" | "refused" | "unknown"; row: string }>,
) {
  return {
    decide: (harness: string) =>
      decisions[harness] ?? { decision: "allowed" as const, row: "default-row" },
  };
}

test("CT-124-32 the terms gate is asked for every entry, the fallbacks included", () => {
  const asked: string[] = [];
  const resolved = resolveRoles({
    ...BASE,
    configuration: configuration({
      phases: ["1"],
      defaultHarness: "default-harness",
      proposer: { flag: "primary-stub" },
      fallbacks: { proposer: [{ name: "fallback-stub", scope: "user" }] },
    }),
    termsGate: {
      decide: (harness: string, role: string, phase: string) => {
        asked.push(`${phase}/${role}/${harness}`);
        return { decision: "allowed" as const, row: "provider:row" };
      },
    },
  });
  assert.equal(resolved.outcome, "resolved");
  assert.ok(asked.includes("1/proposer/primary-stub"));
  assert.ok(asked.includes("1/proposer/fallback-stub"), "the fallback is asked too");
  // And the decision rests on a recorded row.
  if (resolved.outcome !== "resolved") return;
  const fallback = resolved.plan["1"]?.proposer?.[1];
  assert.equal(fallback?.terms.row, "provider:row");
});

test("CT-124-32 a refused entry never enters the plan", () => {
  const resolved = resolveRoles({
    ...BASE,
    configuration: configuration({
      phases: ["1"],
      defaultHarness: "default-harness",
      proposer: { flag: "primary-stub" },
      fallbacks: { proposer: [{ name: "fallback-stub", scope: "user" }] },
    }),
    termsGate: gate({ "fallback-stub": { decision: "refused", row: "terms:refused" } }),
  });
  assert.equal(resolved.outcome, "resolved");
  if (resolved.outcome !== "resolved") return;
  const proposer = resolved.plan["1"]?.proposer ?? [];
  assert.equal(
    proposer.some((entry) => entry.harness === "fallback-stub"),
    false,
  );
  assert.equal(proposer[0]?.kind, "primary");
});

test("CT-124-32 a refused primary of a role refuses the launch", () => {
  const resolved = resolveRoles({
    ...BASE,
    configuration: configuration({
      phases: ["1"],
      defaultHarness: "default-harness",
      proposer: { flag: "primary-stub" },
    }),
    termsGate: gate({ "primary-stub": { decision: "refused", row: "terms:refused" } }),
  });
  assert.equal(resolved.outcome, "refused");
  if (resolved.outcome !== "refused") return;
  assert.equal(resolved.exitCode, 4);
  assert.match(resolved.stderr[0], /terms gate refused primary-stub/);
});

test("CT-124-32 a fallback is recorded as to be gated again when it is used", () => {
  const resolved = resolveRoles({
    ...BASE,
    configuration: configuration({
      phases: ["1"],
      defaultHarness: "default-harness",
      proposer: { flag: "primary-stub" },
      fallbacks: { proposer: [{ name: "fallback-stub", scope: "user" }] },
    }),
  });
  assert.equal(resolved.outcome, "resolved");
  if (resolved.outcome !== "resolved") return;
  assert.equal(resolved.plan["1"]?.proposer?.[1]?.regate, true);
  assert.equal(resolved.plan["1"]?.proposer?.[0]?.regate, false);
});

test("CT-124-33 fallbacks only by opt-in from user scope, environment or flags", () => {
  assert.deepEqual(
    acceptedFallbacks([
      { name: "a", scope: "user" },
      { name: "b", scope: "environment" },
      { name: "c", scope: "flag" },
      { name: "d", scope: "project" },
    ]).map((fallback) => fallback.name),
    ["a", "b", "c"],
  );
  const resolved = resolveRoles({
    ...BASE,
    configuration: configuration({
      phases: ["1"],
      defaultHarness: "default-harness",
      fallbacks: { critic: [{ name: "fallback-stub", scope: "project" }] },
    }),
  });
  assert.equal(resolved.outcome, "resolved");
  if (resolved.outcome !== "resolved") return;
  // A project-scope opt-in is not accepted: the list stays empty.
  assert.equal(resolved.plan["1"]?.critic?.length, 1);
});

test("CT-124-33 without an opt-in the fallback list is empty, and the product adds none", () => {
  const resolved = resolveRoles({
    ...BASE,
    configuration: configuration({ phases: ["1"], defaultHarness: "default-harness" }),
  });
  assert.equal(resolved.outcome, "resolved");
  if (resolved.outcome !== "resolved") return;
  for (const role of ["proposer", "critic"]) {
    const entries: readonly RolePlanEntry[] = resolved.plan["1"]?.[role] ?? [];
    assert.equal(entries.length, 1, `${role} holds only its primary`);
    assert.equal(entries[0]?.kind, "primary");
  }
});

test("CT-124-36 unknown terms are usable when the consumer named the harness", () => {
  const resolved = resolveRoles({
    ...BASE,
    configuration: configuration({
      phases: ["1"],
      defaultHarness: "default-harness",
      critic: { flag: "primary-stub" },
    }),
    termsGate: gate({ "primary-stub": { decision: "unknown", row: "terms:unknown" } }),
  });
  assert.equal(resolved.outcome, "resolved");
  if (resolved.outcome !== "resolved") return;
  assert.equal(resolved.plan["1"]?.critic?.[0]?.harness, "primary-stub");
  assert.equal(resolved.plan["1"]?.critic?.[0]?.terms.decision, "unknown");
  assert.ok(resolved.unknownTermsWarnings.includes("primary-stub"), "the warning is recorded");
});

test("CT-124-36 unknown terms are never usable otherwise", () => {
  // Not as a default ...
  const asDefault = resolveRoles({
    ...BASE,
    configuration: configuration({ phases: ["1"], defaultHarness: "primary-stub" }),
    termsGate: gate({ "primary-stub": { decision: "unknown", row: "terms:unknown" } }),
  });
  assert.equal(asDefault.outcome, "refused");
  // ... and not where nothing named it: a project-scope fallback opt-in is
  // not accepted, so a harness of unknown terms never enters the plan that
  // way, and the product itself adds no fallback (F124-FR-033, F124-FR-036).
  const asProjectFallback = resolveRoles({
    ...BASE,
    configuration: configuration({
      phases: ["1"],
      defaultHarness: "default-harness",
      fallbacks: { critic: [{ name: "fallback-stub", scope: "project" }] },
    }),
    termsGate: gate({ "fallback-stub": { decision: "unknown", row: "terms:unknown" } }),
  });
  assert.equal(asProjectFallback.outcome, "resolved");
  if (asProjectFallback.outcome !== "resolved") return;
  assert.equal(
    (asProjectFallback.plan["1"]?.critic ?? []).some((entry) => entry.harness === "fallback-stub"),
    false,
  );
  assert.deepEqual(asProjectFallback.unknownTermsWarnings, []);
});
