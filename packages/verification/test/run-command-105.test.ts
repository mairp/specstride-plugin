/**
 * T010 — the one call site of the check runner (feature 100, annex C §C.8:
 * `pin` at launch; `start`, `poll`, `result`, `cancel` per command) and the
 * fake runner for tests (`packages/verification/src/gate/run-command.ts`).
 *
 * The obligation of T010 is an effect-witness at the integration level, so
 * none of the lifecycle assertions read the value `runCommand` returned. A
 * JOURNALLING runner writes one line per operation to a file on disk as it is
 * called; the assertions then read that file back with `node:fs` — an
 * independent read path — and hash it, so the lifecycle, the handle identity
 * and the content hash are durable facts that could not exist before the
 * call. The negative case is the last suite: a runner that answers with the
 * exit code 0 while nothing durable happened is REJECTED, and the journal is
 * what shows it.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  CONDITIONS,
  OPERATIONS,
  THROW_IS_TREATED_AS,
  type CheckHandle,
  type CheckResult,
  type CheckRunner,
  type ManifestEntry,
} from "@specstride/contracts/ep/check-runner";
import {
  CALLED_OPERATIONS,
  DEADLINE_IS_A_MEMBER_OF_ROW_233,
  DEADLINE_SIGNAL,
  DEADLINE_STATUS,
  DEFAULT_POLL_INTERVAL_MS,
  conditionFields,
  conditionsOf,
  createFakeCheckRunner,
  deadlineExceeded,
  fakeResult,
  passedFromExitResult,
  pinAtLaunch,
  runCommand,
  systemClock,
  type Clock,
  type GateCommand,
  type RunOptions,
} from "../src/gate/run-command.ts";
import * as gateIndex from "../src/gate/index.ts";

/* ------------------------------------------------------------------ *
 * The fixture: a manifest entry, a command, and a clock that does not wait.
 * ------------------------------------------------------------------ */

function entryOf(id: string, over: Partial<ManifestEntry> = {}): ManifestEntry {
  return Object.freeze({
    id,
    kind: "command",
    argv: Object.freeze([`/usr/bin/${id}`, "--ci"]),
    phase: 1,
    timeLimitMs: 1_000,
    ...over,
  }) as ManifestEntry;
}

function commandOf(id: string, over: Partial<GateCommand> = {}): GateCommand {
  const entry = over.entry ?? entryOf(id);
  return Object.freeze({
    commandId: `CMD-${id}`,
    declaredId: id,
    source: "verification-commands document",
    entry,
    executable: `/usr/bin/${id}`,
    args: Object.freeze(["--ci"]),
    env: Object.freeze({ CI: "1" }),
    cwd: "/work",
    ...over,
  }) as GateCommand;
}

/** A clock that never waits: `sleep` advances it instead of using real time. */
function testClock(startAt = 0): Clock & { readonly ticks: () => number } {
  let t = startAt;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    ticks: () => t,
  };
}

function optionsOf(over: Partial<RunOptions> = {}): RunOptions {
  return {
    environmentAllowList: ["PATH", "CI"],
    containment: "C1",
    timeLimitMs: 1_000,
    pollIntervalMs: 10,
    clock: testClock(),
    ...over,
  };
}

/**
 * `pin` at launch, then run the command — the order §C.8 prescribes, and the
 * order every caller of this package uses. The fake runner keys its script by
 * the id of the manifest entry, and `pin` is what tells it which executable
 * belongs to which entry, so a test that skips `pin` is not the real flow.
 */
async function pinAndRun(
  runner: CheckRunner,
  id: string,
  options: RunOptions = optionsOf(),
): Promise<Awaited<ReturnType<typeof runCommand>>> {
  const entry = entryOf(id);
  await pinAtLaunch(runner, [entry]);
  return runCommand(runner, commandOf(id, { entry }), options);
}

/* ------------------------------------------------------------------ *
 * The journal: the independent read path.
 * ------------------------------------------------------------------ */

const journals = mkdtempSync(join(tmpdir(), "ss105-t010-"));
after(() => {
  rmSync(journals, { recursive: true, force: true });
});

