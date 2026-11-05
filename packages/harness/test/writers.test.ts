/**
 * CT-126-Foundation — the artifact writers (T007; F126-FR-032): the result
 * record is written once, atomically and without overwriting, with sorted
 * keys, a 2-space indent and a final line end; the producer status and the
 * provider terminal are written atomically.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AlreadyFinalizedError,
  AS_IS_CONTRACTS,
  SCHEMA_IDS,
  buildResultRecord,
  finalizedAtNow,
  sameDirectoryGuard,
  sortedJsonStringify,
  writeInvocationRecord,
  writeJsonOnce,
  writeProducerStatus,
  writeProviderTerminal,
  writeResultRecord,
} from "../src/invocation/writers.ts";
import { buildIdentity } from "../src/invocation/identity.ts";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "ct126-writers-"));
}

const IDENTITY = buildIdentity({
  runId: "run-9",
  feature: "126",
  role: "proposer",
  harness: "claude",
  phase: "propose",
  attempt: 1,
  iteration: 3,
  invocationId: "inv-000003-ab12cd34",
});

test("a write is a temporary name in the same directory, then a rename", () => {
  const root = scratch();
  try {
    const path = join(root, "b.json");
    writeJsonOnce(path, { b: 2, a: 1 });
    assert.equal(existsSync(path), true);
    assert.equal(readdirSync(root).filter((n) => n.includes(".once-")).length, 0);
    // Sorted keys, 2-space indent, one final line end.
    assert.equal(readFileSync(path, "utf8"), '{\n  "a": 1,\n  "b": 2\n}\n');
    assert.deepEqual(
      sortedJsonStringify({ z: { b: 1, a: 2 } }),
      '{\n  "z": {\n    "a": 2,\n    "b": 1\n  }\n}\n',
    );
    assert.equal(sameDirectoryGuard(path, join(root, ".b.once-1-0")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an existing artifact makes the write fail and is never overwritten", () => {
  const root = scratch();
  try {
    const path = join(root, "result.json");
    writeJsonOnce(path, { n: 1 });
    assert.throws(
      () => writeJsonOnce(path, { n: 2 }),
      (err: unknown): err is AlreadyFinalizedError => err instanceof AlreadyFinalizedError,
    );
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { n: 1 }); // unchanged
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the result record holds every field F126-FR-032 names", () => {
  const record = buildResultRecord({
    identity: IDENTITY,
    status: "error",
    reason_code: "missing_terminal",
    reason: "the stream ended before a terminal record",
    provider_status: null,
    provider_stop_reason: null,
    producer: {
      producer_exit_code: 0,
      producer_signal: null,
      parser_exit_code: 0,
      timed_out: false,
      launch_failed: false,
      duration_ms: 1234.6,
    },
    providerTerminal: {
      status: "done",
      stop_reason: "end_turn",
      reason: "dropped",
      reason_code: "dropped",
      model: "claude-x",
      cost_usd: 0.01,
      input_tokens: 10,
      num_turns: 4,
      nothing: null,
    },
    extraMetrics: { kill_class: "none", status: "shadowed" },
  });
  assert.equal(record.schema, SCHEMA_IDS.result);
  assert.equal(record.is_error, true);
  assert.equal(record.source, "synthesized"); // the reason code is missing_terminal
  assert.equal(record.duration_ms, 1234); // whole, at least 0
  assert.equal(record.model, "claude-x");
  assert.equal(record.cost_usd, 0.01);
  assert.equal(record.num_turns, 4);
  assert.equal(record.kill_class, "none");
  // Never copied: status, reason, reason_code, stop_reason.
  assert.equal(record.status, "error");
  assert.equal(record.reason, "the stream ended before a terminal record");
  assert.equal(record.reason_code, "missing_terminal");
  assert.equal(record.stop_reason, undefined);
  assert.equal(record.nothing, undefined); // null keys are not copied
  assert.equal(/\.\d{6}Z$/.test(String(record.finalized_at)), true);
  // The as-is contract string.
  assert.equal(AS_IS_CONTRACTS.result, "specstride-invocation-result/v1");
  // Reconciled where the reason code is not missing_terminal.
  const reconciled = buildResultRecord({
    identity: IDENTITY,
    status: "success",
    reason_code: "success",
    reason: "",
    provider_status: 0,
    provider_stop_reason: "end_turn",
    producer: {
      producer_exit_code: 0,
      producer_signal: null,
      parser_exit_code: 0,
      timed_out: false,
      launch_failed: false,
      duration_ms: -5,
    },
  });
  assert.equal(reconciled.source, "reconciled");
  assert.equal(reconciled.is_error, false);
  assert.equal(reconciled.duration_ms, 0); // at least 0
});

test("finalized_at is UTC with microseconds", () => {
  const stamp = finalizedAtNow();
  assert.match(stamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  assert.equal(finalizedAtNow(1700000000123456n), "2023-11-14T22:13:20.123456Z");
});

test("the other artifacts are written atomically with their schema ids", () => {
  const root = scratch();
  try {
    mkdirSync(root, { recursive: true });
    const invocation = join(root, "invocation.json");
    writeInvocationRecord(invocation, IDENTITY, {
      observabilityMode: "structured",
      providerFormat: "claude",
      expectedEvidence: "/tmp/evidence",
      createdAt: "2026-09-30T00:00:00.000000Z",
    });
    assert.equal(JSON.parse(readFileSync(invocation, "utf8")).schema, SCHEMA_IDS.invocation);
    const status = join(root, "producer-status.json");
    writeProducerStatus(status, {
      producer_exit_code: 0,
      producer_signal: null,
      parser_exit_code: 0,
      timed_out: false,
      launch_failed: false,
      duration_ms: 12,
    });
    assert.equal(JSON.parse(readFileSync(status, "utf8")).schema, SCHEMA_IDS.producerStatus);
    const terminal = join(root, "provider-terminal.json");
    writeProviderTerminal(terminal, { stop_reason: "end_turn" }, false);
    const parsed = JSON.parse(readFileSync(terminal, "utf8"));
    assert.equal(parsed.schema, SCHEMA_IDS.providerTerminal);
    assert.equal(parsed.provider_terminal.stop_reason, "end_turn");
    assert.equal(parsed.malformed_stream, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a second finalization of the same pass changes nothing", () => {
  const root = scratch();
  try {
    const path = join(root, "result.json");
    const input = {
      identity: IDENTITY,
      status: "success",
      reason_code: "success",
      reason: "",
      provider_status: 0,
      provider_stop_reason: "end_turn",
      producer: {
        producer_exit_code: 0,
        producer_signal: null,
        parser_exit_code: 0,
        timed_out: false,
        launch_failed: false,
        duration_ms: 5,
      },
      finalized_at: "2026-09-30T00:00:00.000000Z",
    };
    writeResultRecord(path, input);
    const first = readFileSync(path, "utf8");
    assert.throws(
      () => writeResultRecord(path, { ...input, status: "error" }),
      AlreadyFinalizedError,
    );
    assert.equal(readFileSync(path, "utf8"), first); // written once
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
