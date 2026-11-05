/**
 * T050 — CT-122-23, CT-122-24, CT-122-25: the process registry, the run token
 * and the identity check (F122-FR-023, F122-FR-024, F122-FR-025, F122-SC-005).
 *
 * What each case observes, and through which read path:
 *
 *   - **CT-122-23** one entry per child, written BEFORE the child works. The
 *     witness is not this test's word and not the writer's: the child reads
 *     the registry file itself the instant its gate opens and records whether
 *     its own entry was already there (`helpers/gated-child.ts`). The test
 *     reads that record off the disk.
 *   - **CT-122-24** the entry of the engine is of class `owned`, and the entry
 *     of a worker pass carries the worker id. Read back from the JSONL file,
 *     not from the value `openEntry` returned.
 *   - **CT-122-24** the run token is in the environment of every child — read
 *     from the LIVE process through the process table — and only its hash is
 *     in the records: the bytes of the registry file are searched for the
 *     secret and must not hold it.
 *   - **CT-122-25** a planted entry gets 0 signals and the end cause
 *     `identity-mismatch`. The signal count is taken from a signaller that
 *     counts, the end cause is read back out of the registry file, and the
 *     process the planted entry pointed at is still ALIVE afterwards.
 *
 * HOST SAFETY (the owner's ruling of 2026-10-02): every process here is
 * started detached, so it leads a session and a group of its own and its
 * group id is its own process id. No group id of 0, 1 or a negative number
 * can reach a signal, and the suite runs inside the PID namespace of
 * `test/isolate.ts`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import {
  closeEntry,
  openEntry,
  readEntries,
  readOpenEntries,
  registryFileOf,
  startChildUnderTheRegistry,
  startTimeMsOf,
  type ProcsPlace,
} from "../../src/procs/registry.ts";
import {
  checkIdentity,
  signalUnderTheIdentityCheck,
  IDENTITY_MISMATCH,
} from "../../src/procs/identity.ts";
import {
  environmentOfAProcessOfTheSameUser,
  startTimeOfProcess,
} from "../../src/procs/platform.ts";
import { hashToken, mintRunToken, RUN_TOKEN_VAR } from "../../src/procs/run-token.ts";
import { endOwnedProcessesOfEngineStart } from "../../src/root/end-owned.ts";
import { makeScratchControlRoot } from "../helpers/scratch-control-root.ts";
import { spawnStubProcess } from "../helpers/stub-process.ts";
import { isAlive, killAndWait } from "../helpers/kill.ts";
import {
  GATED_CHILD_ENTRY,
  READY_FILE_VAR,
  REGISTRY_FILE_VAR,
  TTL_VAR,
  waitForGatedChild,
} from "../helpers/gated-child.ts";

const SLUG = "122-detached-runtime";

function placeIn(controlRoot: string, runId = "run-1"): ProcsPlace {
  return Object.freeze({ controlRoot, featureSlug: SLUG, runId });
}

test("CT-122-23: one entry per child, written before the child can do any work", async () => {
  const root = makeScratchControlRoot("registry-23");
  const place = placeIn(root.path);
  const token = mintRunToken();
  const ready = join(root.path, "gated.json");
  try {
    const started = await startChildUnderTheRegistry({
      place,
      writer: "engine",
      entry: {
        procId: "p-child-1",
        kind: "harness-pass",
        runTokenHash: token.hash,
        engineStartId: "es-1",
      },
      start: {
        argv: [process.execPath, GATED_CHILD_ENTRY],
        cwd: root.path,
        env: {
          PATH: process.env["PATH"] ?? "",
          [RUN_TOKEN_VAR]: token.secret(),
          [READY_FILE_VAR]: ready,
          [REGISTRY_FILE_VAR]: registryFileOf(place, "engine"),
          [TTL_VAR]: "20000",
        },
      },
    });
    try {
      const seen = await waitForGatedChild(ready);

      // The child's own eyes: its entry was already on disk when it began.
      assert.equal(seen.pid, started.pid);
      assert.equal(seen.procId, "p-child-1");
      assert.equal(seen.sawItsOwnEntry, true, "the entry was written before the child worked");
      assert.equal(seen.entriesForThisPid, 1, "exactly one entry for this child");

      // And the registry agrees, read back from the file.
      const open = readOpenEntries(place);
      assert.equal(open.length, 1);
      assert.equal(open[0]?.procId, "p-child-1");
      assert.equal(open[0]?.pid, started.pid);
      assert.equal(open[0]?.processGroup, started.pid, "a child of the runtime leads its group");
      assert.equal(open[0]?.processSession, started.pid, "and its session");
    } finally {
      await killAndWait(started.pid);
    }
  } finally {
    root.dispose();
  }
});

test("CT-122-23: one file per writer, and a closed entry is no longer open", () => {
  const root = makeScratchControlRoot("registry-23b");
  const place = placeIn(root.path);
  const token = mintRunToken();
  try {
    const byRoot = openEntry(place, "runtime-root", {
      procId: "p-engine",
      kind: "engine",
      pid: 4242,
      processGroup: 4242,
      processSession: 4242,
      startTimeMs: 1_000,
      runTokenHash: token.hash,
      engineStartId: "es-1",
    });
    openEntry(place, "engine", {
      procId: "p-pass",
      kind: "harness-pass",
      pid: 4243,
      processGroup: 4243,
      processSession: 4243,
      startTimeMs: 1_100,
      runTokenHash: token.hash,
      engineStartId: "es-1",
    });

    // Two writers, two files, each named by the writer (the layout table).
    assert.notEqual(registryFileOf(place, "runtime-root"), registryFileOf(place, "engine"));
    assert.match(registryFileOf(place, "engine"), /\/procs\/engine\.jsonl$/);
    assert.equal(
      readFileSync(registryFileOf(place, "runtime-root"), "utf8")
        .split("\n")
        .filter((l) => l !== "").length,
      1,
    );
    assert.equal(
      readFileSync(registryFileOf(place, "engine"), "utf8")
        .split("\n")
        .filter((l) => l !== "").length,
      1,
    );
    assert.equal(readOpenEntries(place).length, 2);

    closeEntry(place, "runtime-root", byRoot, "exited");
    const open = readOpenEntries(place);
    assert.deepEqual(
      open.map((one) => one.procId),
      ["p-pass"],
      "the closed entry is no longer open",
    );
    // The close is a second line, not a rewrite: the file grew.
    assert.equal(
      readFileSync(registryFileOf(place, "runtime-root"), "utf8")
        .split("\n")
        .filter((l) => l !== "").length,
      2,
    );
    const all = readEntries(place);
    const engine = all.find((one) => one.procId === "p-engine");
    assert.equal(engine?.endCause, "exited");
    assert.ok(typeof engine?.endedAt === "string" && engine.endedAt !== "");
  } finally {
    root.dispose();
  }
});

test("CT-122-24: the entry of the engine is of class `owned`, a worker pass carries its worker id", () => {
  const root = makeScratchControlRoot("registry-24");
  const place = placeIn(root.path);
  const token = mintRunToken();
  try {
    openEntry(place, "runtime-root", {
      procId: "p-engine",
      kind: "engine",
      pid: 5100,
      processGroup: 5100,
      processSession: 5100,
      startTimeMs: 1,
      runTokenHash: token.hash,
      engineStartId: "es-1",
    });
    for (let n = 1; n <= 4; n += 1) {
      openEntry(place, "engine", {
        procId: `p-worker-${n}`,
        kind: "worker-pass",
        pid: 5200 + n,
        processGroup: 5200 + n,
        processSession: 5200 + n,
        startTimeMs: n,
        runTokenHash: token.hash,
        engineStartId: "es-1",
        workerId: `w${n}`,
      });
    }
    openEntry(place, "engine", {
      procId: "p-job",
      kind: "detached-job",
      pid: 5300,
      processGroup: 5300,
      processSession: 5300,
      startTimeMs: 1,
      runTokenHash: token.hash,
      engineStartId: "es-1",
      jobId: "job-1",
    });

    const all = readEntries(place);
    const engine = all.find((one) => one.kind === "engine");
    assert.equal(engine?.class, "owned", "the entry of the engine is of class `owned`");

    const workers = all.filter((one) => one.kind === "worker-pass");
    assert.equal(workers.length, 4);
    assert.deepEqual(
      workers.map((one) => one.workerId),
      ["w1", "w2", "w3", "w4"],
      "every worker pass carries its worker id beside pid, start time and the hash",
    );
    for (const worker of workers) {
      assert.equal(worker.class, "owned");
      assert.equal(worker.runTokenHash, token.hash);
      assert.ok(startTimeMsOf(worker) !== null);
    }

    // The detached job of a yield is the one `adoptable` kind (F100-FR-063).
    assert.equal(all.find((one) => one.kind === "detached-job")?.class, "adoptable");

    // A class that contradicts the kind is refused outright.
    assert.throws(
      () =>
        openEntry(place, "engine", {
          procId: "p-bad",
          kind: "worker-pass",
          class: "adoptable",
          pid: 5400,
          processGroup: 5400,
          processSession: 5400,
          startTimeMs: 1,
          runTokenHash: token.hash,
          engineStartId: "es-1",
        }),
      /never of class/,
    );
  } finally {
    root.dispose();
  }
});

test("CT-122-24: the run token is in the environment of every child and only its hash in records", async () => {
  const root = makeScratchControlRoot("registry-24b");
  const place = placeIn(root.path);
  const token = mintRunToken();
  const secret = token.secret();
  const ready = join(root.path, "gated.json");
  try {
    const started = await startChildUnderTheRegistry({
      place,
      writer: "engine",
      entry: {
        procId: "p-child-token",
        kind: "harness-pass",
        runTokenHash: token.hash,
        engineStartId: "es-1",
      },
      start: {
        argv: [process.execPath, GATED_CHILD_ENTRY],
        cwd: root.path,
        env: {
          PATH: process.env["PATH"] ?? "",
          [RUN_TOKEN_VAR]: secret,
          [READY_FILE_VAR]: ready,
          [REGISTRY_FILE_VAR]: registryFileOf(place, "engine"),
          [TTL_VAR]: "20000",
        },
      },
    });
    try {
      const seen = await waitForGatedChild(ready);
      assert.equal(seen.holdsARunToken, true, "the child holds the run token");
      assert.equal(seen.runToken, secret);

      // The independent read: the environment of the LIVE process, from the
      // process table, not from what the test handed to `spawn`.
      const live = environmentOfAProcessOfTheSameUser(started.pid);
      assert.ok(live !== null, "the environment of the child can be read");
      assert.equal(live?.[RUN_TOKEN_VAR], secret, "the live process holds the token");

      // And the record holds the HASH and never the token.
      const bytes = readFileSync(registryFileOf(place, "engine"), "utf8");
      assert.equal(bytes.includes(secret), false, "the secret is nowhere in the record");
      assert.equal(bytes.includes(token.hash), true, "its hash is");
      assert.equal(seen.runTokenHashInTheEntry, hashToken(secret));

      // A caller that passed the secret where the hash belongs is refused.
      assert.throws(
        () =>
          openEntry(place, "engine", {
            procId: "p-leak",
            kind: "check",
            pid: 6000,
            processGroup: 6000,
            processSession: 6000,
            startTimeMs: 1,
            runTokenHash: `not-a-hash-${secret}`,
            engineStartId: "es-1",
          }),
        /hexadecimal hash and not a token/,
      );
    } finally {
      await killAndWait(started.pid);
    }
  } finally {
    root.dispose();
  }
});

test("CT-122-25, F122-SC-005: a planted entry gets 0 signals and the end cause `identity-mismatch`", async () => {
  const root = makeScratchControlRoot("registry-25");
  const place = placeIn(root.path);
  const ours = mintRunToken();
  const theirs = mintRunToken();
  // A live process of this user that holds SOMEONE ELSE'S token: the very
  // thing a planted entry would aim a signal at.
  const stranger = await spawnStubProcess({
    env: { [RUN_TOKEN_VAR]: theirs.secret() },
    detached: true,
    ttlMs: 20_000,
  });
  try {
    const startTimeMs = startTimeOfProcess(stranger.pid);
    assert.ok(startTimeMs !== null, "the platform reports the start time of the stranger");

    // The plant: an entry of OUR run that names the stranger's process id,
    // its real start time and OUR token hash. Everything matches but the one
    // thing that cannot be forged from outside — the token the process holds.
    const planted = openEntry(place, "runtime-root", {
      procId: "p-planted",
      kind: "harness-pass",
      pid: stranger.pid,
      processGroup: stranger.pid,
      processSession: stranger.pid,
      startTimeMs: startTimeMs as number,
      runTokenHash: ours.hash,
      engineStartId: "es-1",
    });

    const identity = checkIdentity(planted);
    assert.equal(identity.matches, false);
    assert.deepEqual([...identity.mismatches], ["run-token-differs"]);

    // 0 signals. The counter is the witness, and it counts every call.
    let signals = 0;
    const guarded = signalUnderTheIdentityCheck(planted, "terminate", {
      signaller: () => (signals += 1),
    });
    assert.equal(signals, 0, "F122-SC-005: 0 signals are sent");
    assert.equal(guarded.signalsSent, 0);
    assert.equal(guarded.outcome, IDENTITY_MISMATCH);
    assert.equal(guarded.record?.reasons.includes("run-token-differs"), true);

    // The end of the `owned` processes closes it with the end cause, and the
    // stranger lives through all of it.
    const result = await endOwnedProcessesOfEngineStart(place, "es-1", "signal", {
      signaller: () => (signals += 1),
      roundWaitMs: 50,
    });
    assert.equal(signals, 0, "still 0 signals after the whole ladder");
    assert.equal(result.signalsSent, 0);
    assert.equal(result.mismatches.length, 1);
    assert.equal(isAlive(stranger.pid), true, "the wrong process was not touched");

    // The end cause, read back out of the registry file.
    const closed = readEntries(place).find((one) => one.procId === "p-planted");
    assert.equal(closed?.endCause, IDENTITY_MISMATCH);
    assert.ok(typeof closed?.endedAt === "string" && closed.endedAt !== "");
    assert.equal(readOpenEntries(place).length, 0);
  } finally {
    await stranger.kill();
    root.dispose();
  }
});

test("CT-122-25: a signal never goes to a group the runtime did not create", () => {
  const root = makeScratchControlRoot("registry-25b");
  const place = placeIn(root.path);
  const token = mintRunToken();
  try {
    // A group id that is not the process id is a group this runtime did not
    // make. The check refuses it before anything reaches the platform.
    const foreign = openEntry(place, "runtime-root", {
      procId: "p-foreign-group",
      kind: "harness-pass",
      pid: process.pid,
      processGroup: 1,
      processSession: 1,
      startTimeMs: startTimeOfProcess(process.pid) ?? 0,
      runTokenHash: token.hash,
      engineStartId: "es-1",
    });
    let signals = 0;
    const guarded = signalUnderTheIdentityCheck(foreign, "kill", {
      signaller: () => (signals += 1),
    });
    assert.equal(signals, 0);
    assert.equal(guarded.outcome, IDENTITY_MISMATCH);
    assert.equal(
      guarded.record?.reasons.includes("group-not-created-by-the-runtime"),
      true,
      "the refusal names the group guard",
    );
  } finally {
    root.dispose();
  }
});

test("CT-122-25: each of the three readings alone is enough to refuse a signal", async () => {
  const root = makeScratchControlRoot("registry-25c");
  const place = placeIn(root.path);
  const token = mintRunToken();
  const live = await spawnStubProcess({
    env: { [RUN_TOKEN_VAR]: token.secret() },
    detached: true,
    ttlMs: 20_000,
  });
  try {
    const realStart = startTimeOfProcess(live.pid);
    assert.ok(realStart !== null);

    // The entry that matches on all three IS signalled, so the three cases
    // below differ from it in one reading only — otherwise they would prove
    // nothing about which reading did the refusing.
    const good = openEntry(place, "runtime-root", {
      procId: "p-good",
      kind: "harness-pass",
      pid: live.pid,
      processGroup: live.pid,
      processSession: live.pid,
      startTimeMs: realStart as number,
      runTokenHash: token.hash,
      engineStartId: "es-good",
    });
    let signals = 0;
    assert.equal(
      signalUnderTheIdentityCheck(good, "polite", { signaller: () => (signals += 1) }).outcome,
      "signalled",
    );
    assert.equal(signals, 1, "a matching entry is signalled exactly once");

    // 1. The START TIME differs: the id belongs to another process now.
    const wrongStart = openEntry(place, "runtime-root", {
      procId: "p-wrong-start",
      kind: "harness-pass",
      pid: live.pid,
      processGroup: live.pid,
      processSession: live.pid,
      startTimeMs: (realStart as number) - 3_600_000,
      runTokenHash: token.hash,
      engineStartId: "es-1",
    });
    signals = 0;
    const byStart = signalUnderTheIdentityCheck(wrongStart, "kill", {
      signaller: () => (signals += 1),
    });
    assert.equal(signals, 0, "F122-SC-005: 0 signals");
    assert.equal(byStart.outcome, IDENTITY_MISMATCH);
    assert.equal(byStart.record?.reasons.includes("start-time-differs"), true);

    // 2. The PROCESS ID names nothing: a pid that is gone.
    const gone = await spawnStubProcess({
      env: { [RUN_TOKEN_VAR]: token.secret() },
      detached: true,
      ttlMs: 5_000,
    });
    const goneStart = startTimeOfProcess(gone.pid) ?? 0;
    await gone.kill();
    const deadEntry = openEntry(place, "runtime-root", {
      procId: "p-dead",
      kind: "harness-pass",
      pid: gone.pid,
      processGroup: gone.pid,
      processSession: gone.pid,
      startTimeMs: goneStart,
      runTokenHash: token.hash,
      engineStartId: "es-1",
    });
    signals = 0;
    const byPid = signalUnderTheIdentityCheck(deadEntry, "kill", {
      signaller: () => (signals += 1),
    });
    assert.equal(signals, 0);
    assert.equal(byPid.outcome, IDENTITY_MISMATCH);
    assert.ok(
      byPid.record?.reasons.includes("pid-gone") ||
        byPid.record?.reasons.includes("start-time-unreadable"),
      `the refusal names the process id or its unreadable start time: ${JSON.stringify(byPid.record?.reasons)}`,
    );

    // 3. The RUN TOKEN is absent: a process of this user that carries none.
    const tokenless = await spawnStubProcess({ detached: true, ttlMs: 20_000 });
    try {
      const noToken = openEntry(place, "runtime-root", {
        procId: "p-no-token",
        kind: "harness-pass",
        pid: tokenless.pid,
        processGroup: tokenless.pid,
        processSession: tokenless.pid,
        startTimeMs: startTimeOfProcess(tokenless.pid) ?? 0,
        runTokenHash: token.hash,
        engineStartId: "es-1",
      });
      signals = 0;
      const byToken = signalUnderTheIdentityCheck(noToken, "kill", {
        signaller: () => (signals += 1),
      });
      assert.equal(signals, 0);
      assert.equal(byToken.outcome, IDENTITY_MISMATCH);
      assert.equal(byToken.record?.reasons.includes("run-token-absent"), true);
      assert.equal(isAlive(tokenless.pid), true, "and it was not touched");
    } finally {
      await tokenless.kill();
    }
  } finally {
    await live.kill();
    root.dispose();
  }
});
