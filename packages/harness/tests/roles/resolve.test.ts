/**
 * T008 — CT-124-20 and CT-124-23 (F124-FR-020, F124-FR-023, F124-SC-006).
 *
 * CT-124-20: role resolution is a pure function of the resolved registry,
 * the resolved configuration and the decisions of the terms gate — the same
 * inputs give the same plan, byte for byte.
 *
 * CT-124-23: every registered role is resolved for every phase, with the
 * per-phase settings of the consumer applied; and an import check shows that
 * no loop layer (packages/layer-micro) and no router imports role
 * resolution.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { resolveRoles } from "../../src/roles/resolve.ts";
import { renderRoleList } from "../../src/roles/names.ts";
import { bare, optional, allowAll, preflightOk, configuration } from "./helpers.ts";

const REGISTRY = [
  optional("dsh-like-stub", "provider/model", "proposer", "critic"),
  bare("named-critic-stub", "proposer", "critic"),
  bare("default-harness", "proposer", "critic"),
];

function input(overrides: Partial<Parameters<typeof resolveRoles>[0]> = {}) {
  return {
    registry: REGISTRY,
    roles: ["proposer", "critic"],
    configuration: configuration({ phases: ["1", "2"], defaultHarness: "default-harness" }),
    termsGate: allowAll(),
    preflight: preflightOk(),
    surface: "launch" as const,
    ...overrides,
  };
}

test("CT-124-20 the same inputs give the same plan", () => {
  const first = resolveRoles(input());
  const second = resolveRoles(input());
  assert.equal(first.outcome, "resolved");
  assert.equal(second.outcome, "resolved");
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(second.plan), JSON.stringify(first.plan));
});

test("CT-124-20 a different terms gate gives a different plan, the registry alone does not", () => {
  const refused = resolveRoles(
    input({ termsGate: { decide: () => ({ decision: "refused" as const, row: "r" }) } }),
  );
  assert.equal(refused.outcome, "refused");
  const resolved = resolveRoles(input());
  assert.equal(resolved.outcome, "resolved");
  // And nothing but the three inputs can change the plan: the resolver takes
  // no clock, no environment and no discovery result.
  const text = readFileSync(join(import.meta.dirname, "../../src/roles/resolve.ts"), "utf8");
  assert.equal(/Date\.now|process\.env|new Date\(/.test(text), false);
});

test("CT-124-23 every registered role is resolved for every phase, with per-phase settings", () => {
  const resolved = resolveRoles(input());
  assert.equal(resolved.outcome, "resolved");
  if (resolved.outcome !== "resolved") return;
  const plan = resolved.plan;
  for (const phase of ["1", "2"]) {
    for (const role of ["proposer", "critic"]) {
      const entries = plan[phase]?.[role] ?? [];
      assert.equal(entries.length >= 1, true, `${phase}/${role} resolved`);
      // F124-FR-023 — every fact of an entry is present.
      for (const entry of entries) {
        for (const fact of [
          "harness",
          "model",
          "modelTier",
          "authTier",
          "transport",
          "form",
          "containment",
          "terms",
          "source",
          "kind",
          "regate",
        ] as const) {
          assert.equal(fact in entry, true, `${phase}/${role}: ${fact}`);
        }
        assert.equal(entry.terms.decision, "allowed");
        assert.equal(entry.terms.row.length > 0, true, "the row it rests on");
      }
    }
  }
});

test("CT-124-23 the per-phase settings of the consumer are applied", () => {
  const resolved = resolveRoles(
    input({
      configuration: configuration({
        phases: ["1", "2"],
        defaultHarness: "default-harness",
        perPhase: {
          "1": { proposer: { model: "phase-one-model" } },
          "2": { proposer: { model: null } },
        },
        models: { proposer: "global-model" },
      }),
    }),
  );
  assert.equal(resolved.outcome, "resolved");
  if (resolved.outcome !== "resolved") return;
  assert.equal(resolved.plan["1"]?.proposer?.[0]?.model, "phase-one-model");
  // F124-FR-027 — where none is named the plan records null.
  assert.equal(resolved.plan["2"]?.proposer?.[0]?.model, null);
});

test("CT-124-23 the import check: no loop layer and no router imports role resolution", () => {
  const roots = [
    join(import.meta.dirname, "../../../layer-micro/src"),
    join(import.meta.dirname, "../../../pipeline/src"),
  ];
  const offenders: string[] = [];
  const ROLE_IMPORT =
    /(roles\/(resolve|names|proposer|registry-writer|types)|@specstride\/harness\/roles)/;
  for (const root of roots) {
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".ts")) {
          if (ROLE_IMPORT.test(readFileSync(path, "utf8"))) offenders.push(path);
        }
      }
    };
    walk(root);
  }
  assert.deepEqual(offenders, []);
  // And the check bites: the wiring of the composition root DOES import it,
  // and the pattern finds it there.
  const wiring = readFileSync(
    join(import.meta.dirname, "../../../cli/src/commands/launch-roles.ts"),
    "utf8",
  );
  assert.equal(ROLE_IMPORT.test(wiring), true);
});

test("CT-124-23 the rendered list comes from the registry, in registry order (F124-FR-031)", () => {
  assert.equal(
    renderRoleList(REGISTRY, "critic"),
    "dsh-like-stub[:provider/model] | named-critic-stub | default-harness",
  );
});
