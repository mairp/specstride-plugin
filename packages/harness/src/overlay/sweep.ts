/**
 * T089 — sweep, reap, liveness and removal (F109-FR-035).
 *
 * `sweep` and `reap` look only at real directories in the real temporary
 * directory whose name marks them as overlays of the product, that belong to
 * the current user, and that hold a valid marker. `sweep` removes the
 * overlays whose owner no longer lives; `reap` removes the overlays of one
 * owner without a test of liveness, and may be limited to one scope. An
 * owner lives when its process exists, or exists and may not be signalled,
 * and the recorded start time is null, cannot be read, or equals the present
 * one. Removal tries each entry that fails once more after making it
 * writable, never raises, and unlinks a link without following it.
 */
import { readdirSync, lstatSync, chmodSync, rmSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { constants } from "node:fs/promises";

/** The name prefix that marks a directory as an overlay of the product. */
export const OVERLAY_TMP_PREFIX = "specstride-overlay-";

/** The marker contract an overlay tree carries. */
export const OVERLAY_MARKER_CONTRACT = "specstride-overlay/v1";

/** The name of the marker file inside an overlay tree. */
export const MARKER_FILE = "marker.json";

/** A parsed, valid marker. */
export type OverlayMarker = {
  readonly contract: string;
  readonly key: string;
  readonly scope: string;
  readonly vars: readonly string[];
  readonly ownerPid: number;
  readonly ownerStart: string | number | null;
  readonly createdAt: string | number;
};

/** True when `pid` names a process that exists (even one we may not signal). */
export function processExists(pid: number): boolean | "eperm" {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === "EPERM") return "eperm";
    return false;
  }
}

/** The start time of a process as the kernel records it, or null. */
export function processStart(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const after = stat.slice(stat.lastIndexOf(")") + 2);
    const field = after.split(" ")[19]; // starttime, 1-based field 22 overall
    const ticks = Number(field);
    if (!Number.isFinite(ticks)) return null;
    const startedAtMs = BOOT_TIME_MS + (ticks / CLOCK_TICKS_PER_SECOND) * 1000;
    return String(Math.floor(startedAtMs));
  } catch {
    return null;
  }
}

const CLOCK_TICKS_PER_SECOND = 100;
const BOOT_TIME_MS = (() => {
  try {
    const stat = readFileSync("/proc/stat", "utf8");
    const line = stat.split("\n").find((one) => one.startsWith("btime "));
    return Number(line?.slice("btime ".length).trim() ?? 0);
  } catch {
    return 0;
  }
})();

/**
 * F109-FR-035 — an owner lives when its process exists, or exists and may
 * not be signalled, and the recorded start time is null, cannot be read, or
 * equals the present one.
 */
export function lives(
  ownerPid: number,
  ownerStart: string | number | null,
  nowStart: string | number | null = null,
): boolean {
  const exists = processExists(ownerPid);
  if (exists === false) return false;
  if (ownerStart === null || ownerStart === "") return true;
  // A recorded start that cannot be read or interpreted cannot disprove
  // liveness: the owner lives.
  if (Number.isNaN(Number(ownerStart))) return true;
  if (nowStart === null) {
    const current = processStart(ownerPid);
    if (current === null) return true;
    nowStart = current;
  }
  return String(ownerStart) === String(nowStart);
}

/** Reads and validates the marker of a tree; null where it is not valid. */
export function readMarker(root: string): OverlayMarker | null {
  try {
    const raw = JSON.parse(readFileSync(join(root, MARKER_FILE), "utf8")) as OverlayMarker;
    if (raw.contract !== OVERLAY_MARKER_CONTRACT) return null;
    if (typeof raw.ownerPid !== "number") return null;
    if (typeof raw.scope !== "string") return null;
    if (!Array.isArray(raw.vars)) return null;
    return raw;
  } catch {
    return null;
  }
}

/** True when `root` is a directory this feature may look at (F109-FR-035). */
export function isOverlayTree(root: string): boolean {
  try {
    const stat = lstatSync(root);
    if (!stat.isDirectory()) return false; // real directories only: no link
    if (stat.uid !== process.getuid?.()) return false;
    return readMarker(root) !== null;
  } catch {
    return false;
  }
}

