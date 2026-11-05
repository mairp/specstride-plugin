/**
 * T013 — characterization tests CT-146-6 and CT-146-7 of the sources
 * `endpoint` and `gateway` (F146-FR-006, F146-FR-007): a candidate by the
 * presence of the variable; the user part of an address is removed; a
 * gateway is asked for its model list only; one candidate per model, of an
 * endpoint kind.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { GuardedReader } from "../../src/discovery/guarded-reader.ts";
import { readEndpointSource } from "../../src/discovery/sources/endpoint.ts";
import { readGatewaySource } from "../../src/discovery/sources/gateway.ts";
import { MetadataClient } from "../../src/discovery/metadata-client.ts";
import { loadBundledDescriptors } from "../../src/descriptor/bundled.ts";
import type { LoadedDescriptor } from "../../src/descriptor/loader.ts";
import { fakeFetch, fakeResolver } from "./helpers.ts";

/** A descriptor a test drives, as the loader would hand it over. */
function driveDescriptor(descriptor: Record<string, unknown>): LoadedDescriptor {
  return {
    ok: true,
    findings: [],
    descriptor: {
      ...descriptor,
      origin: "bundled",
    } as LoadedDescriptor["descriptor"],
  };
}

test("CT-146-6: a candidate by the presence of the variable", async () => {
  const descriptors = loadBundledDescriptors().entries;
  const absent = new GuardedReader({ secretResolver: fakeResolver({}) });
  const nothing = await readEndpointSource({ reader: absent, descriptors });
  // With the variable absent, no endpoint candidate exists.
  assert.equal(nothing.candidates.length, 0);
  const present = new GuardedReader({
    secretResolver: fakeResolver({ "env:EXAMPLE_ENDPOINT_URL": "yes" }),
  });
  const found = await readEndpointSource({ reader: present, descriptors });
  // Both bundled endpoint descriptors name EXAMPLE_ENDPOINT_URL: each is
  // one candidate, found by the presence of the variable alone.
  const ids = found.candidates.map((candidate) => candidate.id).sort();
  assert.deepEqual(ids, ["example-anthropic-messages", "example-openai-chat"]);
  for (const candidate of found.candidates) {
    assert.deepEqual(candidate.sources, ["endpoint"]);
    // The credential field holds a presence, never a value (F146-FR-004).
    assert.ok(["yes", "no", "unprobed"].includes(candidate.credential));
    assert.equal(typeof candidate.endpoint?.host, "string");
  }
});

test("CT-146-6: the user part of an address is removed; only scheme, host and path are kept", async () => {
  const descriptor = driveDescriptor({
    id: "address-fixture",
    kind: "openai-chat",
    detect: { variables: ["ADDRESS_FIXTURE_KEY"] },
    auth: { credential: "env:ADDRESS_FIXTURE_KEY" },
    endpoint: {
      baseUrl: "http://user:secret@127.0.0.1:9/v1?api-version=1",
      modelsPath: "/v1/models",
    },
  });
  const reader = new GuardedReader({
    secretResolver: fakeResolver({ "env:ADDRESS_FIXTURE_KEY": "yes" }),
  });
  const result = await readEndpointSource({ reader, descriptors: [descriptor] });
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0]!;
  // The user part and the query are gone; scheme, host and path remain.
  assert.deepEqual(candidate.endpoint, { scheme: "http", host: "127.0.0.1", path: "/v1" });
  // The provider is the host of the endpoint (threat T-14).
  assert.equal(candidate.provider, "127.0.0.1");
  const recorded = JSON.stringify(result);
  assert.equal(recorded.includes("user"), false, "the user part travelled");
  assert.equal(recorded.includes("secret"), false, "the password travelled");
  assert.equal(recorded.includes("api-version"), false, "the query travelled");
});

test("CT-146-7: a gateway is asked for its model list only; one candidate per model, of an endpoint kind", async () => {
  const reader = new GuardedReader({
    secretResolver: fakeResolver({ "env:GW_KEY": "yes", "env:GW_URL": "yes" }),
  });
  const redactions: string[] = [];
  const metadata = new MetadataClient({
    resolver: fakeResolver({ "env:GW_KEY": "yes" }, { "env:GW_KEY": "gateway-credential" }),
    fetch: fakeFetch((request) => {
      // Whatever the path asked, the answer is a model list of two.
      assert.equal(request.method, "GET");
      return { status: 200, text: '{"data":[{"id":"model-a"},{"id":"model-b"}]}' };
    }),
    redactor: { register: (value) => redactions.push(`${value.length}`) },
  });
  const result = await readGatewaySource({
    reader,
    descriptors: [],
    gatewayVariables: [
      { name: "GW_URL", baseUrl: "http://user@gateway.local:9", credentialReference: "env:GW_KEY" },
    ],
    declaredGateways: [],
    metadata,
    online: true,
  });
  // Exactly one request was made: the model list, and nothing else.
  assert.equal(result.modelListsAsked, 1);
  const trace = metadata.trace;
  assert.equal(trace.length, 1);
  assert.equal(trace[0]!.method, "GET");
  assert.ok(trace[0]!.url.endsWith("/v1/models"));
  assert.equal(trace[0]!.url.includes("chat"), false);
  assert.equal(trace[0]!.url.includes("completions"), false);
  // One candidate per model, of an endpoint kind, to be called through
  // the generic harness adapter.
  assert.equal(result.candidates.length, 2);
  for (const candidate of result.candidates) {
    assert.equal(candidate.kind, "endpoint");
    assert.deepEqual(candidate.sources, ["gateway"]);
    assert.equal(candidate.informational, false);
  }
  assert.deepEqual(result.candidates.map((candidate) => candidate.id).sort(), [
    "gateway:gw_url:model-a",
    "gateway:gw_url:model-b",
  ]);
  // The user part of the gateway address never travelled either.
  const recorded = JSON.stringify({ result, trace });
  assert.equal(recorded.includes("user@"), false);
});

test("CT-146-7: with the metadata pass off, a gateway is asked nothing", async () => {
  const reader = new GuardedReader({ secretResolver: fakeResolver({ "env:GW_KEY": "yes" }) });
  const metadata = new MetadataClient({
    resolver: fakeResolver(),
    fetch: fakeFetch(() => ({ status: 200, text: "{}" })),
  });
  const result = await readGatewaySource({
    reader,
    descriptors: [],
    gatewayVariables: [{ name: "GW_URL", baseUrl: "http://127.0.0.1:9" }],
    declaredGateways: [],
    metadata,
    online: false,
  });
  assert.equal(result.modelListsAsked, 0);
  assert.equal(metadata.trace.length, 0);
  assert.equal(result.candidates.length, 0);
});
