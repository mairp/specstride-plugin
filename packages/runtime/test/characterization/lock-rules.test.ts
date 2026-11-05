/**
 * T027 — the characterization tests of the rules of the lock: CT-122-16,
 * CT-122-19, CT-122-20 and CT-122-21 (F122-FR-016, F122-FR-019, F122-FR-020,
 * F122-FR-021).
 *
 * Every case here reads its answer from the FILE SYSTEM or from a second,
 * independent reading, and never from the value the operation returned. A
 * reclaim that says it refused and left the lock standing is two claims, and
 * only the second one matters.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RESTING_STATES } from "@specstride/contracts/state/run-state";
import {
  SHIPPED_PROVIDER_ID,
  SHIPPED_PROVIDER_VERSION,
  STATES_THAT_KEEP_THE_LOCK,
  STATES_THAT_RELEASE_THE_LOCK,
  createDirectoryLock,
  lockIsHeldInState,
} from "../../src/lock/directory-lock.ts";
import { buildOwnerRecord } from "../../src/lock/owner-record.ts";
import { lockPathsOf, LOCK_LOGICAL_NAME } from "../../src/lock/paths.ts";
import { ACQUIRED_AT_FIELD, probeLock } from "../../src/lock/probe.ts";
import { MAX_ENDPOINT_PATH_BYTES, endpointPlaceOf } from "../../src/lock/liveness.ts";
import {
  PROVIDER_MISMATCH,
  providerIsTheRecordedOne,
  readWorkspaceRecordOf,
  recordTheProvider,
  workspaceIdentityOf,
} from "../../src/lock/workspace-record.ts";
import { startRun } from "../../src/root/start.ts";
import {
  LOCK_CHECKS,
  LOCK_ENDPOINT_CHECK_ID,
  LOCK_PROVIDER_CHECK_ID,
  endpointEvidence,
  endpointSeverity,
  holderEvidence,
  probeTheLock,
  providerEvidence,
  providerSeverity,
} from "../../src/doctor/lock-checks.ts";
import { mintRunToken } from "../../src/procs/run-token.ts";
import { spawnLockOwner } from "../helpers/lock-owner.ts";

/** One hermetic workspace: an empty control root, a tree, a runtime directory. */
type Scratch = {
  readonly place: { controlRoot: string; workspaceRealPath: string };
  readonly runtimeDirectory: string;
  dispose(): void;
};

function scratch(label: string): Scratch {
  const controlRoot = mkdtempSync(join(tmpdir(), `ss-${label}-c-`));
  const workspaceRealPath = mkdtempSync(join(tmpdir(), `ss-${label}-w-`));
  const runtimeDirectory = mkdtempSync(join(tmpdir(), `ss-${label}-r-`));
  return {
    place: { controlRoot, workspaceRealPath },
    runtimeDirectory,
    dispose(): void {
      for (const path of [controlRoot, workspaceRealPath, runtimeDirectory]) {
        rmSync(path, { recursive: true, force: true });
      }
    },
  };
}

function ownerOf(launchId = "launch-1"): ReturnType<typeof buildOwnerRecord> {
  return buildOwnerRecord({ launchId, runTokenHash: mintRunToken().hash });
}

const input = (runId: string): { runId: string; launchId: string; launchNonce: string } => ({
  runId,
  launchId: "launch-1",
  launchNonce: "nonce-1",
});

/* ================================================================== *
 * CT-122-16 — a foreign or unknown lock is never reclaimed, and the
 * refusal names the holder (F122-FR-016).
 * ================================================================== */

test("CT-122-16: a `held-foreign` lock is never reclaimed, and nothing removes it", async () => {
  const s = scratch("ct16-foreign");
  try {
    const lock = createDirectoryLock({ place: s.place, runtimeDirectory: s.runtimeDirectory });
    const paths = lockPathsOf(s.place);
    // A lock whose owner record was made on another host. Nothing of this
    // machine can tell whether its pid means anything, which is the whole
    // point of `held-foreign`.
    plantLock(paths, { ...ownerOf("launch-elsewhere"), hostName: "another-host" });
    const before = readFileSync(paths.ownerRecordFile, "utf8");

    assert.equal((await probeLock(s.place)).result, "held-foreign");
    const refused = await lock.reclaimHere(ownerOf(), input("r-1"));
    assert.equal(refused.reclaimed, false);
    assert.equal(refused.reclaimed === false ? refused.reason : "", "foreign-owner");

    // The two readings that matter, and neither is the return value: the lock
    // is still there, byte for byte.
    assert.equal(existsSync(paths.lockDirectory), true);
    assert.equal(readFileSync(paths.ownerRecordFile, "utf8"), before);
    assert.equal((await probeLock(s.place)).result, "held-foreign");
  } finally {
    s.dispose();
  }
});

