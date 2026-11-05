// T031 (F116-FR-003, IR-35) — the tree fingerprint with its scope, its
// exclusions and its metadata cache.
//
// Scope: the tracked files and the untracked non-ignored files of the working
// tree (from `git ls-files --cached --others --exclude-standard`). Ignored
// paths from which a command of the check manifest executes are OUT of the
// tree fingerprint and IN class A by the hash of their listing with metadata;
// the caller names them as `ignoredRoots` and they are recorded as
// exclusions. A file of the protected set inside the scope is ALWAYS hashed by
// content, whatever a metadata cache entry says (CT-116-3). Other files use a
// cache keyed by path, size and modification time (D-2).
import { execFile } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { contentHash, canonicalRecordHash } from "@specstride/kernel";

const execFileP = promisify(execFile);

/** A cache of content hashes keyed by path, size and modification time. */
export type MetadataCache = Record<string, string>;

/** The cache key of one file: path, size, modification time. */
export function metadataCacheKey(absolutePath: string, size: number, mtimeMs: number): string {
  return `${absolutePath}|${size}|${mtimeMs}`;
}

/** The tracked and the untracked non-ignored files of the tree, sorted. */
export async function listTreeFiles(root: string): Promise<string[]> {
  const { stdout } = await execFileP(
    "git",
    ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout
    .split("\0")
    .filter((p) => p.length > 0)
    .sort();
}

/** One entry of the metadata listing of an ignored path (F116-FR-003). */
export interface ListingEntry {
  name: string;
  kind: "file" | "directory" | "other";
  size: number;
  mode: number;
  mtimeMs: number;
  ctimeMs: number;
}

export interface IgnoredListing {
  path: string;
  listingHash: string;
  entries: ListingEntry[];
  contentHashed: { path: string; hash: string }[];
}

export interface TreeExclusions {
  ignored: string[];
  rule: string;
}

export interface TreeFingerprintResult {
  fingerprint: string;
  files: string[];
  hashes: Record<string, string>;
  exclusions: TreeExclusions;
  ignoredListings: IgnoredListing[];
}

/** Recursively list every entry under an ignored root, with metadata. */
export function listingEntries(root: string, relRoot: string): ListingEntry[] {
  const absRoot = join(root, relRoot);
  const out: ListingEntry[] = [];
  const walk = (abs: string) => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absEntry = join(abs, entry.name);
      let stat;
      try {
        stat = statSync(absEntry);
      } catch {
        continue;
      }
      out.push({
        name: relative(absRoot, absEntry),
        kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
        size: stat.size,
        mode: stat.mode,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs,
      });
      if (entry.isDirectory()) walk(absEntry);
    }
  };
  walk(absRoot);
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

/**
 * The fingerprint of one ignored path: the hash of the listing with metadata
 * (name, kind, size, mode, modification time, time of the last change of
 * status of every entry) plus, content-hashed, every pinned executable and
 * every file a class A pattern of a profile matches.
 */
export function listingFingerprint(
  root: string,
  relRoot: string,
  contentPaths: string[] = [],
): IgnoredListing {
  const entries = listingEntries(root, relRoot);
  const wanted = new Set(contentPaths.map((p) => join(relRoot, p)));
  const contentHashed: { path: string; hash: string }[] = [];
  for (const full of [...wanted].sort()) {
    try {
      contentHashed.push({
        path: full,
        hash: contentHash(readFileSync(join(root, full))),
      });
    } catch {
      // a listed file that vanished is simply not content-hashed
    }
  }
  return {
    path: relRoot,
    listingHash: canonicalRecordHash(entries),
    entries,
    contentHashed,
  };
}

export interface TreeFingerprintOptions {
  /** Paths of the protected set: always hashed by content (CT-116-3). */
  protectedPaths?: string[];
  /** Ignored paths from which commands execute: hashed by listing. */
  ignoredRoots?: string[];
  /** Per ignored root, the paths content-hashed inside it. */
  ignoredContentPaths?: Record<string, string[]>;
  /** A metadata cache of content hashes, keyed by {@link metadataCacheKey}. */
  cache?: MetadataCache;
}

/**
 * The tree fingerprint: a canonical hash over the sorted {path: content hash}
 * of every file in scope, plus the listing hash of every ignored root, plus
 * the recorded exclusions.
 */
export async function treeFingerprint(
  root: string,
  options: TreeFingerprintOptions = {},
): Promise<TreeFingerprintResult> {
  const protectedPaths = new Set(options.protectedPaths ?? []);
  const ignoredRoots = [...(options.ignoredRoots ?? [])];
  const files = (await listTreeFiles(root)).filter(
    (rel) =>
      !ignoredRoots.some((ig) => rel === ig || rel.startsWith(ig.endsWith("/") ? ig : `${ig}/`)),
  );
  const cache = options.cache;
  const hashes: Record<string, string> = {};
  for (const rel of files) {
    const abs = join(root, rel);
    const stat = statSync(abs);
    const key = metadataCacheKey(abs, stat.size, stat.mtimeMs);
    const cached = cache ? cache[key] : undefined;
    if (!protectedPaths.has(rel) && cached !== undefined) {
      hashes[rel] = cached; // metadata cache hit, not protected
      continue;
    }
    hashes[rel] = contentHash(readFileSync(abs)); // content, always for protected
  }
  const ignoredListings = (options.ignoredRoots ?? []).map((rel) =>
    listingFingerprint(root, rel, options.ignoredContentPaths?.[rel] ?? []),
  );
  const exclusions: TreeExclusions = {
    ignored: ignoredRoots.sort(),
    rule: "F116-FR-003: ignored paths from which a command executes are in class A by their listing",
  };
  const fingerprint = canonicalRecordHash({
    files: hashes,
    ignored: ignoredListings.map((l) => ({ path: l.path, listingHash: l.listingHash })),
    exclusions,
  });
  return { fingerprint, files, hashes, exclusions, ignoredListings };
}
