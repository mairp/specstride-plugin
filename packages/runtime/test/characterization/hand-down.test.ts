/**
 * T044 — CT-122-18: the hand-down of the lease (F122-FR-018; annex F §F.5;
 * annex E §E.2, F100-FR-147).
 *
 * The two sentences the task names:
 *
 *   - *an engine in start mode `child` takes NO LOCK.* Proved behaviourally, not
 *     by reading a constant: the lock of the workspace is taken by the root, the
 *     child engine is handed a token, and the lock directory is read back off
 *     the disk to show that it is still the ROOT's — one lock, one owner record,
 *     the root's own run token hash in it, and no second lock anywhere under the
 *     control root.
 *   - *`verify` fails after the root was killed.* The root here is a real
 *     process of its own, killed without warning, so nothing of the product runs
 *     when it dies. `verify` then answers "no" — and it answers "no" for the
 *     right reason, which the richer form reports.
 *
 * And the third sentence of F122-FR-018, which the task's title does not repeat
 * but the requirement does: *`verify` MUST answer "no" when the provider fails.*
 * A provider that THROWS is the case §F.5 calls "a provider that fails in
 * `verify`", and the answer is `false` and never an exception.
 *
 * HOST SAFETY. The only signal this file sends names ONE process id, through the
 * helper that refuses an id that is not an integer above one (the owner's ruling
 * of 2026-10-02). No group is signalled.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAILURE_PATHS } from "@specstride/contracts/ep/lock";
import type { Lease } from "@specstride/contracts/records/lease";
import {
  HAND_DOWN_REQUIREMENT,
  VERIFY_ANSWERS_WHEN_THE_PROVIDER_FAILS,
  WHEN_THE_OWNER_IS_LOST,
  engineTakesALock,
  handDown,
  verify,
  verifyWithReason,
  type LeaseProvider,
} from "../../src/lease/hand-down.ts";
import {
  createDirectoryLock,
  readHolder,
  readLease as readLeaseOfTheLock,
} from "../../src/lock/directory-lock.ts";
import { buildOwnerRecord } from "../../src/lock/owner-record.ts";
import { lockPathsOf } from "../../src/lock/paths.ts";
import { hashToken, mintRunToken } from "../../src/procs/run-token.ts";
import { spawnLockOwner } from "../helpers/lock-owner.ts";

type Scratch = {
  readonly place: { controlRoot: string; workspaceRealPath: string };
  readonly runtimeDirectory: string;
  dispose(): void;
};

function scratch(label: string): Scratch {
  const controlRoot = mkdtempSync(join(tmpdir(), `hd-${label}-c-`));
  const workspaceRealPath = mkdtempSync(join(tmpdir(), `hd-${label}-w-`));
  const runtimeDirectory = mkdtempSync(join(tmpdir(), `hd-${label}-r-`));
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

/** Every directory under a root whose name is the lock's. */
function locksUnder(root: string): readonly string[] {
  const found: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (!entry.isDirectory()) continue;
      if (existsSync(join(path, "owner.json"))) found.push(path);
      walk(path);
    }
  };
  walk(root);
  return Object.freeze(found.sort());
}