test("CT-122-16: the refusal names the lock, the host, the launch and the time", async () => {
  const s = scratch("ct16-names");
  try {
    const lock = createDirectoryLock({ place: s.place, runtimeDirectory: s.runtimeDirectory });
    const paths = lockPathsOf(s.place);
    const planted = {
      ...ownerOf("launch-7"),
      hostName: "another-host",
      [ACQUIRED_AT_FIELD]: "2026-10-02T11:22:33.000Z",
    };
    plantLock(paths, planted);
    const refused = await lock.reclaimHere(ownerOf(), input("r-1"));
    assert.equal(refused.reclaimed, false);
    const detail = refused.reclaimed === false ? refused.detail : "";
    // F122-FR-016 — the logical name of the lock, the host name, the launch
    // and the time of the owner record. All four, in the refusal itself.
    assert.match(detail, new RegExp(LOCK_LOGICAL_NAME));
    assert.match(detail, /another-host/);
    assert.match(detail, /launch-7/);
    assert.match(detail, /2026-10-02T11:22:33\.000Z/);

    // And the doctor finding says the same four things (F122-FR-016).
    const reading = await probeTheLock({ lockPlace: s.place });
    const evidence = holderEvidence(reading);
    for (const part of [
      LOCK_LOGICAL_NAME,
      "another-host",
      "launch-7",
      "2026-10-02T11:22:33.000Z",
    ]) {
      assert.ok(evidence.includes(part), `the doctor finding names ${part}: ${evidence}`);
    }
  } finally {
    s.dispose();
  }
});

test("CT-122-16: an `unknown` lock is never reclaimed either", async () => {
  const s = scratch("ct16-unknown");
  try {
    const lock = createDirectoryLock({ place: s.place, runtimeDirectory: s.runtimeDirectory });
    const paths = lockPathsOf(s.place);
    // An owner record that lacks a required field of §B.9 reads as `unknown`,
    // and `unknown` counts as held.
    mkdirSync(paths.lockDirectory, { recursive: true, mode: 0o700 });
    writeFileSync(paths.ownerRecordFile, JSON.stringify({ schema: "specstride.lease/1:owner" }));
    assert.equal((await probeLock(s.place)).result, "unknown");

    const refused = await lock.reclaimHere(ownerOf(), input("r-1"));
    assert.equal(refused.reclaimed, false);
    assert.equal(refused.reclaimed === false ? refused.error : "", "unknown");
    assert.equal(existsSync(paths.lockDirectory), true);
    assert.equal((await probeLock(s.place)).result, "unknown");
  } finally {
    s.dispose();
  }
});

test("CT-122-16: nothing removes a lock whose owner lives", async () => {
  const s = scratch("ct16-live");
  try {
    const owner = await spawnLockOwner({
      controlRoot: s.place.controlRoot,
      workspaceRealPath: s.place.workspaceRealPath,
      runtimeDirectory: s.runtimeDirectory,
    });
    try {
      assert.equal(owner.ready.acquired, true);
      assert.equal((await probeLock(s.place)).result, "held-live");
      const lock = createDirectoryLock({ place: s.place, runtimeDirectory: s.runtimeDirectory });
      const refused = await lock.reclaimHere(ownerOf(), input("r-1"));
      assert.equal(refused.reclaimed, false);
      // Read it back: the live owner's lock is still there and still live.
      assert.equal(existsSync(lockPathsOf(s.place).lockDirectory), true);
      assert.equal((await probeLock(s.place)).result, "held-live");
    } finally {
      await owner.kill();
    }
  } finally {
    s.dispose();
  }
});

/* ================================================================== *
 * CT-122-19 — a different provider refuses (F122-FR-019).
 * ================================================================== */

