/**
 * T011 — unit test of the platform readers of T010, with RECORDED outputs of
 * `ps` and of the process file system as fixtures (F122-FR-025, F122-FR-013;
 * and F122-FR-042, which the readers carry).
 *
 * Why recorded fixtures and not the live machine: the readings that matter
 * cannot be produced to order. A process in state `Z` that has exited and was
 * not yet collected, a process in another pid namespace, a process whose
 * command name holds a space and a bracket, a boot identity that differs from
 * the present one — each is either racy or impossible to stage here. A
 * recorded tree makes every one of them an ordinary case.
 *
 * The recorded tree is `../fixtures/proc-linux/`, taken from this machine on
 * 2026-10-02 and then edited into the four processes the tests need. The
 * recorded `ps` outputs are in `../fixtures/ps-macos.json`, which is how the
 * macOS BRANCH is exercised at all: the parsing is proved, the platform is
 * not, and that is why the macOS readings stay `unverified` (D-6, D-8).
 *
 * What this file does NOT prove: that `/proc` on some other Linux looks like
 * the fixture. That is what a characterization test against the live machine
 * is for, and the last section does exactly that — it reads this very process
 * through `platformIo` and checks the readings against what the process
 * already knows about itself.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LIVENESS_REASONS,
  MACOS_UNVERIFIED_REASON,
  MACOS_VERIFICATION,
  PID_NAMESPACE_LINK,
  PLATFORMS_WITH_A_BRANCH,
  READ_THROUGH_THE_KERNEL_PRIMITIVE,
  SMALLEST_PROCESS_ID,
  START_TIME_TOLERANCE_MS,
  ZOMBIE_STATE,
  bootIdentity,
  createPlatformReaders,
  environmentOfAProcessOfTheSameUser,
  findProcessesByRunToken,
  hasExitedWithoutBeingCollected,
  hostNameOfTheMachine,
  isAskableProcessId,
  pidNamespaceOf,
  processesOfTheUser,
  recordedPlatformIo,
  recordedProcessLives,
  startTimeOfProcess,
  type PlatformIo,
  type ProcessOfTheUser,
} from "../../src/procs/platform.ts";
import type { ProcessPrimitive } from "@specstride/contracts/ep/kernel-services";
import { createProcessPrimitive } from "@specstride/kernel";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "..", "fixtures");
const PROC_LINUX_FIXTURE = join(FIXTURES, "proc-linux.json");
const PS_MACOS = join(FIXTURES, "ps-macos.json");

/** The recorded Linux process file system: a map of path to content. */
type ProcFixture = {
  readonly procRoot: string;
  readonly bootTimeSeconds: number;
  readonly clockTicksPerSecond: number;
  readonly files: Record<string, string>;
  readonly links: Record<string, string>;
};
const PROC: ProcFixture = JSON.parse(readFileSync(PROC_LINUX_FIXTURE, "utf8")) as ProcFixture;
const PROC_ROOT = PROC.procRoot;

/** The user the recorded tree is read as; the fixture belongs to this user. */
const FIXTURE_UID = typeof process.getuid === "function" ? process.getuid() : null;

/** The four processes of the recorded tree, and what each one is. */
const ENGINE = 4101;
const ODD_NAME = 4102;
const ZOMBIE = 4103;
const STRANGER = 4104;

/** The run token the recorded tree carries, as recorded in two environs. */
const RECORDED_TOKEN = "a9f1c0de5b7342e8";

/** What the recorded `/proc/stat` records as the boot time, in seconds. */
const RECORDED_BTIME_SECONDS = PROC.bootTimeSeconds;

/** The boot identity the recorded tree carries. */
const RECORDED_BOOT_ID = "aebf8686-5592-4fb5-924c-9e1d1ce80e2f";

/** The pid namespace the first three recorded processes are in. */
const RECORDED_NAMESPACE = "pid:[4026531836]";

/** Field 22 of the recorded `stat` of the engine, in clock ticks. */
const ENGINE_START_TICKS = 795675;

