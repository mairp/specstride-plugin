/**
 * T034 — characterization test CT-124-22 for the replay of the resolved
 * registry (F124-FR-022, F124-SC-006, CQ-106): a resume and a relaunch read
 * the record and rank nothing; a new resolution only by the flag
 * `--resolve-roles` or when a harness of the stored plan no longer exists;
 * a changed version or descriptor hash warns and keeps the pick.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RESOLVE_ROLES_FLAG,
  changedSinceLaunch,
  harnessesOfThePlan,
  reasonToResolveAgain,
  replay,
  replayWarningLine,
  readStoredRecord,
} from "../../src/roles/replay.ts";
import { writeResolvedRegistry } from "../../src/roles/registry-writer.ts";
import type { ResolvedRegistryInput } from "../../src/roles/registry-writer.ts";
import type { CriticCandidate, CriticPick, RolePlanEntry } from "../../src/roles/types.ts";
import type { RegistryHarness } from "@specstride/contracts/records/resolved-registry";

const RUN_ID = "run-ct-124-22";
const STATE_ROOT = mkdtempSync(join(tmpdir(), "ct-124-22-"));

function candidate(overrides: Partial<CriticCandidate> = {}): Record<string, unknown> {
  return {
    id: "state-tested",
    state: "tested",
    origin: "user",
    version: "1.4.2",
    descriptorHash: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    resolvedPath: "/usr/local/bin/stub-harness",
    kind: "cli",
    completionForm: { value: "tool-less", provenance: "declared" },
    costClass: { value: "local", provenance: "declared" },
    contextWindow: { tokens: 200000, source: "declared" },
    memory: { native: false, provenance: "declared" },
    terms: { decision: "allowed", row: "provider:local-stub", provenance: "configuration" },
    containmentCeiling: "C2",
    namedByTheConsumer: true,
    ...overrides,
  };
}

const PLAN_ENTRY: RolePlanEntry = {
  harness: "state-tested",
  model: null,
  modelTier: "standard",
  authTier: 0,
  transport: "cli",
  form: "tool-less",
  containment: "C2",
  source: "configuration",
  kind: "primary",
  regate: false,
  terms: { decision: "allowed", row: "provider:local-stub" },
};

const CRITIC_PICK: CriticPick = {
  step: "configured",
  automatic: false,
  harness: "state-tested",
  model: null,
  state: "tested",
  form: "tool-less",
  window: 200000,
  windowSource: "declared",
  cap: null,
  diversity: "diverse",
  sameModelWarning: false,
  runnersUp: [],
  notQualified: [],
  passedOver: [],
  table: { id: "ranking-table", version: "1", ruleIds: ["R2-state"] },
};

function registryInput(overrides: Partial<ResolvedRegistryInput> = {}): ResolvedRegistryInput {
  return {
    harnesses: [candidate()],
    roles: [
      {
        id: "proposer",
        capabilityLevelRequired: "proposer",
        independenceConstraints: [],
        budgetKey: "budget.proposer",
      },
      {
        id: "critic",
        capabilityLevelRequired: "completion",
        independenceConstraints: [],
        budgetKey: "budget.critic",
      },
    ],
    plan: { "1": { proposer: [PLAN_ENTRY], critic: [PLAN_ENTRY] } },
    criticPick: CRITIC_PICK,
    runnersUp: [],
    announced: ["[SPECSTRIDE-CRITIC] step=configured harness=state-tested"],
    ...overrides,
  } as ResolvedRegistryInput;
}

/** The current list of harnesses, read as the field `harnesses` reads them. */
function currentHarnesses(overrides: Partial<Record<string, unknown>>[] = []): RegistryHarness[] {
  return [candidate(...overrides) as unknown as RegistryHarness];
}

/** Write the stored record of the launch once, for the whole file. */
writeResolvedRegistry({ runId: RUN_ID, stateRoot: STATE_ROOT, input: registryInput() });

/** A `resolveAgain` spy: if the replay ranks, this must have been called. */
function spyResolution(calls: string[]): () => ResolvedRegistryInput {
  return () => {
    calls.push("resolved");
    return registryInput();
  };
}

