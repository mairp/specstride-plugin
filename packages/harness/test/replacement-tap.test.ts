/**
 * CT-126-10 (T038) — the replacement tap (F126-FR-011, with F126-FR-030).
 *
 * The tap is started from the argument list, with no shell; the stream of
 * the pass is its only standard input, and its output and error are ignored.
 * It can never fail the pass: a spawn failure, a fault exit or a tap that
 * does not end gives only the parser exit code of the producer status. It
 * is a process of the pass, entered with class `owned` and gone when the
 * pass has ended with it.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  OWNED_PROCESS_CLASS,
  replacementTapArgv,
  runReplacementTap,
  type OwnedProcessRegistry,
  type SpawnFn,
} from "../src/stream/tap.ts";
import type { TapContext } from "../src/stream/tap.ts";
import { producerFieldsOfExit } from "../src/invocation/producer.ts";
import { writeProducerStatus } from "../src/invocation/writers.ts";
import { ensureInvocationDirectory, artifactPath } from "../src/invocation/layout.ts";
import { buildIdentity } from "../src/invocation/identity.ts";

function scratch(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

const STREAM_LINES = ['{"type":"system","subtype":"init"}', '{"type":"result","is_error":false}'];

/** Start the stub with the real `spawn`, exactly as the loop starts a tap. */
const realSpawn: SpawnFn = (argv, options) => {
  const child = spawn(argv[0] as string, argv.slice(1) as string[], {
    stdio: options.stdio as unknown as "pipe",
    shell: options.shell,
  });
  return {
    pid: child.pid,
    on: (event: string, cb: (value: unknown) => void) => {
      child.on(event, cb);
    },
    write: (chunk: string) => {
      child.stdin?.write(chunk);
    },
    end: () => {
      child.stdin?.end();
    },
    kill: () => {
      child.kill();
    },
  };
};

const CONTEXT: TapContext = {
  eventDestination: "",
  runId: "run-ct10",
  task: "demo",
  feature: "126-stream-seam-and-invocation",
  role: "proposer",
  harness: "prime",
  phase: 2,
  attempt: 1,
  iteration: 1,
  invocationId: "inv-000010-bb10ct10",
  expectedEvidencePath: null,
  providerFormat: "prime-v3",
  invocationModel: null,
  providerTerminalDestination: null,
};

function writeStub(dir: string, name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, body, "utf8");
  return path;
}

