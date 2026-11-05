/**
 * T069 — every line of `launch` and of the `state` commands is under the
 * 200-byte budget of the line grammar (F100 line budget; EP-14's cap).
 *
 * The lines are built with the same `printLine` calls the command modules
 * make, over every label and key set the two modules emit, with the longest
 * values the product can put in them (F122-FR-006, F122-FR-036). The test
 * MEASURES `Buffer.byteLength` — the budget is bytes, not characters.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { printLine } from "@specstride/contracts/grammar/line-keys";
import {
  ACTION,
  LAUNCH_LABEL,
  REFUSE_LABEL,
  PROFILE_THAT_PRINTS_NO_LINE,
  runLaunchHandshake,
} from "../../../cli/src/commands/launch-handshake.ts";
import {
  REFUSAL_ACTION_OF,
  REFUSE_LABEL as STATE_REFUSE_LABEL,
  STATE_LABEL,
} from "../../../cli/src/commands/state.ts";

/** The budget of one printed line of the product. */
const CAP_BYTES = 200;

/** The longest refusal reason the launch can name. */
const A_LONG_REFUSAL = "control-root-not-writable";

test("T069: every launch and state line is under 200 bytes", () => {
  // The launch line, for `started` and for `attached`.
  const started = printLine(LAUNCH_LABEL, { run: "run-t069", state: "running" });
  const attached = printLine(LAUNCH_LABEL, {
    run: "a-run-id-that-the-lease-names-0123456789abcdef0123456789abcdef",
    state: "running",
  });
  // The refusal line of the launch, with the longest reason and next.
  const refused = printLine(REFUSE_LABEL, {
    action: ACTION,
    reason: A_LONG_REFUSAL,
    next: "reclaim the lock of the run, or start the run again",
  });
  // The state line and the refusal line of the three `state` subcommands.
  // The keys of `[SPECSTRIDE-STATE]` are action, feature, approvals, out and
  // from: `out` for `export`, `from` for `import` and `adopt`.
  const stateLines = [
    printLine(STATE_LABEL, {
      action: "export",
      feature: "a-feature-slug-0123456789abcdef0123456789abcdef",
      approvals: 12,
      out: "/tmp/a-very-long-location-directory-name/t069-export.json",
    }),
    printLine(STATE_LABEL, {
      action: "import",
      feature: "a-feature-slug-0123456789abcdef0123456789abcdef",
      approvals: 12,
      from: "/tmp/a-very-long-location-directory-name/t069-import.json",
    }),
    printLine(STATE_LABEL, {
      action: "adopt",
      feature: "a-feature-slug-0123456789abcdef0123456789abcdef",
      approvals: 12,
      from: "/tmp/a-very-long-location-directory-name/t069-adopt.json",
    }),
  ];
  const stateRefusals = (["export", "import", "adopt"] as const).map((sub) =>
    printLine(STATE_REFUSE_LABEL, {
      action: REFUSAL_ACTION_OF[sub],
      reason: "usage",
      next: "read `specstride state --help` and give the flag again",
    }),
  );

  const every = [started, attached, refused, ...stateLines, ...stateRefusals];
  for (const line of every) {
    const bytes = Buffer.byteLength(line, "utf8");
    assert.ok(
      bytes < CAP_BYTES,
      `the line is ${bytes} bytes, over the ${CAP_BYTES}-byte budget: ${line}`,
    );
  }
  // The longest line, measured, for the verification record.
  const longest = Math.max(...every.map((line) => Buffer.byteLength(line, "utf8")));
  assert.ok(longest > 0);
});

test("T069: the lines the handshake itself prints are under 200 bytes", async () => {
  const printed: string[] = [];
  // A refusal path through the real step 4: an unknown request kind refuses
  // before step 1, and prints its one line.
  const outcome = await runLaunchHandshake({
    place: { controlRoot: "/tmp/t069-none", workspaceRealPath: "/tmp/t069-none" },
    slug: "t069",
    launchId: "launch-t069",
    runId: "run-t069",
    workspaceId: "ws-t069",
    requestKind: "a-kind-no-table-names" as never,
    request: { pipelineId: "p", bundleHash: "sha256:x" },
    engineExecutable: { path: process.execPath, hash: "sha256:e" },
    strategy: {
      available: () => ({ available: true, reason: "ok" }),
      async start() {
        throw new Error("the strategy is never called for an unknown request kind");
      },
      describe: () => ({
        id: "spawn-detached",
        survives: { parentEnd: true, sessionEnd: true, reboot: false },
      }),
    } as never,
    runtimeEntry: [process.execPath],
    environmentAllowList: ["PATH"],
    runtimeLogLogicalName: "launch:l:runtime-log",
    launchNonce: "nonce-t069",
    handshakeLimitSeconds: 5,
    print: (line: string): void => void printed.push(line),
  });
  assert.equal(outcome.outcome, "refused");
  assert.equal(printed.length, 1, "one line for a refusal, and nothing else");
  for (const line of printed) {
    assert.ok(Buffer.byteLength(line, "utf8") < CAP_BYTES, `over the budget: ${line}`);
    // The parity profile prints nothing: the same run, quiet.
  }
  const quiet: string[] = [];
  await runLaunchHandshake({
    place: { controlRoot: "/tmp/t069-none", workspaceRealPath: "/tmp/t069-none" },
    slug: "t069",
    launchId: "launch-t069",
    runId: "run-t069",
    workspaceId: "ws-t069",
    requestKind: "a-kind-no-table-names" as never,
    request: { pipelineId: "p", bundleHash: "sha256:x" },
    engineExecutable: { path: process.execPath, hash: "sha256:e" },
    strategy: {
      available: () => ({ available: true, reason: "ok" }),
      async start() {
        throw new Error("never called");
      },
      describe: () => ({
        id: "spawn-detached",
        survives: { parentEnd: true, sessionEnd: true, reboot: false },
      }),
    } as never,
    runtimeEntry: [process.execPath],
    environmentAllowList: ["PATH"],
    runtimeLogLogicalName: "launch:l:runtime-log",
    launchNonce: "nonce-t069",
    handshakeLimitSeconds: 5,
    profile: PROFILE_THAT_PRINTS_NO_LINE,
    print: (line: string): void => void quiet.push(line),
  });
  assert.deepEqual(quiet, [], "the parity profile prints no line");
});
