/**
 * T058 — CT-109-23: the bundled descriptors (F109-FR-023).
 *
 * The bundled descriptors are data: they are read from the package's
 * descriptor directory, validated like any descriptor the consumer brings,
 * carry logical names of the form `package:harness:<id>`, name no machine,
 * and can be removed without a change of code.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUNDLED_DESCRIPTORS_DIR,
  bundledLogicalName,
  loadBundledDescriptors,
  textIsMachineSpecific,
} from "../../src/descriptor/bundled.ts";
import { buildCliInvocation } from "../../src/generic/cli.ts";
import { guardAddress } from "../../src/endpoint/guard.ts";

test("CT-109-23: the bundled descriptors are validated data from the package", async () => {
  const loaded = await loadBundledDescriptors();
  assert.ok(loaded.entries.length >= 3, `bundled ${loaded.entries.length}`);
  // Findings are empty: every bundled descriptor validates.
  assert.deepEqual(loaded.findings, []);
  // Each entry keeps its id, its origin and its logical name.
  const ids = loaded.entries.map((entry) => entry.descriptor.id).sort();
  assert.deepEqual(ids, ["example-anthropic-messages", "example-cli", "example-openai-chat"]);
  for (const entry of loaded.entries) {
    assert.equal(entry.ok, true);
    assert.equal(entry.descriptor?.origin, "bundled");
    const logicalName = bundledLogicalName(entry.descriptor!.id as string);
    assert.match(logicalName, /^package:harness:/);
  }
  // The logical names are the mapping's keys, and nothing else is named.
  assert.deepEqual(
    Object.keys(loaded.logicalNames).sort(),
    ["example-anthropic-messages", "example-cli", "example-openai-chat"].sort(),
  );
});

test("CT-109-23: the bundled descriptors name no machine", async () => {
  const loaded = await loadBundledDescriptors();
  for (const entry of loaded.entries) {
    const specific = textIsMachineSpecific(JSON.stringify(entry.descriptor!));
    assert.equal(specific, null, `${entry.descriptor.id} names ${String(specific)}`);
  }
  // And the check itself catches the names it exists for.
  for (const machine of [
    "/home/someone/agents/claude",
    "/Users/someone/agents/claude",
    "https://api.openai.com/v1",
    "https://api.anthropic.com/v1",
    "localhost:43210",
    "gpt-4o",
    "sk-proj-abc123",
  ]) {
    assert.ok(textIsMachineSpecific(JSON.stringify({ endpoint: machine })) !== null, machine);
  }
});

test("CT-109-23: the bundled descriptors conform through the same adapters", async () => {
  const loaded = await loadBundledDescriptors();
  const byId = new Map(
    loaded.entries.map((entry) => [entry.descriptor!.id as string, entry.descriptor!]),
  );
  // The CLI example builds an invocation through the generic adapter...
  const cli = byId.get("example-cli")!;
  const workdir = mkdtempSync(join(tmpdir(), "ct-23-work-"));
  const built = buildCliInvocation(cli, "nonexistent-harness-binary", {
    role: "proposer",
    prompt: "a short prompt",
    workdir,
    model: "example-model",
    sessionId: "s",
  });
  assert.ok(built.ok, JSON.stringify(built));
  // ...with the descriptor's own argument list and prompt; the descriptor
  // declared that no permission mechanism exists, and none was invented.
  const roleCall = cli.invoke as Record<string, Record<string, unknown>>;
  assert.equal(roleCall.proposer?.permission, "none");
  assert.equal(built.stdin, null);
  assert.ok(built.args.length > 0);
  assert.ok(built.args.includes("example-model"), "the model placeholder took the value");

  // The endpoint examples pass the guard of the seam: a loopback base URL.
  for (const id of ["example-openai-chat", "example-anthropic-messages"]) {
    const descriptor = byId.get(id)!;
    const endpoint = descriptor.endpoint as Record<string, unknown>;
    const guarded = guardAddress(String(endpoint.baseUrl));
    assert.equal(guarded.ok, true, `${id} endpoint ${String(endpoint.baseUrl)}`);
  }
});

test("CT-109-23: a bundled descriptor is removed without a change of code", async () => {
  // Copy the shipped data to a temporary directory; the shipped files stay.
  const copy = mkdtempSync(join(tmpdir(), "ct-23-copy-"));
  try {
    cpSync(BUNDLED_DESCRIPTORS_DIR, copy, { recursive: true });
    const before = await loadBundledDescriptors({ dir: copy });
    assert.equal(before.entries.length, 3);

    // Remove one: data leaves, the code does not change.
    rmSync(join(copy, "example-anthropic-messages.yaml"));
    const after = await loadBundledDescriptors({ dir: copy });
    assert.equal(after.entries.length, 2);
    assert.deepEqual(after.findings, []);
    assert.equal(after.logicalNames["example-anthropic-messages"], undefined);
    assert.ok(after.logicalNames["example-cli"]);
    assert.ok(after.logicalNames["example-openai-chat"]);

    // Nothing in the code names the removed file.
    const source = await (async () => {
      const { readFileSync } = await import("node:fs");
      return readFileSync(
        join(
          fileURLToPath(new URL(".", import.meta.url)),
          "..",
          "..",
          "src",
          "descriptor",
          "bundled.ts",
        ),
        "utf8",
      );
    })();
    assert.ok(!source.includes("example-cli"), "the code names no bundled descriptor");
    assert.ok(!source.includes("example-anthropic-messages"));

    // And a directory with no descriptor at all loads as none.
    const empty = mkdtempSync(join(tmpdir(), "ct-23-empty-"));
    try {
      const none = await loadBundledDescriptors({ dir: empty });
      assert.deepEqual(none.entries, []);
      assert.deepEqual(none.findings, []);
      assert.equal(readdirSync(empty).length, 0);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});