async function gone(pid: number): Promise<boolean> {
  for (let waited = 0; waited < 2000; waited += 50) {
    try {
      process.kill(pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 50));
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * the argument list, the shell and the standard input
 * ------------------------------------------------------------------ */

test("CT-126-10: the tap is started from the argument list, with no shell, and the stream is its only standard input", async () => {
  const argv = replacementTapArgv("/usr/local/bin/prime-tap", CONTEXT);
  assert.ok(Array.isArray(argv), "the arguments are a list, not a command line");
  assert.equal(argv[0], "/usr/local/bin/prime-tap");

  const received: string[] = [];
  let stdinClosed = false;
  const calls: { argv: readonly string[]; options: unknown }[] = [];
  const run = await runReplacementTap(argv, {
    input: STREAM_LINES,
    spawn: (list, options) => {
      calls.push({ argv: list, options });
      const handlers = new Map<string, (value: unknown) => void>();
      const child = {
        pid: 4242,
        on: (event: string, cb: (value: unknown) => void) => {
          handlers.set(event, cb);
        },
        write: (chunk: string) => received.push(chunk),
        end: () => {
          stdinClosed = true;
          // The stub ends with code 0 as soon as its standard input is closed.
          handlers.get("exit")?.(0);
        },
        kill: () => undefined,
      };
      return child;
    },
  });
  assert.equal(run.parserExitCode, 0);
  assert.equal(run.failed, false);
  const call = calls[0];
  assert.ok(call, "the child was spawned");
  const options = call.options as { stdio: string[]; shell?: boolean };
  assert.equal(options.shell, false, "no shell starts the tap");
  assert.deepEqual(options.stdio, ["pipe", "ignore", "ignore"]);
  assert.equal(
    received.join(""),
    STREAM_LINES.join("\n") + "\n",
    "the stream of the pass is the only standard input",
  );
  assert.equal(stdinClosed, true, "the standard input is closed after the stream");
});

/* ------------------------------------------------------------------ *
 * a tap that cannot start, that faults, or that never ends
 * ------------------------------------------------------------------ */

test("CT-126-10: a tap that cannot be started never fails the pass (parser exit 127)", async () => {
  const root = scratch("ct126-10a-");
  try {
    const dir = ensureInvocationDirectory(
      root,
      buildIdentity({
        runId: "run-ct10",
        feature: "126-stream-seam-and-invocation",
        role: "proposer",
        harness: "prime",
        phase: "2",
        attempt: 1,
        iteration: 1,
        invocationId: "inv-000010-bb10ct10",
      }),
    );
    const run = await runReplacementTap(["/nonexistent/definitely-not-a-tap"], {
      input: STREAM_LINES,
      spawn: realSpawn,
      timeoutMs: 5000,
    });
    assert.equal(run.parserExitCode, 127);
    assert.equal(run.failed, true, "the fault is recorded, but only there");
    const status = artifactPath(dir, "pass:producer-status");
    writeProducerStatus(status, producerFieldsOfExit(0, run.parserExitCode, 5));
    const recorded = JSON.parse(readFileSync(status, "utf8")) as Record<string, unknown>;
    assert.equal(recorded["parser_exit_code"], 127);
    assert.equal(recorded["producer_exit_code"], 0, "the producer itself did not fail");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CT-126-10: a tap that faults with exit 3 lands only in parser_exit_code", async () => {
  const dir = scratch("ct126-10b-");
  try {
    const stub = writeStub(dir, "exit3.mjs", "process.exit(3);\n");
    const run = await runReplacementTap([process.execPath, stub], {
      input: STREAM_LINES,
      spawn: realSpawn,
      timeoutMs: 5000,
    });
    assert.equal(run.parserExitCode, 3);
    assert.equal(run.failed, true);
    const status = join(dir, "producer-status.json");
    writeProducerStatus(status, producerFieldsOfExit(0, run.parserExitCode, 5));
    const recorded = JSON.parse(readFileSync(status, "utf8")) as Record<string, unknown>;
    assert.equal(recorded["parser_exit_code"], 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-126-10: a tap that never ends is ended by the timeout, and the pass carries on", async () => {
  const dir = scratch("ct126-10c-");
  try {
    const stub = writeStub(
      dir,
      "never.mjs",
      "process.stdin.resume();\nsetInterval(() => undefined, 1000);\n",
    );
    const run = await runReplacementTap([process.execPath, stub], {
      input: STREAM_LINES,
      spawn: realSpawn,
      timeoutMs: 300,
    });
    assert.equal(run.parserExitCode, 1);
    assert.equal(run.failed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * the process registry and the end of the pass
 * ------------------------------------------------------------------ */

test("CT-126-10: the tap is entered with class owned and is gone when the pass has ended with it", async () => {
  const dir = scratch("ct126-10d-");
  try {
    // A tap that ends on its own: entered, and left at the end.
    const entries: { pid: number; className: string }[] = [];
    const left: number[] = [];
    const owned: OwnedProcessRegistry = {
      enter: (pid, className) => entries.push({ pid, className }),
      leave: (pid) => left.push(pid),
    };
    const stub = writeStub(dir, "echo.mjs", "process.stdin.resume(); process.exit(0);\n");
    const run = await runReplacementTap([process.execPath, stub], {
      input: STREAM_LINES,
      spawn: realSpawn,
      owned,
      timeoutMs: 5000,
    });
    assert.equal(run.failed, false);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].className, OWNED_PROCESS_CLASS);
    assert.deepEqual(left, [entries[0].pid]);
    assert.ok(await gone(entries[0].pid), "the process is gone after the pass ended with it");

    // A tap that never ends: the timeout ends it, and it is gone too.
    const entries2: number[] = [];
    const left2: number[] = [];
    const neverDir = scratch("ct126-10e-");
    try {
      const never = writeStub(
        neverDir,
        "never.mjs",
        "process.stdin.resume(); setInterval(() => undefined, 1000);\n",
      );
      await runReplacementTap([process.execPath, never], {
        input: STREAM_LINES,
        spawn: realSpawn,
        owned: {
          enter: (pid) => entries2.push(pid),
          leave: (pid) => left2.push(pid),
        },
        timeoutMs: 300,
      });
      assert.equal(entries2.length, 1);
      assert.deepEqual(left2, [entries2[0]]);
      assert.ok(await gone(entries2[0]), "a timed-out tap is gone when the pass has ended");
    } finally {
      rmSync(neverDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-126-10: the stream reaches the tap through standard input, and its output is ignored", async () => {
  const dir = scratch("ct126-10f-");
  try {
    // The stub writes what it received on standard input to a file given as
    // the second argument, so the test sees what the tap received.
    const stub = writeStub(
      dir,
      "capture.mjs",
      [
        "import { appendFileSync } from 'node:fs';",
        "let received = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => { received += chunk; });",
        "process.stdin.on('end', () => {",
        "  appendFileSync(process.argv[2], received, 'utf8');",
        "  process.exit(0);",
        "});",
      ].join("\n"),
    );
    const captured = join(dir, "captured-stream.txt");
    const run = await runReplacementTap([process.execPath, stub, captured], {
      input: STREAM_LINES,
      spawn: realSpawn,
      timeoutMs: 5000,
    });
    assert.equal(run.parserExitCode, 0);
    assert.equal(readFileSync(captured, "utf8"), STREAM_LINES.join("\n") + "\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
