/**
 * CT-126-13 (T043) — the readers of the server-sent-event rows
 * (F126-FR-040, with F126-FR-018, F126-FR-016 and F126-FR-013).
 *
 * Hand-written streams of both rows go through the seam: comments, several
 * `data:` lines of one event, the literal that ends the stream, a keep-alive
 * event, an error event, and a stream that ends before its result. One text
 * record per content block, the fragments joined; a cost of null; the
 * missing terminal of the cut stream; and the parity listing that stays
 * `claude` then `prime-v3`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { defaultStreamRegistry, type ResolvedRow } from "../src/stream/registry.ts";
import { startRowReader } from "../src/stream/start.ts";
import { formatListing, runTap, resolveTapRoute, type TapEvent } from "../src/stream/tap.ts";
import { SSE_DONE } from "../src/stream/sse-reader.ts";
import { drainDiagnostics } from "../src/stream/closed-sets.ts";
import type { NormalizedRecord } from "../src/stream/records.ts";

function rowOf(name: string): ResolvedRow {
  const row = defaultStreamRegistry().resolve(name);
  if (!row) throw new Error(`${name} row missing`);
  return row;
}

function read(name: string, lines: readonly string[]): NormalizedRecord[] {
  const reader = startRowReader(rowOf(name), { invocationModel: null });
  if (reader === null) throw new Error(`${name} reader missing`);
  const out: NormalizedRecord[] = [];
  for (const line of lines) out.push(...reader.push(line));
  out.push(...reader.finish());
  return out;
}

function kinds(records: readonly NormalizedRecord[]): string[] {
  return records.map((r) => r.kind);
}

const CTX = {
  eventDestination: "",
  runId: "run-ct13",
  task: "demo",
  feature: "126-stream-seam-and-invocation",
  role: "proposer" as const,
  harness: "sse-openai",
  phase: 2,
  attempt: 1,
  iteration: 1,
  invocationId: "inv-000013-ee13ct13",
  expectedEvidencePath: null,
  invocationModel: null,
};

/* ------------------------------------------------------------------ *
 * the OpenAI framing
 * ------------------------------------------------------------------ */

test("CT-126-13: the sse-openai reader joins the fragments of one content block, skips comments and keep-alives, and ends on the literal", () => {
  drainDiagnostics();
  const records = read("sse-openai", [
    ": keep-alive comment, ignored",
    "id: 1",
    "retry: 500",
    `data: {"choices":[{"delta":{"role":"assistant"}}]}`,
    "",
    "event: ping",
    "data: ",
    "",
    `data: {"choices":[{"delta":{"content":"Hel"}}]}`,
    "",
    `data: {"choices":[{"delta":{"content":"lo"}}]}`,
    "",
    `data: {"choices":[{"delta":{}}]}`,
    "",
    `data: {"choices":[],"usage":{"input_tokens":9,"output_tokens":4},"id":"chatcmpl-1","status":"success","stop_reason":"stop"}`,
    "",
    `data: ${SSE_DONE}`,
    "",
    `data: {"choices":[{"delta":{"content":"never"}}]}`,
    "",
  ]);
  // The synthesized init (hasInitRecord false, synthInit), the one joined
  // text record, the usage and the terminal; nothing after the literal.
  assert.equal(kinds(records)[0], "init");
  assert.deepEqual(
    records.filter((r) => r.kind === "text").map((r) => (r as { text: string }).text),
    ["Hello"],
    "one text record per content block, the fragments joined",
  );
  const usage = records.find((r) => r.kind === "usage") as { cost: number | null } | undefined;
  assert.ok(usage, "the usage record is handed on");
  assert.equal(usage.cost, null, "neither stream reports a cost");
  const terminal = records.filter((r) => r.kind === "terminal");
  assert.equal(terminal.length, 1);
  assert.equal(
    records.some((r) => (r as { text?: string }).text === "never"),
    false,
    "nothing is read after the literal that ends the stream",
  );
});

test("CT-126-13: an error event of the sse-openai row becomes one error record", () => {
  drainDiagnostics();
  const records = read("sse-openai", [
    `data: {"error":{"message":"the model is overloaded","code":529}}`,
    "",
  ]);
  const errors = records.filter((r) => r.kind === "error");
  assert.equal(errors.length, 1);
  const error = errors[0] as { message: string; code: unknown };
  assert.equal(error.message, "the model is overloaded");
  assert.equal(error.code, "529", "the code of the provider is carried as data");
});