test("CT-122-19: the provider is recorded at the first acquire", async () => {
  const s = scratch("ct19-record");
  try {
    assert.equal(readWorkspaceRecordOf(s.place).present, false);
    const started = await startRun({
      place: s.place,
      starter: "engine",
      startMode: "standalone",
      owner: ownerOf(),
      acquire: input("r-1"),
      provider: createDirectoryLock({ place: s.place, runtimeDirectory: s.runtimeDirectory }),
    });
    assert.equal(started.started, true);
    // Read the record back off the disk, not out of the return value.
    const record = readWorkspaceRecordOf(s.place);
    assert.equal(record.present, true);
    if (record.present) {
      assert.deepEqual(record.record.lockProvider, {
        id: SHIPPED_PROVIDER_ID,
        version: SHIPPED_PROVIDER_VERSION,
      });
      // F122-FR-019 — the identity comes from the REAL path of the workspace.
      assert.equal(record.record.workspaceId, workspaceIdentityOf(s.place.workspaceRealPath));
    }
  } finally {
    s.dispose();
  }
});

test("CT-122-19: a launch whose configured provider differs is refused, with a doctor finding", async () => {
  const s = scratch("ct19-refuse");
  try {
    const recorded = recordTheProvider(s.place, {
      id: SHIPPED_PROVIDER_ID,
      version: SHIPPED_PROVIDER_VERSION,
    });
    assert.equal(recorded.ok, true);
    const other = { id: "some-other-provider", version: "1" };
    assert.equal(providerIsTheRecordedOne(s.place, other), false);

    const refused = await startRun({
      place: s.place,
      starter: "engine",
      startMode: "standalone",
      owner: ownerOf(),
      acquire: input("r-2"),
      configuredProvider: other,
      provider: createDirectoryLock({ place: s.place, runtimeDirectory: s.runtimeDirectory }),
    });
    assert.equal(refused.started, false);
    if (!refused.started) {
      assert.equal(refused.refusal, PROVIDER_MISMATCH);
      assert.equal(refused.exit, 4);
      // Nothing of the run was written, and the lock was never taken.
      assert.equal(refused.wroteTheRun, false);
      assert.equal(existsSync(lockPathsOf(s.place).lockDirectory), false);
    }

    // The doctor refuses the same launch, and says why (F122-FR-019).
    const reading = await probeTheLock({ lockPlace: s.place, configuredLockProvider: other });
    assert.equal(providerSeverity(reading), "fail");
    assert.match(providerEvidence(reading), /some-other-provider/);
    assert.match(providerEvidence(reading), new RegExp(SHIPPED_PROVIDER_ID));
  } finally {
    s.dispose();
  }
});

test("CT-122-19: the doctor check of the provider is launch-blocking", () => {
  // EP-14 guarantees the launch checks are exactly the `lb` subset, so the
  // doctor and a launch cannot disagree about a provider that differs.
  const check = findCheck(LOCK_PROVIDER_CHECK_ID);
  assert.equal(check.lb, true);
});

/* ================================================================== *
 * CT-122-20 — after a release the probe says `free` and the marker is
 * gone, in every resting state (F122-FR-020).
 * ================================================================== */

test("CT-122-20: in every resting state the lock is released and the marker is gone", async () => {
  // The four resting states of annex E §E.2, read from the table and not
  // written out here, so a state added to the machine joins this test.
  assert.deepEqual([...STATES_THAT_RELEASE_THE_LOCK], [...RESTING_STATES]);
  assert.equal(RESTING_STATES.length, 4);

  for (const state of RESTING_STATES) {
    const s = scratch(`ct20-${state}`);
    try {
      const lock = createDirectoryLock({ place: s.place, runtimeDirectory: s.runtimeDirectory });
      const paths = lockPathsOf(s.place);
      const acquired = await lock.acquireHere(ownerOf(), input("r-1"));
      assert.equal(acquired.acquired, true, state);
      if (!acquired.acquired) continue;
      // The advisory marker, as the runtime root writes it while the run lives.
      mkdirSync(join(s.place.workspaceRealPath, ".specstride"), { recursive: true });
      writeFileSync(paths.advisoryMarkerFile, "owner\n");
      assert.equal(existsSync(paths.advisoryMarkerFile), true, state);
      assert.equal(lockIsHeldInState(state), false, `${state} releases the lock`);

      await lock.release(acquired.lease);

      // Both readings come off the disk.
      assert.equal((await probeLock(s.place)).result, "free", state);
      assert.equal(existsSync(paths.lockDirectory), false, state);
      assert.equal(existsSync(paths.advisoryMarkerFile), false, state);
      // B-0251, defect D-06 — the as-is fallback stayed behind because its
      // own owner file was still inside it. Nothing is left here.
      assert.equal(existsSync(paths.ownerRecordFile), false, state);
      // And the endpoint the kernel backed is gone with it.
      assert.equal(existsSync(acquired.endpoint.path), false, state);
    } finally {
      s.dispose();
    }
  }
});

