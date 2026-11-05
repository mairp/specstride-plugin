/**
 * CT-126-12 (T042) — the sinks of the result event (CQ-228, with
 * F126-FR-036 and the annex C §C.10 local-first rule).
 *
 * The finalization writes one `agent_result` per invocation: through the one
 * event writer outside the compatibility projection, where the stub sink
 * receives the event after the primary write, whole with `ts`, `type` and
 * `seq`; in the compatibility projection to the local destination only, and
 * an empty destination skips it; and a second finalization writes no second
 * event.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ensureInvocationDirectory, artifactPath } from "../src/invocation/layout.ts";
import { finalizeInvocation, AGENT_RESULT_EVENT } from "../src/invocation/finalization.ts";
import {
  writeInvocationRecord,
  writeProducerStatus,
  writeProviderTerminal,
} from "../src/invocation/writers.ts";
import type { EventWriterPort, TapEvent } from "../src/stream/tap.ts";
import type { InvocationIdentity } from "../src/invocation/identity.ts";

const IDENTITY: InvocationIdentity = {
  runId: "run-ct12",
  feature: "126-stream-seam-and-invocation",
  role: "proposer",
  harness: "claude",
  phase: "2",
  attempt: 1,
  iteration: 1,
  invocationId: "inv-000012-dd12ct12",
};

/** One invocation directory with its record, its producer status and its sidecar. */
function makeInvocation(seq: number): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), `ct126-12-${seq}-`));
  const dir = ensureInvocationDirectory(root, {
    ...IDENTITY,
    invocationId: `${IDENTITY.invocationId}-${seq}`,
  });
  writeInvocationRecord(
    artifactPath(dir, "pass:invocation"),
    { ...IDENTITY, invocationId: `${IDENTITY.invocationId}-${seq}` },
    {
      observabilityMode: "structured",
      providerFormat: "claude",
      expectedEvidence: "",
      createdAt: new Date().toISOString(),
    },
  );
  writeProducerStatus(artifactPath(dir, "pass:producer-status"), {
    producer_exit_code: 0,
    producer_signal: null,
    parser_exit_code: 0,
    timed_out: false,
    launch_failed: false,
    duration_ms: 700,
  });
  writeProviderTerminal(
    artifactPath(dir, "pass:provider-terminal"),
    {
      status: "success",
      reason: null,
      stop_reason: "end_turn",
    },
    false,
  );
  return { root, dir };
}

/** The stub of the one event writer: primary write first, then the sinks. */
function oneEventWriter(): {
  writer: EventWriterPort;
  primary: { event: TapEvent }[];
  sink: { event: TapEvent & { ts: string; seq: number }; afterPrimary: boolean }[];
  append(event: TapEvent): void;
} {
  const primary: { event: TapEvent }[] = [];
  const sink: { event: TapEvent & { ts: string; seq: number }; afterPrimary: boolean }[] = [];
  let seq = 0;
  const port: EventWriterPort = {
    append(event: TapEvent): void {
      primary.push({ event });
      seq += 1;
      sink.push({
        event: { ...event, ts: "0000000000.000000000", seq },
        afterPrimary: true,
      });
    },
  };
  return { writer: port, primary, sink, append: (event) => port.append(event) };
}

/* ------------------------------------------------------------------ *
 * through the one event writer, sink after the primary write
 * ------------------------------------------------------------------ */

test("CT-126-12: the finalization writes one agent_result through the one event writer, and the sink receives it after the primary write, whole", () => {
  const { root, dir } = makeInvocation(0);
  try {
    const writer = oneEventWriter();
    const run = finalizeInvocation({
      dir,
      breakerStatePath: join(root, "breakers.json"),
      limit: 3,
      writer: writer.writer,
    });
    assert.equal(run.exitCode, 0);
    // One agent_result, through the writer.
    const written = writer.primary.filter((e) => e.event.type === AGENT_RESULT_EVENT);
    assert.equal(written.length, 1, "exactly one agent_result is written");
    assert.deepEqual(written[0].event.type, AGENT_RESULT_EVENT);
    // The stub sink receives it after the primary write, whole.
    const received = writer.sink.filter((e) => e.event.type === AGENT_RESULT_EVENT);
    assert.equal(received.length, 1);
    assert.equal(received[0].afterPrimary, true, "the sink is called after the primary write");
    assert.ok(received[0].event.ts.length > 0, "the envelope carries ts");
    assert.equal(received[0].event.seq, 1, "the envelope carries seq");
    assert.deepEqual(received[0].event.fields, written[0].event.fields);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CT-126-12: a second finalization writes no second event (CQ-228)", () => {
  const { root, dir } = makeInvocation(1);
  try {
    const writer = oneEventWriter();
    const first = finalizeInvocation({
      dir,
      breakerStatePath: join(root, "breakers.json"),
      limit: 3,
      writer: writer.writer,
    });
    assert.equal(first.exitCode, 0);
    const afterFirst = writer.primary.filter((e) => e.event.type === AGENT_RESULT_EVENT).length;
    assert.equal(afterFirst, 1);
    const resultBefore = readFileSync(artifactPath(dir, "pass:result"), "utf8");
    const second = finalizeInvocation({
      dir,
      breakerStatePath: join(root, "breakers.json"),
      limit: 3,
      writer: writer.writer,
    });
    assert.equal(second.exitCode, 0);
    assert.equal(
      writer.primary.filter((e) => e.event.type === AGENT_RESULT_EVENT).length,
      1,
      "no second event",
    );
    assert.equal(readFileSync(artifactPath(dir, "pass:result"), "utf8"), resultBefore);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * the compatibility projection and the empty destination
 * ------------------------------------------------------------------ */

test("CT-126-12: in the compatibility projection the event goes to the local destination only, and no sink is called", () => {
  const { root, dir } = makeInvocation(2);
  try {
    const destination = join(root, "events-as-is.jsonl");
    const writer = oneEventWriter();
    const run = finalizeInvocation({
      dir,
      breakerStatePath: join(root, "breakers.json"),
      limit: 3,
      compatibilityProjection: true,
      eventsPath: destination,
      writer: writer.writer,
    });
    assert.equal(run.exitCode, 0);
    assert.equal(existsSync(destination), true, "the local destination holds the event");
    const line = JSON.parse(readFileSync(destination, "utf8").trim()) as Record<string, unknown>;
    assert.equal(line["event"], AGENT_RESULT_EVENT);
    assert.equal(line["sequence"], 1);
    // The as-is form is the local destination only: the writer saw nothing.
    assert.equal(writer.primary.length, 0, "no writer event in the as-is form");
    assert.equal(writer.sink.length, 0, "no sink is called from this process");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CT-126-12: an empty destination skips the as-is event (B-2160)", () => {
  const { root, dir } = makeInvocation(3);
  try {
    const run = finalizeInvocation({
      dir,
      breakerStatePath: join(root, "breakers.json"),
      limit: 3,
      compatibilityProjection: true,
      eventsPath: "",
    });
    assert.equal(run.exitCode, 0, "the skip is silent");
    assert.equal(run.events.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