/* ------------------------------------------------------------------ *
 * the Anthropic framing
 * ------------------------------------------------------------------ */

test("CT-126-13: the sse-anthropic reader keeps its initial record, joins text per block, and carries null as its cost", () => {
  drainDiagnostics();
  const records = read("sse-anthropic", [
    `data: {"type":"message_start","message":{"model":"claude-sample"}}`,
    "",
    `data: {"type":"content_block_start","index":0}`,
    "",
    `data: {"type":"content_block_delta","delta":{"text":"Goodbye"}}`,
    "",
    `data: {"type":"content_block_delta","delta":{"text":" now"}}`,
    "",
    `data: {"type":"content_block_stop","index":0}`,
    "",
    `data: {"type":"message_delta","status":"success","stop_reason":"end_turn","usage":{"input_tokens":3,"output_tokens":7},"id":"msg-1"}`,
    "",
  ]);
  // The initial record comes from the stream (hasInitRecord true): the model
  // is the data of the `message_start` event.
  assert.equal(kinds(records)[0], "init");
  assert.deepEqual(
    records.filter((r) => r.kind === "text").map((r) => (r as { text: string }).text),
    ["Goodbye now"],
  );
  assert.equal(records.filter((r) => r.kind === "terminal").length, 1);
  const usage = records.find((r) => r.kind === "usage") as { cost: number | null };
  assert.equal(usage.cost, null);
});

test("CT-126-13: data that is not JSON gives the malformed-stream flag and no record", () => {
  drainDiagnostics();
  const reader = startRowReader(rowOf("sse-openai"), { invocationModel: null });
  if (reader === null) throw new Error("sse-openai reader missing");
  const records = [...reader.push("data: not-json-at-all"), ...reader.push(""), ...reader.finish()];
  // The synthesized init of the row, plus the synthesized terminal of
  // `synthTerminal`: the malformed data itself becomes no record.
  assert.deepEqual(kinds(records), ["init", "terminal"], "the malformed data is not handed on");
  assert.equal(reader.malformedStream, true);
});

/* ------------------------------------------------------------------ *
 * the cut stream and the parity listing
 * ------------------------------------------------------------------ */

test("CT-126-13: a stream that ends before its result is synthesized with missing_terminal, and the pass still ends 0", () => {
  drainDiagnostics();
  const registry = defaultStreamRegistry();
  const row = registry.resolve("sse-openai");
  if (!row) throw new Error("sse-openai row missing");
  const reader = startRowReader(row, { invocationModel: null });
  if (reader === null) throw new Error("sse reader missing");
  const lines = [
    `data: {"choices":[{"delta":{"content":"cut"}}]}`,
    "",
    // The stream is cut: no terminal, no literal.
  ];
  const events: TapEvent[] = [];
  const run = runTap(lines, {
    context: { ...CTX, providerFormat: row.name, providerTerminalDestination: null },
    route: resolveTapRoute({ streamOn: true, row, reader }).route,
    announcement: {
      mode: "structured",
      reason: null,
      providerFormat: row.name,
      role: "proposer",
      signals: row.signals,
    },
    writer: { append: (event) => events.push(event) },
    printLine: () => true,
  });
  assert.equal(run.exitCode, 0, "a cut stream never fails the pass");
  const terminals = events.filter((e) => e.type === "stream.terminal");
  assert.equal(terminals.length, 1, "the missing terminal is synthesized once");
  assert.equal(terminals[0].fields["synthesized"], true);
  assert.equal(terminals[0].fields["stopReason"], "missing_terminal");
});

test("CT-126-13: the parity listing stays claude then prime-v3, whatever SSE rows are registered (F126-FR-013)", () => {
  const registry = defaultStreamRegistry();
  registry.register({
    name: "sse-sample",
    reason: "a sample SSE row that is not listed as is",
    signals: ["init", "text", "result"],
    synthTerminal: true,
    reader: {
      type: "mapping",
      framing: "sse",
      selector: "data",
      fields: { "text.text": "delta.text" },
      tolerate: [],
    },
  });
  assert.deepEqual(formatListing(registry), ["claude", "prime-v3"]);
});