test("CT-122-18: an engine in start mode `child` takes no lock: the lock stays the root's, the child holds only a token, and there is exactly one lock under the control root (F122-FR-018)", async () => {
  const s = scratch("child");
  try {
    assert.equal(HAND_DOWN_REQUIREMENT, "F122-FR-018");
    // The two start modes, as the module answers about them.
    assert.equal(engineTakesALock("standalone"), true);
    assert.equal(engineTakesALock("child"), false, "an engine in start mode `child` takes no lock");

    // The ROOT takes the lock.
    const rootToken = mintRunToken();
    const provider = createDirectoryLock({
      place: s.place,
      runtimeDirectory: s.runtimeDirectory,
    });
    const acquired = await provider.acquireHere(
      buildOwnerRecord({ launchId: "launch-hd", runTokenHash: rootToken.hash }),
      { runId: "run-hd", launchId: "launch-hd", launchNonce: "nonce-hd" },
    );
    assert.equal(acquired.acquired, true);
    if (!acquired.acquired) return;

    // The ENGINE, in start mode `child`, is handed the lease down as a token.
    const handed = handDown(provider, acquired.lease);
    assert.equal(typeof handed.token, "string");
    assert.ok(handed.token.length > 0);
    assert.equal(handed.hash, hashToken(handed.token));
    assert.notEqual(handed.token, handed.hash, "the child gets the secret, not the hash");

    // The lease on disk holds ONLY the hash. Read back, not asserted of the
    // object the provider returned.
    const onDisk = readLeaseOfTheLock(lockPathsOf(s.place));
    assert.notEqual(onDisk, null);
    assert.equal(onDisk?.leaseTokenHash, handed.hash, "the lease records the hash");
    const text = readFileSync(lockPathsOf(s.place).leaseFile, "utf8");
    assert.equal(
      text.includes(handed.token),
      false,
      "the secret of the lease token is nowhere in the record (annex B, §B.8; F100-FR-052)",
    );

    // And the lock is still the ROOT's: one lock, the root's owner record.
    const holder = readHolder(lockPathsOf(s.place));
    assert.equal(
      holder?.runTokenHash,
      rootToken.hash,
      "the owner record of the lock is the root's and not the child's",
    );
    assert.deepEqual(
      locksUnder(s.place.controlRoot),
      [lockPathsOf(s.place).lockDirectory],
      "exactly one lock exists under the control root: the child took none",
    );

    // The token the child holds does verify while the root holds the lease.
    assert.equal(await verify(provider, handed.token), true);
    // And a token that is not the one handed down does not.
    assert.equal(await verify(provider, "not-the-token"), false);
    assert.equal(await verify(provider, ""), false);
    assert.equal(await verify(provider, null), false);

    await provider.release(acquired.lease);
  } finally {
    s.dispose();
  }
});

test("CT-122-18: `verify` fails after the root was killed, and says why (F122-FR-018, F100-FR-147)", async () => {
  const s = scratch("killed");
  let owner: Awaited<ReturnType<typeof spawnLockOwner>> | null = null;
  try {
    // A real root, in a process of its own, holding the lock and the lease.
    owner = await spawnLockOwner({
      controlRoot: s.place.controlRoot,
      workspaceRealPath: s.place.workspaceRealPath,
      runtimeDirectory: s.runtimeDirectory,
      runId: "run-hd-killed",
      launchId: "launch-hd-killed",
      launchNonce: "nonce-hd-killed",
    });
    assert.equal(owner.ready.acquired, true, "the root took the lock");

    // The engine's view of the same workspace: a provider of its own, which is
    // what an engine really has — it shares no object with the root.
    const engineSide = createDirectoryLock({
      place: s.place,
      runtimeDirectory: s.runtimeDirectory,
    });
    const leaseOnDisk = readLeaseOfTheLock(lockPathsOf(s.place)) as Lease;
    assert.notEqual(leaseOnDisk, null);
    // The token the root handed down. The hand-down is written into the lease,
    // so the engine's side can present it afterwards.
    const handed = handDown(engineSide, leaseOnDisk);
    assert.equal(await verify(engineSide, handed.token), true, "it verifies while the root lives");

    // The root is killed without warning: nothing of the product runs.
    await owner.kill();
    owner = null;

    // F122-FR-018 — `verify` answers "no". The lock directory is still there,
    // because a killed process releases nothing; the answer is "no" all the
    // same, and that is the point.
    assert.equal(
      existsSync(lockPathsOf(s.place).lockDirectory),
      true,
      "the killed root released nothing: the lock is still on disk",
    );
    // The engine's next boundary: the lock has been reclaimed by nobody yet, so
    // what fails is the identity of the owner, not the token.
    const reclaimed = await engineSide.reclaimHere(
      buildOwnerRecord({ launchId: "launch-hd-next", runTokenHash: mintRunToken().hash }),
      { runId: "run-hd-killed", launchId: "launch-hd-next", launchNonce: "nonce-hd-next" },
    );
    assert.equal(reclaimed.reclaimed, true, "the dead root's lock is reclaimable");
    assert.equal(
      await verify(engineSide, handed.token),
      false,
      "after the root was killed and its lock reclaimed, `verify` answers no",
    );
    const why = await verifyWithReason(engineSide, handed.token);
    assert.equal(why.holdsTheLease, false);
    assert.equal(why.reason, "the token does not match the lease");

    // F100-FR-147 — what the engine does then.
    assert.equal(WHEN_THE_OWNER_IS_LOST.terminalRecordCause, "owner-lost");
    assert.equal(WHEN_THE_OWNER_IS_LOST.exit, 6);
    assert.equal(WHEN_THE_OWNER_IS_LOST.runsAPhaseGate, false);
  } finally {
    if (owner !== null) await owner.kill();
    s.dispose();
  }
});

