/**
 * T015 — the writability test and the owner-only check of the control root
 * (F122-FR-022, F122-FR-039; research D-13).
 *
 * Two questions about the directory the control plane lives in, asked before
 * anything is written into it:
 *
 *   1. **Can we write it?** *The CLI MUST test that it can write the control
 *      root before it writes a launch record, and the runtime root MUST test
 *      it before it takes the lock. Where either cannot write, the launch MUST
 *      be refused with a message that names the key of the control root*
 *      (F122-FR-039). D-13 says how: write and remove a probe file. Not a
 *      permission bit, not an `access` call — an actual write, because a read
 *      of the mode cannot see a full disk, a read-only mount or a sandbox that
 *      lets `access` through and refuses the write.
 *   2. **Can anyone else write it?** *The feature MUST refuse to use a control
 *      root that another user can write* (F122-FR-022). A control root another
 *      user can write is a control root in which another user can plant an
 *      approval record or an owner record, which is the whole trust of the
 *      product.
 *
 * **The key of the control root is `state.dir`** — F122-FR-039 and row 116 of
 * the `parity` profile both name it, and the message of a refusal has to carry
 * it, because the consumer's remedy is to set that key. It is a WIDENING key
 * (F122-FR-039, last sentence): nothing falls back by itself (D-13).
 *
 * Nothing here decides the exit code of a command. The two refusals are values
 * from the closed set `launch-refusals-of-122` (row 212), and the CLI maps
 * them: a launch exits 4 and a state command exits 3, as
 * `contracts/cli-state-commands.md` says. The doctor check of F122-FR-022 is
 * registered next door in `../doctor/control-root-checks.ts`.
 */
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Stats } from "node:fs";

/** The requirements this module carries, and the decision it carries out. */
export const CONTROL_ROOT_REQUIREMENTS = ["F122-FR-022", "F122-FR-039"] as const;
export const CONTROL_ROOT_DECISION = "D-13" as const;

/**
 * F122-FR-039 and row 116 of the `parity` profile — the key of the control
 * root. Every refusal names it, because setting it is the consumer's remedy.
 */
export const CONTROL_ROOT_KEY = "state.dir" as const;

/** Row 116 of annex X §X.7, which pins the key above. */
export const CONTROL_ROOT_PARITY_ROW = 116 as const;

/** F122-FR-039, last sentence — the key of the control root is a widening key. */
export const CONTROL_ROOT_KEY_IS_WIDENING = true as const;

/** D-13 — nothing falls back by itself; the consumer sets the key. */
export const FALLS_BACK_BY_ITSELF = false as const;

/**
 * F122-FR-022 — every directory and file this feature creates in the control
 * plane is readable and writable by its owner only. The advisory marker in the
 * workspace part is the one exception the requirement names.
 */
export const DIRECTORY_MODE = 0o700 as const;
export const FILE_MODE = 0o600 as const;

/** The bits that say another user may write: group write and other write. */
export const OTHER_WRITE_BITS = 0o022 as const;

/** The two refusals of the closed set `launch-refusals-of-122` (row 212). */
export const CONTROL_ROOT_NOT_WRITABLE = "control-root-not-writable" as const;
export const CONTROL_ROOT_UNSAFE = "control-root-unsafe" as const;

/** The refusals this module can produce. */
export const CONTROL_ROOT_REFUSALS = [CONTROL_ROOT_UNSAFE, CONTROL_ROOT_NOT_WRITABLE] as const;
export type ControlRootRefusal = (typeof CONTROL_ROOT_REFUSALS)[number];

/** The exit code of a launch refused for either reason (annex G §G.4). */
export const LAUNCH_EXIT_CODE = 4 as const;

/** The exit code of a state command refused for either reason (F122-FR-022). */
export const STATE_COMMAND_EXIT_CODE = 3 as const;

/** The prefix of the probe file D-13 writes and removes. */
export const PROBE_FILE_PREFIX = ".specstride-write-probe-" as const;

/** Who asked. Both are named by F122-FR-039; both run the same test. */
export const ASKERS = ["cli", "runtime-root"] as const;
export type Asker = (typeof ASKERS)[number];

/** When each asker runs the test (F122-FR-039). */
export const ASKER_RUNS_IT_BEFORE: Readonly<Record<Asker, string>> = Object.freeze({
  cli: "it writes a launch record",
  "runtime-root": "it takes the lock",
});

/* ------------------------------------------------------------------ *
 * What the two checks answer.
 * ------------------------------------------------------------------ */

