// CT-125-30 (F125-FR-039) — the kept usage accounting and the failure kinds of
// Lisa's harness at `363e6a3`, as brought to the seam of F125-FR-041 in
// `packages/adapter-claude/src/sdk/harness.ts`:
//   - usage comes from the provider's own accounting, never from the text of
//     the stream;
//   - a figure the provider did not report is `null` (Lisa returned zero);
//   - failure kinds come from structured codes FIRST and from text SECOND;
//   - prose that only mentions such a phrase stays a success;
//   - a stop the caller requested and a time limit of the caller are not
//     failures of the harness adapter.
// No live model: the `query` implementation is injected (Lisa's `queryImpl`).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ClaudeAgentSdkHarness,
  claudeAgentEnvironment,
  classifyHarnessFailureText,
  usageFromSdkResult,
  type HarnessEvent,
  type QueryImpl,
} from "../../src/sdk/harness.ts";

const SESSION = { mode: "fresh" as const, sessionId: "s-125-30" };

/** A fake queryImpl yielding the given messages (Lisa's `queryImpl` seam). */
function fakeQuery(
  messages: unknown[],
  seen: { options?: Record<string, unknown> } = {},
): QueryImpl {
  return async function* (args) {
    seen.options = args.options;
    for (const m of messages) yield m;
  };
}

/** A fake queryImpl that throws once the caller's signal fires. */
function abortableQuery(signal: AbortSignal): QueryImpl {
  return async function* () {
    yield { type: "system", subtype: "init", model: "claude-x", session_id: "s", tools: [] };
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, 5_000);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(new Error("This operation was aborted"));
        },
        { once: true },
      );
    });
  };
}

async function collect(iter: AsyncIterable<HarnessEvent>): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

const terminal = (events: readonly HarnessEvent[]): Extract<HarnessEvent, { kind: "result" }> =>
  events.filter((e): e is Extract<HarnessEvent, { kind: "result" }> => e.kind === "result").at(-1)!;

describe("CT-125-30 usage accounting (kept of Lisa, F125-FR-039)", () => {
  it("takes the figures from the provider's own usage object, never from text", () => {
    const u = usageFromSdkResult({
      total_cost_usd: 0.0123,
      usage: {
        input_tokens: 11,
        output_tokens: 22,
        cache_read_input_tokens: 33,
        cache_creation_input_tokens: 44,
      },
    });
    assert.deepEqual(u, {
      inputTokens: 11,
      outputTokens: 22,
      cacheReadTokens: 33,
      cacheCreationTokens: 44,
      costUsd: 0.0123,
    });
  });

  it("a figure the provider did not report is null, never zero (the seam change)", () => {
    assert.deepEqual(usageFromSdkResult({}), {
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      costUsd: null,
    });
    assert.equal(usageFromSdkResult({ usage: { input_tokens: 5 } }).outputTokens, null);
    assert.equal(usageFromSdkResult({ usage: { output_tokens: 5 } }).costUsd, null);
  });

  it("the terminal result carries the provider's own figures untouched", async () => {
    const harness = new ClaudeAgentSdkHarness({
      queryImpl: fakeQuery([
        {
          type: "result",
          subtype: "success",
          session_id: "s-125-30",
          num_turns: 3,
          total_cost_usd: 0.5,
          usage: { input_tokens: 7, output_tokens: 9 },
        },
      ]),
    });
    const events = await collect(
      harness.runPass({
        prompt: "p",
        workdir: "/tmp",
        session: SESSION,
      }),
    );
    const result = terminal(events);
    assert.equal(result.usage.costUsd, 0.5);
    assert.equal(result.usage.inputTokens, 7);
    assert.equal(result.usage.outputTokens, 9);
    assert.equal(result.usage.cacheReadTokens, null);
    assert.equal(result.sessionId, "s-125-30");
    assert.equal(result.numTurns, 3);
  });
});