test("CT-122-18: `verify` answers no when the provider FAILS, and never throws (F122-FR-018, §F.5)", async () => {
  // §F.5 "Failure of an implementation": a provider that fails in `verify` makes
  // the engine treat the owner as lost. So a throw must become `false`.
  const throwing: LeaseProvider = {
    handDown: (): string => "token-from-a-provider-that-will-fail",
    verify: (): Promise<boolean> => {
      throw new Error("the provider could not read the lease");
    },
  };
  assert.equal(await verify(throwing, "token-from-a-provider-that-will-fail"), false);
  assert.equal(VERIFY_ANSWERS_WHEN_THE_PROVIDER_FAILS, false);
  const why = await verifyWithReason(throwing, "token-from-a-provider-that-will-fail");
  assert.equal(why.holdsTheLease, false);
  assert.equal(why.reason, "the provider failed");
  assert.match(String(why.providerFailure), /could not read the lease/);
  assert.equal(FAILURE_PATHS.verify, "the engine treats the owner as lost");

  // A provider whose promise REJECTS is the same case.
  const rejecting: LeaseProvider = {
    handDown: (): string => "t",
    verify: (): Promise<boolean> => Promise.reject(new Error("the socket is gone")),
  };
  assert.equal(await verify(rejecting, "t"), false);

  // And one that answers something that is not a truth value has not answered.
  const vague: LeaseProvider = {
    handDown: (): string => "t",
    verify: (): Promise<boolean> => Promise.resolve("yes" as unknown as boolean),
  };
  assert.equal(await verify(vague, "t"), false);
});

test("CT-122-18: `handDown` refuses a provider that returns the hash instead of the token (F122-FR-018)", () => {
  const hash = hashToken("some-secret");
  // A provider that hands back what the lease RECORDS: the hash, which every
  // reader of the run may read already.
  const wrong: LeaseProvider = {
    handDown: (): string => hash,
    verify: (): Promise<boolean> => Promise.resolve(true),
  };
  const leaseWithThatHash = { leaseTokenHash: hash } as unknown as Lease;
  assert.throws(
    () => handDown(wrong, leaseWithThatHash),
    /returned the HASH of the lease token/,
    "a lease holds only the hash, and the child needs the secret",
  );
  // And the same provider handing back a real secret is accepted.
  const right: LeaseProvider = {
    handDown: (): string => "some-secret",
    verify: (): Promise<boolean> => Promise.resolve(true),
  };
  assert.equal(handDown(right, leaseWithThatHash).hash, hash);
  const empty: LeaseProvider = {
    handDown: (): string => "",
    verify: (): Promise<boolean> => Promise.resolve(true),
  };
  assert.throws(() => handDown(empty, {} as Lease), /returned no token/);
});
