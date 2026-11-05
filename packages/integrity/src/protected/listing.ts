// T074 (F116-FR-003; IR-35, CQ-197) — the listing of an ignored path of
// class A and the content hashes inside it.
//
// An ignored path from which a command of the check manifest executes is in
// class A by the hash of its listing with metadata. The listing holds, per
// entry, the name, the kind, the size, the mode, the modification time and
// the time of the last change of status, so that a change of content that
// restores size and modification time still changes the listing. Inside such
// a path, content is hashed of every pinned executable (F116-FR-009) and of
// every file that a class A pattern of a toolchain profile matches (IR-38);
// every other file there is covered by the listing alone.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contentHash, canonicalRecordHash } from "@specstride/kernel";
import { listingEntries, type IgnoredListing, type ListingEntry } from "../fingerprint/tree.ts";
import { matchClassA } from "./set.ts";

export interface ListIgnoredPathOptions {
  /** The class A patterns of the toolchain profiles in use. */
  patterns: string[];
  /** The pinned executables of the profiles, by their path inside the tree. */
  pinnedExecutables?: string[];
}

/**
 * One ignored path of class A: its metadata listing (hashed over name, kind,
 * size, mode, modification time and the time of the last change of status of
 * every entry) and the content hashes of the pinned executables and of the
 * files its class A patterns match (F116-FR-003).
 */
export function listIgnoredPath(
  root: string,
  relRoot: string,
  options: ListIgnoredPathOptions,
): IgnoredListing {
  const entries: ListingEntry[] = listingEntries(root, relRoot);
  const pinned = new Set(options.pinnedExecutables ?? []);
  const contentHashed: { path: string; hash: string }[] = [];
  for (const entry of entries) {
    if (entry.kind !== "file") continue;
    const inside = entry.name; // relative to the ignored path
    const fromRoot = relRoot === "" ? inside : `${relRoot}/${inside}`;
    const matched =
      matchClassA(options.patterns, inside) ||
      matchClassA(options.patterns, fromRoot) ||
      pinned.has(inside) ||
      pinned.has(fromRoot);
    if (!matched) continue;
    try {
      contentHashed.push({
        path: fromRoot,
        hash: contentHash(readFileSync(join(root, fromRoot))),
      });
    } catch {
      // a listed file that vanished is simply not content-hashed
    }
  }
  return {
    path: relRoot,
    listingHash: hashOfListing(entries),
    entries,
    contentHashed,
  };
}

/** The canonical hash over the metadata of every entry of the listing. */
export function hashOfListing(entries: ListingEntry[]): string {
  return canonicalRecordHash(
    entries.map((e) => ({
      name: e.name,
      kind: e.kind,
      size: e.size,
      mode: e.mode,
      mtimeMs: e.mtimeMs,
      ctimeMs: e.ctimeMs,
    })),
  );
}

/**
 * Whether the record of the protected set must name this ignored path as
 * covered by a listing (F116-FR-003): yes, always, when it is one of the
 * ignored paths from which a command executes.
 */
export function isCoveredByListing(_relRoot: string): boolean {
  return true;
}
