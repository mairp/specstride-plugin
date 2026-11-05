// T032 (F116-FR-001, F116-FR-002, F116-FR-003; IR-38) — the protected set:
// classes A and B, patterns evaluated at every comparison, listings of
// ignored paths.
//
// Class A is a set of PATH PATTERNS (versioned data per toolchain, from the
// `classA` field of `specstride.toolchain/1`), evaluated at every comparison —
// never the list of files found at phase entry. Class B is the list of test
// files that exist at phase entry, with content hashes.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { contentHash, canonicalRecordHash } from "@specstride/kernel";
import { listingFingerprint } from "../fingerprint/tree.ts";

/** A toolchain profile: `specstride.toolchain/1` (EP-16, F116-FR-013). */
export interface ToolchainProfile {
  schema: "specstride.toolchain/1";
  id: string;
  version: string;
  detect: Record<string, unknown>;
  classA: string[];
  testFiles?: string[];
  caches?: { path: string; disableEnv?: Record<string, string> }[];
  userConfig?: string[];
  suppressionMarkers?: string[];
  executables?: string[];
  effectiveConfig?: string[] | null;
  workerSeeds?: string[];
  workerEnv?: Record<string, string>;
  [unknown: string]: unknown; // an unknown field is ignored with a finding
}

/** Convert one glob pattern to a regular expression (`**`, `*`, `?`). */
export function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        i += 1;
        source += ".*";
      } else {
        source += "[^/]*";
      }
    } else if (c === "?") {
      source += "[^/]";
    } else {
      source += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

/** Evaluate the class A patterns against one path, at comparison time. */
export function matchClassA(patterns: string[], path: string): boolean {
  return patterns.some((p) => globToRegExp(p).test(path));
}

/** The union of the class A patterns of the profiles, in profile order. */
export function classAPatternsOf(profiles: ToolchainProfile[]): string[] {
  const seen = new Set<string>();
  for (const profile of profiles) for (const p of profile.classA) seen.add(p);
  return [...seen];
}

function listUnder(root: string, dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string) => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absEntry = join(abs, entry.name);
      const relEntry = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(absEntry, relEntry);
      else if (entry.isFile()) out.push(relEntry);
    }
  };
  walk(join(root, dir), dir === "." || dir === "" ? "" : dir.replace(/\/+$/, ""));
  return out;
}

/** Files of the working tree, best effort (a caller may pass its own list). */
export function listAllFiles(root: string): string[] {
  return listUnder(root, ".");
}

/**
 * Class B: the test files that exist at phase entry, with content hashes.
 * The list is frozen at phase entry; the PATTERNS decide what counts.
 */
export async function classBFiles(
  root: string,
  profiles: ToolchainProfile[],
  files?: string[],
): Promise<{ path: string; hash: string }[]> {
  const patterns = profiles.flatMap((p) => p.testFiles ?? []);
  const candidates = files ?? listAllFiles(root);
  const out: { path: string; hash: string }[] = [];
  for (const rel of candidates.sort()) {
    if (patterns.some((p) => globToRegExp(p).test(rel))) {
      out.push({ path: rel, hash: contentHash(readFileSync(join(root, rel))) });
    }
  }
  return out;
}

/**
 * One ignored path of class A: covered by the hash of its listing with
 * metadata; the pinned executables and the files a class A pattern of a
 * profile matches inside it are hashed by content (F116-FR-003, CQ-197).
 */
export function ignoredPathOfClassA(
  root: string,
  relRoot: string,
  profiles: ToolchainProfile[],
  pinnedExecutables: string[] = [],
): ReturnType<typeof listingFingerprint> {
  const patterns = classAPatternsOf(profiles);
  const entries = listingFingerprint(root, relRoot, []);
  const contentPaths = entries.entries
    .filter((e) => e.kind === "file")
    .map((e) => e.name)
    .filter((name) => matchClassA(patterns, name) || pinnedExecutables.includes(name));
  return listingFingerprint(root, relRoot, contentPaths);
}

/** The fingerprint of the protected set itself (class data, not per-file). */
export function setFingerprint(set: {
  patterns: string[];
  classB: { path: string; hash: string }[];
  ignoredListings: { path: string; listingHash: string }[];
}): string {
  return canonicalRecordHash({
    classA: set.patterns,
    classB: set.classB,
    ignoredListings: set.ignoredListings,
  });
}