/** One line of the journal, as it is read back from disk. */
type JournalLine = { readonly operation: string; readonly subject: string };

/**
 * A check runner that writes the operations of §C.8 to a FILE as they are
 * called, and otherwise behaves as the fake runner of T010 does. The file is
 * the durable effect: nothing the call site returns is read to prove the
 * lifecycle.
 */
function journallingRunner(
  name: string,
  scripts: Parameters<typeof createFakeCheckRunner>[0] = {},
): { readonly runner: CheckRunner; readonly path: string } {
  const path = join(journals, `${name}.journal`);
  const inner = createFakeCheckRunner(scripts);
  const note = (operation: string, subject: string): void => {
    appendFileSync(path, `${operation}\t${subject}\n`, "utf8");
  };
  const runner: CheckRunner = {
    async pin(entry) {
      const pinned = await inner.pin(entry);
      note("pin", entry.id);
      return pinned;
    },
    async start(input) {
      const handle = await inner.start(input);
      note("start", handle.id);
      return handle;
    },
    async poll(handle) {
      const state = await inner.poll(handle);
      note("poll", `${handle.id}:${state.state}`);
      return state;
    },
    async result(handle) {
      const result = await inner.result(handle);
      note("result", `${handle.id}:${String(result.exitCode)}`);
      return result;
    },
    async cancel(handle) {
      await inner.cancel(handle);
      note("cancel", handle.id);
    },
    environment(entry, profile) {
      note("environment", entry.id);
      return inner.environment(entry, profile);
    },
  };
  return { runner, path };
}

/** Read a journal back from disk; an independent path, not the return value. */
function readJournal(path: string): readonly JournalLine[] {
  const text = readFileSync(path, "utf8");
  return Object.freeze(
    text
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const [operation = "", subject = ""] = line.split("\t");
        return Object.freeze({ operation, subject });
      }),
  );
}

/** The sha256 of a journal: a content hash that could not exist before. */
function hashOf(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/* ------------------------------------------------------------------ *
 * The call site itself.
 * ------------------------------------------------------------------ */

describe("T010 one call site, and it is this file", () => {
  it("is the only module of `src/` that calls an operation of the runner", () => {
    const root = join(import.meta.dirname, "..", "src");
    const files: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".ts")) files.push(path);
      }
    };
    walk(root);
    assert.ok(files.length > 10, "the source tree was read");
    const callers = files.filter((path) => {
      const text = readFileSync(path, "utf8");
      return /\brunner\.(pin|start|poll|result|cancel|environment)\s*\(/.test(text);
    });
    assert.deepEqual(
      callers.map((p) => p.slice(root.length + 1)),
      ["gate/run-command.ts"],
      "the operations of §C.8 are called from one module only",
    );
  });

  it("names the operations it calls, and they are operations of §C.8", () => {
    assert.deepEqual([...CALLED_OPERATIONS], ["pin", "start", "poll", "result", "cancel"]);
    for (const operation of CALLED_OPERATIONS) {
      assert.ok((OPERATIONS as readonly string[]).includes(operation), operation);
    }
    // `environment` is the sixth operation; the composition root calls it for
    // a detached command staged before (F105-FR-035), not the gate.
    assert.ok(!(CALLED_OPERATIONS as readonly string[]).includes("environment"));
    assert.equal(OPERATIONS.length, 6);
  });

  it("re-exports the call site and the fake runner from the index of `gate/`", () => {
    assert.equal(gateIndex.runCommand, runCommand);
    assert.equal(gateIndex.createFakeCheckRunner, createFakeCheckRunner);
    assert.equal(gateIndex.pinAtLaunch, pinAtLaunch);
  });

  it("has a clock of its own, so a run needs no injected one", () => {
    assert.equal(typeof systemClock.now(), "number");
    assert.ok(systemClock.now() > 0);
    assert.equal(DEFAULT_POLL_INTERVAL_MS, 25);
  });
});