/** The overlay trees of the real temporary directory (F109-FR-035's look). */
export function overlayRoots(tmp: string = tmpdir()): string[] {
  let names: string[];
  try {
    names = readdirSync(tmp);
  } catch {
    return [];
  }
  const roots: string[] = [];
  for (const name of names) {
    if (!name.startsWith(OVERLAY_TMP_PREFIX)) continue;
    const root = join(tmp, name);
    if (isOverlayTree(root)) roots.push(root);
  }
  return roots.sort();
}

/**
 * F109-FR-035 — remove one tree. Each entry that fails is tried once more
 * after making it writable; a link is unlinked without following it; the
 * function never raises and returns the cause when the removal still fails.
 */
export function removeTree(root: string): { readonly removed: boolean; readonly cause?: string } {
  try {
    const stat = lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      // Unlink a link without following it.
      rmSync(root, { force: true });
      return { removed: true };
    }
  } catch (cause) {
    return { removed: false, cause: String((cause as NodeJS.ErrnoException).code ?? cause) };
  }
  for (const pass of [0, 1]) {
    try {
      if (pass === 1) chmodSync(root, 0o700); // one more try, writable
      rmSync(root, { recursive: true, force: false });
      return { removed: true };
    } catch (cause) {
      if (pass === 1) {
        return { removed: false, cause: String((cause as NodeJS.ErrnoException).code ?? cause) };
      }
    }
  }
  return { removed: false, cause: "unknown" };
}

/** The as-is line the sweep prints for every tree it removes. */
export function staleLine(root: string, pid: number): string {
  return `specstride: removed stale overlay ${root} (owner ${pid} gone)`;
}

/** The as-is warning for a removal that still fails (exactly one line). */
export function removalWarning(root: string, cause: string): string {
  return `specstride: warning: could not remove overlay ${root}: ${cause}`;
}

/** The result record of `sweep` or `reap` (F109-FR-034: always 0). */
export type SweepResult = {
  readonly operation: "sweep" | "reap";
  readonly exit_code: 0;
  readonly removed: readonly string[];
  readonly lines: readonly string[];
};

/**
 * F109-FR-035 — remove the overlays whose owner no longer lives. Every
 * removal prints the as-is stale line on standard error; a removal that
 * still fails prints exactly one warning line instead.
 */
export function sweep(
  options: {
    readonly tmpDir?: string;
    /** Injectable liveness test; defaults to the kernel test of `lives`. */
    readonly isLive?: (ownerPid: number, ownerStart: string | number | null) => boolean;
  } = {},
): SweepResult {
  const removed: string[] = [];
  const lines: string[] = [];
  for (const root of overlayRoots(options.tmpDir)) {
    const marker = readMarker(root);
    if (marker === null) continue;
    const alive = options.isLive
      ? options.isLive(marker.ownerPid, marker.ownerStart)
      : lives(marker.ownerPid, marker.ownerStart);
    if (alive) continue;
    const outcome = removeTree(root);
    if (outcome.removed) {
      removed.push(root);
      lines.push(staleLine(root, marker.ownerPid));
    } else {
      lines.push(removalWarning(root, outcome.cause ?? "unknown"));
    }
  }
  return { operation: "sweep", exit_code: 0, removed, lines };
}

/**
 * F109-FR-035 — remove the overlays of one owner without a test of liveness,
 * optionally limited to one scope. Always returns 0.
 */
export function reap(options: {
  readonly tmpDir?: string;
  readonly ownerPid: number;
  readonly scope?: string;
}): SweepResult {
  const removed: string[] = [];
  const lines: string[] = [];
  for (const root of overlayRoots(options.tmpDir)) {
    const marker = readMarker(root);
    if (marker === null) continue;
    if (marker.ownerPid !== options.ownerPid) continue;
    if (options.scope !== undefined && marker.scope !== options.scope) continue;
    const outcome = removeTree(root);
    if (outcome.removed) {
      removed.push(root);
    } else {
      lines.push(removalWarning(root, outcome.cause ?? "unknown"));
    }
  }
  return { operation: "reap", exit_code: 0, removed, lines };
}

/** Where the real path of a path stays inside a directory (seed refusal). */
export function staysInside(dir: string, candidate: string): boolean {
  try {
    const resolved = realpathSync(candidate);
    return resolved === dir || resolved.startsWith(dir.endsWith("/") ? dir : `${dir}/`);
  } catch {
    return false;
  }
}

export const DIRECTORY_PERMISSIONS = 0o700;
export const SEED_PERMISSIONS = 0o600;
export const ACCESS_OK = constants.F_OK;
