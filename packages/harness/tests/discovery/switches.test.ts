/**
 * T017 — characterization test CT-146-12 of the switches of discovery
 * (F146-FR-012): with discovery off no probe runs and no request is made;
 * with the metadata pass off no request is made; under the `parity`
 * profile both are off and nothing is printed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discover, discoverySwitches } from "../../src/discovery/discover.ts";
import type { ProbeSpawn } from "../../src/discovery/probes/runner.ts";
import type { TestedAdapter } from "../../src/discovery/ports.ts";
import { GuardedReader } from "../../src/discovery/guarded-reader.ts";
import { fakeFetch, fakeResolver } from "./helpers.ts";

/** A spawn a test traces: one call here is one probe that ran. */
function tracedSpawn(): ProbeSpawn & { readonly calls: number } {
  const spawn = ((request: { file: string }) => {
    calls += 1;
    throw new Error(`a probe ran: ${request.file}`);
  }) as unknown as ProbeSpawn & { calls: number };
  let calls = 0;
  Object.defineProperty(spawn, "calls", { get: () => calls });
  return spawn;
}

const ADAPTER: TestedAdapter = {
  id: "adapter-fixture",
  kind: "cli",
  detect: { executable: "adapter-fixture" },
};

/** A directory on the search path that holds the adapter's executable. */
function makeBin(): string {
  const bin = mkdtempSync(join(tmpdir(), "ct-146-12-bin-"));
  writeFileSync(join(bin, "adapter-fixture"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return bin;
}

test("CT-146-12: with discovery off no probe runs and no request is made", async () => {
  const spawn = tracedSpawn();
  const fetch = fakeFetch(() => ({ status: 200, text: "{}" }));
  const reader = new GuardedReader({
    secretResolver: fakeResolver({ "env:EXAMPLE_ENDPOINT_URL": "yes" }),
    readSearchPath: () => makeBin(),
  });
  const result = await discover({
    resolver: fakeResolver({ "env:EXAMPLE_ENDPOINT_URL": "yes" }),
    reader,
    spawn,
    fetch,
    testedAdapters: [ADAPTER],
    declarations: [{ id: "mine", kind: "cli" }],
    runVersionProbes: true,
    switches: { discoveryEnabled: false, metadataPassEnabled: false, parityProfile: false },
  });
  // No probe ran, and no request was made.
  assert.equal(spawn.calls, 0);
  assert.equal(fetch.calls.length, 0);
  assert.equal(result.requests.length, 0);
  // The list holds the tested harness adapters and the entries the
  // consumer declared — and nothing the sources found.
  assert.deepEqual(result.candidates.map((candidate) => candidate.id).sort(), [
    "adapter-fixture",
    "mine",
  ]);
  const mine = result.candidates.find((candidate) => candidate.id === "mine");
  assert.equal(mine?.state, "declared");
  const adapter = result.candidates.find((candidate) => candidate.id === "adapter-fixture");
  assert.equal(adapter?.state, "tested");
});

test("CT-146-12: with the metadata pass off no request is made", async () => {
  const fetch = fakeFetch(() => ({ status: 200, text: "{}" }));
  const result = await discover({
    resolver: fakeResolver({ "env:GW_KEY": "yes", "env:EXAMPLE_ENDPOINT_URL": "yes" }),
    fetch,
    gatewayVariables: [
      { name: "GW_URL", baseUrl: "http://127.0.0.1:9", credentialReference: "env:GW_KEY" },
    ],
    switches: { discoveryEnabled: true, metadataPassEnabled: false, parityProfile: false },
  });
  assert.equal(fetch.calls.length, 0);
  assert.equal(result.requests.length, 0);
  // The passive pass still ran: an endpoint candidate exists.
  assert.deepEqual(result.passes, { passive: true, metadata: false });
  assert.ok(result.candidates.some((candidate) => candidate.sources.includes("endpoint")));
});

test("CT-146-12: under the `parity` profile both switches are off and nothing is printed", async () => {
  const printed: string[] = [];
  const spawn = tracedSpawn();
  const fetch = fakeFetch(() => ({ status: 200, text: "{}" }));
  const switches = discoverySwitches({ profile: "parity" });
  assert.deepEqual(switches, {
    discoveryEnabled: false,
    metadataPassEnabled: false,
    parityProfile: true,
  });
  const result = await discover({
    resolver: fakeResolver(),
    reader: new GuardedReader({
      secretResolver: fakeResolver(),
      readSearchPath: () => "/nonexistent-ct-146-12",
    }),
    spawn,
    fetch,
    printer: (line) => printed.push(line),
    projectConfig: { scope: "project", values: { harnesses: { ignored: {} } } },
    switches,
  });
  assert.equal(spawn.calls, 0);
  assert.equal(fetch.calls.length, 0);
  assert.equal(result.requests.length, 0);
  // Nothing is printed: no line of this feature, on the printer or in the
  // result.
  assert.equal(printed.length, 0);
  assert.equal(result.lines.length, 0);
});
