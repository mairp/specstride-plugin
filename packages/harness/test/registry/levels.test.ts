/**
 * T007 — CT-109-2: the capability levels (F109-FR-002).
 *
 * The level `proposer` requires the six capabilities P1 to P6 and the level
 * `completion` the six capabilities C1 to C6. An entry that lacks one of them
 * MUST NOT be offered for the role, and the registry MUST record which one is
 * missing. Registration fails outright where a declared level holds no
 * operation of that level (see lisa-registration.test.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAPABILITY_LEVELS,
  COMPLETION_CAPABILITIES,
  LEVEL_CAPABILITY_IDS,
  PROPOSER_CAPABILITIES,
  checkRegistration,
  type RegistrationCandidate,
} from "../../src/registry/levels.ts";

function entry(operations: Record<string, string[]>): RegistrationCandidate {
  return {
    id: "fake-harness",
    levels: Object.keys(operations),
    operations,
  };
}

test("CT-109-2: the closed set of capability levels holds proposer and completion", () => {
  assert.deepEqual([...CAPABILITY_LEVELS], ["proposer", "completion"]);
});

test("CT-109-2: the level proposer requires exactly P1 to P6", () => {
  assert.deepEqual([...LEVEL_CAPABILITY_IDS.proposer], ["P1", "P2", "P3", "P4", "P5", "P6"]);
  assert.equal(PROPOSER_CAPABILITIES.length, 6);
  for (const capability of PROPOSER_CAPABILITIES) {
    assert.equal(capability.level, "proposer");
    assert.ok(capability.description.length > 0, `${capability.id} carries its sentence`);
  }
});

test("CT-109-2: the level completion requires exactly C1 to C6", () => {
  assert.deepEqual([...LEVEL_CAPABILITY_IDS.completion], ["C1", "C2", "C3", "C4", "C5", "C6"]);
  assert.equal(COMPLETION_CAPABILITIES.length, 6);
  for (const capability of COMPLETION_CAPABILITIES) {
    assert.equal(capability.level, "completion");
    assert.ok(capability.description.length > 0, `${capability.id} carries its sentence`);
  }
});

test("CT-109-2: an entry with all of P1 to P6 is offered for the proposer", () => {
  const result = checkRegistration(entry({ proposer: ["P1", "P2", "P3", "P4", "P5", "P6"] }));
  assert.equal(result.ok, true);
  assert.equal(result.offered.proposer, true);
  assert.deepEqual([...result.missing.proposer], []);
});

test("CT-109-2: an entry with all of C1 to C6 is offered for the completion", () => {
  const result = checkRegistration(entry({ completion: ["C1", "C2", "C3", "C4", "C5", "C6"] }));
  assert.equal(result.ok, true);
  assert.equal(result.offered.completion, true);
  assert.deepEqual([...result.missing.completion], []);
});

test("CT-109-2: an entry lacking P4 is not offered for the proposer and P4 is recorded", () => {
  const result = checkRegistration(entry({ proposer: ["P1", "P2", "P3", "P5", "P6"] }));
  assert.equal(result.ok, true, "registered, but not offered");
  assert.equal(result.offered.proposer, false);
  assert.deepEqual([...result.missing.proposer], ["P4"]);
  assert.equal(result.offered.completion, false);
});

test("CT-109-2: an entry lacking C2 and C5 records both and is not offered", () => {
  const result = checkRegistration(entry({ completion: ["C1", "C3", "C4", "C6"] }));
  assert.equal(result.offered.completion, false);
  assert.deepEqual([...result.missing.completion], ["C2", "C5"]);
});

test("CT-109-2: an entry that declares both levels with all twelve capabilities is offered for both roles", () => {
  const result = checkRegistration(
    entry({
      proposer: ["P1", "P2", "P3", "P4", "P5", "P6"],
      completion: ["C1", "C2", "C3", "C4", "C5", "C6"],
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.offered.proposer, true);
  assert.equal(result.offered.completion, true);
});

test("CT-109-2: an unknown level refuses the entry at registration", () => {
  const result = checkRegistration(
    entry({ agent: ["P1", "P2", "P3", "P4", "P5", "P6"] }) as RegistrationCandidate,
  );
  assert.equal(result.ok, false);
  assert.match(result.refusals[0]!.reason, /closed set/);
});