/** What `checkControlRoot` found. */
export type ControlRootCheck = {
  /** The directory that was checked. */
  readonly path: string;
  /** True where the control root may be used. */
  readonly usable: boolean;
  /** The refusal, where it may not. */
  readonly refusal: ControlRootRefusal | null;
  /** The key a refusal names; always `state.dir`. */
  readonly key: typeof CONTROL_ROOT_KEY;
  /** The message, which names the key (F122-FR-039). */
  readonly message: string;
  /** What was observed, for a doctor finding. Redacted of nothing: it is a path and a mode. */
  readonly evidence: ControlRootEvidence;
};

/** What the two checks observed. */
export type ControlRootEvidence = {
  /** True where the directory exists. */
  readonly exists: boolean;
  /** The permission bits, where they could be read. */
  readonly mode: number | null;
  /** The permission bits as four octal digits, for a message. */
  readonly modeOctal: string | null;
  /** The user that owns the directory, where it could be read. */
  readonly owner: number | null;
  /** The user this process runs as, where the platform has one. */
  readonly asker: number | null;
  /** True where another user can write the directory (F122-FR-022). */
  readonly anotherUserCanWrite: boolean;
  /** True where the probe file of D-13 was written and removed. */
  readonly probeWritten: boolean;
  /** The error of the platform where the probe failed. */
  readonly probeError: string | null;
};

/* ------------------------------------------------------------------ *
 * The owner-only check (F122-FR-022).
 * ------------------------------------------------------------------ */

/**
 * F122-FR-022 — whether another user can write a directory.
 *
 * Two ways another user can: the permission bits grant write to the group or
 * to everyone, or the directory belongs to somebody else. The second matters
 * as much as the first: a directory owned by another user is a directory whose
 * mode that user can change at any moment, so reading the bits of it says
 * nothing about tomorrow.
 *
 * Root is not exempted and not special-cased. Root can write any directory, so
 * a check that asked "can root write this" would answer yes everywhere; the
 * question asked here is the useful one — whether a user OTHER than the owner
 * has write permission by the bits, or whether the owner is not us.
 */
export function anotherUserCanWrite(stats: Stats, asker: number | null): boolean {
  if ((stats.mode & OTHER_WRITE_BITS) !== 0) return true;
  if (asker !== null && stats.uid !== asker) return true;
  return false;
}

/** The permission bits of a mode as four octal digits, e.g. `0700`. */
export function modeOctalOf(mode: number): string {
  return `0${(mode & 0o7777).toString(8).padStart(3, "0")}`;
}

/* ------------------------------------------------------------------ *
 * The writability test (F122-FR-039, D-13).
 * ------------------------------------------------------------------ */

/**
 * D-13 — write and remove a probe file. The answer is whether the write
 * happened, and the error of the platform where it did not.
 *
 * The probe file is named with the process id and a counter so that two
 * processes testing one control root at the same moment do not remove each
 * other's probe and conclude that the directory is unwritable.
 */
let probeCounter = 0;

export function probeWritability(path: string): { written: boolean; error: string | null } {
  probeCounter += 1;
  const probe = join(path, `${PROBE_FILE_PREFIX}${process.pid}-${probeCounter}`);
  try {
    writeFileSync(probe, "", { mode: FILE_MODE, flag: "wx" });
    return { written: true, error: null };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    return { written: false, error: err.code ?? err.message };
  } finally {
    try {
      rmSync(probe, { force: true });
    } catch {
      // The probe was never created, or it is already gone. Either way there
      // is nothing to clean up and nothing to report: the answer above stands.
    }
  }
}

/* ------------------------------------------------------------------ *
 * The two checks together.
 * ------------------------------------------------------------------ */

/**
 * F122-FR-022 and F122-FR-039 — check a control root before it is used.
 *
 * The order matters and is not an accident: the **owner-only check comes
 * first**. A control root another user can write is refused with
 * `control-root-unsafe` even though it IS writable, because the writability
 * test would otherwise pass and the launch would go on to use a directory in
 * which a stranger can plant an owner record. The unsafe answer is the
 * stronger one, so it is asked first.
 *
 * A directory that does not exist is not yet a refusal: `createControlRoot`
 * makes it owner-only, and `check` is then asked again. A directory that
 * cannot be created is `control-root-not-writable`, because that is what the
 * consumer has to fix and the key is what they fix it with.
 */
