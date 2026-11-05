/**
 * T075 — signalling a process group (F100-FR-234).
 *
 * The primitive signals a group polite, terminate, kill: an interrupt before a
 * termination (the polite stop of F100-FR-134 is "an interrupt before a
 * termination"), then a termination, then the signal that cannot be handled.
 *
 * HOST SAFETY (owner ruling of 2026-10-02). `process.kill` of the platform
 * reads a group id as a *negative* process id, and `kill(-1)` as root means
 * every process on the machine. Five host resets on 2026-10-02 came from
 * exactly that. So the group id is checked before any signal leaves this
 * module: only an integer above one is a group this primitive will signal, and
 * the refusal is an error, never a silent no-op. There is no option, no
 * environment variable and no flag that switches the check off.
 */
import type { GroupSignal } from "@specstride/contracts/ep/kernel-services";

/** The three signals a group may be sent, from polite to final (F100-FR-234). */
export const GROUP_SIGNALS = ["polite", "terminate", "kill"] as const;

/** What each of the three means on the platform. */
export const SIGNAL_OF_A_GROUP_SIGNAL: Readonly<Record<GroupSignal, NodeJS.Signals>> =
  Object.freeze({
    polite: "SIGINT",
    terminate: "SIGTERM",
    kill: "SIGKILL",
  });

/** The signal name the platform is given for one of the three. */
export function signalNameOf(signal: GroupSignal): NodeJS.Signals {
  const name = SIGNAL_OF_A_GROUP_SIGNAL[signal];
  if (name === undefined) {
    throw new Error(
      `the group signal \`${String(signal)}\` is not one of ${GROUP_SIGNALS.join(", ")}`,
    );
  }
  return name;
}

/**
 * The group ids this primitive will never signal: `0` is the group of the
 * caller itself, `1` is the group of the init process, and a negative id read
 * as a group — `-1` above all — is every process the user may signal, which as
 * root is the machine.
 */
export const GROUP_IDS_NEVER_SIGNALLED = Object.freeze([0, 1, -1]);

/**
 * Throw unless `pgid` names a process group this primitive may signal. Only an
 * integer above one passes. A float, a NaN, a zero and every negative number
 * are refused before a signal leaves this process.
 */
export function assertSignallableGroup(pgid: number): void {
  if (!Number.isInteger(pgid) || pgid <= 1) {
    throw new Error(
      `refusing to signal the process group ${String(pgid)}: only a process group above 1 may ` +
        `be signalled (0 is the caller's own group, 1 is init, and -1 is every process of ` +
        `this user, which as root is the machine)`,
    );
  }
}

/** Throw unless `pid` names one process this primitive may read or signal. */
export function assertSignallableProcess(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 1) {
    throw new Error(
      `refusing to signal the process ${String(pid)}: only a process above 1 may be signalled ` +
        `(a zero or negative id names a process group, not a process)`,
    );
  }
}

/**
 * F100-FR-234 — signal a process group: polite, terminate, kill. The group is
 * one the runtime created; `assertSignallableGroup` refuses anything that
 * could widen the signal beyond it.
 *
 * A group that is already gone is not an error: the caller asked for it to end
 * and it has ended. Every other failure of the platform is thrown.
 */
export function signalGroup(pgid: number, signal: GroupSignal): void {
  assertSignallableGroup(pgid);
  const name = signalNameOf(signal);
  try {
    process.kill(-pgid, name);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return;
    throw error;
  }
}
