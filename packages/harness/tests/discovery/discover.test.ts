/**
 * T010 — characterization tests CT-146-1 and CT-146-2 of discovery
 * (F146-FR-001, F146-FR-002): the two passes; no model call and no paid
 * call; every candidate records its source, a member of the closed set;
 * no candidate is marked a default or picked for a role, and `termsRef`
 * is null where the terms are unknown (ruling P14, every audience).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { discover } from "../../src/discovery/discover.ts";
import { sourcesOfDiscovery } from "../../src/discovery/closed-sets-of-146.ts";
import { fakeFetch, fakeResolver } from "./helpers.ts";
import type { ProbeSpawn } from "../../src/discovery/probes/runner.ts";

/** A spawn that a test traces: a call here would be a process started. */
const tracedSpawn: ProbeSpawn = (request) => {
  throw new Error(`a probe was started outside a pass: ${request.file} ${request.args.join(" ")}`);
};

test("CT-146-1: two passes; no model call and no paid call", async () => {
  const resolver = fakeResolver(
    { "env:EXAMPLE_ENDPOINT_URL": "yes", "env:EXAMPLE_ENDPOINT_KEY": "yes" },
    { "env:EXAMPLE_ENDPOINT_KEY": "endpoint-credential" },
  );
  const fetch = fakeFetch(() => ({ status: 200, text: '{"data":[]}' }));
  const result = await discover({
    resolver,
    spawn: tracedSpawn,
    fetch,
    // The metadata pass is driven by an injected fetch; no gateway is
    // configured, so no request of the pass leaves the machine here.
    gatewayVariables: [],
    switches: { discoveryEnabled: true, metadataPassEnabled: true, parityProfile: false },
  });
  // The two passes ran: the passive one always, the metadata one where it
  // is switched on.
  assert.deepEqual(result.passes, { passive: true, metadata: true });
  // No process was started outside a pass (the traced spawn throws).
  // No model call and no paid call: every request that the metadata pass
  // made or planned was a GET of a model list, and never a request that
  // runs a prompt against a model.
  for (const request of result.requests) {
    assert.equal(request.method, "GET");
    assert.equal(/chat\/completions|\/v1\/messages|completions/.test(request.url), false);
  }
  for (const call of fetch.calls) {
    assert.equal(call.method, "GET");
    assert.equal(/chat\/completions|\/v1\/messages|completions/.test(call.url), false);
  }
  // No secret was resolved for a model call: the only `resolve` of a run
  // with no gateway would serve a model list, and none was needed.
  assert.equal(resolver.resolveCalls.length, 0);
});

test("CT-146-1: the metadata pass asks the model list of a gateway, and nothing else", async () => {
  const resolver = fakeResolver(
    { "env:GW_KEY": "yes", "env:GW_URL": "yes" },
    { "env:GW_KEY": "gateway-credential" },
  );
  const fetch = fakeFetch(() => ({
    status: 200,
    text: '{"data":[{"id":"m1"},{"id":"m2"}]}',
  }));
  const result = await discover({
    resolver,
    fetch,
    gatewayVariables: [
      { name: "GW_URL", baseUrl: "http://127.0.0.1:9", credentialReference: "env:GW_KEY" },
    ],
    switches: { discoveryEnabled: true, metadataPassEnabled: true, parityProfile: false },
  });
  // Exactly one request: the model list, by GET.
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0]!.method, "GET");
  assert.ok(fetch.calls[0]!.url.endsWith("/v1/models"));
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0]!.status, 200);
  // Every model of the list is one candidate, of an endpoint kind.
  const models = result.candidates.filter((candidate) => candidate.sources.includes("gateway"));
  assert.equal(models.length, 2);
  for (const candidate of models) assert.equal(candidate.kind, "endpoint");
});

test("CT-146-2: every candidate records a source of the closed set; no default, no role pick; termsRef null where unknown", async () => {
  const resolver = fakeResolver({ "env:EXAMPLE_ENDPOINT_URL": "yes" });
  const result = await discover({
    resolver,
    spawn: tracedSpawn,
    switches: { discoveryEnabled: true, metadataPassEnabled: false, parityProfile: false },
  });
  assert.ok(result.candidates.length > 0);
  const members: readonly string[] = sourcesOfDiscovery.members;
  for (const candidate of result.candidates) {
    // The candidate records the source that found it, a member of the
    // closed set of the seven sources (F146-FR-002).
    assert.ok(candidate.sources.length > 0, `candidate ${candidate.id} names no source`);
    for (const source of candidate.sources) {
      assert.ok(
        members.includes(source),
        `"${source}" is not a member of the closed set of the sources of discovery`,
      );
    }
    // No candidate is marked a default and none is picked for a role
    // (F146-FR-001, ruling P14): the record holds no field that could
    // carry such a marking.
    for (const field of Object.keys(candidate)) {
      assert.match(
        field,
        /^(id|sources|state|origin|kind|version|descriptorHash|resolvedPath|endpoint|provider|capabilities|window|credential|termsRef|informational|findings)$/,
      );
    }
    // `termsRef` is null where the terms are unknown: the bundled
    // descriptors state no `provider.termsRef`.
    assert.equal(candidate.termsRef, null);
    assert.equal(candidate.informational, candidate.sources.includes("host"));
  }
  // And the result of the run holds no default and no role pick either.
  for (const field of Object.keys(result)) {
    assert.equal(/default|role|pick/i.test(field), false, `the result carries "${field}"`);
  }
});
