/**
 * T053 — the hand-over of the raw stream to the reader registry of feature
 * 126 (F109-FR-019).
 *
 * The generic harness adapter reads NO stream by itself. The raw stream of
 * a call goes, unread, to the stream reader that is registered for the
 * `stream.format` of the descriptor. Where the descriptor carries
 * `stream.mapping`, the mapping is handed to the reader as DATA — the
 * reader interprets it, the seam does not. A stream format that no reader
 * is registered for refuses the descriptor.
 *
 * The registry itself is feature 126's; this module holds only the seam
 * side: the shape a reader registry answers to, and the one hand-over
 * function. Until feature 126 ships its registry, a consumer of the seam
 * passes any object that answers `readerFor`.
 */

/** What one stream reader of feature 126 answers to. */
export type StreamReader = {
  /** The `stream.format` this reader reads. */
  readonly format: string;
  /**
   * Read the raw stream. The seam hands the stream over UNREAD; the reader
   * consumes it. `mapping` is the descriptor's `stream.mapping`, as data.
   */
  read(input: {
    readonly stream: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> | string;
    readonly mapping: Readonly<Record<string, unknown>> | null;
  }): Promise<unknown> | unknown;
};

/** The reader registry of feature 126, as the seam sees it. */
export type StreamReaderRegistry = {
  /** The reader registered for a format, or undefined. */
  readerFor(format: string): StreamReader | undefined;
};

export type StreamHandover =
  | {
      readonly ok: true;
      /** The reader the stream was handed to (the seam did not read it). */
      readonly reader: StreamReader;
      /** The mapping, handed over as data: the same object the descriptor carried. */
      readonly mapping: Readonly<Record<string, unknown>> | null;
    }
  | { readonly ok: false; readonly reason: "unknown-format"; readonly message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The `stream` record of the descriptor: format and mapping. */
export function streamOf(descriptor: {
  readonly stream?: unknown;
}): { readonly format: string; readonly mapping: Readonly<Record<string, unknown>> | null } | null {
  const stream = descriptor.stream;
  if (!isRecord(stream) || typeof stream.format !== "string") {
    return null;
  }
  return {
    format: stream.format,
    mapping: isRecord(stream.mapping) ? stream.mapping : null,
  };
}

/**
 * F109-FR-019 — hand the raw stream to the reader registered for the
 * `stream.format` of the descriptor. No format, or a format no reader is
 * registered for, refuses.
 */
export function handOverStream(input: {
  readonly stream: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> | string;
  readonly format?: string;
  readonly mapping?: Readonly<Record<string, unknown>> | null;
  readonly registry: StreamReaderRegistry;
}): StreamHandover {
  const format = input.format;
  if (typeof format !== "string" || format.length === 0) {
    return {
      ok: false,
      reason: "unknown-format",
      message: "the descriptor declares no stream.format; the raw text stream has no reader",
    };
  }
  const reader = input.registry.readerFor(format);
  if (reader === undefined) {
    return {
      ok: false,
      reason: "unknown-format",
      message: `no stream reader is registered for the format \`${format}\`; the descriptor is refused`,
    };
  }
  // The seam reads nothing: the reader is called with the stream as it is.
  void reader.read({ stream: input.stream, mapping: input.mapping ?? null });
  return { ok: true, reader, mapping: input.mapping ?? null };
}

/**
 * F109-FR-019 — refuse a descriptor whose `stream.format` no reader is
 * registered for, at load time, before any call.
 */
export function refuseDescriptorStream(
  descriptor: { readonly stream?: unknown },
  registry: StreamReaderRegistry,
): { ok: true } | { ok: false; reason: "unknown-format"; message: string } {
  const stream = streamOf(descriptor);
  if (stream === null) return { ok: true }; // raw text: no reader needed
  if (registry.readerFor(stream.format) === undefined) {
    return {
      ok: false,
      reason: "unknown-format",
      message: `no stream reader is registered for the format \`${stream.format}\`; the descriptor is refused`,
    };
  }
  return { ok: true };
}
