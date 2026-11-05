/**
 * T008 — end a process without warning.
 *
 * The crash tests of this feature (quickstart scenario 7) and the liveness
 * cases of EP-13 need a process that dies the way a crash kills one: with no
 * chance to clean up, no handler run, no record closed. That is `SIGKILL` and
 * never `SIGTERM` — a polite signal would let the victim tidy up, and a test
 * built on it would prove the wrong thing.
 *
 * The helper also waits: a process id is only free of its process once the
 * process has been collected, and a test that checks liveness straight after
 * the signal would race the kernel.
 */
import process from "node:process";

/** The signal that gives no warning. */
export const NO_WARNING_SIGNAL = "SIGKILL" as const;

/** True where a process of this user is still there to be signalled. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // `EPERM` means it lives and this user may not signal it (F122-FR-042).
    return code === "EPERM";
  }
}

/**
 * Throw unless `pid` names one process a test may end. A process id that is not
 * a positive integer above one is refused: `node`'s `kill` reads a zero or a
 * negative number as a *process group*, so a mistyped id would widen a kill of
 * one stub into a kill of a whole group.
 */
export function assertSignallableProcess(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 1) {
    throw new Error(
      `refusing to signal the process ${pid}: only a process above 1 may be ended without ` +
        `warning (a zero or negative id names a process group, not a process)`,
    );
  }
}

/** Send `SIGKILL` to one process. True where the signal was delivered. */
export function killWithoutWarning(pid: number): boolean {
  assertSignallableProcess(pid);
  try {
    process.kill(pid, NO_WARNING_SIGNAL);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

/**
 * The process groups a test may never signal: `0` is *this* process group (the
 * test runner itself), `1` is the group of the init process — and `kill(-1)` is
 * "every process this user may signal", which as root is the whole machine.
 * A group id that is not a positive integer above one is refused, loudly,
 * before any signal is sent.
 */
export const FORBIDDEN_PROCESS_GROUPS = Object.freeze([0, 1]);

/** Throw unless `pgid` names a process group a test is allowed to end. */
export function assertSignallableGroup(pgid: number): void {
  if (!Number.isInteger(pgid) || pgid <= 1 || FORBIDDEN_PROCESS_GROUPS.includes(pgid)) {
    throw new Error(
      `refusing to signal the process group ${pgid}: only a process group above 1 may be ` +
        `ended without warning (0 is this test runner's own group, 1 is init, and -1 is ` +
        `every process of this user)`,
    );
  }
}

/**
 * Send `SIGKILL` to a whole process group, by the negative process id of its
 * leader — how the root ends the processes of class `owned` when it goes down,
 * and how a crash test takes a tree out at once.
 *
 * Refuses the groups of `FORBIDDEN_PROCESS_GROUPS` and anything below them
 * before it signals: a mistyped group would otherwise take out the test runner
 * or, as `-1`, everything this user owns.
 */
export function killGroupWithoutWarning(pgid: number): boolean {
  assertSignallableGroup(pgid);
  try {
    process.kill(-pgid, NO_WARNING_SIGNAL);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

/** Wait until the process is gone, or throw when it is still there. */
export async function waitForGone(pid: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid)) {
    if (Date.now() > deadline) {
      throw new Error(`the process ${pid} was still there ${timeoutMs} ms after SIGKILL`);
    }
    await new Promise((done) => setTimeout(done, 10));
  }
}

/** Kill without warning and wait until the process is gone. The usual call. */
export async function killAndWait(pid: number, timeoutMs = 5_000): Promise<void> {
  killWithoutWarning(pid);
  await waitForGone(pid, timeoutMs);
}