describe("T010 `pin`, at launch, once per entry of the manifest", () => {
  it("pins every entry and writes one `pin` line per entry, in order", async () => {
    const { runner, path } = journallingRunner("pin-every-entry");
    const entries = [entryOf("build"), entryOf("typecheck"), entryOf("test")];
    const outcomes = await pinAtLaunch(runner, entries);
    // The independent read path: the journal on disk.
    const journal = readJournal(path);
    assert.deepEqual(
      journal.map((l) => l.operation),
      ["pin", "pin", "pin"],
      "`pin` and nothing else runs at launch",
    );
    assert.deepEqual(
      journal.map((l) => l.subject),
      ["build", "typecheck", "test"],
    );
    assert.equal(outcomes.length, 3);
    for (const outcome of outcomes) {
      assert.equal(outcome.refused, undefined);
      assert.equal(outcome.pinned?.kind, "command");
    }
  });

  it("refuses an entry whose identity has an unknown kind, at launch", async () => {
    const runner = createFakeCheckRunner({
      odd: { pin: { kind: "wasm" as unknown as "command", executable: "/usr/bin/odd" } },
    });
    const [outcome] = await pinAtLaunch(runner, [entryOf("odd")]);
    assert.ok(outcome !== undefined);
    assert.equal(outcome.pinned, undefined);
    assert.match(outcome.refused ?? "", /refused at launch/);
    assert.match(outcome.refused ?? "", /not a kind of identity/);
    assert.match(outcome.refused ?? "", /annex C §C\.8/);
  });

  it("refuses an entry whose `pin` threw, and treats the throw as `cannot-start`", async () => {
    const runner = createFakeCheckRunner({ gone: { pinThrows: "no such file" } });
    const [outcome] = await pinAtLaunch(runner, [entryOf("gone")]);
    assert.match(outcome?.refused ?? "", /cannot-start/);
    assert.match(outcome?.refused ?? "", /no such file/);
    assert.equal(THROW_IS_TREATED_AS, "cannot-start");
  });

  it("reports every other entry when one is refused: the launch sees them all", async () => {
    const runner = createFakeCheckRunner({ bad: { pinThrows: "boom" } });
    const outcomes = await pinAtLaunch(runner, [entryOf("ok1"), entryOf("bad"), entryOf("ok2")]);
    assert.deepEqual(
      outcomes.map((o) => o.refused === undefined),
      [true, false, true],
    );
  });
});

describe("T010 `start`, `poll`, `result` per command — the durable lifecycle", () => {
  it("runs the lifecycle in the order of §C.8, read back from disk", async () => {
    const { runner, path } = journallingRunner("lifecycle", { lint: { runningPolls: 2 } });
    const before = statSync(journals).isDirectory();
    assert.ok(before);
    const entry = entryOf("lint");
    await pinAtLaunch(runner, [entry]);
    await runCommand(runner, commandOf("lint", { entry }), optionsOf());

    // Independent read path, and a content hash of a file that did not exist
    // before the call.
    const journal = readJournal(path);
    const hash = hashOf(path);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.deepEqual(
      journal.map((l) => l.operation),
      ["pin", "start", "poll", "poll", "poll", "result"],
    );
    assert.equal(journal[0]?.subject, "lint");
    // The handle is a durable identity that `start` minted: it appears first
    // on the `start` line and then on every line after it.
    const handleId = journal[1]?.subject ?? "";
    assert.match(handleId, /^fake-handle-\d+$/);
    for (const line of journal.slice(2)) {
      assert.ok(line.subject.startsWith(handleId), `${line.operation} names the handle`);
    }
    assert.deepEqual(
      journal.slice(2, 5).map((l) => l.subject.split(":")[1]),
      ["running", "running", "ended"],
    );
    assert.equal(journal[5]?.subject, `${handleId}:0`);
    assert.ok(!journal.some((l) => l.operation === "cancel"), "nothing was cancelled");
  });

  it("gives the result record the as-is fields of F105-FR-009", async () => {
    const runner = createFakeCheckRunner({ build: { result: { exitCode: 0, durationMs: 42 } } });
    const result = await pinAndRun(runner, "build");
    assert.equal(result.commandId, "CMD-build");
    assert.equal(result.declaredId, "build");
    assert.equal(result.source, "verification-commands document");
    assert.equal(result.executable, "/usr/bin/build");
    assert.deepEqual([...result.args], ["--ci"]);
    assert.deepEqual({ ...result.env }, { CI: "1" });
    assert.equal(result.cwd, "/work");
    assert.equal(result.exitCode, 0);
    assert.equal(result.signal, null);
    assert.equal(result.durationMs, 42);
    assert.equal(typeof result.stdout, "string");
    assert.equal(typeof result.stderr, "string");
    assert.equal(result.passed, true);
  });

  it("fails a command on a non-zero exit code, and throws nothing", async () => {
    const runner = createFakeCheckRunner({ test: { result: { exitCode: 1 } } });
    const result = await pinAndRun(runner, "test");
    assert.equal(result.passed, false);
    assert.equal(result.exitCode, 1);
    assert.equal(result.error, undefined, "a failed command is not an error of the runner");
    assert.equal(passedFromExitResult(1, undefined), false);
    assert.equal(passedFromExitResult(0, undefined), true);
    assert.equal(passedFromExitResult(0, "cannot-start"), false);
  });
});