/** The clock ticks per second the kernel falls back to for a recorded table. */
const RECORDED_TICKS_PER_SECOND = PROC.clockTicksPerSecond;

/** The start time the readers must derive for the engine, in milliseconds. */
const ENGINE_START_MS =
  RECORDED_BTIME_SECONDS * 1000 + (ENGINE_START_TICKS / RECORDED_TICKS_PER_SECOND) * 1000;

/** The recorded Linux seam, with what the platform would answer to `kill(_, 0)`. */
function linuxIo(
  signals: Readonly<Record<number, "permitted" | "permission-refused" | "gone" | "unknown">> = {
    [ENGINE]: "permitted",
    [ODD_NAME]: "permitted",
    [ZOMBIE]: "permitted",
    [STRANGER]: "permitted",
  },
): PlatformIo {
  return recordedPlatformIo({
    platform: "linux",
    procRoot: PROC_ROOT,
    uid: FIXTURE_UID,
    hostName: "recorded-host",
    files: PROC.files,
    links: PROC.links,
    signals,
  });
}

/** A primitive bound to a recorded table, so `startTimeOf` reads the fixture. */
function primitiveOver(io: PlatformIo): ProcessPrimitive {
  return createProcessPrimitive(io);
}

/* ------------------------------------------------------------------ *
 * The rule of T010: the readers go through the kernel primitive.
 * ------------------------------------------------------------------ */

test("T011 — the start time and the token search go through the kernel primitive", () => {
  assert.deepEqual([...READ_THROUGH_THE_KERNEL_PRIMITIVE], ["startTimeOf", "findByRunToken"]);

  // The proof is behavioural and not a comment: a primitive that answers
  // something of its own making is what the readers report, so they cannot be
  // reading the table themselves.
  const sentinelStart = 1234567890;
  const sentinelCarriers = Object.freeze([4242, 4243]);
  const stub: ProcessPrimitive = {
    start: () => Promise.reject(new Error("not used")),
    startDetached: () => Promise.reject(new Error("not used")),
    signalGroup: () => {
      throw new Error("the readers never signal");
    },
    startTimeOf: () => sentinelStart,
    findByRunToken: () => sentinelCarriers,
    waitForEnd: () => Promise.reject(new Error("not used")),
  };
  assert.equal(startTimeOfProcess(ENGINE, stub), sentinelStart);
  assert.deepEqual([...findProcessesByRunToken("whatever", stub)], [4242, 4243]);
});

test("T011 — the readers name both platforms and mark macOS `unverified`", () => {
  assert.deepEqual([...PLATFORMS_WITH_A_BRANCH], ["linux", "darwin"]);
  assert.equal(MACOS_VERIFICATION, "unverified");
  assert.match(MACOS_UNVERIFIED_REASON, /no macOS machine/);
  assert.match(MACOS_UNVERIFIED_REASON, /D-6, D-8/);
});

test("T011 — an id that is not a single process is never asked about", () => {
  // HOST SAFETY (the owner's ruling of 2026-10-02): a signal of zero to a
  // group as root asks about every process on the machine.
  assert.equal(SMALLEST_PROCESS_ID, 2);
  for (const pid of [0, 1, -1, -5, 1.5, Number.NaN]) {
    assert.equal(isAskableProcessId(pid), false, `${pid} must not be askable`);
  }
  for (const pid of [2, 4101, 99999]) assert.equal(isAskableProcessId(pid), true);

  // And the readers answer rather than ask.
  const io = linuxIo();
  for (const pid of [0, 1, -1, 1.5]) {
    assert.equal(startTimeOfProcess(pid, primitiveOver(io)), null);
    assert.equal(pidNamespaceOf(pid, io), null);
    assert.equal(environmentOfAProcessOfTheSameUser(pid, io), null);
    assert.equal(hasExitedWithoutBeingCollected(pid, io), false);
    const liveness = recordedProcessLives({ pid }, io, primitiveOver(io));
    assert.equal(liveness.alive, false);
    assert.equal(liveness.reason, "not-a-process");
  }
});

