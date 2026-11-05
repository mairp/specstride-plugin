/**
 * T008 — the three test helpers do what they say.
 *
 * The helpers are the ground every later test of this feature stands on, so
 * they are themselves tested, against the live platform and not a double:
 *
 *   1. `stub-process.ts` — the stub holds the environment it was given (read
 *      back from the record it wrote, and read back a second time from the
 *      process environment of the live process through `/proc` where the
 *      platform has it) and it sleeps: it is still alive after a wait, having
 *      written nothing and ended nothing;
 *   2. `scratch-control-root.ts` — a fresh, empty directory per call, two calls
 *      never the same one, the environment names `SPECSTRIDE_STATE_DIR`, and
 *      `dispose` removes it;
 *   3. `kill.ts` — `killWithoutWarning` ends a live stub with `SIGKILL` and
 *      `waitForGone` returns only once the process is gone; the end is reported
 *      as a signal and not as an exit code, which is what "without warning"
 *      means; `killGroupWithoutWarning` ends a detached stub by its group;
 *      `isAlive` is false afterwards and `killWithoutWarning` of a dead process
 *      is false and not a throw.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { platform } from "node:os";
import {
  CONTROL_ROOT_ENV,
  CONTROL_ROOT_KEY,
  makeScratchControlRoot,
  withScratchControlRoot,
} from "../helpers/scratch-control-root.ts";
import {
  NO_WARNING_SIGNAL,
  assertSignallableGroup,
  assertSignallableProcess,
  isAlive,
  killGroupWithoutWarning,
  killWithoutWarning,
  waitForGone,
} from "../helpers/kill.ts";
import { spawnStubProcess, readStubRecord } from "../helpers/stub-process.ts";

const RUN_TOKEN = "SPECSTRIDE_RUN_TOKEN";

test("T008 — the stub holds the environment it was given and sleeps", async () => {
  const token = "token-for-the-helpers-test";
  const stub = await spawnStubProcess({
    env: { [RUN_TOKEN]: token, STUB_LABEL: "held" },
    ttlMs: 10_000,
  });
  try {
    // It holds the environment: in the record it wrote...
    assert.equal(stub.ready.env[RUN_TOKEN], token);
    assert.equal(stub.ready.env.STUB_LABEL, "held");
    assert.equal(stub.ready.kind, "specstride.test.stub-process/1");
    assert.equal(stub.ready.pid, stub.pid);
    assert.equal(stub.ready.ppid, process.pid);
    assert.deepEqual(readStubRecord(stub.readyPath), stub.ready);

    // ...and in the live process, which is the path the platform readers of
    // T010 will take. Only where the platform offers it.
    if (platform() === "linux") {
      const environ = readFileSync(`/proc/${stub.pid}/environ`, "utf8").split("\0");
      assert.ok(
        environ.includes(`${RUN_TOKEN}=${token}`),
        `the run token is not in the environment of the live process ${stub.pid}`,
      );
    }

    // And it sleeps: still there after a wait, with nothing ended.
    assert.ok(isAlive(stub.pid), "the stub was not alive");
    await new Promise((done) => setTimeout(done, 250));
    assert.ok(isAlive(stub.pid), "the stub did not stay alive — it does not sleep");
    assert.equal(stub.child.exitCode, null);
    assert.equal(stub.child.signalCode, null);
  } finally {
    await stub.kill();
  }
});

test("T008 — a scratch control root is empty, fresh per call, and removable", async () => {
  const first = makeScratchControlRoot();
  const second = makeScratchControlRoot();
  try {
    assert.notEqual(first.path, second.path, "two calls gave the same control root");
    assert.deepEqual(readdirSync(first.path), [], "the control root is not empty");
    assert.deepEqual(readdirSync(second.path), [], "the control root is not empty");
    assert.equal(first.key, CONTROL_ROOT_KEY);
    assert.equal(first.key, "state.dir");
    assert.equal(first.env[CONTROL_ROOT_ENV], first.path);
    assert.equal(CONTROL_ROOT_ENV, "SPECSTRIDE_STATE_DIR");
    // It is not the real state directory of this user, whatever that is.
    assert.notEqual(first.path, process.env[CONTROL_ROOT_ENV]);
  } finally {
    first.dispose();
    second.dispose();
  }
  assert.ok(!existsSync(first.path), "dispose did not remove the control root");
  assert.ok(!existsSync(second.path), "dispose did not remove the control root");

  // `withScratchControlRoot` removes it even when the body throws.
  let seen = "";
  await assert.rejects(
    withScratchControlRoot((root) => {
      seen = root.path;
      throw new Error("the body failed");
    }),
    /the body failed/,
  );
  assert.ok(!existsSync(seen), "the control root outlived a failed body");
});

test("T008 — kill ends a process without warning, and waitForGone waits for it", async () => {
  const stub = await spawnStubProcess({ env: { STUB_LABEL: "to-be-killed" }, ttlMs: 10_000 });
  try {
    assert.ok(isAlive(stub.pid));
    assert.equal(killWithoutWarning(stub.pid), true);
    await waitForGone(stub.pid);
    assert.ok(!isAlive(stub.pid), "the stub was still alive after waitForGone returned");

    // Without warning: the end is a signal, not an exit code. A polite signal
    // would have let the stub exit 0 of its own accord.
    const how = await stub.exited;
    assert.equal(how.signal, NO_WARNING_SIGNAL);
    assert.equal(NO_WARNING_SIGNAL, "SIGKILL");
    assert.equal(how.code, null);

    // Killing what is already gone is a false, not a throw.
    assert.equal(killWithoutWarning(stub.pid), false);
  } finally {
    await stub.kill();
  }
});

test("T008 — kill ends a detached stub by its process group", async (t) => {
  if (platform() === "win32") {
    t.skip("there is no process group to signal on this platform");
    return;
  }
  const stub = await spawnStubProcess({
    detached: true,
    env: { STUB_LABEL: "a-group" },
    ttlMs: 10_000,
  });
  try {
    // `detached` gives it a group of its own, with itself as the leader.
    assert.equal(stub.ready.pgid, stub.pid, "the detached stub does not lead its own group");
    assert.equal(killGroupWithoutWarning(stub.pid), true);
    await waitForGone(stub.pid);
    assert.ok(!isAlive(stub.pid));
    // The forbidden groups are refused before any signal leaves this process:
    // `0` is the test runner's own group, `1` is init, and `process.kill(-1)`
    // is every process this user may signal — as root, the whole machine.
    for (const forbidden of [0, 1, -1, -5, 1.5, Number.NaN]) {
      assert.throws(
        () => killGroupWithoutWarning(forbidden),
        /refusing to signal the process group/,
        `the group ${forbidden} was not refused`,
      );
    }
  } finally {
    await stub.kill();
  }
});

test("T008 — the pid guard refuses anything that is not one process above 1", () => {
  // `process.kill` reads a zero or a negative number as a *process group*, so a
  // mistyped id would widen the end of one stub into the end of a whole group —
  // and `-1` as root is every process on the machine. The guard refuses before
  // any signal leaves this process, so the refusal is what is tested, not the
  // effect of a signal nobody wants sent.
  for (const refused of [0, 1, -1, -1234, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => assertSignallableProcess(refused),
      /refusing to signal the process/,
      `the process id ${refused} was not refused`,
    );
    assert.throws(
      () => killWithoutWarning(refused),
      /refusing to signal the process/,
      `killWithoutWarning did not refuse the process id ${refused}`,
    );
  }
  // A real process id passes the guard, so the guard is not refusing everything.
  assert.doesNotThrow(() => assertSignallableProcess(process.pid));
  assert.doesNotThrow(() => assertSignallableGroup(process.pid));
});