describe("T010 `cancel`, at the time limit", () => {
  it("cancels a command that never ends and fails it with `timeout`", async () => {
    const { runner, path } = journallingRunner("never-ends", { slow: { neverEnds: true } });
    const result = await pinAndRun(
      runner,
      "slow",
      optionsOf({ timeLimitMs: 50, pollIntervalMs: 10, clock: testClock() }),
    );
    const journal = readJournal(path);
    // The durable record shows `cancel` and NO `result`.
    assert.equal(journal.filter((l) => l.operation === "cancel").length, 1);
    assert.equal(journal.filter((l) => l.operation === "result").length, 0);
    assert.equal(journal.at(-1)?.operation, "cancel");
    const handleId = journal.find((l) => l.operation === "start")?.subject ?? "";
    assert.equal(journal.at(-1)?.subject, handleId, "the handle that was cancelled");
    assert.equal(result.passed, false);
    assert.equal(result.error, "timeout");
    assert.equal(result.exitCode, null);
    assert.match(result.reason ?? "", /ran past its time limit of 50 ms and was cancelled/);
  });

  it("swallows a throw from `cancel`: the command has already failed", async () => {
    const runner = createFakeCheckRunner({ slow: { neverEnds: true } });
    const throwing: CheckRunner = {
      ...runner,
      cancel: async () => {
        throw new Error("the process group is gone");
      },
    };
    const result = await pinAndRun(
      throwing,
      "slow",
      optionsOf({ timeLimitMs: 20, pollIntervalMs: 10 }),
    );
    assert.equal(result.error, "timeout", "the reason the command failed for is kept");
    assert.match(result.reason ?? "", /time limit/);
  });
});

describe("T010 a runner that cannot start, or throws, is a failed command", () => {
  it("treats a throw at `start` as `cannot-start` and calls nothing after it", async () => {
    const { runner, path } = journallingRunner("start-throws", {
      missing: { startThrows: "ENOENT" },
    });
    const result = await pinAndRun(runner, "missing");
    const journal = readJournal(path);
    assert.deepEqual(
      journal.map((l) => l.operation),
      ["pin"],
      "`pin` at launch succeeded; nothing after `start` ran",
    );
    assert.equal(result.passed, false);
    assert.equal(result.error, "cannot-start");
    assert.match(result.reason ?? "", /ENOENT/);
  });

  it("treats a throw at `poll` as `cannot-start`, and cancels the handle", async () => {
    const { runner, path } = journallingRunner("poll-throws", {
      flap: { pollThrows: "the handle is unknown" },
    });
    const result = await pinAndRun(runner, "flap");
    const journal = readJournal(path);
    assert.deepEqual(
      journal.map((l) => l.operation),
      ["pin", "start", "cancel"],
    );
    assert.equal(result.error, "cannot-start");
    assert.equal(result.passed, false);
  });

  it("treats a throw at `result` as `cannot-start`", async () => {
    const runner = createFakeCheckRunner({ odd: { resultThrows: "no result" } });
    const result = await pinAndRun(runner, "odd");
    assert.equal(result.error, "cannot-start");
    assert.equal(result.passed, false);
    assert.equal(result.exitCode, null);
  });

  it("never rejects: the gate decides, and it never stops at a failure", async () => {
    const runner = createFakeCheckRunner({
      a: { result: { exitCode: 1 } },
      b: { startThrows: "boom" },
      c: { result: { exitCode: 0 } },
    });
    const results = [];
    for (const id of ["a", "b", "c"]) results.push(await pinAndRun(runner, id));
    assert.deepEqual(
      results.map((r) => r.passed),
      [false, false, true],
      "the command after a failure still ran",
    );
  });
});

