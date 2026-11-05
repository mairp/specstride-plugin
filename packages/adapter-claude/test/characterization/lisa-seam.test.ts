// CT-125-32 (F125-FR-041) — the four behaviours BROUGHT TO THE SEAM of Lisa's
// harness at `363e6a3`, now in `packages/adapter-claude/src/sdk/harness.ts`:
//   1. the permission mode is accept-edits (F125-FR-012); Lisa's
//      `bypassPermissions` default is NOT kept;
//   2. the request carries the session directive of F125-FR-013, where Lisa's
//      request had no session field; an empty session id is refused;
//   3. the pass never ends because the adapter polls for an evidence file: it
//      ends by the terminal message of the SDK or by the stop of the port
//      (Lisa's evidence-poll gate is removed);
//   4. the harness adapter never retries a call by itself.
// And the TWO KEPT OPTIONS:
//   - the implicit idle cutoff (`API_FORCE_IDLE_TIMEOUT`) is off unless the
//     consumer sets it;
//   - the consumer's `harnesses.claude.disableSubagents` adds the sub-agent
//     tool to the tools that are refused.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ClaudeAgentSdkHarness,
  claudeAgentDisallowedTools,
  claudeAgentEnvironment,
  type HarnessEvent,
} from "../../src/sdk/harness.ts";

const FRESH = { mode: "fresh" as const, sessionId: "minted-125-32" };

async function collect(iter: AsyncIterable<HarnessEvent>): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

const terminal = (events: readonly HarnessEvent[]): Extract<HarnessEvent, { kind: "result" }> =>
  events.filter((e): e is Extract<HarnessEvent, { kind: "result" }> => e.kind === "result").at(-1)!;

describe("CT-125-32 seam behaviour 1: the permission mode is accept-edits", () => {
  it("the default option is acceptEdits, never bypassPermissions", async () => {
    const seen: { options?: Record<string, unknown> } = {};
    const harness = new ClaudeAgentSdkHarness({
      queryImpl: async function* (args) {
        seen.options = args.options;
        yield { type: "result", subtype: "success", session_id: "s", num_turns: 1 };
      },
    });
    await collect(harness.runPass({ prompt: "p", workdir: "/tmp", session: FRESH }));
    assert.equal(seen.options?.["permissionMode"], "acceptEdits");
  });

  it("no default of this adapter is bypassPermissions; only an explicit consumer override passes one", async () => {
    const seen: { options?: Record<string, unknown> } = {};
    const harness = new ClaudeAgentSdkHarness({
      sdkOptions: { permissionMode: "bypassPermissions" },
      queryImpl: async function* (args) {
        seen.options = args.options;
        yield { type: "result", subtype: "success", session_id: "s", num_turns: 1 };
      },
    });
    await collect(harness.runPass({ prompt: "p", workdir: "/tmp", session: FRESH }));
    assert.equal(seen.options?.["permissionMode"], "bypassPermissions"); // consumer's own choice
  });
});

describe("CT-125-32 seam behaviour 2: the session directive", () => {
  it("a fresh pass sets no resume option and carries the minted id on the request", async () => {
    const seen: { options?: Record<string, unknown>; prompt?: string } = {};
    const harness = new ClaudeAgentSdkHarness({
      queryImpl: async function* (args) {
        seen.options = args.options;
        seen.prompt = args.prompt;
        yield { type: "result", subtype: "success", session_id: "s", num_turns: 1 };
      },
    });
    await collect(harness.runPass({ prompt: "p", workdir: "/tmp", session: FRESH }));
    assert.equal("resume" in (seen.options ?? {}), false);
    assert.equal(seen.prompt, "p");
  });

  it("a continue pass resumes by the existing id", async () => {
    const seen: { options?: Record<string, unknown> } = {};
    const harness = new ClaudeAgentSdkHarness({
      queryImpl: async function* (args) {
        seen.options = args.options;
        yield { type: "result", subtype: "success", session_id: "sess-125-32", num_turns: 1 };
      },
    });
    await collect(
      harness.runPass({
        prompt: "p",
        workdir: "/tmp",
        session: { mode: "continue", sessionId: "sess-125-32" },
      }),
    );
    assert.equal(seen.options?.["resume"], "sess-125-32");
  });

  it("an empty session id is refused before any model work", async () => {
    const harness = new ClaudeAgentSdkHarness({
      queryImpl: async function* () {
        yield await Promise.reject(new Error("the model must never be reached"));
      },
    });
    await assert.rejects(
      () =>
        collect(
          harness.runPass({
            prompt: "p",
            workdir: "/tmp",
            session: { mode: "fresh", sessionId: "" },
          }),
        ),
      /empty session id/,
    );
  });
});

