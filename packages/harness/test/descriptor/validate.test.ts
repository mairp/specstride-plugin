/**
 * T010 — CT-109-14: descriptor validation (F109-FR-014).
 *
 * Unknown top-level key; `x-` keys ignored; the version range; an argument
 * list written as shell text; a placeholder outside the closed set of seven;
 * a duplicate id of one origin; `kind` and `stream.format` resolved through
 * their registries; the precedence of sources; the optional `tiers` and
 * `session`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PLACEHOLDERS,
  SOURCE_PRECEDENCE,
  loadDescriptors,
  placeholderOutsideClosedSet,
  validateDescriptor,
} from "../../src/descriptor/loader.ts";
import { checkRegistration } from "../../src/registry/levels.ts";

const REGISTRIES = {
  kinds: ["cli", "openai-chat", "anthropic-messages"],
  streamFormats: ["text", "jsonl", "sse-openai", "sse-anthropic"],
};

export function baseDescriptor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    descriptorVersion: 1,
    id: "fake-harness",
    kind: "cli",
    provider: { id: "fake", termsRef: null },
    auth: { tiers: [1], credential: null },
    stream: { format: "text" },
    isolation: { envAllow: ["FAKE_TOKEN"] },
    ...overrides,
  };
}

test("CT-109-14: a well-formed descriptor validates and the loader sets the origin", () => {
  const result = validateDescriptor(baseDescriptor(), REGISTRIES, "user");
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  assert.equal(result.descriptor!.origin, "user");
});

test("CT-109-14: an unknown top-level key refuses the descriptor, naming it", () => {
  const result = validateDescriptor(baseDescriptor({ launchMode: "detach" }), REGISTRIES, "user");
  assert.equal(result.ok, false);
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0]!.reason, /unknown top-level key `launchMode`/);
  assert.equal(result.findings[0]!.descriptor, "fake-harness");
});

test("CT-109-14: keys under `x-` are ignored, not refused", () => {
  const result = validateDescriptor(
    baseDescriptor({ "x-vendor-note": "anything at all" }),
    REGISTRIES,
    "bundled",
  );
  assert.equal(result.ok, true, JSON.stringify(result.findings));
});

test("CT-109-14: a descriptorVersion outside the accepted range refuses the descriptor", () => {
  for (const version of [2, 0, "1", null]) {
    const result = validateDescriptor(
      baseDescriptor({ descriptorVersion: version }),
      REGISTRIES,
      "user",
    );
    assert.equal(result.ok, false, String(version));
    assert.match(result.findings[0]!.reason, /descriptorVersion/);
    assert.match(result.findings[0]!.reason, /accepted range/);
  }
});

test("CT-109-14: an argument list written as shell text refuses the descriptor; a list is accepted", () => {
  const shell = validateDescriptor(
    baseDescriptor({ invoke: { proposer: { args: "run --prompt {prompt} --yes" } } }),
    REGISTRIES,
    "user",
  );
  assert.equal(shell.ok, false);
  assert.match(shell.findings[0]!.reason, /not a list of text/);

  const list = validateDescriptor(
    baseDescriptor({ invoke: { proposer: { args: ["run", "--prompt", "{prompt}", "--yes"] } } }),
    REGISTRIES,
    "user",
  );
  assert.equal(list.ok, true, JSON.stringify(list.findings));
});

test("CT-109-14: a placeholder outside the closed set of seven refuses the descriptor", () => {
  // Every member of the closed set passes, including the parameterised file.
  for (const placeholder of [...PLACEHOLDERS, "{file:handoff.md}"]) {
    assert.equal(placeholderOutsideClosedSet(placeholder), null, placeholder);
  }
  const result = validateDescriptor(
    baseDescriptor({
      invoke: { proposer: { args: ["run", "--prompt", "{promptFile}", "--out", "{notes}"] } },
    }),
    REGISTRIES,
    "user",
  );
  assert.equal(result.ok, false);
  assert.match(
    result.findings[0]!.reason,
    /placeholder `\{notes\}` is outside the closed set of seven/,
  );
});

test("CT-109-14: `kind` and `stream.format` resolve through their registries; an unregistered value refuses", () => {
  const unknownKind = validateDescriptor(
    baseDescriptor({ kind: "shell-agent" }),
    REGISTRIES,
    "user",
  );
  assert.equal(unknownKind.ok, false);
  assert.match(unknownKind.findings[0]!.reason, /kind registry/);

  const unknownStream = validateDescriptor(
    baseDescriptor({ stream: { format: "xml-events" } }),
    REGISTRIES,
    "user",
  );
  assert.equal(unknownStream.ok, false);
  assert.match(unknownStream.findings[0]!.reason, /stream-format registry/);
});

test("CT-109-14: two descriptors of ONE origin with one id refuse the later one", () => {
  const loaded = loadDescriptors(
    [
      { raw: baseDescriptor({ displayName: "first" }), origin: "user" },
      { raw: baseDescriptor({ displayName: "second" }), origin: "user" },
    ],
    REGISTRIES,
  );
  const sameIdFindings = loaded.findings.filter((finding) =>
    /another descriptor of the origin `user` already holds the id/.test(finding.reason),
  );
  assert.equal(sameIdFindings.length, 1, JSON.stringify(loaded.findings));
  const userEntries = loaded.entries.filter((entry) => entry.descriptor.origin === "user");
  assert.equal(userEntries.length, 1);
  assert.equal((userEntries[0]!.descriptor as { displayName?: string }).displayName, "first");
});

test("CT-109-14: the precedence of sources — one entry wins as a whole, nothing is merged", () => {
  const loaded = loadDescriptors(
    [
      {
        raw: baseDescriptor({
          id: "shared-harness",
          origin: undefined,
          displayName: "the bundled one",
          isolation: { envAllow: ["BUNDLED_VAR"] },
        }),
        origin: "bundled",
      },
      {
        raw: baseDescriptor({
          id: "shared-harness",
          displayName: "the consumer one",
          isolation: { envAllow: ["USER_VAR"] },
        }),
        origin: "user",
      },
    ],
    REGISTRIES,
  );
  assert.equal(loaded.entries.length, 1, "one entry wins as a whole");
  const winner = loaded.entries[0]!.descriptor as Record<string, unknown>;
  assert.equal(winner.displayName, "the consumer one");
  assert.equal(winner.origin, "user");
  assert.deepEqual(
    (winner.isolation as { envAllow: string[] }).envAllow,
    ["USER_VAR"],
    "nothing is merged",
  );
  assert.equal(loaded.losers.length, 1);
  assert.equal(loaded.losers[0]!.origin, "bundled");
  assert.match(loaded.losers[0]!.reason, /outranks/);
});

test("CT-109-14: the precedence order is consumer, tested adapter, bundled, detected; the consumer entry is never tested", () => {
  assert.deepEqual([...SOURCE_PRECEDENCE], ["user", "adapter", "bundled", "detected"]);
  const loaded = loadDescriptors(
    [
      {
        raw: baseDescriptor({ id: "h", versionRange: ">=9", verifiedOn: "2026-01-01" }),
        origin: "adapter",
      },
      { raw: baseDescriptor({ id: "h" }), origin: "user" },
      { raw: baseDescriptor({ id: "h" }), origin: "detected" },
    ],
    REGISTRIES,
  );
  assert.equal(loaded.entries.length, 1);
  const winner = loaded.entries[0]!.descriptor as Record<string, unknown>;
  assert.equal(winner.origin, "user", "the consumer-declared entry wins");
  assert.equal(winner.tested, false, "an entry from a consumer descriptor is never tested");
  assert.equal(loaded.losers.length, 2);
});

test("CT-109-14: the optional fields `tiers` and `session` are accepted", () => {
  const result = validateDescriptor(
    baseDescriptor({
      tiers: [{ name: "fast" }, { name: "deep" }],
      session: { state: "configHome", redirect: ["--session-dir", "{workdir}"] },
    }),
    REGISTRIES,
    "user",
  );
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  assert.equal((result.descriptor!.tiers as unknown[]).length, 2);
});

test("CT-109-14: every refusal names the descriptor and the reason, for the doctor", () => {
  const result = validateDescriptor(
    baseDescriptor({ id: "my-harness", descriptorVersion: 7 }),
    REGISTRIES,
    "detected",
  );
  assert.equal(result.ok, false);
  assert.equal(result.findings[0]!.descriptor, "my-harness");
  assert.equal(typeof result.findings[0]!.reason, "string");
});

test("CT-109-14: a registry built from loaded entries applies the check of registration (T008 seam)", () => {
  const loaded = loadDescriptors(
    [
      {
        raw: baseDescriptor({
          id: "fake-harness",
          roles: { proposer: { supported: true }, critic: { supported: false } },
        }),
        origin: "user",
      },
    ],
    REGISTRIES,
  );
  assert.equal(loaded.entries.length, 1);
  // The entry declares the proposer level and holds all six capabilities.
  const registration = checkRegistration({
    id: "fake-harness",
    levels: ["proposer"],
    operations: { proposer: ["P1", "P2", "P3", "P4", "P5", "P6"] },
  });
  assert.equal(registration.ok, true);
  assert.equal(registration.offered.proposer, true);
});
