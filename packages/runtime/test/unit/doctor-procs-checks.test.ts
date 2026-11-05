/**
 * T058 — the doctor check that reports survivors, and the checks that probe
 * the platform tools `ps` and, on macOS, `sysctl` (F122-FR-027; plan.md,
 * "Primary Dependencies"; EP-14, annex G §G.7).
 *
 * What is asserted, and why each matters:
 *
 *   - the checks REGISTER, under ids that are check ids and not configuration
 *     keys (a hyphen in the middle segment, §K.2 rule 1 — the finding
 *     CT-110-109 raised against the first lock ids);
 *   - the survivor check reports and ends NOTHING: a live survivor is still
 *     there after the probe has run, read from the process table;
 *   - it is not launch-blocking, and the reason is structural: the launch
 *     checks are exactly the `lb` subset (EP-14), and a check that refused
 *     the launch that would clear the survivor would deadlock the product;
 *   - the platform checks answer per platform, with the macOS form
 *     launch-blocking and the Linux form not, and the sysctl probe asks
 *     through `bootIdentity`, which is the only thing the feature uses it
 *     for — so the doctor cannot pass where the product fails.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import process from "node:process";
import {
  type DoctorCheck,
  type DoctorRegistry,
  launchChecks,
  MESSAGE_TEMPLATE_CAP_BYTES,
} from "@specstride/contracts/ep/doctor";
import {
  PROCS_PLACE_PROBE_KEY,
  readTheSurvivors,
  registerSurvivorChecks,
  survivorCheck,
  survivorEvidence,
  survivorSeverity,
  SURVIVOR_CHECK_ID,
  SURVIVOR_CHECK_BLOCKS_A_LAUNCH,
} from "../../src/doctor/survivor-checks.ts";
import {
  PLATFORM_IO_PROBE_KEY,
  PS_CHECK_ID,
  SYSCTL_CHECK_ID,
  platformChecksFor,
  probePs,
  probeSysctl,
  registerPlatformChecks,
  toolEvidence,
  toolSeverity,
} from "../../src/doctor/platform-checks.ts";
import { openEntry, type ProcsPlace } from "../../src/procs/registry.ts";
import { recordedPlatformIo } from "../../src/procs/platform.ts";
import { startTimeOfProcess } from "../../src/procs/platform.ts";
import { mintRunToken, RUN_TOKEN_VAR } from "../../src/procs/run-token.ts";
import { makeScratchControlRoot } from "../helpers/scratch-control-root.ts";
import { spawnStubProcess } from "../helpers/stub-process.ts";

/** A registry that records what was registered, and nothing else. */
function recordingRegistry(): DoctorRegistry & { readonly seen: DoctorCheck[] } {
  const seen: DoctorCheck[] = [];
  return {
    seen,
    register: (check: DoctorCheck) => {
      seen.push(check);
    },
    registered: () => seen,
    run: () => Promise.resolve([]),
  };
}

function stillRunning(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0] !== "Z";
  } catch {
    return false;
  }
}

test("T058: the survivor check registers under a check id and never blocks a launch", () => {
  const registry = recordingRegistry();
  const registered = registerSurvivorChecks(registry);
  assert.deepEqual(
    registry.seen.map((one) => one.id),
    [SURVIVOR_CHECK_ID],
  );
  assert.equal(SURVIVOR_CHECK_ID, "runtime.process-survivors.found");
  // A hyphen in a segment makes a dotted literal a check id and never a key.
  assert.ok(SURVIVOR_CHECK_ID.split(".").some((segment) => segment.includes("-")));
  assert.equal(survivorCheck.lb, SURVIVOR_CHECK_BLOCKS_A_LAUNCH);
  assert.equal(survivorCheck.lb, false);
  assert.deepEqual([...launchChecks(registered)], []);
  assert.ok(Buffer.byteLength(survivorCheck.messageTemplate, "utf8") <= MESSAGE_TEMPLATE_CAP_BYTES);
});

test("T058: the survivor check reports a live survivor and ends nothing", async () => {
  const root = makeScratchControlRoot("doctor-survivors");
  const place: ProcsPlace = Object.freeze({
    controlRoot: root.path,
    featureSlug: "122-detached-runtime",
    runId: "run-doctor",
  });
  const token = mintRunToken();
  const stub = await spawnStubProcess({
    env: { [RUN_TOKEN_VAR]: token.secret() },
    detached: true,
    ttlMs: 20_000,
  });
  try {
    openEntry(place, "engine", {
      procId: "p-pass",
      kind: "harness-pass",
      pid: stub.pid,
      processGroup: stub.pid,
      processSession: stub.pid,
      startTimeMs: startTimeOfProcess(stub.pid) ?? 0,
      runTokenHash: token.hash,
      engineStartId: "es-1",
    });

    const observed = await survivorCheck.probe({ [PROCS_PLACE_PROBE_KEY]: place });
    assert.equal(survivorSeverity(observed), "warn");
    const evidence = survivorEvidence(observed);
    assert.match(evidence, new RegExp(`pid=${stub.pid}`));
    assert.match(evidence, /harness-pass/);
    assert.equal(stillRunning(stub.pid), true, "the check ended nothing");

    // With no run given, the check says so and is a warning, never `ok`.
    const nothing = await readTheSurvivors({});
    assert.equal(survivorSeverity(nothing), "warn");
    assert.equal(survivorEvidence(nothing), "no run was given to the check");
  } finally {
    await stub.kill();
    root.dispose();
  }
});

