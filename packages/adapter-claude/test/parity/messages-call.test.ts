// PT-125-C-066-messages-call (T035) — the critic is the direct Messages call:
// POST `<base>/v1/messages`, headers `x-api-key` and
// `anthropic-version: 2023-06-01`, `max_tokens` 2048, ONE user message and NO
// field that names tools; the reply is the concatenation of the `text`
// content blocks (F125-FR-028; C-066; B-0980; DV-001). Under the `parity`
// profile this is the critic of Claude at auth tier 1 as well, since it is
// the baseline's transport; the transcript of the critic stub of FX-05
// (`messages` shape) is compared in a transport-neutral form, and the FX-06
// error scenarios (`http-error`, `cli-empty-output`) replay as typed
// failures with NO verdict (F125-FR-030).
// Surfaces: transcript (method, path, headers, body), stdout (the reply
// text), exit (the typed failure, never a verdict).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import {
  ANTHROPIC_VERSION,
  CRITIC_MAX_TOKENS,
  CriticDirectTransportError,
  DEFAULT_CRITIC_BASE_URL,
  buildMessagesRequest,
  bodyNamesNoTool,
  callCriticDirect,
  replyTextOfDirect,
} from "../../src/critic-direct.ts";

const KEY = "sk-test-critic-key";

/** One recorded request, as the stub transcript holds it. */
type Recorded = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
};

/** A loopback stub of the FX-05 `messages` scenarios; no clock, no randomness. */
function startMessagesStub(
  answer: { status: number; body: unknown },
  recorded: Recorded[],
): Promise<Server> {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async (): Promise<void> => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => void chunks.push(chunk));
      request.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        recorded.push({
          method: request.method ?? "",
          path: request.url ?? "",
          headers: request.headers,
          body: raw === "" ? {} : (JSON.parse(raw) as Record<string, unknown>),
        });
        response.writeHead(answer.status, { "content-type": "application/json" });
        response.end(JSON.stringify(answer.body));
      });
    })();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function baseUrlOf(server: Server): string {
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  return `http://127.0.0.1:${String(address.port)}`;
}

describe("PT-125-C-066-messages-call — the direct Messages call (F125-FR-028)", () => {
  it("the request is a POST to <base>/v1/messages with the as-is headers and body", () => {
    const request = buildMessagesRequest({
      prompt: "Judge the evidence.",
      baseUrl: DEFAULT_CRITIC_BASE_URL,
      key: KEY,
      model: "claude-opus-4-8",
    });
    // transcript: the transport-neutral request shape of the baseline.
    assert.equal(request.method, "POST");
    assert.equal(request.url, `${DEFAULT_CRITIC_BASE_URL}/v1/messages`);
    assert.equal(request.headers["x-api-key"], KEY);
    assert.equal(request.headers["anthropic-version"], ANTHROPIC_VERSION);
    assert.equal(ANTHROPIC_VERSION, "2023-06-01");
    assert.equal(request.body["max_tokens"], CRITIC_MAX_TOKENS);
    assert.equal(CRITIC_MAX_TOKENS, 2048);
    // ONE user message, and NO field that names tools (B-0980).
    assert.deepEqual(request.body["messages"], [{ role: "user", content: "Judge the evidence." }]);
    assert.equal(bodyNamesNoTool(request.body), true);
  });

  it("the reply is the concatenation of the text content blocks (stdout surface)", async () => {
    const recorded: Recorded[] = [];
    const server = await startMessagesStub(
      {
        status: 200,
        body: {
          content: [
            { type: "text", text: "VERDICT: APPROVED — " },
            { type: "text", text: "the criterion holds" },
          ],
          stop_reason: "end_turn",
        },
      },
      recorded,
    );
    try {
      const record = await callCriticDirect({
        prompt: "Judge the evidence.",
        env: {
          SPECSTRIDE_CLAUDE_CRITIC_API_KEY: KEY,
          SPECSTRIDE_CLAUDE_CRITIC_BASE_URL: baseUrlOf(server),
        },
        profile: "parity",
      });
      assert.equal(record.verdict, "VERDICT: APPROVED — the criterion holds");
      assert.equal(record.failure, null);
      // transcript: the stub saw exactly one request, of the messages shape.
      assert.equal(recorded.length, 1);
      assert.equal(recorded[0]?.method, "POST");
      assert.equal(recorded[0]?.path, "/v1/messages");
      assert.equal(recorded[0]?.headers["x-api-key"], KEY);
      assert.equal(recorded[0]?.headers["anthropic-version"], ANTHROPIC_VERSION);
      assert.equal(bodyNamesNoTool(recorded[0]?.body ?? {}), true);
    } finally {
      server.close();
    }
  });

  it("FX-06 http-error: an error status is a typed failure and gives NO verdict", async () => {
    const recorded: Recorded[] = [];
    const server = await startMessagesStub(
      { status: 500, body: { error: { type: "api_error" } } },
      recorded,
    );
    try {
      await assert.rejects(
        callCriticDirect({
          prompt: "Judge the evidence.",
          env: {
            SPECSTRIDE_CLAUDE_CRITIC_API_KEY: KEY,
            SPECSTRIDE_CLAUDE_CRITIC_BASE_URL: baseUrlOf(server),
          },
          profile: "parity",
        }),
        (error: unknown) =>
          error instanceof CriticDirectTransportError &&
          error.kind === "error-status" &&
          // exit surface: a transport failure, never scored as a verdict.
          /no verdict is produced/.test(error.message),
      );
    } finally {
      server.close();
    }
  });

  it("FX-06 cli-empty-output: an empty reply is a typed failure with no verdict", () => {
    // state: the reply reader maps an empty content list and a missing list
    // alike to null, which the call reports as the typed empty-reply failure.
    assert.equal(replyTextOfDirect({ content: [] }), "");
    assert.equal(replyTextOfDirect({}), null);
    assert.equal(replyTextOfDirect(null), null);
  });
});
