/**
 * CT-126-Foundation — the registry (T005): the validation of F126-FR-001,
 * one resolution per name or alias, unknown resolves to nothing, and the
 * rows this feature registers.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SIGNALS,
  RegistryRefusedError,
  StreamFormatRegistry,
  defaultStreamRegistry,
  isValidFormatName,
  type StreamFormatRow,
} from "../src/stream/registry.ts";

function row(over: Partial<StreamFormatRow> = {}): StreamFormatRow {
  return {
    name: "sample",
    reason: "a capability reason",
    reader: { type: "code", start: () => undefined },
    ...over,
  };
}

test("the name shape rules of F126-FR-001", () => {
  assert.equal(isValidFormatName("claude"), true);
  assert.equal(isValidFormatName("sse-openai"), true);
  assert.equal(isValidFormatName("a"), false); // too short
  assert.equal(isValidFormatName("-claude"), false); // leading hyphen
  assert.equal(isValidFormatName("claude-"), false); // trailing hyphen
  assert.equal(isValidFormatName("Claude"), false); // upper case
  assert.equal(isValidFormatName("claude_v3"), false); // underscore
});

test("a valid row registers, and a name or alias resolves to the same row", () => {
  const registry = new StreamFormatRegistry();
  const resolved = registry.register(row({ aliases: ["sample-alt"] }));
  assert.equal(resolved.hasInitRecord, true); // default
  assert.equal(resolved.synthInit, false); // default
  assert.equal(resolved.listedAsIs, false); // default
  assert.deepEqual([...resolved.signals], DEFAULT_SIGNALS);
  assert.equal(registry.resolve("sample")?.name, "sample");
  assert.equal(registry.resolve("sample-alt")?.name, "sample"); // same row
  assert.equal(registry.resolve("nonesuch"), undefined); // unknown: nothing
});

test("each fault of F126-FR-001 refuses with a message that names it", () => {
  const registry = new StreamFormatRegistry();
  registry.register(row());
  const refuses = (candidate: StreamFormatRow, fragment: string): void => {
    assert.throws(
      () => registry.register(candidate),
      (err: unknown): err is RegistryRefusedError =>
        err instanceof RegistryRefusedError && err.message.includes(fragment),
    );
  };
  refuses(row(), "registered twice"); // repeated name
  refuses(row({ name: "other", aliases: ["sample"] }), "alias 'sample'"); // repeated alias
  refuses(row({ name: "Bad_Name" }), "invalid"); // invalid name
  refuses(row({ name: "noreason", reason: "   " }), "empty capability reason");
  refuses(
    row({ name: "synthy", hasInitRecord: true, synthInit: true }),
    "synthInit together with an initial record",
  );
  refuses(row({ name: "tooly", tools: ["NotCanonical"] }), "canonical vocabulary");
  refuses(row({ name: "emptysig", signals: [] }), "empty capability list");
  refuses(row({ name: "unknownsig", signals: ["init", "nope"] }), "closed set");
  refuses(row({ name: "ordersig", signals: ["tool", "init"] }), "out of order");
  refuses(row({ name: "repeatsig", signals: ["init", "init"] }), "repeating");
});

test("the rows this feature registers resolve (F126-FR-007, F126-FR-001)", () => {
  const registry = defaultStreamRegistry();
  assert.equal(registry.resolve("claude-stream-json")?.name, "claude");
  assert.equal(registry.resolve("prime-v3")?.name, "prime-v3");
  assert.equal(registry.resolve("text")?.synthTerminal, true);
  assert.equal(registry.resolve("sse-openai")?.reader.type, "mapping");
  assert.equal(registry.resolve("sse-anthropic")?.reader.type, "mapping");
  assert.deepEqual(
    [...registry.names()],
    ["claude", "prime-v3", "text", "sse-openai", "sse-anthropic"],
  );
});

test("the parity listing shows only the rows that set listedAsIs", () => {
  const registry = new StreamFormatRegistry();
  registry.register(row({ name: "claude", aliases: ["claude-stream-json"], listedAsIs: true }));
  registry.register(row({ name: "prime-v3", listedAsIs: true }));
  registry.register(row({ name: "text" }));
  assert.deepEqual(
    registry.listedAsIs().map((r) => r.name),
    ["claude", "prime-v3"],
  );
});