test("CT-124-22 the flag of a new resolution is --resolve-roles (CQ-106)", () => {
  assert.equal(RESOLVE_ROLES_FLAG, "--resolve-roles");
});

test("CT-124-22 a resume reads the record and ranks nothing (F124-FR-022)", () => {
  const calls: string[] = [];
  // A BETTER candidate was added to the list of harnesses since launch —
  // the resume must not care (F124-SC-006: the plan is byte-identical).
  const better = [...currentHarnesses(), ...currentHarnesses([{ id: "better-candidate" }])];
  const outcome = replay({
    runId: RUN_ID,
    stateRoot: STATE_ROOT,
    currentHarnesses: better,
    consumerAsksByFlag: false,
    resolveAgain: spyResolution(calls),
  });
  assert.equal(outcome.action, "replay");
  assert.equal(outcome.rankedAgain, false);
  assert.deepEqual(calls, []); // nothing was discovered or ranked again
  // The plan of the record IS the plan of the resumed run, byte for byte.
  const stored = readStoredRecord(RUN_ID, STATE_ROOT);
  assert.deepEqual(outcome.plan, stored.plan);
  assert.deepEqual(outcome.criticPick, stored.criticPick);
  assert.deepEqual(outcome.warnings, []);
  assert.deepEqual(outcome.lines, []);
});

test("CT-124-22 a relaunch reads the record and ranks nothing too (F124-FR-022)", () => {
  const calls: string[] = [];
  const outcome = replay({
    runId: RUN_ID,
    stateRoot: STATE_ROOT,
    currentHarnesses: currentHarnesses(),
    consumerAsksByFlag: false,
    resolveAgain: spyResolution(calls),
  });
  assert.equal(outcome.action, "replay");
  assert.equal(outcome.rankedAgain, false);
  assert.deepEqual(calls, []);
  // The record on disk is untouched by a replay: the same bytes as the write.
  const text = readFileSync(join(STATE_ROOT, RUN_ID, "registry.json"), "utf8");
  assert.equal(JSON.parse(text).schema, "specstride.registry/1");
  assert.deepEqual(JSON.parse(text).plan, registryInput().plan);
});

test("CT-124-22 a new resolution happens by the flag, announced and recorded (F124-FR-022)", () => {
  const calls: string[] = [];
  const outcome = replay({
    runId: RUN_ID,
    stateRoot: STATE_ROOT,
    currentHarnesses: currentHarnesses(),
    consumerAsksByFlag: true, // --resolve-roles
    resolveAgain: spyResolution(calls),
  });
  assert.equal(outcome.action, "resolve-again");
  assert.equal(outcome.reason, "flag");
  assert.equal(outcome.rankedAgain, true);
  assert.deepEqual(calls, ["resolved"]);
  // Recorded: a NEW record was written to run:<runId>:registry.
  assert.equal(typeof outcome.path, "string");
  const onDisk = JSON.parse(readFileSync(outcome.path, "utf8"));
  assert.deepEqual(onDisk.plan, outcome.plan);
  // Announced: the lines carry the announcement of the new pick.
  assert.deepEqual(outcome.lines, [
    "SPECSTRIDE-CRITIC harness=state-tested model=null step=configured state=tested form=tool-less window-source=declared cap=null auto=false",
  ]);
  assert.deepEqual(onDisk.announced, registryInput().announced);
});

test("CT-124-22 a new resolution happens when a harness of the plan no longer exists (F124-FR-022)", () => {
  const calls: string[] = [];
  // The list of harnesses no longer holds the harness of the stored plan.
  const outcome = replay({
    runId: RUN_ID,
    stateRoot: STATE_ROOT,
    currentHarnesses: [],
    consumerAsksByFlag: false,
    resolveAgain: spyResolution(calls),
  });
  assert.equal(outcome.action, "resolve-again");
  assert.equal(outcome.reason, "plan-harness-gone");
  assert.equal(outcome.rankedAgain, true);
  assert.deepEqual(calls, ["resolved"]);
});