test("CT-122-20: in `paused-quota`, `relaunching` and `stopping` the lock stays held", async () => {
  assert.deepEqual([...STATES_THAT_KEEP_THE_LOCK], ["paused-quota", "relaunching", "stopping"]);
  const s = scratch("ct20-held");
  try {
    const lock = createDirectoryLock({ place: s.place, runtimeDirectory: s.runtimeDirectory });
    const acquired = await lock.acquireHere(ownerOf(), input("r-1"));
    assert.equal(acquired.acquired, true);
    for (const state of STATES_THAT_KEEP_THE_LOCK) {
      assert.equal(lockIsHeldInState(state), true, state);
      // Nothing of this feature releases on those states: the lock is still
      // there and still live.
      assert.equal((await probeLock(s.place)).result, "held-live", state);
    }
    if (acquired.acquired) await lock.release(acquired.lease);
  } finally {
    s.dispose();
  }
});

/* ================================================================== *
 * CT-122-21 — an endpoint that cannot be created gives `unknown`
 * (F122-FR-021).
 * ================================================================== */

test("CT-122-21: an endpoint path over the guard gives `unknown`, and nothing is written", async () => {
  const s = scratch("ct21");
  try {
    // A per-user runtime directory so deep that the endpoint path passes the
    // guard. The guard is this provider's own: past the measured limit the
    // platform truncates the path IN SILENCE (T009), so a provider that let
    // it through would bind somewhere else and answer for another workspace.
    const deep = join(s.runtimeDirectory, "x".repeat(120));
    mkdirSync(deep, { recursive: true });
    const place = endpointPlaceOf(workspaceIdentityOf(s.place.workspaceRealPath), {
      runtimeDirectory: deep,
    });
    assert.equal(place.ok, false);
    if (!place.ok) {
      assert.equal(place.failure, "path-too-long");
      assert.ok(place.bytes > MAX_ENDPOINT_PATH_BYTES);
    }

    const lock = createDirectoryLock({ place: s.place, runtimeDirectory: deep });
    const result = await lock.acquireHere(ownerOf(), input("r-1"));
    assert.equal(result.acquired, false);
    if (!result.acquired) {
      // F122-FR-021 — `acquire` gives `unknown`, which counts as held.
      assert.equal(result.error, "unknown");
      assert.equal(result.endpointFailure, "path-too-long");
    }
    // No lock was left behind by the attempt.
    assert.equal(existsSync(lockPathsOf(s.place).lockDirectory), false);

    // F122-FR-021 — *the doctor MUST name the cause*.
    const reading = await probeTheLock({
      lockPlace: s.place,
      runtimeDirectory: deep,
    });
    assert.equal(endpointSeverity(reading), "fail");
    const evidence = endpointEvidence(reading);
    assert.match(evidence, /path-too-long/);
    assert.match(evidence, new RegExp(String(MAX_ENDPOINT_PATH_BYTES)));
    assert.equal(findCheck(LOCK_ENDPOINT_CHECK_ID).lb, true);
  } finally {
    s.dispose();
  }
});

test("CT-122-21: the start refuses with `lock-unknown` and pipeline code 24", async () => {
  const s = scratch("ct21-start");
  try {
    const deep = join(s.runtimeDirectory, "y".repeat(120));
    mkdirSync(deep, { recursive: true });
    const outcome = await startRun({
      place: s.place,
      starter: "runtime-root",
      startMode: "standalone",
      owner: ownerOf(),
      acquire: input("r-1"),
      provider: createDirectoryLock({ place: s.place, runtimeDirectory: deep }),
    });
    assert.equal(outcome.started, false);
    if (!outcome.started) {
      assert.equal(outcome.refusal, "lock-unknown");
      assert.equal(outcome.exit, 24);
      assert.equal(outcome.wroteTheRun, false);
    }
  } finally {
    s.dispose();
  }
});

/* ------------------------------------------------------------------ *
 * Helpers of this file.
 * ------------------------------------------------------------------ */

function plantLock(paths: ReturnType<typeof lockPathsOf>, owner: Record<string, unknown>): void {
  mkdirSync(paths.lockDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(paths.ownerRecordFile, JSON.stringify(owner, null, 2) + "\n", { mode: 0o600 });
}

function findCheck(id: string): { readonly lb: boolean } {
  const found = LOCK_CHECKS.find((c) => c.id === id);
  assert.notEqual(found, undefined, `the doctor registers \`${id}\``);
  return found as { readonly lb: boolean };
}