describe("CT-125-32 seam behaviour 3: no evidence polling", () => {
  it("the request carries no evidence path at all", async () => {
    const seen: { request?: unknown } = {};
    const harness = new ClaudeAgentSdkHarness({
      queryImpl: async function* () {
        yield { type: "result", subtype: "success", session_id: "s", num_turns: 1 };
      },
    });
    const req = { prompt: "p", workdir: "/tmp", session: FRESH };
    seen.request = req;
    const events = await collect(harness.runPass(req));
    assert.equal("evidencePath" in (seen.request as Record<string, unknown>), false);
    assert.equal(terminal(events).subtype, "success");
  });

  it("a pass runs to its terminal message even where an evidence file exists", async () => {
    // Lisa's gate would have aborted the session the instant the file appeared;
    // the seam does not watch the filesystem, so the whole stream is delivered.
    const dir = mkdtempSync(join(tmpdir(), "ct-125-32-"));
    const evidence = join(dir, "GATE1-EVIDENCE.md");
    writeFileSync(evidence, "already there");
    const yielded: string[] = [];
    const harness = new ClaudeAgentSdkHarness({
      queryImpl: async function* () {
        yield { type: "system", subtype: "init", model: "m", session_id: "s", tools: [] };
        yielded.push("init");
        yield {
          type: "assistant",
          message: { content: [{ type: "text", text: "writing the evidence" }] },
        };
        yielded.push("text");
        yield { type: "result", subtype: "success", session_id: "s", num_turns: 2 };
        yielded.push("result");
      },
    });
    const events = await collect(harness.runPass({ prompt: "p", workdir: dir, session: FRESH }));
    assert.deepEqual(yielded, ["init", "text", "result"]);
    assert.equal(events.filter((e) => e.kind === "init").length, 1);
    assert.equal(events.filter((e) => e.kind === "text").length, 1);
    assert.equal(terminal(events).subtype, "success");
  });
});

describe("CT-125-32 seam behaviour 4: no retry of its own", () => {
  it("a failing pass calls the SDK exactly once and reports the failure", async () => {
    let calls = 0;
    const harness = new ClaudeAgentSdkHarness({
      queryImpl: async function* () {
        calls++;
        yield await Promise.reject(new Error("connection reset by peer"));
      },
    });
    const result = terminal(
      await collect(harness.runPass({ prompt: "p", workdir: "/tmp", session: FRESH })),
    );
    assert.equal(result.isError, true);
    assert.equal(result.failureKind, "transport_failed");
    assert.equal(calls, 1);
  });

  it("a stream that closes with no terminal message synthesizes ONE result, once", async () => {
    let calls = 0;
    const harness = new ClaudeAgentSdkHarness({
      queryImpl: async function* () {
        calls++;
        yield { type: "system", subtype: "init", model: "m", session_id: "s", tools: [] };
        // the generator just ends here
      },
    });
    const events = await collect(harness.runPass({ prompt: "p", workdir: "/tmp", session: FRESH }));
    assert.equal(calls, 1);
    assert.equal(events.filter((e) => e.kind === "result").length, 1);
    assert.equal(terminal(events).failureKind, "transport_failed");
  });
});

describe("CT-125-32 kept option: the implicit idle cutoff is off unless set", () => {
  it("the pass environment sets API_FORCE_IDLE_TIMEOUT=0 when the consumer set nothing", async () => {
    const seen: { options?: Record<string, unknown> } = {};
    const harness = new ClaudeAgentSdkHarness({
      queryImpl: async function* (args) {
        seen.options = args.options;
        yield { type: "result", subtype: "success", session_id: "s", num_turns: 1 };
      },
    });
    await collect(harness.runPass({ prompt: "p", workdir: "/tmp", session: FRESH }));
    const env = seen.options?.["env"] as Record<string, string | undefined>;
    assert.equal(env["API_FORCE_IDLE_TIMEOUT"], "0");
  });

  it("the consumer's own cutoff value survives into the pass environment", () => {
    const env = claudeAgentEnvironment({ API_FORCE_IDLE_TIMEOUT: "90" }, {});
    assert.equal(env["API_FORCE_IDLE_TIMEOUT"], "90");
  });
});

describe("CT-125-32 kept option: the sub-agent tool refused on request", () => {
  it("the consumer's disableSubagents switch adds Agent to the refused tools", () => {
    const tools = claudeAgentDisallowedTools(["Write"], "1");
    assert.deepEqual(tools, ["Write", "Agent"]);
  });

  it("truthy spellings disable; anything else does not", () => {
    assert.deepEqual(claudeAgentDisallowedTools(undefined, "true"), ["Agent"]);
    assert.deepEqual(claudeAgentDisallowedTools(undefined, "yes"), ["Agent"]);
    assert.deepEqual(claudeAgentDisallowedTools(undefined, "on"), ["Agent"]);
    assert.equal(claudeAgentDisallowedTools(undefined, "0"), undefined);
    assert.equal(claudeAgentDisallowedTools(undefined, undefined), undefined);
  });

  it("an already-listed Agent is not duplicated", () => {
    assert.deepEqual(claudeAgentDisallowedTools(["Agent"], "1"), ["Agent"]);
  });

  it("the switch reaches the pass options through the environment of the adapter", async () => {
    const previous = process.env["LISA_CLAUDE_DISABLE_SUBAGENTS"];
    process.env["LISA_CLAUDE_DISABLE_SUBAGENTS"] = "1";
    try {
      const seen: { options?: Record<string, unknown> } = {};
      const harness = new ClaudeAgentSdkHarness({
        sdkOptions: { disallowedTools: ["Write"] },
        queryImpl: async function* (args) {
          seen.options = args.options;
          yield { type: "result", subtype: "success", session_id: "s", num_turns: 1 };
        },
      });
      await collect(harness.runPass({ prompt: "p", workdir: "/tmp", session: FRESH }));
      assert.deepEqual(seen.options?.["disallowedTools"], ["Write", "Agent"]);
    } finally {
      if (previous === undefined) delete process.env["LISA_CLAUDE_DISABLE_SUBAGENTS"];
      else process.env["LISA_CLAUDE_DISABLE_SUBAGENTS"] = previous;
    }
  });
});
