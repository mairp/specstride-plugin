/**
 * A lock owner in a process of its own, for the tests of user story 2.
 *
 * Liveness rests on something the kernel releases when the owner dies
 * (F122-FR-014), so a test that wants to see a DEAD owner cannot use the test
 * process as the owner: the test process is alive, by definition. This helper
 * is the owner: a child that takes the lock, writes a ready record naming its
 * process id and its endpoint, and then sleeps until it is ended. Kill it
 * without warning and the kernel drops the endpoint, which is exactly the
 * case "the owner killed without warning" of the conformance suite.
 *
 * The child holds no clean-up handler of its own on purpose: the point is
 * that nothing of the product runs when it dies.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

/** The file this module is, so that the child can be started from it. */
export const LOCK_OWNER_ENTRY = fileURLToPath(import.meta.url);

/** The kind of the ready record the child writes. */
export const READY_KIND = "specstride.test.lock-owner/1" as const;

/** What the child reports once it has taken the lock, or failed to. */
export type LockOwnerReady = {
  readonly kind: typeof READY_KIND;
  readonly pid: number;
  readonly acquired: boolean;
  readonly endpoint: string | null;
  readonly detail: string;
  readonly runTokenHash: string;
};

/** A running owner. */
export type LockOwner = {
  readonly pid: number;
  readonly ready: LockOwnerReady;
  readonly child: ChildProcess;
  /** End it without warning; the kernel, not the child, drops the endpoint. */
  kill(): Promise<void>;
};

/** What the caller pins. */
export type SpawnLockOwnerOptions = {
  readonly controlRoot: string;
  readonly workspaceRealPath: string;
  readonly runtimeDirectory: string;
  readonly runId?: string;
  readonly launchId?: string;
  readonly launchNonce?: string;
  readonly readyTimeoutMs?: number;
};

/** Start an owner and wait until it has answered about the lock. */
export async function spawnLockOwner(options: SpawnLockOwnerOptions): Promise<LockOwner> {
  const readyPath = join(mkdtempSync(join(tmpdir(), "specstride-lock-owner-")), "ready.json");
  const child = spawn(
    process.execPath,
    [
      LOCK_OWNER_ENTRY,
      "--ready",
      readyPath,
      "--control-root",
      options.controlRoot,
      "--workspace",
      options.workspaceRealPath,
      "--runtime-directory",
      options.runtimeDirectory,
      "--run",
      options.runId ?? "run-owner",
      "--launch",
      options.launchId ?? "launch-owner",
      "--nonce",
      options.launchNonce ?? "nonce-owner",
    ],
    { stdio: ["ignore", "ignore", "ignore"], cwd: dirname(LOCK_OWNER_ENTRY) },
  );
  child.unref();
  const pid = child.pid;
  if (pid === undefined) throw new Error("the lock owner was not started: it has no process id");
  const ready = await waitForReady(readyPath, child, options.readyTimeoutMs ?? 15_000);
  let killed = false;
  return {
    pid: ready.pid,
    ready,
    child,
    async kill(): Promise<void> {
      if (killed) return;
      killed = true;
      // The owner is one process, never a group: a group signal from a test
      // is what reset this host five times (the owner's ruling of
      // 2026-10-02), and an owner is ended by its own process id only.
      if (!Number.isInteger(ready.pid) || ready.pid <= 1) {
        throw new Error(`refusing to signal the process id ${String(ready.pid)}`);
      }
      try {
        process.kill(ready.pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
      const deadline = Date.now() + 5_000;
      for (;;) {
        try {
          process.kill(ready.pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
        }
        if (Date.now() > deadline) throw new Error(`the lock owner ${ready.pid} would not die`);
        await new Promise((done) => setTimeout(done, 10));
      }
    },
  };
}

async function waitForReady(
  readyPath: string,
  child: ChildProcess,
  timeoutMs: number,
): Promise<LockOwnerReady> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  for (;;) {
    try {
      const record = JSON.parse(readFileSync(readyPath, "utf8")) as LockOwnerReady;
      if (record.kind === READY_KIND) return record;
      last = `unexpected record kind ${String(record.kind)}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `the lock owner ended before it was ready (exit ${String(child.exitCode)}, ` +
          `signal ${String(child.signalCode)}): ${last}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(`the lock owner did not become ready inside ${timeoutMs} ms: ${last}`);
    }
    await new Promise((done) => setTimeout(done, 10));
  }
}

/* ------------------------------------------------------------------ *
 * The child.
 * ------------------------------------------------------------------ */

async function runAsChild(argv: readonly string[]): Promise<void> {
  const { writeFileSync } = await import("node:fs");
  const { createDirectoryLock } = await import("../../src/lock/directory-lock.ts");
  const { buildOwnerRecord } = await import("../../src/lock/owner-record.ts");
  const { mintRunToken } = await import("../../src/procs/run-token.ts");
  const read = (name: string): string => {
    const at = argv.indexOf(`--${name}`);
    const value = at === -1 ? undefined : argv[at + 1];
    if (value === undefined) throw new Error(`the lock owner needs --${name}`);
    return value;
  };
  const readyPath = read("ready");
  const token = mintRunToken();
  const lock = createDirectoryLock({
    place: { controlRoot: read("control-root"), workspaceRealPath: read("workspace") },
    runtimeDirectory: read("runtime-directory"),
  });
  const owner = buildOwnerRecord({ launchId: read("launch"), runTokenHash: token.hash });
  const result = await lock.acquireHere(owner, {
    runId: read("run"),
    launchId: read("launch"),
    launchNonce: read("nonce"),
  });
  const ready: LockOwnerReady = {
    kind: READY_KIND,
    pid: process.pid,
    acquired: result.acquired,
    endpoint: result.acquired ? result.endpoint.path : null,
    detail: result.acquired ? "the lock was taken" : result.detail,
    runTokenHash: token.hash,
  };
  writeFileSync(readyPath, JSON.stringify(ready, null, 2) + "\n", { mode: 0o600 });
  // Stay alive, holding the endpoint, until something ends this process. The
  // timer is referenced on purpose: the endpoint itself is unreferenced, so
  // without it node would exit at once and the owner would never be alive.
  setInterval(() => {}, 60_000);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === LOCK_OWNER_ENTRY) {
  void runAsChild(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`lock-owner: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