/* ------------------------------------------------------------------ *
 * 1. The start time of a process, from the recorded tree.
 * ------------------------------------------------------------------ */

test("T011 — the start time of a process comes from the recorded tree", () => {
  const io = linuxIo();
  assert.equal(startTimeOfProcess(ENGINE, primitiveOver(io)), ENGINE_START_MS);
});

test("T011 — a command name with a space and a bracket does not break the parse", () => {
  // `/proc/<pid>/stat` holds the command name in brackets and the name itself
  // may hold a space and a bracket. A parse that split on the second field
  // would read the wrong number here; the recorded name is `(we (are) fine)`.
  const io = linuxIo();
  const text = PROC.files[`${PROC_ROOT}/${ODD_NAME}/stat`] ?? "";
  assert.match(text, /\(we \(are\) fine\)/, "the fixture lost its awkward command name");
  const expected = RECORDED_BTIME_SECONDS * 1000 + (801000 / RECORDED_TICKS_PER_SECOND) * 1000;
  assert.equal(startTimeOfProcess(ODD_NAME, primitiveOver(io)), expected);
});

test("T011 — the start time of a process that is not in the tree is null", () => {
  const io = linuxIo();
  assert.equal(startTimeOfProcess(9999, primitiveOver(io)), null);
});

/* ------------------------------------------------------------------ *
 * 2, 3, 4. Boot identity, host name, pid namespace.
 * ------------------------------------------------------------------ */

test("T011 — the boot identity comes from the recorded tree", () => {
  assert.equal(bootIdentity(linuxIo()), RECORDED_BOOT_ID);
});

test("T011 — a boot identity that cannot be read is null and never a guess", () => {
  // A recorded platform that was given no files at all: nothing can be read.
  const io = recordedPlatformIo({ platform: "linux", procRoot: PROC_ROOT, uid: FIXTURE_UID });
  assert.equal(bootIdentity(io), null);
});

test("T011 — the host name is the seam's, and a failure is null", () => {
  assert.equal(hostNameOfTheMachine(linuxIo()), "recorded-host");
  const silent = recordedPlatformIo({ platform: "linux", procRoot: PROC_ROOT, hostName: null });
  assert.equal(hostNameOfTheMachine(silent), null);
});

test("T011 — the pid namespace is read, and two processes can be in different ones", () => {
  const io = linuxIo();
  assert.equal(pidNamespaceOf(ENGINE, io), RECORDED_NAMESPACE);
  assert.equal(pidNamespaceOf(ZOMBIE, io), RECORDED_NAMESPACE);
  // The stranger was recorded in another pid namespace, which is what makes a
  // probe `held-foreign` (F122-FR-013, row P3).
  assert.equal(pidNamespaceOf(STRANGER, io), "pid:[4026531999]");
  assert.notEqual(pidNamespaceOf(STRANGER, io), pidNamespaceOf(ENGINE, io));
  assert.equal(PID_NAMESPACE_LINK, "ns/pid");
});

test("T011 — macOS has no pid namespace, so the reading is null there", () => {
  const io = recordedPlatformIo({
    platform: "darwin",
    procRoot: PROC_ROOT,
    uid: FIXTURE_UID,
    files: PROC.files,
    links: PROC.links,
  });
  assert.equal(pidNamespaceOf(ENGINE, io), null);
});

/* ------------------------------------------------------------------ *
 * 5. The environment of a process of the same user.
 * ------------------------------------------------------------------ */

test("T011 — the environment of a process of the same user is read from the tree", () => {
  const io = linuxIo();
  const env = environmentOfAProcessOfTheSameUser(ENGINE, io);
  assert.notEqual(env, null);
  assert.equal((env as Record<string, string>)["SPECSTRIDE_RUN_TOKEN"], RECORDED_TOKEN);
  assert.equal((env as Record<string, string>)["HOME"], "/root");
});

