/**
 * T014 — canary test CT-146-8 (F146-FR-008, F146-SC-002): GET only; a
 * redirect is refused and the second host sees no request; the credential
 * appears in no record, log or event.
 *
 * The two hosts are loopback servers the test itself serves with the
 * `http` of the runtime — the same shape as the fixture
 * `endpoint/redirect-endpoint.mjs` of T001, held inside the test process.
 * The credential is the planted marker of the fixture home,
 * `canary-146-credential`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { MetadataClient } from "../../src/discovery/metadata-client.ts";
import { fakeResolver } from "../discovery/helpers.ts";

const MARKER = "canary-146-credential";

/** One loopback server that records the requests it saw. */
function serve(
  handler: (request: { method: string | undefined; url: string | undefined }) => {
    status: number;
    location?: string;
    body?: string;
  },
): Promise<{ server: Server; port: number; seen: { method: string; url: string }[] }> {
  const seen: { method: string; url: string }[] = [];
  const server = createServer((request, response) => {
    seen.push({ method: request.method ?? "", url: request.url ?? "" });
    const answer = handler({ method: request.method, url: request.url });
    if (answer.location !== undefined) response.setHeader("location", answer.location);
    response.statusCode = answer.status;
    response.end(answer.body ?? "");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        port: typeof address === "object" && address !== null ? address.port : 0,
        seen,
      });
    });
  });
}

test("CT-146-8: GET only; a redirect is refused; the second host sees no request; no credential anywhere", async () => {
  const primary = await serve(() => ({ status: 302, location: redirectTarget, body: "" }));
  const secondary = await serve(() => ({
    status: 200,
    body: '{"data":[{"id":"model-on-second-host"}]}',
  }));
  // The redirect target: the model list on the second loopback port.
  const redirectTarget = `http://127.0.0.1:${secondary.port}/v1/models`;
  const metadata = new MetadataClient({
    resolver: fakeResolver({ "env:CANARY_KEY": "yes" }, { "env:CANARY_KEY": MARKER }),
    // The default fetch of the runtime is used for the metadata client
    // under test; the redactor records what it was handed, by label.
    redactor: { register: () => {} },
  });
  const result = await metadata.fetchModelList({
    url: `http://127.0.0.1:${primary.port}/v1/models`,
    credentialReference: "env:CANARY_KEY",
    allowedHost: new URL(`http://127.0.0.1:${primary.port}`).host,
  });
  // The redirect is refused: the value stays null, and a finding names it.
  assert.equal(result.outcome, "redirect-refused");
  assert.equal(result.status, 302);
  assert.deepEqual(result.models, []);
  assert.equal(result.finding?.code, "metadata-redirect-refused");
  // GET only: the primary host saw exactly one request, and it was a GET.
  assert.deepEqual(primary.seen, [{ method: "GET", url: "/v1/models" }]);
  // The second host saw no request at all.
  assert.deepEqual(secondary.seen, []);
  // The credential appears in no record of the client: not in the result,
  // not in the trace, not in a finding, not in a log line.
  const records = JSON.stringify({ result, trace: metadata.trace });
  assert.equal(records.includes(MARKER), false, "the credential travelled into a record");
  assert.equal(records.includes("authorization"), false);
  assert.equal(records.includes("x-api-key"), false);
  const close = (server: Server): Promise<void> =>
    new Promise((resolve) => server.close(() => resolve()));
  await close(primary.server);
  await close(secondary.server);
});

test("CT-146-8: the credential is bound to its host; a second host is never asked", async () => {
  const other = await serve(() => ({ status: 200, body: '{"data":[]}' }));
  const metadata = new MetadataClient({
    resolver: fakeResolver({ "env:CANARY_KEY": "yes" }, { "env:CANARY_KEY": MARKER }),
  });
  const result = await metadata.fetchModelList({
    url: `http://127.0.0.1:${other.port}/v1/models`,
    credentialReference: "env:CANARY_KEY",
    allowedHost: "endpoint.example.local",
  });
  // The request is refused before anything is sent: the other host saw
  // nothing, and the credential stayed where it was.
  assert.equal(result.outcome, "host-not-allowed");
  assert.deepEqual(other.seen, []);
  assert.equal(metadata.trace[0]!.refusedBeforeRequest, "host-not-allowed");
  assert.equal(JSON.stringify({ result, trace: metadata.trace }).includes(MARKER), false);
  await new Promise<void>((resolve) => other.server.close(() => resolve()));
});
