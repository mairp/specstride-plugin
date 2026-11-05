/**
 * T068 — CT-109-40, the record of the proof in the invocation record of every
 * critic-class call, and the containment level of each role per run
 * (F109-FR-040; F109-SC-003).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fixFormBeforeCall } from "../../src/proof/forms.ts";
import { proveFirstForm } from "../../src/proof/first-form.ts";
import { proveSecondForm, WITHHELD_LOCATIONS } from "../../src/proof/second-form.ts";
import {
  CONTAINMENT_LEVELS,
  PROOF_KINDS,
  PROOF_RESULTS,
  containmentLevelsForRun,
  isContainmentLevel,
  recordOfFirstForm,
  recordOfSecondForm,
} from "../../src/proof/record.ts";

const FIRST = fixFormBeforeCall("tool-less") as Exclude<
  ReturnType<typeof fixFormBeforeCall>,
  { accepted: false }
>;
const SECOND = fixFormBeforeCall("read-only-tools") as Exclude<
  ReturnType<typeof fixFormBeforeCall>,
  { accepted: false }
>;

test("CT-109-40: the kinds of proof and the results are the closed sets", () => {
  assert.deepEqual(
    [...PROOF_KINDS],
    ["initial-record", "pinned-configuration", "read-only-sandbox"],
  );
  assert.deepEqual([...PROOF_RESULTS], ["passed", "refused", "passed-over"]);
});

test("CT-109-40: the record of an accepted call of the first form", () => {
  const proof = proveFirstForm({
    fixed: FIRST,
    mintedSessionId: "sess-a",
    initialRecord: { tools: [], sessionId: "sess-a" },
    tested: true,
  });
  assert.deepEqual(recordOfFirstForm(proof), {
    form: "tool-less",
    proofKind: "initial-record",
    result: "passed",
  });
  const weaker = proveFirstForm({
    fixed: FIRST,
    mintedSessionId: "sess-a",
    initialRecord: null,
    tested: true,
    pinned: {
      pin: "1.2.3",
      installedVersion: "1.2.3",
      preflightPassed: true,
      flagSet: ["--no-tools"],
    },
  });
  assert.deepEqual(recordOfFirstForm(weaker), {
    form: "tool-less",
    proofKind: "pinned-configuration",
    result: "passed",
    weakerProof: true,
  });
});

test("CT-109-40: the record of a refused call names the reason", () => {
  const proof = proveFirstForm({
    fixed: FIRST,
    mintedSessionId: "sess-a",
    initialRecord: { tools: ["shell"], sessionId: "sess-a" },
    tested: true,
  });
  const record = recordOfFirstForm(proof);
  assert.equal(record.result, "refused");
  assert.equal(record.form, "tool-less");
  assert.match(record.reason ?? "", /tool/);
});

test("CT-109-40: the record of the second form carries the sandbox, the network and the confirmation", () => {
  const passed = proveSecondForm({
    fixed: SECOND,
    sandboxMode: "read-only",
    networkOff: true,
    confirmation: { confirmed: true, deniedLocations: [...WITHHELD_LOCATIONS] },
    provenance: "configured",
  });
  assert.deepEqual(
    recordOfSecondForm(passed, {
      sandboxMode: "read-only",
      networkOff: true,
      confirmation: true,
    }),
    {
      form: "read-only-tools",
      proofKind: "read-only-sandbox",
      result: "passed",
      sandboxMode: "read-only",
      networkOff: true,
      confirmation: true,
    },
  );
  const passedOver = proveSecondForm({
    fixed: SECOND,
    sandboxMode: "unrestricted",
    networkOff: false,
    confirmation: null,
    provenance: "automatically-picked",
  });
  const overRecord = recordOfSecondForm(passedOver, {
    sandboxMode: "unrestricted",
    networkOff: false,
    confirmation: false,
  });
  assert.equal(overRecord.result, "passed-over");
  assert.equal(overRecord.sandboxMode, "unrestricted");
  assert.equal(overRecord.networkOff, false);
  assert.equal(overRecord.confirmation, false);
});

test("CT-109-40: the containment level of each role per run", () => {
  assert.deepEqual([...CONTAINMENT_LEVELS], ["C0", "C1", "C2", "C3"]);
  assert.deepEqual(containmentLevelsForRun({ proposer: "C2", critic: "C3" }), {
    proposer: "C2",
    critic: "C3",
  });
  // The unknown-value rule of row 26: read as C0.
  assert.deepEqual(containmentLevelsForRun({ proposer: "C9", critic: undefined as never }), {
    proposer: "C0",
    critic: "C0",
  });
  assert.equal(isContainmentLevel("C2"), true);
  assert.equal(isContainmentLevel("C4"), false);
});