test("T011 — an environment that cannot be read is null and never an error", () => {
  // D-8, "Open": on macOS the system may refuse it, and the fallback must not
  // be an exception that stops a search for survivors half way through.
  const io = linuxIo();
  assert.equal(environmentOfAProcessOfTheSameUser(9999, io), null);
});

/* ------------------------------------------------------------------ *
 * 6. The list of processes of the user, and the search for a token.
 * ------------------------------------------------------------------ */

test("T011 — the processes of the user are the numeric entries of the tree", () => {
  const io = linuxIo();
  const pids = processesOfTheUser(io).map((p: ProcessOfTheUser) => p.pid);
  assert.deepEqual(pids, [ENGINE, ODD_NAME, ZOMBIE, STRANGER]);
  // Each carries the ticks it was recorded with, which is what a Linux
  // identity check compares together with the boot identity (D-8).
  const engine = processesOfTheUser(io).find((p: ProcessOfTheUser) => p.pid === ENGINE);
  assert.equal(engine?.startTicks, ENGINE_START_TICKS);
  assert.equal(engine?.startTimeMs, ENGINE_START_MS);
});

test("T011 — the search for a run token finds the two processes that carry it", () => {
  const io = linuxIo();
  const found = findProcessesByRunToken(RECORDED_TOKEN, primitiveOver(io));
  assert.deepEqual([...found], [ENGINE, ODD_NAME]);
  // The stranger of the tree carries no token and is not reported, and the
  // answer is process ids: the environments the search read are not returned,
  // because an environment may hold a credential.
  assert.ok(!found.includes(STRANGER));
  for (const value of found) assert.equal(typeof value, "number");
});

test("T011 — a token nothing carries finds nothing, and an empty token finds nothing", () => {
  const io = linuxIo();
  assert.deepEqual([...findProcessesByRunToken("not-a-token", primitiveOver(io))], []);
  assert.deepEqual([...findProcessesByRunToken("", primitiveOver(io))], []);
});

/* ------------------------------------------------------------------ *
 * 7. Whether a recorded process lives — the three readings of
 *    F122-FR-042.
 * ------------------------------------------------------------------ */

test("F122-FR-042 — a process the asker may not signal is ALIVE", () => {
  const io = linuxIo({ [ENGINE]: "permission-refused" });
  const liveness = recordedProcessLives({ pid: ENGINE }, io, primitiveOver(io));
  assert.equal(liveness.alive, true, "a process we may not signal must read as alive");
  assert.equal(liveness.reason, "permission-refused");
});

test("F122-FR-042 — a process that exited and was not collected is NOT alive", () => {
  // The recorded zombie answers a signal of zero as `permitted`, exactly as a
  // real one does. That is why the state is read FIRST: were it read second,
  // every uncollected child would look alive until its parent waited for it.
  const io = linuxIo({ [ZOMBIE]: "permitted" });
  assert.equal(hasExitedWithoutBeingCollected(ZOMBIE, io), true);
  assert.equal(ZOMBIE_STATE, "Z");
  const liveness = recordedProcessLives({ pid: ZOMBIE }, io, primitiveOver(io));
  assert.equal(liveness.alive, false, "an uncollected process must read as not alive");
  assert.equal(liveness.reason, "exited-not-collected");
  // And the live engine is not a zombie, so the check is not answering `true`
  // to everything.
  assert.equal(hasExitedWithoutBeingCollected(ENGINE, io), false);
});

test("F122-FR-042 — where a reuse of the process id cannot be told, the answer is ALIVE", () => {
  const io = linuxIo();
  // (a) The entry recorded no start time at all.
  const noRecord = recordedProcessLives({ pid: ENGINE }, io, primitiveOver(io));
  assert.equal(noRecord.alive, true);
  assert.equal(noRecord.reason, "pid-reuse-cannot-be-told");

  // (b) The entry has one, but the platform will not give the live reading.
  const blind: ProcessPrimitive = { ...primitiveOver(io), startTimeOf: () => null };
  const cannotRead = recordedProcessLives({ pid: ENGINE, startTimeMs: ENGINE_START_MS }, io, blind);
  assert.equal(cannotRead.alive, true);
  assert.equal(cannotRead.reason, "pid-reuse-cannot-be-told");
});