test("CT-124-22 a changed version warns and keeps the pick (F124-FR-022)", () => {
  const calls: string[] = [];
  const outcome = replay({
    runId: RUN_ID,
    stateRoot: STATE_ROOT,
    currentHarnesses: currentHarnesses([{ version: "2.0.0" }]),
    consumerAsksByFlag: false,
    resolveAgain: spyResolution(calls),
  });
  // Warning, not a new resolution: the pick stays.
  assert.equal(outcome.action, "replay");
  assert.deepEqual(calls, []);
  assert.equal(outcome.warnings.length, 1);
  assert.equal(outcome.warnings[0].what, "version");
  assert.equal(outcome.warnings[0].from, "1.4.2");
  assert.equal(outcome.warnings[0].to, "2.0.0");
  assert.deepEqual(outcome.lines, [replayWarningLine(outcome.warnings[0])]);
  assert.match(outcome.lines[0], /^\[SPECSTRIDE-ROLES\] warning=changed-version /);
  assert.match(outcome.lines[0], /pick=kept$/);
  // The pick is exactly the stored one.
  const stored = readStoredRecord(RUN_ID, STATE_ROOT);
  assert.deepEqual(outcome.criticPick, stored.criticPick);
});

test("CT-124-22 a changed descriptor hash warns and keeps the pick (F124-FR-022)", () => {
  const calls: string[] = [];
  const hash = "sha256:2222222222222222222222222222222222222222222222222222222222222222";
  const outcome = replay({
    runId: RUN_ID,
    stateRoot: STATE_ROOT,
    currentHarnesses: currentHarnesses([{ descriptorHash: hash }]),
    consumerAsksByFlag: false,
    resolveAgain: spyResolution(calls),
  });
  assert.equal(outcome.action, "replay");
  assert.deepEqual(calls, []);
  assert.deepEqual(
    outcome.warnings.map((w) => w.what),
    ["descriptor-hash"],
  );
  assert.equal(outcome.warnings[0].to, hash);
  // The pick and the plan stay exactly as the record holds them.
  const stored = readStoredRecord(RUN_ID, STATE_ROOT);
  assert.deepEqual(outcome.criticPick, stored.criticPick);
  assert.deepEqual(outcome.plan, stored.plan);
});

test("CT-124-22 a changed version AND descriptor hash give both warnings, pick kept", () => {
  const hash = "sha256:3333333333333333333333333333333333333333333333333333333333333333";
  const warnings = changedSinceLaunch(
    readStoredRecord(RUN_ID, STATE_ROOT),
    currentHarnesses([{ version: "9.9.9", descriptorHash: hash }]),
  );
  assert.deepEqual(
    warnings.map((w) => `${w.harness}:${w.what}`),
    ["state-tested:version", "state-tested:descriptor-hash"],
  );
});

test("CT-124-22 the helpers read the plan of the record and reason of the replay", () => {
  const stored = readStoredRecord(RUN_ID, STATE_ROOT);
  assert.deepEqual(harnessesOfThePlan(stored.plan as never), ["state-tested"]);
  assert.equal(reasonToResolveAgain(stored, currentHarnesses(), false), null);
  assert.equal(reasonToResolveAgain(stored, currentHarnesses(), true), "flag");
  assert.equal(reasonToResolveAgain(stored, [], false), "plan-harness-gone");
});

test("CT-124-22 a resume of a run that holds no record is refused", () => {
  assert.throws(() => readStoredRecord("run-never-launched", STATE_ROOT), {
    name: "ReplayError",
  });
  assert.throws(
    () =>
      replay({
        runId: "run-never-launched",
        stateRoot: STATE_ROOT,
        currentHarnesses: currentHarnesses(),
        consumerAsksByFlag: false,
      }),
    { name: "ReplayError" },
  );
});

test("CT-124-22 a resolve-again without a handed-in resolution is refused", () => {
  assert.throws(
    () =>
      replay({
        runId: RUN_ID,
        stateRoot: STATE_ROOT,
        currentHarnesses: [],
        consumerAsksByFlag: false,
      }),
    { name: "ReplayError" },
  );
});