export function checkControlRoot(path: string, asker: Asker = "cli"): ControlRootCheck {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;

  let stats: Stats | null = null;
  try {
    stats = statSync(path);
  } catch {
    stats = null;
  }

  if (stats === null) {
    // It does not exist. Only the write decides: a directory we can create is
    // a directory we can use, and we create it owner-only.
    const made = tryCreate(path);
    if (!made.created) {
      return refusal(path, CONTROL_ROOT_NOT_WRITABLE, asker, {
        exists: false,
        mode: null,
        modeOctal: null,
        owner: null,
        asker: uid,
        anotherUserCanWrite: false,
        probeWritten: false,
        probeError: made.error,
      });
    }
    return checkControlRoot(path, asker);
  }

  if (!stats.isDirectory()) {
    return refusal(path, CONTROL_ROOT_NOT_WRITABLE, asker, {
      exists: true,
      mode: stats.mode,
      modeOctal: modeOctalOf(stats.mode),
      owner: stats.uid,
      asker: uid,
      anotherUserCanWrite: false,
      probeWritten: false,
      probeError: "ENOTDIR",
    });
  }

  const shared = anotherUserCanWrite(stats, uid);
  const evidenceSoFar = {
    exists: true,
    mode: stats.mode,
    modeOctal: modeOctalOf(stats.mode),
    owner: stats.uid,
    asker: uid,
    anotherUserCanWrite: shared,
  };

  // The unsafe answer is the stronger one, so it is asked first: an unsafe
  // control root is writable, and the writability test would pass.
  if (shared) {
    return refusal(path, CONTROL_ROOT_UNSAFE, asker, {
      ...evidenceSoFar,
      probeWritten: false,
      probeError: null,
    });
  }

  const probe = probeWritability(path);
  if (!probe.written) {
    return refusal(path, CONTROL_ROOT_NOT_WRITABLE, asker, {
      ...evidenceSoFar,
      probeWritten: false,
      probeError: probe.error,
    });
  }

  return Object.freeze({
    path,
    usable: true,
    refusal: null,
    key: CONTROL_ROOT_KEY,
    message:
      `the control root \`${path}\` is writable by this process and by no other user ` +
      `(the key \`${CONTROL_ROOT_KEY}\` names it)`,
    evidence: Object.freeze({ ...evidenceSoFar, probeWritten: true, probeError: null }),
  });
}

/** Create the control root, owner-only (F122-FR-022). */
export function createControlRoot(path: string): void {
  mkdirSync(path, { recursive: true, mode: DIRECTORY_MODE });
}

function tryCreate(path: string): { created: boolean; error: string | null } {
  try {
    createControlRoot(path);
    return { created: true, error: null };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    return { created: false, error: err.code ?? err.message };
  }
}

/** Build a refusal, with the message that names the key (F122-FR-039). */
function refusal(
  path: string,
  which: ControlRootRefusal,
  asker: Asker,
  evidence: ControlRootEvidence,
): ControlRootCheck {
  return Object.freeze({
    path,
    usable: false,
    refusal: which,
    key: CONTROL_ROOT_KEY,
    message: messageOf(which, path, asker, evidence),
    evidence: Object.freeze(evidence),
  });
}

/**
 * The message of a refusal. It names the key of the control root, which
 * F122-FR-039 requires of the not-writable refusal and which is just as much
 * the remedy for the unsafe one.
 */
export function messageOf(
  which: ControlRootRefusal,
  path: string,
  asker: Asker,
  evidence: ControlRootEvidence,
): string {
  const before = ASKER_RUNS_IT_BEFORE[asker];
  if (which === CONTROL_ROOT_UNSAFE) {
    const why =
      evidence.owner !== null && evidence.asker !== null && evidence.owner !== evidence.asker
        ? `it belongs to the user ${evidence.owner} and this process runs as ${evidence.asker}, ` +
          `so that user can change its permissions at any time`
        : `its permissions are ${evidence.modeOctal ?? "unknown"}, which grant write to another ` +
          `user`;
    return (
      `${CONTROL_ROOT_UNSAFE}: the control root \`${path}\` can be written by another user — ` +
      `${why}. Another user who can write the control root can plant an approval record or an ` +
      `owner record in it. Set the key \`${CONTROL_ROOT_KEY}\` to a directory that only you ` +
      `can write (F122-FR-022)`
    );
  }
  return (
    `${CONTROL_ROOT_NOT_WRITABLE}: the control root \`${path}\` cannot be written by this ` +
    `process${evidence.probeError === null ? "" : ` (${evidence.probeError})`}, and the ` +
    `${asker === "cli" ? "CLI" : "runtime root"} tests it before ${before}. Set the key ` +
    `\`${CONTROL_ROOT_KEY}\` to a directory you can write (F122-FR-039)`
  );
}

/**
 * The exit code of a refusal, by the command that was refused. A launch exits
 * 4; a state command exits 3 (F122-FR-022; `contracts/cli-state-commands.md`).
 */
export function exitCodeOf(command: "launch" | "state"): number {
  return command === "launch" ? LAUNCH_EXIT_CODE : STATE_COMMAND_EXIT_CODE;
}
