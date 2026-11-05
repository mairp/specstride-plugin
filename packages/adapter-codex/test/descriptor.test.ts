/**
 * T016 — the harness descriptor of the adapter (F131-FR-001, F131-FR-004).
 *
 * `data/descriptor.json` is validated against the schema of the harness
 * seam: kind `cli`, the roles, the transports, the containment ceiling, the
 * memory switches, and `concurrentSessions` null. The loader of the seam is
 * the same one a descriptor of the consumer goes through.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isTestedHarnessAdapter, validateDescriptor } from "@specstride/harness";

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..");
const DESCRIPTOR_PATH = join(PACKAGE, "data", "descriptor.json");

/** The open sets the loader resolves `kind` and `stream.format` through. */
const REGISTRIES = {
  kinds: ["cli", "openai-chat", "anthropic-messages", "http"],
  streamFormats: ["text", "jsonl", "sse-openai"],
};

function load(): Record<string, unknown> {
  return JSON.parse(readFileSync(DESCRIPTOR_PATH, "utf8")) as Record<string, unknown>;
}

function validated() {
  const raw = load();
  const result = validateDescriptor(raw, REGISTRIES, "adapter");
  assert.deepEqual(result.findings, []);
  assert.equal(result.ok, true);
  assert.ok(result.descriptor, "the loader returns the validated descriptor");
  return result.descriptor!;
}

test("the descriptor validates against the schema of the seam with no finding", () => {
  validated();
});

test("the descriptor is of kind `cli`, version 1, provider `openai`", () => {
  const descriptor = validated();
  assert.equal(descriptor.descriptorVersion, 1);
  assert.equal(descriptor.id, "codex");
  assert.equal(descriptor.kind, "cli");
  const provider = descriptor.provider as { id: string };
  assert.equal(provider.id, "openai");
  const auth = descriptor.auth as { tiers: number[] };
  assert.deepEqual(auth.tiers, [1, 2]);
  assert.ok(!auth.tiers.includes(3), "auth tier 3 is never a value of the descriptor");
});

test("the descriptor offers the proposer and completion levels and both transports", () => {
  const descriptor = validated();
  const roles = descriptor.roles as Record<string, { levels?: string[] }>;
  assert.deepEqual(roles.proposer?.levels, ["proposer"]);
  assert.ok(roles.critic?.levels?.includes("completion"));
  assert.deepEqual(descriptor.transports, ["subprocess", "direct-call"]);
  const critic = roles.critic as { transports?: string[] };
  assert.ok(critic.transports?.includes("subprocess"));
  assert.ok(critic.transports?.includes("direct-call"));
});

test("the invocation shapes are argument lists, never shell text", () => {
  const descriptor = validated();
  const invoke = descriptor.invoke as Record<string, { args: string[] }>;
  const shapes = Object.keys(invoke).sort();
  assert.deepEqual(shapes, [
    "critic-readonly",
    "proposer-continued",
    "proposer-default",
    "proposer-parity",
  ]);
  for (const call of Object.values(invoke)) {
    assert.ok(Array.isArray(call.args));
    for (const arg of call.args) assert.equal(typeof arg, "string");
  }
});

test("containment, memory and the null capabilities hold as the data model states", () => {
  const descriptor = validated();
  const containment = descriptor.containment as { ceiling: string; modes: string[] };
  assert.equal(containment.ceiling, "C2");
  assert.deepEqual(containment.modes, ["read-only", "workspace-write"]);
  assert.ok(!containment.modes.includes("danger-full-access"));
  const memory = descriptor.memory as { native?: unknown; switchOff?: unknown };
  assert.ok(memory.native !== undefined);
  assert.ok(memory.switchOff !== undefined);
  assert.equal(descriptor.concurrentSessions, null);
  assert.equal(descriptor.spendLimit, null);
  assert.equal(descriptor.versionRange, ">=0.153.4 <0.154");
  assert.equal(descriptor.verifiedOn, "2026-09-29");
});

test("the descriptor earns the tested-adapter rules: origin adapter, range, date", () => {
  const descriptor = validated();
  assert.equal(descriptor.origin, "adapter");
  assert.equal(
    isTestedHarnessAdapter({
      origin: descriptor.origin,
      versionRange: descriptor.versionRange as string,
      verifiedOn: descriptor.verifiedOn as string,
    }),
    true,
  );
  const stream = descriptor.stream as { format: string };
  assert.equal(stream.format, "jsonl");
});
