/**
 * T016 — CT-124-28 (F124-FR-028): an unknown role name refuses the launch
 * with the rendered list, by default; with the switch of row 90 off, the
 * name is carried into the run — the as-is behaviour of F124-FR-029 and
 * F124-FR-030.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveRoles,
  REFUSE_UNKNOWN_DEFAULT,
  REFUSE_UNKNOWN_KEY,
  writesNoRunState,
} from "../../src/roles/resolve.ts";
import { renderRoleList } from "../../src/roles/names.ts";
import { bare, optional, allowAll, preflightOk, configuration } from "./helpers.ts";

const REGISTRY = [
  optional("endpoint-stub", "provider/model", "proposer", "critic"),
  bare("default-harness", "proposer", "critic"),
];

function input(refuseUnknown: boolean, surface: "launch" | "run") {
  return {
    registry: REGISTRY,
    roles: ["proposer", "critic"],
    configuration: configuration({
      phases: ["1"],
      defaultHarness: "default-harness",
      proposer: { flag: "no-such-proposer" },
      refuseUnknown,
    }),
    termsGate: allowAll(),
    preflight: preflightOk(),
    surface,
  };
}

test("CT-124-28 the switch is on by default, on the row-90 key", () => {
  assert.equal(REFUSE_UNKNOWN_DEFAULT, true);
  assert.equal(REFUSE_UNKNOWN_KEY, "roles.refuseUnknown");
});

test("CT-124-28 with the default settings an unknown role name refuses the launch with the rendered list", () => {
  const resolved = resolveRoles(input(true, "launch"));
  assert.equal(resolved.outcome, "refused");
  if (resolved.outcome !== "refused") return;
  assert.equal(resolved.exitCode, 4);
  const list = renderRoleList(REGISTRY, "proposer");
  assert.match(resolved.stderr[0], /\[SPECSTRIDE-ROLES\]/);
  assert.match(resolved.stderr[0], /refused/);
  assert.ok(resolved.stderr[0].includes(list), `the refusal lists ${list}`);
  // No run state is written for a refusal (F124-FR-035).
  assert.equal(writesNoRunState(resolved), true);
  assert.deepEqual(resolved.refusals[0]?.reason, "unknown-role-name");
});

test("CT-124-28 the same for the critic, against the critic's list", () => {
  const resolved = resolveRoles({
    ...input(true, "launch"),
    configuration: configuration({
      phases: ["1"],
      defaultHarness: "default-harness",
      critic: { flag: "no-such-critic" },
    }),
  });
  assert.equal(resolved.outcome, "refused");
  if (resolved.outcome !== "refused") return;
  assert.ok(resolved.stderr[0].includes(renderRoleList(REGISTRY, "critic")));
});

test("CT-124-28 with the switch off the name is carried into the run", () => {
  const carried = resolveRoles(input(false, "launch"));
  assert.equal(carried.outcome, "resolved");
  if (carried.outcome !== "resolved") return;
  // The unknown proposer name enters the plan, and the as-is result of
  // F124-FR-029 travels with the resolution: every pass ends 127.
  assert.equal(carried.plan["1"]?.proposer?.[0]?.harness, "no-such-proposer");
  assert.equal(carried.asIs.length, 1);
  assert.equal(carried.asIs[0]?.kind, "unknown-backend");
  assert.match(carried.asIs[0]?.message ?? "", /unknown backend 'no-such-proposer' \(/);
  assert.ok((carried.asIs[0]?.message ?? "").includes(renderRoleList(REGISTRY, "proposer")));
});

test("CT-124-28 with the switch off the unknown critic name is carried as the as-is provider failure", () => {
  const carried = resolveRoles({
    ...input(false, "launch"),
    configuration: configuration({
      phases: ["1"],
      defaultHarness: "default-harness",
      critic: { variable: "no-such-critic" },
      refuseUnknown: false,
    }),
  });
  assert.equal(carried.outcome, "resolved");
  if (carried.outcome !== "resolved") return;
  const asIs = carried.asIs.find((result) => result.role === "critic");
  assert.equal(asIs?.kind, "unknown-critic-provider");
  assert.equal(asIs?.result, 10);
  assert.match(asIs?.message ?? "", /unknown SPECSTRIDE_CRITIC provider: no-such-critic \(/);
});
