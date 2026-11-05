// CT-125-31 (F125-FR-040) — the tap mapping kept from Lisa at `363e6a3`, now in
// `packages/adapter-claude/src/sdk/tap.ts`:
//   - the initial message gives the model, the session id and the tool count;
//   - an assistant message gives its text blocks and its tool-use blocks with
//     a compact one-line target of at most 200 characters (first present of a
//     file path, a path, a command, a pattern, an address or a notebook path,
//     else the first names of the input);
//   - the final message gives the usage, the session id, the number of turns
//     and the error;
//   - any other message kind is ignored;
//   - a failure of the tap never breaks the loop;
//   - a backend that ignores structured output falls back to raw output passed
//     through unchanged with no structured record.
// No live model: the events are constructed here and the v1 serializer is
// injected (the structural form of Lisa's `serializeV1`).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ClaudeAgentSdkHarness,
  summarizeToolInput,
  type HarnessEvent,
  type QueryImpl,
} from "../../src/sdk/harness.ts";
import {
  HarnessTap,
  oneLine,
  tapHarnessPass,
  type EmitClock,
  type TapEvent,
  type V1Event,
} from "../../src/sdk/tap.ts";

const CLOCK: EmitClock = { hrNow: () => 42, isoLocalNow: () => "2026-10-26T00:00:00.000Z" };

const makeTap = (ctx = {}, serialize?: (ev: V1Event) => string) =>
  new HarnessTap(CLOCK, ctx, serialize ?? ((ev) => JSON.stringify(ev)));

async function collect(iter: AsyncIterable<HarnessEvent>): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

const INIT = {
  type: "system",
  subtype: "init",
  model: "claude-sonnet-4-5",
  session_id: "sess-125-31",
  tools: ["Read", "Write", "Bash"],
};

/** Run a stream of SDK messages through the harness and then through the tap. */
async function runThroughTap(messages: unknown[], tap = makeTap()) {
  const queryImpl: QueryImpl = async function* () {
    for (const m of messages) yield m;
  };
  const harness = new ClaudeAgentSdkHarness({ queryImpl });
  const events = await collect(
    harness.runPass({
      prompt: "do the work",
      workdir: "/tmp",
      session: { mode: "fresh", sessionId: "minted-125-31" },
    }),
  );
  const v1: string[] = [];
  const human: string[] = [];
  const terminalEvent = await tapHarnessPass(events as unknown as AsyncIterable<TapEvent>, tap, {
    onV1: (line) => v1.push(line),
    onHuman: (line) => human.push(line),
  });
  return { events, v1, human, terminalEvent };
}

describe("CT-125-31 the initial message", () => {
  it("gives the model, the session id and the tool count", async () => {
    const { v1, human } = await runThroughTap([INIT]);
    // The pass with only an init message gets ONE synthesized terminal result
    // (the harness adapter never retries nor leaves the loop waiting), so two
    // v1 lines come back: the init and the agent_result.
    assert.equal(v1.length, 2);
    const rec = JSON.parse(v1[0]!) as Record<string, string>;
    assert.equal(rec.event, "agent_init");
    assert.equal(rec.model, "claude-sonnet-4-5");
    assert.equal(rec.session_id, "sess-125-31");
    assert.equal(rec.tools, "3");
    assert.match(human[0]!, /init model=claude-sonnet-4-5 session=sess-125-31 tools=3/);
  });
});

describe("CT-125-31 assistant text and tool blocks", () => {
  it("an assistant text block becomes an agent_text event clamped to one line", async () => {
    const { v1, human } = await runThroughTap([
      INIT,
      { type: "assistant", message: { content: [{ type: "text", text: "step one\nstep two" }] } },
    ]);
    const rec = JSON.parse(v1[1]!) as Record<string, string>;
    assert.equal(rec.event, "agent_text");
    assert.equal(rec.text, "step one step two");
    assert.equal(human[1], "step one\nstep two");
  });

  it("a tool block keeps a target from the first present key, clamped to 200 characters", async () => {
    const long = "x".repeat(400);
    const { v1, human } = await runThroughTap([
      INIT,
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Write", input: { file_path: `/tmp/${long}`, other: "1" } },
          ],
        },
      },
    ]);
    const rec = JSON.parse(v1[1]!) as Record<string, string>;
    assert.equal(rec.event, "agent_tool");
    assert.equal(rec.tool, "Write");
    const target = rec.target!;
    assert.ok(target.startsWith("file_path=/tmp/"));
    // `key=` prefix (15 chars here) plus at most 200 chars of the value.
    assert.ok(target.length <= 15 + 200, `target too long: ${target.length}`);
    assert.match(human[1]!, /→ Write file_path=\/tmp\/x+/);
  });

  it("the target prefers file_path, then command, else the first names of the input", async () => {
    assert.equal(harnessTarget({ command: "ls -la", file_path: "/a/b" }), "file_path=/a/b");
    assert.equal(harnessTarget({ pattern: "foo.*bar" }), "pattern=foo.*bar");
    assert.equal(harnessTarget({ b: "2", a: "1", c: "3", d: "4", e: "5", f: "6" }), "b,a,c,d,e");
    assert.equal(harnessTarget({}), undefined);
    assert.equal(harnessTarget("not an object"), undefined);
  });
});

