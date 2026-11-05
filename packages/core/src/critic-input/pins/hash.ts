// Feature 117 (T083) — the backing hash of the verdict pins (F117-FR-031).
//
// A pin is bound to a content hash of the source files the pinned criteria
// are about (the priority files of the grounding pass). On the next attempt
// the hash is computed again over the SAME paths; the stored pins are
// honoured only while the hash is equal. ANY change to a backing file changes
// the hash and drops every pin, so a pin can never mask a regression: changed
// code is always re-judged from scratch.
//
// The hash is the baseline's (`verdict_pins.backing_hash` at the pinned
// commit): over the sorted, de-duplicated paths, the digest of each file —
// the SHA-256 of its bytes, lower-case hexadecimal — or the literal
// `MISSING` when the file cannot be read (so deleting a backing file also
// invalidates), hashed once more as the lines `path=digest`, each terminated
// by a NUL byte. The order of the paths therefore does not matter. The parity
// test `PT-117-C-066-pins` compares this hash with the baseline's over the
// same tree, byte for byte.
//
// The file digests come from the ONE hasher of the product
// (`@specstride/kernel/hasher`, F100-FR-207, the canonical hasher of annex
// X §X.5): no hash is computed here. This module reads NO file itself: the
// bytes come in through the file-reading port of `../ports.ts`, or as
// prebuilt entries from a caller that already holds them.
import { contentHash } from "@specstride/kernel/hasher";
import type { FileReadingPort } from "../ports.ts";

/** The digest an unreadable backing path contributes (the baseline's `MISSING`). */
export const MISSING_BACKING_DIGEST = "MISSING" as const;

/**
 * One entry of the backing hash: the path AS CITED (the key the entries are
 * sorted and de-duplicated by, so the hash is independent of how the path is
 * spelled relative to the workspace) and the digest of its bytes.
 */
export type BackingEntry = {
  readonly path: string;
  readonly digest: string;
};

/**
 * The upper bound of one backing read. A backing file larger than this is
 * hashed from its first bytes, which still invalidates the pin set whenever
 * the head of the file changes; the grounding pass never cites such a file
 * as a priority path.
 */
export const BACKING_READ_LIMIT = 64 * 1024 * 1024;

/** The entry one file contributes: the content hash of its bytes, or `MISSING`. */
export function backingEntry(path: string, content: Uint8Array | undefined): BackingEntry {
  return { path, digest: contentOf(content) };
}

/** The digest of file bytes, or the literal `MISSING` for an unreadable file. */
function contentOf(content: Uint8Array | undefined): string {
  return content === undefined ? MISSING_BACKING_DIGEST : contentHash(content);
}

/**
 * The backing hash over the entries. De-duplicated by path and sorted, order
 * independent, over the lines `path=digest` each terminated by a NUL byte —
 * the baseline's construction, byte for byte.
 */
export function backingHash(entries: readonly BackingEntry[]): string {
  const byPath = new Map<string, string>();
  for (const entry of entries) byPath.set(entry.path, entry.digest);
  const text = [...byPath.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) // sorted by the cited path
    .map(([path, digest]) => `${path}=${digest}\0`)
    .join("");
  return contentHash(text);
}

/**
 * The entries for the paths, read through the file-reading port. A path
 * relative to the workspace root is joined onto `workdir`; an absolute path
 * stands as it is. A path the port cannot read contributes `MISSING`, never
 * an error.
 */
export function readBackingEntries(
  reader: FileReadingPort,
  paths: readonly string[],
  workdir: string,
): BackingEntry[] {
  const entries: BackingEntry[] = [];
  for (const path of new Set(paths)) {
    if (path === "") continue;
    const full = path.startsWith("/") ? path : `${workdir}/${path}`;
    entries.push({ path, digest: contentOf(reader.read(full, 0, BACKING_READ_LIMIT)) });
  }
  return entries;
}

/**
 * The backing hash of the paths, read through the file-reading port. This is
 * the one entry point the pin block uses (`../pins/block.ts`).
 */
export function backingHashOfPaths(
  reader: FileReadingPort,
  paths: readonly string[],
  workdir: string,
): string {
  return backingHash(readBackingEntries(reader, paths, workdir));
}