test("T058: an adoptable survivor is information, not a warning", async () => {
  const root = makeScratchControlRoot("doctor-adoptable");
  const place: ProcsPlace = Object.freeze({
    controlRoot: root.path,
    featureSlug: "122-detached-runtime",
    runId: "run-doctor-2",
  });
  const token = mintRunToken();
  const stub = await spawnStubProcess({
    env: { [RUN_TOKEN_VAR]: token.secret() },
    detached: true,
    ttlMs: 20_000,
  });
  try {
    openEntry(place, "engine", {
      procId: "p-job",
      kind: "detached-job",
      pid: stub.pid,
      processGroup: stub.pid,
      processSession: stub.pid,
      startTimeMs: startTimeOfProcess(stub.pid) ?? 0,
      runTokenHash: token.hash,
      engineStartId: "es-1",
      jobId: "job-1",
    });
    const observed = await survivorCheck.probe({ [PROCS_PLACE_PROBE_KEY]: place });
    assert.equal(survivorSeverity(observed), "info");
    assert.match(survivorEvidence(observed), /adoptable=1 toBeEnded=0/);
    assert.equal(stillRunning(stub.pid), true);
  } finally {
    await stub.kill();
    root.dispose();
  }
});

test("T058: the checks of the platform tools, per platform", async () => {
  const darwin = platformChecksFor("darwin");
  const linux = platformChecksFor("linux");
  assert.deepEqual(
    darwin.map((one) => one.id),
    [PS_CHECK_ID, SYSCTL_CHECK_ID],
  );
  assert.deepEqual(
    linux.map((one) => one.id),
    [PS_CHECK_ID, SYSCTL_CHECK_ID],
  );
  assert.deepEqual(
    darwin.map((one) => one.lb),
    [true, true],
    "both are launch-blocking on macOS",
  );
  assert.deepEqual(
    linux.map((one) => one.lb),
    [false, false],
    "neither is on Linux",
  );
  for (const one of [...darwin, ...linux]) {
    assert.ok(one.id.split(".").some((segment) => segment.includes("-")));
    assert.ok(Buffer.byteLength(one.messageTemplate, "utf8") <= MESSAGE_TEMPLATE_CAP_BYTES);
  }

  const registry = recordingRegistry();
  registerPlatformChecks(registry, "linux");
  assert.deepEqual(
    registry.seen.map((one) => one.id),
    [PS_CHECK_ID, SYSCTL_CHECK_ID],
  );
  assert.deepEqual([...launchChecks(registry.seen)], [], "no launch check on Linux");

  const onDarwin = recordingRegistry();
  registerPlatformChecks(onDarwin, "darwin");
  assert.deepEqual(
    launchChecks(onDarwin.seen).map((one) => one.id),
    [PS_CHECK_ID, SYSCTL_CHECK_ID],
    "both refuse a launch on macOS",
  );
});

test("T058: `ps` is probed against the live platform and against a recorded one", async () => {
  // The live machine: `ps` is on the search path here, so it answers.
  const live = await probePs({});
  assert.equal(live.tool, "ps");
  assert.equal(live.platform, process.platform);
  assert.equal(live.answered, true, "`ps` answered on this host");
  assert.equal(toolSeverity(live), "ok");
  assert.match(toolEvidence(live), /tool=ps/);

  // A macOS platform on which `ps` is missing: needed, and so a failure.
  const missingOnDarwin = await probePs({
    [PLATFORM_IO_PROBE_KEY]: recordedPlatformIo({ platform: "darwin", procRoot: "/proc" }),
  });
  assert.equal(missingOnDarwin.answered, false);
  assert.equal(missingOnDarwin.needed, true);
  assert.equal(toolSeverity(missingOnDarwin), "fail");

  // The same absence on Linux is information: the process file system answers.
  const missingOnLinux = await probePs({
    [PLATFORM_IO_PROBE_KEY]: recordedPlatformIo({ platform: "linux", procRoot: "/proc" }),
  });
  assert.equal(missingOnLinux.needed, false);
  assert.equal(toolSeverity(missingOnLinux), "info");
});

test("T058: `sysctl` is probed through the boot identity, the one use the feature has", async () => {
  // A recorded macOS platform whose `sysctl` answers the boot time.
  const answering = await probeSysctl({
    [PLATFORM_IO_PROBE_KEY]: recordedPlatformIo({
      platform: "darwin",
      procRoot: "/proc",
      ps: { "-n kern.boottime": "{ sec = 1700000000, usec = 0 }" },
    }),
  });
  // The reading goes through `bootIdentity`, so whatever it answers is what
  // the product would see; the check never asks `sysctl` its own way.
  assert.equal(answering.tool, "sysctl");
  assert.equal(answering.platform, "darwin");
  assert.equal(answering.needed, true);

  const silent = await probeSysctl({
    [PLATFORM_IO_PROBE_KEY]: recordedPlatformIo({ platform: "darwin", procRoot: "/proc" }),
  });
  assert.equal(silent.answered, false);
  assert.equal(toolSeverity(silent), "fail");

  const onLinux = await probeSysctl({
    [PLATFORM_IO_PROBE_KEY]: recordedPlatformIo({ platform: "linux", procRoot: "/proc" }),
  });
  assert.equal(onLinux.needed, false);
  assert.equal(toolSeverity(onLinux), "info");
});