describe("CT-125-30 failure kinds: structured codes first, text second", () => {
  it("a structured code wins over the surrounding text", async () => {
    const harness = new ClaudeAgentSdkHarness({
      queryImpl: fakeQuery([
        {
          type: "result",
          subtype: "error_max_turns",
          error_code: "rate_limit_error",
          session_id: "s",
          num_turns: 1,
        },
      ]),
    });
    const result = terminal(
      await collect(harness.runPass({ prompt: "p", workdir: "/tmp", session: SESSION })),
    );
    assert.equal(result.isError, true);
    assert.equal(result.failureKind, "rate_limited");
  });

  it("a structured code that disagrees with the text still wins", async () => {
    const harness = new ClaudeAgentSdkHarness({
      queryImpl: fakeQuery([
        {
          type: "result",
          subtype: "error_during_execution",
          code: "authentication_error",
          result: "Error: connection reset by peer",
          session_id: "s",
          num_turns: 1,
        },
      ]),
    });
    const result = terminal(
      await collect(harness.runPass({ prompt: "p", workdir: "/tmp", session: SESSION })),
    );
    assert.equal(result.failureKind, "authentication_failed");
  });

  it("with no structured code, the result text maps the phrase", async () => {
    const harness = new ClaudeAgentSdkHarness({
      queryImpl: fakeQuery([
        {
          type: "result",
          subtype: "error_during_execution",
          result: "API Error: prompt is too long: 250000 tokens > 200000 maximum",
          session_id: "s",
          num_turns: 1,
        },
      ]),
    });
    const result = terminal(
      await collect(harness.runPass({ prompt: "p", workdir: "/tmp", session: SESSION })),
    );
    assert.equal(result.failureKind, "context_window_exceeded");
  });

  it("with no structured code, the last assistant text maps the phrase", async () => {
    const harness = new ClaudeAgentSdkHarness({
      queryImpl: fakeQuery([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "Error: invalid api key provided" }] },
        },
        { type: "result", subtype: "error_during_execution", session_id: "s", num_turns: 1 },
      ]),
    });
    const result = terminal(
      await collect(harness.runPass({ prompt: "p", workdir: "/tmp", session: SESSION })),
    );
    assert.equal(result.failureKind, "authentication_failed");
  });

  it("a tool failure maps to agent_failure", () => {
    assert.equal(
      classifyHarnessFailureText("tool_use_error: Bash failed with exit 1"),
      "agent_failure",
    );
  });

  it("a transport phrase maps to transport_failed", () => {
    assert.equal(classifyHarnessFailureText("fetch failed: ECONNRESET"), "transport_failed");
  });

  it("a caller time limit and a caller stop are NOT failures of the harness adapter", () => {
    assert.equal(classifyHarnessFailureText("request timed out after 60000ms"), undefined);
    assert.equal(classifyHarnessFailureText("deadline exceeded"), undefined);
    assert.equal(classifyHarnessFailureText("the pass was aborted by the caller"), undefined);
    assert.equal(classifyHarnessFailureText("operation cancelled"), undefined);
  });

  it("a pass ended by the caller's signal carries no failureKind", async () => {
    const controller = new AbortController();
    const harness = new ClaudeAgentSdkHarness({ queryImpl: abortableQuery(controller.signal) });
    const run = collect(
      harness.runPass({
        prompt: "p",
        workdir: "/tmp",
        timeoutSec: 0,
        signal: controller.signal,
        session: SESSION,
      }),
    );
    setTimeout(() => controller.abort(), 20);
    const events = await run;
    const result = terminal(events);
    assert.equal(result.isError, true);
    assert.equal(result.failureKind, undefined);
  });

  it("the harness adapter never retries a call by itself", async () => {
    let calls = 0;
    const harness = new ClaudeAgentSdkHarness({
      queryImpl: async function* () {
        calls++;
        yield {
          type: "result",
          subtype: "error_during_execution",
          error_code: "overloaded_error",
          session_id: "s",
          num_turns: 0,
        };
      },
    });
    const result = terminal(
      await collect(harness.runPass({ prompt: "p", workdir: "/tmp", session: SESSION })),
    );
    assert.equal(result.isError, true);
    assert.equal(calls, 1);
  });
});

describe("CT-125-30 prose stays a success", () => {
  it("an assistant mention of a rate limit does not fail the pass", async () => {
    const harness = new ClaudeAgentSdkHarness({
      queryImpl: fakeQuery([
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "I will be careful of the rate limit while editing." }],
          },
        },
        {
          type: "result",
          subtype: "success",
          session_id: "s-125-30",
          num_turns: 2,
          total_cost_usd: 0.01,
          usage: { input_tokens: 3, output_tokens: 4 },
        },
      ]),
    });
    const result = terminal(
      await collect(harness.runPass({ prompt: "p", workdir: "/tmp", session: SESSION })),
    );
    assert.equal(result.isError, false);
    assert.equal(result.subtype, "success");
    assert.equal(result.failureKind, undefined);
  });

  it("a result whose prose merely mentions an authentication phrase stays a success", async () => {
    const harness = new ClaudeAgentSdkHarness({
      queryImpl: fakeQuery([
        {
          type: "result",
          subtype: "success",
          result: "documented the authentication flow of the product",
          session_id: "s",
          num_turns: 1,
        },
      ]),
    });
    const result = terminal(
      await collect(harness.runPass({ prompt: "p", workdir: "/tmp", session: SESSION })),
    );
    assert.equal(result.isError, false);
    assert.equal(result.failureKind, undefined);
  });
});

describe("CT-125-30 kept option: the implicit idle cutoff", () => {
  it("is off unless the consumer sets it", () => {
    const env = claudeAgentEnvironment(undefined, {});
    assert.equal(env["API_FORCE_IDLE_TIMEOUT"], "0");
  });
  it("the consumer's own value is preserved", () => {
    const env = claudeAgentEnvironment({ API_FORCE_IDLE_TIMEOUT: "45" }, {});
    assert.equal(env["API_FORCE_IDLE_TIMEOUT"], "45");
  });
});