describe("T010 the conditions of a result, each in a field of its own", () => {
  it("holds no condition field when the runner returned none (the `parity` record)", async () => {
    const runner = createFakeCheckRunner({ build: { result: { exitCode: 0 } } });
    const result = await pinAndRun(runner, "build");
    for (const condition of CONDITIONS) {
      assert.ok(!(condition in result), `the entry holds no \`${condition}\` field`);
    }
    assert.deepEqual(Object.keys(conditionFields(fakeResult())), []);
    assert.deepEqual([...conditionsOf(fakeResult())], []);
  });

  it("keeps each condition the runner returned in a field of its own", async () => {
    const runner = createFakeCheckRunner({
      build: { result: { exitCode: 0, tainted: true, flaky: true, reason: "slow" } },
    });
    const result = await pinAndRun(runner, "build");
    assert.equal(result.tainted, true);
    assert.equal(result.flaky, true);
    assert.equal(result.reason, "slow");
    assert.ok(!("cached" in result), "a condition that was not set holds no field");
    assert.ok(!("unchecked" in result));
    assert.deepEqual(
      [...conditionsOf(fakeResult({ tainted: true, flaky: true }))],
      ["tainted", "flaky"],
    );
  });

  it("does not let a condition by itself fail a command (F105-FR-032)", async () => {
    for (const condition of CONDITIONS) {
      const runner = createFakeCheckRunner({
        build: { result: { exitCode: 0, [condition]: true } as Partial<CheckResult> },
      });
      const result = await pinAndRun(runner, "build");
      assert.equal(result.passed, true, `\`${condition}\` alone does not fail the command`);
      assert.equal(result[condition], true, `\`${condition}\` is kept in the record`);
    }
  });
});

describe("T010 the detached command staged before, which has no exit code", () => {
  it("reports `DEADLINE` of row 233 and counts as failed", () => {
    assert.equal(DEADLINE_SIGNAL, "DEADLINE");
    assert.equal(DEADLINE_IS_A_MEMBER_OF_ROW_233, true);
    assert.equal(DEADLINE_STATUS, "deadline_exceeded");
    const result = deadlineExceeded(commandOf("server"), 90_000);
    assert.equal(result.signal, "DEADLINE");
    assert.equal(result.exitCode, null);
    assert.equal(result.passed, false);
    assert.equal(result.durationMs, 90_000);
    assert.match(result.reason ?? "", /deadline_exceeded/);
    assert.match(result.reason ?? "", /F105-FR-035/);
  });
});

