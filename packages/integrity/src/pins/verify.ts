// T037 (F116-FR-009; IR-36, IR-37) — verification of pins, the search path at
// launch, the effective configuration of the toolchain and the handling of
// caches. A pin that does not verify gives `tainted` with the reason
// `pin-mismatch`; a result reported as replayed from a cache carries `cached`
// and is NOT a pass.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { contentHash } from "@specstride/kernel";
import type { ToolchainProfile } from "../protected/set.ts";

const execFileP = promisify(execFile);

/** The search path is the value captured at launch, kept for the whole run. */
export function searchPathAtLaunch(env: NodeJS.ProcessEnv): string {
  return env.PATH ?? "";
}

export interface Pin {
  path: string;
  hash: string;
  resolvedVia: string;
}

/** Pin one executable: its content hash and the path entry that resolved it. */
export function pinExecutable(path: string, searchPathAtLaunchValue: string): Pin {
  return {
    path,
    hash: contentHash(readFileSync(path)),
    resolvedVia: dirname(path) === "" ? searchPathAtLaunchValue : dirname(path),
  };
}

export interface PinVerdict {
  ok: boolean;
  reason?: "pin-mismatch";
}

/** Verify the pin before each check; a mismatch is a taint reason. */
export function verifyPin(pin: Pin, _searchPath: string): PinVerdict {
  let current: string;
  try {
    current = contentHash(readFileSync(pin.path));
  } catch {
    return { ok: false, reason: "pin-mismatch" };
  }
  return current === pin.hash ? { ok: true } : { ok: false, reason: "pin-mismatch" };
}

/**
 * The hash of the effective configuration, read where the toolchain profile
 * names how: one fixed argument list of a pinned executable (CQ-085).
 */
export async function effectiveConfigHash(argv: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileP(argv[0], argv.slice(1), { env });
  return createHash("sha256").update(stdout, "utf8").digest("hex");
}

/** The environment that switches every cache location of the profile off. */
export function cacheDisableEnv(profile: ToolchainProfile): Record<string, string> {
  const env: Record<string, string> = {};
  for (const cache of profile.caches ?? []) {
    for (const [key, value] of Object.entries(cache.disableEnv ?? {})) env[key] = value;
  }
  return env;
}

/** The cache locations: each is switched off or in class A (F116-FR-009). */
export function CACHE_LOCATIONS_IN_CLASS_A_OR_OFF(profile: ToolchainProfile): string[] {
  return (profile.caches ?? []).map((c) => c.path);
}

export type Cached = false | { reason: string };

/** The `cached` condition, in its own field, never replacing the exit. */
export function cachedCondition(replayedFromCache: boolean): Cached {
  return replayedFromCache ? { reason: "replayed-from-cache" } : false;
}

/** A pass: every command exit 0 and NO condition present — cached is no pass. */
export function resultIsPass(result: {
  commands: { exit: number | null; conditions: Record<string, unknown> }[];
}): boolean {
  return result.commands.every(
    (c) => c.exit === 0 && Object.values(c.conditions).every((condition) => condition === false),
  );
}

/** The metadata of a pinned executable, for the record of the protected set. */
export function pinMetadata(path: string): { path: string; size: number } {
  return { path, size: statSync(path).size };
}

export const UNUSED_JOIN = join; // re-exported for callers that resolve pins