test("F122-FR-042 — a matching start time is alive, and a differing one is a reused id", () => {
  const io = linuxIo();
  const matches = recordedProcessLives(
    { pid: ENGINE, startTimeMs: ENGINE_START_MS },
    io,
    primitiveOver(io),
  );
  assert.equal(matches.alive, true);
  assert.equal(matches.reason, "identity-matches");
  assert.equal(matches.observedStartTimeMs, ENGINE_START_MS);

  // Inside the margin is still the same process: the boot time is recorded in
  // seconds, so two readers that rounded differently must still agree.
  const rounded = recordedProcessLives(
    { pid: ENGINE, startTimeMs: ENGINE_START_MS - START_TIME_TOLERANCE_MS },
    io,
    primitiveOver(io),
  );
  assert.equal(rounded.alive, true);
  assert.equal(rounded.reason, "identity-matches");

  // Past the margin the platform CAN tell, and it says this is another process.
  const reused = recordedProcessLives(
    { pid: ENGINE, startTimeMs: ENGINE_START_MS - 60_000 },
    io,
    primitiveOver(io),
  );
  assert.equal(reused.alive, false);
  assert.equal(reused.reason, "pid-reused");
});

test("F122-FR-042 — a process that is gone is not alive", () => {
  const io = linuxIo({ [ENGINE]: "gone" });
  const liveness = recordedProcessLives({ pid: ENGINE }, io, primitiveOver(io));
  assert.equal(liveness.alive, false);
  assert.equal(liveness.reason, "gone");
});