describe("T010 the fake runner", () => {
  it("implements the six operations of §C.8 and records every call", async () => {
    const runner = createFakeCheckRunner({ lint: { runningPolls: 1 } });
    await pinAndRun(runner, "lint");
    assert.deepEqual(
      runner.calls.map((c) => c.operation),
      ["pin", "start", "poll", "poll", "result"],
    );
    assert.equal(runner.callsOf("pin").length, 1);
    assert.equal(runner.callsOf("cancel").length, 0);
    const handleId = runner.callsOf("start")[0]?.handleId ?? "";
    assert.equal(runner.commandOf({ id: handleId } as CheckHandle), "lint");
    assert.equal(runner.commandOf({ id: "no-such-handle" } as CheckHandle), undefined);
  });

  it("`environment` starts no process and returns no handle (§C.8)", () => {
    const runner = createFakeCheckRunner();
    const entry = entryOf("build", { env: { TZ: "UTC" } });
    const outside = runner.environment(entry, "default");
    const parity = runner.environment(entry, "parity");
    assert.deepEqual({ ...outside }, { TZ: "UTC" });
    assert.deepEqual({ ...parity }, { SPECSTRIDE_PROFILE: "parity", TZ: "UTC" });
    assert.deepEqual(
      runner.calls.map((c) => c.operation),
      ["environment", "environment"],
    );
    assert.equal(runner.callsOf("start").length, 0, "no process was started");
  });

  it("gives a result with the fields of §C.8 and no condition set", () => {
    const result = fakeResult();
    assert.equal(result.exitCode, 0);
    assert.equal(result.output.hash.length, 64);
    for (const condition of CONDITIONS) assert.equal(result[condition], false);
    assert.equal(fakeResult({ exitCode: 7 }).exitCode, 7);
  });

  it("hands out a new handle per `start`", async () => {
    const runner = createFakeCheckRunner();
    for (const id of ["a", "b"]) await pinAndRun(runner, id);
    const handles = runner.callsOf("start").map((c) => c.handleId);
    assert.equal(handles.length, 2);
    assert.notEqual(handles[0], handles[1]);
  });
});

describe("T010 the negative case: a successful-looking answer with no durable effect", () => {
  it("rejects an exit code 0 the runner never reached a `result` for", async () => {
    // The script makes `result` answer with the exit code 0, but `start`
    // throws, so no handle is ever minted and `result` is never called.
    const { runner, path } = journallingRunner("looks-fine", {
      sneaky: { startThrows: "nothing was started", result: { exitCode: 0 } },
    });
    const result = await pinAndRun(runner, "sneaky");

    // The call site rejects it: no exit code, `cannot-start`, not passed.
    assert.equal(result.passed, false, "a successful-looking answer is not a pass");
    assert.equal(result.exitCode, null);
    assert.equal(result.error, "cannot-start");

    // And the independent read path agrees: there is no durable effect of a
    // RUN. The journal holds the `pin` of the launch and nothing else — no
    // handle was minted, so there is no lifecycle to read and no `result`.
    const journal = readJournal(path);
    assert.deepEqual(
      journal.map((l) => l.operation),
      ["pin"],
    );
    assert.ok(!journal.some((l) => l.operation === "start"));
    assert.ok(!journal.some((l) => l.operation === "result"));
  });

  it("rejects a `result` a `poll` never said had ended", async () => {
    // `poll` throws, so the command never ended; `result` would have
    // answered 0. The journal proves `result` was not called.
    const { runner, path } = journallingRunner("never-ended", {
      sneaky: { pollThrows: "lost the handle", result: { exitCode: 0 } },
    });
    const result = await pinAndRun(runner, "sneaky");
    const journal = readJournal(path);
    assert.ok(!journal.some((l) => l.operation === "result"), "no `result` was reached");
    assert.deepEqual(
      journal.map((l) => l.operation),
      ["pin", "start", "cancel"],
    );
    assert.equal(result.passed, false);
    assert.equal(result.exitCode, null);
  });

  it("writes a different content hash for a different lifecycle", async () => {
    const a = journallingRunner("hash-a", { x: { runningPolls: 0 } });
    const b = journallingRunner("hash-b", { x: { runningPolls: 3 } });
    await pinAndRun(a.runner, "x");
    await pinAndRun(b.runner, "x");
    const [hashA, hashB] = [hashOf(a.path), hashOf(b.path)];
    assert.match(hashA, /^[0-9a-f]{64}$/);
    assert.notEqual(hashA, hashB, "the durable record of the two runs differs");
    assert.equal(readJournal(a.path).filter((l) => l.operation === "poll").length, 1);
    assert.equal(readJournal(b.path).filter((l) => l.operation === "poll").length, 4);
  });
});