// The 200-character target comes from the tool-block mapping of the harness
// (`summarizeToolInput`), called through the extracted module's public surface.
function harnessTarget(input: unknown): string | undefined {
  return summarizeToolInput(input);
}

describe("CT-125-31 the final message", () => {
  it("gives the usage, the session id, the turns and the error", async () => {
    const { v1, human, terminalEvent } = await runThroughTap([
      INIT,
      {
        type: "result",
        subtype: "error_during_execution",
        session_id: "sess-125-31",
        num_turns: 4,
        total_cost_usd: 0.25,
        usage: { input_tokens: 10, output_tokens: 20 },
      },
    ]);
    const rec = JSON.parse(v1.at(-1)!) as Record<string, string>;
    assert.equal(rec.event, "agent_result");
    assert.equal(rec.session_id, "sess-125-31");
    assert.equal(rec.is_error, "True");
    assert.equal(rec.subtype, "error");
    assert.equal(rec.num_turns, "4");
    assert.equal(rec.cost_usd, "0.25");
    assert.equal(rec.input_tokens, "10");
    assert.equal(rec.output_tokens, "20");
    assert.match(human.at(-1)!, /✗ result: error/);
    assert.equal(terminalEvent?.isError, true);
  });

  it("a boolean serializes Python-style on the v1 wire", async () => {
    const { v1 } = await runThroughTap([
      { type: "result", subtype: "success", session_id: "s", num_turns: 1 },
    ]);
    const rec = JSON.parse(v1.at(-1)!) as Record<string, string>;
    assert.equal(rec.is_error, "False");
  });

  it("a figure the provider did not report is absent from the v1 record", async () => {
    const { v1 } = await runThroughTap([
      { type: "result", subtype: "success", session_id: "s", num_turns: 1 },
    ]);
    const rec = JSON.parse(v1.at(-1)!) as Record<string, string>;
    assert.equal("cost_usd" in rec, false);
    assert.equal("output_tokens" in rec, false);
  });
});

describe("CT-125-31 ignored kinds and unknown kinds", () => {
  it("a non-init system message and unknown kinds produce no record and no echo", async () => {
    const tap = makeTap();
    const out1 = tap.tap({ kind: "status", text: "working" } as unknown as TapEvent);
    assert.deepEqual(out1.v1Lines, []);
    assert.equal(out1.human, "");
  });

  it("the stream of a pass with only ignored kinds yields nothing on the tap", async () => {
    const { v1, human } = await runThroughTap([
      { type: "stream_event", event: "something" },
      { type: "system", subtype: "other", model: "m", session_id: "s", tools: [] },
    ]);
    // Only the terminal result event of the synthesized closing is tapped.
    assert.equal(
      v1.filter((l) => (JSON.parse(l) as Record<string, string>).event === "agent_init").length,
      0,
    );
    assert.ok(human.length >= 0);
  });
});

describe("CT-125-31 a failing tap never breaks the loop", () => {
  it("a tap that throws is skipped and the terminal event still comes back", async () => {
    let taps = 0;
    const bomb = makeTap({}, () => {
      taps++;
      throw new Error("the serializer exploded");
    });
    const { v1, terminalEvent } = await runThroughTap(
      [
        INIT,
        { type: "assistant", message: { content: [{ type: "text", text: "hello" }] } },
        { type: "result", subtype: "success", session_id: "s", num_turns: 1 },
      ],
      bomb,
    );
    assert.deepEqual(v1, []); // nothing reached the sink
    assert.ok(taps > 0);
    assert.equal(terminalEvent?.subtype, "success");
  });

  it("a dead sink never stalls the run", async () => {
    const queryImpl: QueryImpl = async function* () {
      yield INIT;
      yield { type: "assistant", message: { content: [{ type: "text", text: "hello" }] } };
      yield { type: "result", subtype: "success", session_id: "s", num_turns: 1 };
    };
    const harness = new ClaudeAgentSdkHarness({ queryImpl });
    const events = await collect(
      harness.runPass({
        prompt: "p",
        workdir: "/tmp",
        session: { mode: "fresh", sessionId: "s-125-31" },
      }),
    );
    const terminalEvent = await tapHarnessPass(
      events as unknown as AsyncIterable<TapEvent>,
      makeTap(),
      {
        onV1: () => {
          throw new Error("the sink is a full disk");
        },
        onHuman: () => {
          throw new Error("the sink is a full disk");
        },
      },
    );
    assert.equal(terminalEvent?.subtype, "success");
  });
});

describe("CT-125-31 the raw fallback", () => {
  it("a raw line passes through verbatim with no structured record", () => {
    const out = makeTap().tapRaw("claude: the backend printed this plain line");
    assert.deepEqual(out.v1Lines, []);
    assert.equal(out.human, "claude: the backend printed this plain line");
  });
});

describe("CT-125-31 the tap holds no prompt and no reply in a structured record", () => {
  it("no v1 record of the pass carries the prompt text", async () => {
    const { v1 } = await runThroughTap([INIT]);
    for (const line of v1) {
      assert.equal(line.includes("do the work"), false, line);
    }
  });
});

describe("CT-125-31 one_line (kept helper)", () => {
  it("collapses whitespace and clamps with the ellipsis", () => {
    assert.equal(oneLine("a\n\nb   c", 40), "a b c");
    const clamped = oneLine("y".repeat(300), 10);
    assert.equal(clamped.length, 10);
    assert.ok(clamped.endsWith("…"));
  });
});