test("F122-FR-042 — the answer may refuse a claim of completion and never make one", () => {
  // The last sentence of the requirement, carried in the type: `alive` is the
  // conservative reading, so it can refuse "this run is complete" and can
  // never establish it.
  const io = linuxIo();
  for (const recorded of [{ pid: ENGINE }, { pid: ZOMBIE }, { pid: 9999 }, { pid: 0 }]) {
    const liveness = recordedProcessLives(recorded, io, primitiveOver(io));
    assert.equal(liveness.mayRefuseAClaimOfCompletion, true);
    assert.equal(liveness.mayMakeAClaimOfCompletion, false);
    assert.ok(
      LIVENESS_REASONS.includes(liveness.reason),
      `${liveness.reason} is not one of the closed set of reasons`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * The macOS branch, against recorded `ps` output.
 * ------------------------------------------------------------------ */

type PsFixture = {
  readonly recordedOn: string;
  readonly verification: string;
  readonly reason: string;
  readonly uid: number;
  readonly ps: Record<string, string>;
  readonly expect: {
    readonly bootIdentity: string;
    /**
     * The LINE `ps` printed, not a number of milliseconds. `ps -o lstart=` on
     * macOS prints a local time with no zone in it, so the milliseconds it
     * parses to depend on the zone the test runs in. Recording the line and
     * parsing it in the test keeps the fixture hermetic and still proves what
     * is being claimed: that the reader takes ITS answer from that line.
     */
    readonly startTimeLineOf: Record<string, string>;
    readonly secondsBetween501And502: number;
    readonly processesOfTheUser: number[];
    readonly runToken: string;
    readonly carriers: number[];
    readonly zombie: number;
  };
};

function macosIo(fixture: PsFixture): PlatformIo {
  return recordedPlatformIo({
    platform: "darwin",
    procRoot: "/proc-does-not-exist-on-macos",
    uid: fixture.uid,
    hostName: "recorded-mac",
    ps: fixture.ps,
    signals: { 501: "permitted", 502: "permitted" },
  });
}

test("T011 — the macOS branch parses recorded `ps` output, and stays `unverified`", () => {
  const fixture = JSON.parse(readFileSync(PS_MACOS, "utf8")) as PsFixture;
  // The fixture says of itself that it is recorded and not measured. This is
  // the honest limit of the test: it proves the PARSING of `ps` output and
  // says nothing about macOS, which is why D-6 and D-8 keep every macOS value
  // `unverified`.
  assert.equal(fixture.verification, "unverified");
  assert.match(fixture.reason, /no macOS machine/);

  const io = macosIo(fixture);
  const primitive = primitiveOver(io);

  for (const [pid, line] of Object.entries(fixture.expect.startTimeLineOf)) {
    assert.equal(
      startTimeOfProcess(Number(pid), primitive),
      Date.parse(line),
      `the recorded start time of ${pid} was not taken from the line \`${line}\``,
    );
  }
  // A difference between two readings is free of the zone question, so it is
  // asserted outright: the two recorded processes started five seconds apart.
  const first = startTimeOfProcess(501, primitive) as number;
  const second = startTimeOfProcess(502, primitive) as number;
  assert.equal((second - first) / 1000, fixture.expect.secondsBetween501And502);

  // The state column is parsed too, so the macOS reading of F122-FR-042's
  // uncollected process works off `ps` and not off a process file system.
  assert.equal(hasExitedWithoutBeingCollected(fixture.expect.zombie, io), true);
  assert.equal(hasExitedWithoutBeingCollected(501, io), false);
  const zombie = recordedProcessLives({ pid: fixture.expect.zombie }, io, primitive);
  assert.equal(zombie.alive, false);
  assert.equal(zombie.reason, "exited-not-collected");
  assert.deepEqual(
    processesOfTheUser(io).map((p: ProcessOfTheUser) => p.pid),
    fixture.expect.processesOfTheUser,
  );
  assert.deepEqual(
    [...findProcessesByRunToken(fixture.expect.runToken, primitive)],
    fixture.expect.carriers,
  );
  // The host name is the seam's on either platform, and the pid namespace is
  // null on macOS because the platform has none.
  assert.equal(hostNameOfTheMachine(io), "recorded-mac");
  assert.equal(pidNamespaceOf(501, io), null);
  // The boot identity of macOS comes from `ps` of pid 1, `unverified` (D-6).
  assert.equal(bootIdentity(io), fixture.expect.bootIdentity);
});

/* ------------------------------------------------------------------ *
 * The live machine, so the fixtures are not the only witness.
 * ------------------------------------------------------------------ */

test("T011 — the readers agree with this live process about itself", (t) => {
  if (process.platform !== "linux") {
    t.skip(`${MACOS_VERIFICATION}: ${MACOS_UNVERIFIED_REASON}`);
    return;
  }
  const readers = createPlatformReaders();

  // The start time of this process is a real number, and it lies in the past.
  const startedAt = readers.startTimeOfProcess(process.pid);
  assert.notEqual(startedAt, null, "the live start time of this process could not be read");
  assert.ok((startedAt as number) > 0);
  assert.ok((startedAt as number) <= Date.now() + START_TIME_TOLERANCE_MS);

  // The boot identity and the host name are there, and the pid namespace has
  // the form the kernel gives it.
  assert.match(readers.bootIdentity() ?? "", /\S/);
  assert.equal(readers.hostName(), hostname());
  assert.match(readers.pidNamespaceOfThisProcess() ?? "", /^pid:\[\d+\]$/);

  // This process is in its own list, and it reads as alive by its own recorded
  // start time — the identity check of F122-FR-025 on the easiest possible case.
  assert.ok(readers.processesOfTheUser().some((p: ProcessOfTheUser) => p.pid === process.pid));
  const liveness = readers.recordedProcessLives({
    pid: process.pid,
    startTimeMs: startedAt as number,
  });
  assert.equal(liveness.alive, true);
  assert.equal(liveness.reason, "identity-matches");

  // And a process id that certainly does not exist is not alive.
  const absent = readers.recordedProcessLives({ pid: 0x7ffffff });
  assert.equal(absent.alive, false);
});
