/**
 * T022 — the composition root of the launch verb for feature 124
 * (packages/cli/src/commands/launch-roles.ts).
 *
 * What this test holds:
 *
 * - the resolver of `@specstride/harness` roles is composed with the
 *   surfaces of the handshake: a REFUSED LAUNCH reports exit 4, a REFUSED
 *   RUN reports exit 3, and both report `wroteRunState: false` and carry the
 *   refusal lines on stderr (F124-FR-035);
 * - a resolution MAY write the resolved registry, a refusal NEVER does;
 * - the deps are injected: no registry, no terms gate, no preflight is
 *   constructed here, so no harness name is named in this file either
 *   (F124-SC-008).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  LAUNCH_REFUSED_EXIT,
  RUN_REFUSED_EXIT,
  exitCodeFor,
  mayWriteResolvedRegistry,
  resolveRolesForVerb,
  type LaunchRolesDeps,
} from "../../src/commands/launch-roles.ts";
import { bare } from "../../../harness/tests/roles/helpers.ts";

const REGISTRY = [
  bare("default-harness", "proposer", "critic"),
  bare("endpoint-stub", "proposer", "critic"),
];

function deps(overrides: Partial<LaunchRolesDeps> = {}): LaunchRolesDeps {
  return {
    registry: { roles: [{ id: "proposer" }, { id: "critic" }] },
    configuration: {
      phases: ["1"],
      perPhase: {},
      models: {},
      fallbacks: {},
      proposer: {},
      critic: {},
      defaultHarness: "default-harness",
    },
    termsGate: { decide: () => ({ decision: "allowed" as const, row: "provider:fixture" }) },
    preflight: { check: () => ({ ok: true }) },
    namedHarnesses: REGISTRY,
    ...overrides,
  };
}

test("T022: a refused launch is a handshake of exit 4, with no run state written", () => {
  const outcome = resolveRolesForVerb(
    deps({
      configuration: {
        phases: ["1"],
        perPhase: {},
        models: {},
        fallbacks: {},
        proposer: { flag: "no-such-stub" },
        critic: {},
        defaultHarness: "default-harness",
      },
    }),
    "launch",
  );
  assert.equal(outcome.kind, "refused");
  if (outcome.kind !== "refused") return;
  assert.equal(outcome.handshake.exitCode, LAUNCH_REFUSED_EXIT);
  assert.equal(outcome.handshake.exitCode, 4);
  assert.equal(outcome.handshake.wroteRunState, false);
  assert.ok(outcome.handshake.stderr[0]?.includes("no-such-stub"));
  assert.equal(
    mayWriteResolvedRegistry({ outcome: "refused", refusals: [], exitCode: 4, stderr: [] }),
    false,
  );
});

test("T022: a refused run is a handshake of exit 3, and no state of a run is written", () => {
  const outcome = resolveRolesForVerb(
    deps({
      configuration: {
        phases: ["1"],
        perPhase: {},
        models: {},
        fallbacks: {},
        proposer: { flag: "no-such-stub" },
        critic: {},
        defaultHarness: "default-harness",
      },
    }),
    "run",
  );
  assert.equal(outcome.kind, "refused");
  if (outcome.kind !== "refused" || outcome.verb !== "run") return;
  assert.equal(outcome.exitCode, RUN_REFUSED_EXIT);
  assert.equal(outcome.exitCode, 3);
  assert.equal(outcome.wroteRunState, false);
  assert.ok(outcome.stderr[0]?.includes("no-such-stub"));
});

test("T022: a resolution may write the resolved registry, and the exit is 0", () => {
  const outcome = resolveRolesForVerb(deps(), "launch");
  assert.equal(outcome.kind, "resolved");
  assert.equal(exitCodeFor(outcome.resolution, "launch"), 0);
  assert.equal(mayWriteResolvedRegistry(outcome.resolution), true);
});

test("T022: the composition root names no harness (F124-SC-008)", () => {
  const source = readFileSync(
    new URL("../../src/commands/launch-roles.ts", import.meta.url),
    "utf8",
  );
  assert.equal(/\b(claude|codex|dsh|prime|endpoint-stub|stub-harness)\b/.test(source), false);
});
