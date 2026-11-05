/**
 * T018 — CT-124-34 and CT-124-35 (F124-FR-034, F124-FR-035).
 *
 * CT-124-34: a failed preflight of a primary refuses the launch and names
 * what is missing; of a fallback it disqualifies the candidate.
 *
 * CT-124-35: a refusal ends `launch` with the outcome `refused` and exit 4,
 * a foreground `run` with exit 3; no run state is written.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { resolveRoles, refusalExitCode, writesNoRunState } from "../../src/roles/resolve.ts";
import { bare, allowAll, configuration } from "./helpers.ts";

const REGISTRY = [
  bare("primary-stub", "proposer", "critic"),
  bare("fallback-stub", "proposer", "critic"),
  bare("default-harness", "proposer", "critic"),
];

const BASE = {
  registry: REGISTRY,
  roles: ["proposer", "critic"],
  termsGate: allowAll(),
};

function input(surface: "launch" | "run", missing: readonly string[]) {
  return {
    ...BASE,
    configuration: configuration({
      phases: ["1"],
      defaultHarness: "default-harness",
      proposer: { flag: "primary-stub" },
      fallbacks: { proposer: [{ name: "fallback-stub", scope: "user" }] },
    }),
    preflight: {
      check: (harness: string) =>
        harness === "primary-stub" ? { ok: false, missing } : { ok: true },
    },
    surface,
  };
}

test("CT-124-34 a failed preflight of a primary refuses and names what is missing", () => {
  const resolved = resolveRoles(input("launch", ["the credential of the endpoint", "its binary"]));
  assert.equal(resolved.outcome, "refused");
  if (resolved.outcome !== "refused") return;
  assert.match(resolved.stderr[0], /preflight of primary-stub for the proposer failed/);
  assert.ok(resolved.stderr[0].includes("the credential of the endpoint"));
  assert.ok(resolved.stderr[0].includes("its binary"));
  assert.deepEqual(resolved.refusals[0]?.reason, "preflight-failed");
});

test("CT-124-34 a failed preflight of a fallback disqualifies it and never refuses", () => {
  const resolved = resolveRoles({
    ...input("launch", []),
    configuration: configuration({
      phases: ["1"],
      defaultHarness: "default-harness",
      proposer: { flag: "primary-stub" },
      fallbacks: { proposer: [{ name: "fallback-stub", scope: "user" }] },
    }),
    preflight: {
      check: (harness: string) => (harness === "fallback-stub" ? { ok: false } : { ok: true }),
    },
  });
  assert.equal(resolved.outcome, "resolved");
  if (resolved.outcome !== "resolved") return;
  assert.equal(
    (resolved.plan["1"]?.proposer ?? []).some((entry) => entry.harness === "fallback-stub"),
    false,
  );
});

test("CT-124-34 the preflight is asked for the harness of every role", () => {
  const asked: string[] = [];
  const resolved = resolveRoles({
    ...BASE,
    configuration: configuration({ phases: ["1"], defaultHarness: "default-harness" }),
    preflight: {
      check: (harness: string, role: string) => {
        asked.push(`${role}/${harness}`);
        return { ok: true };
      },
    },
    surface: "launch",
  });
  assert.equal(resolved.outcome, "resolved");
  assert.ok(asked.includes("proposer/default-harness"));
  assert.ok(asked.includes("critic/default-harness"));
});

test("CT-124-35 launch ends refused with exit 4, a foreground run with exit 3", () => {
  const launch = resolveRoles(input("launch", ["its binary"]));
  const run = resolveRoles(input("run", ["its binary"]));
  assert.equal(launch.outcome, "refused");
  assert.equal(run.outcome, "refused");
  assert.equal(refusalExitCode(launch, "launch"), 4);
  assert.equal(refusalExitCode(run, "run"), 3);
  assert.equal(refusalExitCode(run, "launch"), 4);
  assert.equal(refusalExitCode(launch, "run"), 3);
});

test("CT-124-35 no run state is written for a refusal", () => {
  const launch = resolveRoles(input("launch", ["its binary"]));
  assert.equal(writesNoRunState(launch), true);
  // A refusal carries no plan at all: there is nothing to write.
  assert.equal("plan" in launch, false);
});
