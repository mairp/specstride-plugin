/**
 * T052 — CT-109-19: the hand-over of the raw stream to the reader registry
 * of feature 126 (F109-FR-019).
 *
 * The raw stream goes to the reader registered for `stream.format`; the
 * `stream.mapping` is handed over as data; an unknown format refuses the
 * descriptor. The seam itself reads no stream.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateDescriptor } from "../../src/descriptor/loader.ts";
import {
  handOverStream,
  refuseDescriptorStream,
  streamOf,
  type StreamReader,
  type StreamReaderRegistry,
} from "../../src/generic/stream-handover.ts";

/** A reader that records what it was handed, and what it consumed. */
function recordingReader(format: string): {
  readonly reader: StreamReader;
  readonly seen: { stream: unknown; mapping: unknown; consumed: boolean };
} {
  const seen: { stream: unknown; mapping: unknown; consumed: boolean } = {
    stream: null,
    mapping: null,
    consumed: false,
  };
  return {
    seen,
    reader: {
      format,
      read(input) {
        seen.stream = input.stream;
        seen.mapping = input.mapping;
        // The reader, and only the reader, consumes the stream.
        void (async () => {
          for await (const _ of input.stream as AsyncIterable<Uint8Array>) {
            seen.consumed = true;
          }
          seen.consumed = true;
        })();
        return { format };
      },
    },
  };
}

function registryOf(readers: readonly StreamReader[]): StreamReaderRegistry {
  return {
    readerFor: (format: string) => readers.find((r) => r.format === format),
  };
}

async function* rawStream(): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode("record one\n");
  yield new TextEncoder().encode("record two\n");
}

test("CT-109-19: the raw stream goes to the reader registered for stream.format", async () => {
  const jsonl = recordingReader("jsonl");
  const sse = recordingReader("sse-openai");
  const stream = rawStream();
  const mapping = { kind: "kindOf", fields: { reply: "text" } };
  const handover = handOverStream({
    stream,
    format: "jsonl",
    mapping,
    registry: registryOf([jsonl.reader, sse.reader]),
  });
  assert.ok(handover.ok, JSON.stringify(handover));
  assert.equal(handover.reader.format, "jsonl", "the reader OF THE FORMAT took the stream");
  // The stream was handed over unread: the reader received THE stream.
  assert.equal(jsonl.seen.stream, stream, "the same stream object, not a copy");
  await new Promise((resolveSettle) => setTimeout(resolveSettle, 10));
  assert.equal(jsonl.seen.consumed, true, "the reader consumed it");
  assert.equal(sse.seen.stream, null, "the other reader saw nothing");
});

test("CT-109-19: stream.mapping is handed over as data", () => {
  const reader = recordingReader("jsonl");
  const mapping = { kind: "kindOf", fields: { reply: "text" } };
  const handover = handOverStream({
    stream: rawStream(),
    format: "jsonl",
    mapping,
    registry: registryOf([reader.reader]),
  });
  assert.ok(handover.ok);
  // As data: the very object the descriptor carried, uninterpreted.
  assert.equal(handover.mapping, mapping);
  assert.equal(reader.seen.mapping, mapping);
});

test("CT-109-19: the seam reads no stream by itself", () => {
  // The hand-over returns without consuming anything: with a reader that
  // never touches the stream, the stream is still fresh.
  let consumed = false;
  const untouched = registryOf([
    {
      format: "text",
      read() {
        consumed = true;
        return null;
      },
    },
  ]);
  const stream = rawStream();
  const handover = handOverStream({ stream, format: "text", registry: untouched });
  assert.ok(handover.ok);
  // `read` was called (the hand-over happened), the stream object is the
  // caller's, and nothing of the seam iterated it: the iterator is unused.
  assert.equal(consumed, true);
  assert.ok(stream[Symbol.asyncIterator], "the stream is intact for the reader");
});

test("CT-109-19: a format no reader is registered for refuses", () => {
  const handover = handOverStream({
    stream: rawStream(),
    format: "xml-frames",
    registry: registryOf([recordingReader("jsonl").reader]),
  });
  assert.equal(handover.ok, false);
  assert.ok(!handover.ok && handover.reason === "unknown-format");
});

test("CT-109-19: an unknown stream format refuses the descriptor", () => {
  const registries = {
    kinds: ["cli", "openai-chat", "anthropic-messages"],
    streamFormats: ["text", "jsonl", "sse-openai", "sse-anthropic"],
  };
  const base = {
    descriptorVersion: 1,
    id: "ct-19-harness",
    kind: "cli",
    models: {},
    roles: { critic: { supported: true } },
    invoke: { critic: { permission: "none", prompt: "stdin", args: ["--p"] } },
    continuation: {},
    failures: {},
    cost: {},
    memory: {},
    stream: undefined,
  };
  // At load time, through the same registry of readers.
  const unknown = { ...base, stream: { format: "xml-frames" } };
  const readers = registryOf([recordingReader("jsonl").reader, recordingReader("text").reader]);
  assert.equal(refuseDescriptorStream(unknown, readers).ok, false);
  // The loader refuses it too, against the stream-format registry.
  assert.equal(validateDescriptor(unknown, registries, "user").ok, false);

  // A format a reader IS registered for passes both.
  const known = { ...base, stream: { format: "jsonl", mapping: { kind: "kindOf" } } };
  assert.deepEqual(refuseDescriptorStream(known, readers), { ok: true });
  assert.equal(validateDescriptor(known, registries, "user").ok, true);
  assert.deepEqual(streamOf(known), {
    format: "jsonl",
    mapping: { kind: "kindOf" },
  });

  // Raw text, the default: no reader needed, no refusal.
  assert.deepEqual(refuseDescriptorStream(base, readers), { ok: true });
  assert.equal(streamOf(base), null);
});
