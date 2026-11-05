/**
 * T027 and T028 — the HERMETIC half of the two live probes, run on Linux.
 *
 * The owner ruling of 2026-09-30: the live part of each probe — one GET of a
 * real model list, with a real credential, against a real provider or a real
 * gateway — is run by a person and never by the build. What the build may do
 * is the hermetic half: prove, on loopback only, that the machinery the
 * person will use does exactly what the specification declares, so the live
 * run is one substitution of a real URL and a real credential.
 *
 * This script starts two loopback servers and, against them:
 *   T027 — one GET of a model list: the request is a GET, the credential
 *          travels in the header the harness descriptor declares
 *          (`authorization: Bearer …` for a bearer scheme), to the one host
 *          the descriptor names and no other; the resolved value is
 *          registered with the redactor; the trace holds no header, no body
 *          and no credential. A redirect is refused, not followed.
 *   T028 — one GET of a gateway model list: the body lists models of more
 *          than one provider, and the reading of the list keeps them all,
 *          one candidate model each, so a gateway that lists models of other
 *          providers is visible to discovery.
 *
 * Never run against any host other than 127.0.0.1. Never given a real
 * credential. Exit status 0 means every hermetic assertion held.
 */
import { createServer, type Server } from "node:http";
import assert from "node:assert/strict";
import { MetadataClient, modelsOfBody } from "../../src/discovery/metadata-client.ts";
import type { SecretResolver } from "@specstride/contracts/ep/secret-resolver";

const CREDENTIAL = "hermetic-not-a-real-credential";
const sentAuthorizationHeaders: string[] = [];
const requestLines: string[] = [];

/** A resolver over one environment reference, as the composition root wires it. */
const resolver: SecretResolver = {
  handles: (scheme) => scheme === "env:",
  exists: async () => "yes",
  resolve: async () => ({ value: CREDENTIAL, registeredWithTheRedactor: true }),
  boundHost: () => null,
};

const registeredWithRedactor: string[] = [];
const redactor = {
  register: (value: string, label: string) => {
    registeredWithRedactor.push(label);
  },
};

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : 0);
    });
  });
}

/** The model-list server of T027: it answers 200 and records what it was sent. */
const provider = createServer((req, res) => {
  requestLines.push(`${req.method} ${req.url}`);
  sentAuthorizationHeaders.push(String(req.headers.authorization ?? ""));
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      object: "list",
      data: [{ id: "stub-small" }, { id: "stub-large" }],
      window_tokens: 8192,
    }),
  );
});

/** A second host that must never see a request (the redirect target). */
const secondHost = createServer(() => {
  requestLines.push("SECOND-HOST-SAW-A-REQUEST");
});

const redirector = createServer((req, res) => {
  requestLines.push(`${req.method} ${req.url}`);
  res.writeHead(302, { location: "http://second-host.invalid/v1/models" });
  res.end();
});

/** The gateway of T028: its model list names models of several providers. */
const gateway = createServer((req, res) => {
  requestLines.push(`gateway ${req.method} ${req.url}`);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      object: "list",
      data: [
        { id: "openai/gpt-stub" },
        { id: "anthropic/claude-stub" },
        { id: "google/gemini-stub" },
      ],
    }),
  );
});

const providerPort = await listen(provider);
const redirectorPort = await listen(redirector);
await listen(secondHost);
const gatewayPort = await listen(gateway);

const client = new MetadataClient({ resolver, redactor });

// --- T027, hermetic: one GET of a model list, credential as declared -------
const ok = await client.fetchModelList({
  url: `http://127.0.0.1:${providerPort}/v1/models`,
  credentialReference: "env:HERMETIC_STUB_KEY",
  allowedHost: `127.0.0.1:${providerPort}`,
});

const header = sentAuthorizationHeaders[0] ?? "";
assert.equal(ok.outcome, "ok", "the model list did not answer ok");
assert.deepEqual(
  [...ok.models],
  ["stub-small", "stub-large"],
  "the model list was not read as the models it names",
);
assert.equal(
  ok.windowTokens,
  null,
  "the client invented a window — the window is the rule of F146-FR-016, never the client's",
);
assert.equal(requestLines[0], "GET /v1/models", "the request was not a single GET");
assert.equal(
  header,
  `Bearer ${CREDENTIAL}`,
  "the credential did not travel as declared (authorization, bearer scheme)",
);
assert.deepEqual(
  registeredWithRedactor,
  [`credential of 127.0.0.1:${providerPort}`],
  "the resolved value was not registered with the redactor at the moment of use",
);
assert.ok(
  !JSON.stringify(client.trace).includes(CREDENTIAL),
  "the trace carries the credential value",
);

// The credential never reaches a second host: a redirect is refused.
const redirected = await client.fetchModelList({
  url: `http://127.0.0.1:${redirectorPort}/v1/models`,
  credentialReference: "env:HERMETIC_STUB_KEY",
  allowedHost: `127.0.0.1:${redirectorPort}`,
});
assert.equal(redirected.outcome, "redirect-refused", "a redirect was not refused");
assert.ok(
  !requestLines.some((line) => line.includes("SECOND-HOST")),
  "the second host saw a request",
);
assert.ok(
  !sentAuthorizationHeaders.slice(1).some((h) => h.includes(CREDENTIAL)),
  "the credential left the build after the first host",
);

// The credential is bound to its host: another host is refused before a byte.
const stranger = await client.fetchModelList({
  url: `http://127.0.0.1:${providerPort}/v1/models`,
  credentialReference: "env:HERMETIC_STUB_KEY",
  allowedHost: "other-host.invalid:1",
});
assert.equal(stranger.outcome, "host-not-allowed", "a foreign host was not refused");

// --- T028, hermetic: one GET of a gateway model list -----------------------
const list = await client.fetchModelList({
  url: `http://127.0.0.1:${gatewayPort}/v1/models`,
  credentialReference: null,
  allowedHost: `127.0.0.1:${gatewayPort}`,
});
assert.equal(list.outcome, "ok", "the gateway model list did not answer ok");
const models = modelsOfBody(
  JSON.stringify({
    data: [
      { id: "openai/gpt-stub" },
      { id: "anthropic/claude-stub" },
      { id: "google/gemini-stub" },
    ],
  }),
);
const providers = new Set(models.map((m) => m.split("/")[0]));
assert.ok(providers.size >= 3, "the gateway list did not keep models of more than one provider");
assert.deepEqual(
  [...providers].sort(),
  ["anthropic", "google", "openai"],
  "the providers of the gateway list were not read",
);

provider.close();
redirector.close();
secondHost.close();
gateway.close();

process.stdout.write(
  JSON.stringify(
    {
      date: new Date().toISOString().slice(0, 10),
      platform: process.platform,
      t027: {
        request: requestLines[0],
        credentialHeader: "authorization: Bearer <redacted — value never printed>",
        credentialValuePrinted: false,
        redactorRegistered: registeredWithRedactor,
        outcome: ok.outcome,
        models: [...ok.models],
        windowTokens: ok.windowTokens,
        redirectRefused: redirected.outcome,
        secondHostSawRequest: false,
        foreignHostRefused: stranger.outcome,
        traceCarriesCredential: false,
      },
      t028: {
        request: "GET /v1/models",
        outcome: list.outcome,
        models: models,
        providers: [...providers].sort(),
        crossProviderVisible: true,
      },
    },
    null,
    2,
  ) + "\n",
);
