/**
 * T005 — characterization test CT-124-21 for the writer of the resolved
 * registry (F124-FR-021): the record at the logical name
 * `run:<runId>:registry` validates against `specstride.registry/1`, it is
 * written by a temporary name and a rename (F100-FR-036), and it holds no
 * secret value (F100-FR-052).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REGISTRY_SCHEMA_ID,
  REGISTRY_LOGICAL_NAME,
  buildResolvedRegistry,
  holdsNoSecretValue,
  isATemporaryRegistryName,
  registryPathFor,
  writeResolvedRegistry,
} from "../../src/roles/registry-writer.ts";
import type { CriticPick, RolePlanEntry } from "../../src/roles/types.ts";
import type { ResolvedRegistryInput } from "../../src/roles/registry-writer.ts";
import type { RegistryHarness } from "@specstride/contracts/records/resolved-registry";
import {
  isResolvedRegistry,
  readResolvedRegistry,
} from "@specstride/contracts/records/resolved-registry";
import { temporaryNameFor } from "@specstride/kernel/atomic-write";

const RUN_ID = "run-ct-124-21";
const STATE_ROOT = mkdtempSync(join(tmpdir(), "ct-124-21-"));

/** A candidate in the form of the field `harnesses` of annex C §C.6. */
function candidate(
  overrides: Partial<RegistryHarness> & Record<string, unknown> = {},
): RegistryHarness {
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
    memory: { value: { native: false }, provenance: "declared" },
    terms: { decision: "allowed", row: "provider:local-stub", provenance: "configuration" },
    containmentCeiling: { level: "C2", provenance: "declared" },
    capabilities: {},
    sources: {},
    namedByTheConsumer: true,
    ...overrides,
  } as RegistryHarness;
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

function input(overrides: Partial<ResolvedRegistryInput> = {}): ResolvedRegistryInput {
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
    announced: ["[SPECSTRIDE-ROLES] proposer=state-tested source=configuration"],
    ...overrides,
  };
}

test("CT-124-21 the logical name of the record is run:<runId>:registry and the schema id is specstride.registry/1", () => {
  assert.equal(REGISTRY_LOGICAL_NAME, "run:<runId>:registry");
  assert.equal(REGISTRY_SCHEMA_ID, "specstride.registry/1");
  assert.equal(registryPathFor(RUN_ID, STATE_ROOT), join(STATE_ROOT, RUN_ID, "registry.json"));
});

test("CT-124-21 the built record validates against specstride.registry/1", () => {
  const record = buildResolvedRegistry(input());
  assert.equal(record.schema, "specstride.registry/1");
  assert.equal(isResolvedRegistry(record), true);
  // A reader by logical name accepts it too (F100-FR-048).
  const reread = readResolvedRegistry(JSON.parse(JSON.stringify(record)));
  assert.equal(reread.schema, "specstride.registry/1");
});

test("CT-124-21 the record is written at run:<runId>:registry by a temporary name and a rename", () => {
  const { path } = writeResolvedRegistry({ runId: RUN_ID, stateRoot: STATE_ROOT, input: input() });
  assert.equal(existsSync(path), true);
  const onDisk = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(onDisk.schema, "specstride.registry/1");
  assert.equal(isResolvedRegistry(onDisk), true);
  // The temporary name lives in the SAME directory and is gone after the
  // rename: no leftover of the write is in the directory of the run.
  const names = readdirSync(join(STATE_ROOT, RUN_ID));
  assert.deepEqual(
    names.filter((n) => isATemporaryRegistryName(n)),
    [],
  );
  assert.deepEqual(names, ["registry.json"]);
  // The name the write used is the kernel's temporary name form: hidden,
  // carrying the process id and a counter, renamed into place (F100-FR-036).
  assert.equal(isATemporaryRegistryName(temporaryNameFor(path)), true);
});

test("CT-124-21 the record on disk holds no secret value (F100-FR-052)", () => {
  const path = registryPathFor(RUN_ID, STATE_ROOT);
  const text = readFileSync(path, "utf8");
  assert.equal(
    SECRET_SHAPED_KEYS.some((k) => text.includes(`"${k}"`)),
    false,
  );
  assert.equal(holdsNoSecretValue(JSON.parse(text)).ok, true);
});

const SECRET_SHAPED_KEYS = ["apiKey", "api_key", "secret", "password", "token", "credential"];

test("CT-124-21 a record that carries a secret-shaped key is refused before the write", () => {
  assert.equal(holdsNoSecretValue({ plan: { criticApiKey: "sk-123" } }).ok, false);
  assert.equal(
    holdsNoSecretValue({ harnesses: [{ pem: "-----BEGIN PRIVATE KEY-----\nabc" }] }).ok,
    false,
  );
  assert.throws(
    () => buildResolvedRegistry(input({ harnesses: [candidate({ apiKey: "sk-123" })] }) as never),
    { name: "RegistryWriterError" },
  );
  // The refused record never reached the disk: the directory still holds only
  // the one record of the successful write above.
  const names = readdirSync(join(STATE_ROOT, RUN_ID));
  assert.deepEqual(
    names.filter((n) => isATemporaryRegistryName(n)),
    [],
  );
});

test("CT-124-21 an invalid record is refused before the write (F100-FR-048)", () => {
  const broken: Record<string, unknown> = input();
  delete broken.announced;
  assert.throws(() => buildResolvedRegistry(broken as never));
});

test("CT-124-21 the writer refuses a run id that is not a directory name", () => {
  assert.throws(() => registryPathFor("../escape", STATE_ROOT), { name: "RegistryWriterError" });
});
