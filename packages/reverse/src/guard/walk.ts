/**
 * T023 of feature 108 — the RE-WALK the guard compares against the baseline
 * (F108-FR-027, F108-FR-032).
 *
 * The guard takes the source and the baseline inventory and "re-walks the
 * source with the baseline's exclusions plus the output directory, and
 * compares the size and content hash of every walked and skipped entry with
 * the baseline's" (F108-FR-027, origin B-1855). The walk of the INVENTORY
 * belongs to feature 140 and `@specstride/reverse` may not import it (layer
 * L6 may import contracts, kernel and spec-formats only), so the re-walk lives
 * here — and it is written to AGREE with the rules feature 140's specification
 * fixes, because a disagreement would show up as a false problem of the guard:
 *
 * | Rule | Where feature 140 fixes it |
 * |---|---|
 * | git mode only when the source is inside a work tree AND is its top level | F140-FR-017 (B-1916) |
 * | git mode lists `git ls-files -co --exclude-standard -z`, 300 s | F140-FR-017 (B-1921) |
 * | git mode drops a state-directory component, an excluded path, and a path git lists that the work tree lacks; the deny list does NOT apply | F140-FR-017 (B-1922, B-1931) |
 * | the file-system walk skips the deny list and the state names at any depth | F140-FR-018 (B-1911, B-1910) |
 * | the file-system walk honours only the ROOT `.gitignore`, as a glob subset | F140-FR-018 (B-1919, B-1920) |
 * | no link is ever followed; a linked directory is one entry, not entered | F140-FR-018 (B-1923) |
 * | an entry carries `bytes` and `sha256`; a link is sized and hashed BY ITS TARGET STRING | F140-FR-020 |
 * | exclusions are stripped of `/`, de-duplicated, sorted; one matches itself and everything under it | F140-FR-017 (B-1928) |
 * | candidate paths are sorted by code point | F140-FR-017 (B-1924) |
 * | the fingerprint is the SHA-256 of the compact JSON of the sorted triples | F140-FR-021 |
 *
 * What the re-walk does NOT do, because the guard does not compare it: the
 * language and the role of an entry (F140-FR-019), and the REASON an entry was
 * skipped. The guard compares `(bytes, sha256)` alone (B-1855), and a binary,
 * an oversize file and a link all carry those two in the inventory — so one
 * rule produces them here for every kind of entry, and no skip classification
 * is needed for the comparison or for the fingerprint to agree.
 *
 * F108-FR-032 — the tree is read as a CLAIM. Every path is `lstat`ed before it
 * is touched, a link is never followed (its target STRING is the datum), and a
 * regular file is opened with `O_NOFOLLOW` where the platform offers it, so a
 * link swapped in between the inventory and the guard cannot make the guard
 * read outside the source.
 */
import {
  closeSync,
  constants,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
} from "node:fs";
import { join } from "node:path";

import { contentHash } from "@specstride/kernel/hasher";

/* ------------------------------------------------------------------------- *
 * The names the walk never enters (F140-FR-017, F140-FR-018)
 * ------------------------------------------------------------------------- */

/**
 * The names of state the walk never enters: the workspace part, whose name is
 * `.specstride` (annex B, the root `<workspace-part>`), and the old tree
 * `.lisa`. The legacy state directory name of the as-is walk is not carried
 * (DV-036); these two stay.
 */
export const STATE_DIRECTORY_NAMES = Object.freeze([".specstride", ".lisa"] as const);

/**
 * The directories the FILE-SYSTEM walk skips at any depth (F140-FR-018,
 * B-1911). In git mode this list does NOT apply (F140-FR-017, B-1922).
 */
export const DENY_DIRECTORIES = Object.freeze([
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  "dist",
  "build",
  "target",
  "vendor",
  "testautomation",
] as const);

/** The directory the walk never enters and the guard compares on its own. */
export const TESTAUTOMATION_DIRECTORY = "testautomation" as const;

/** The one ignore file the file-system walk reads (F140-FR-018, B-1919). */
export const ROOT_IGNORE_FILE = ".gitignore" as const;

/** The size of a read of the content, in bytes (F140-FR-019, B-1915). */
export const READ_CHUNK_BYTES = 64 * 1024;

/* ------------------------------------------------------------------------- *
 * Exclusions (F140-FR-017, B-1928)
 * ------------------------------------------------------------------------- */

/**
 * The exclusions of the re-walk, normalised: leading and trailing `/`
 * stripped, de-duplicated, sorted by code point.
 */
export function guardExcludes(
  baselineExcludes: readonly string[],
  outRelativeToTheSource: string | undefined,
): readonly string[] {
  const seen = new Set<string>();
  for (const raw of [...baselineExcludes, outRelativeToTheSource ?? ""]) {
    const trimmed = raw.replace(/^\/+/, "").replace(/\/+$/, "");
    if (trimmed !== "") seen.add(trimmed);
  }
  return Object.freeze([...seen].sort(byCodePoint));
}

/** The order of every list of this module: by code point, never by locale. */
export function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** An exclusion matches ITSELF and everything under it (F140-FR-017). */
export function isUnderAnExclusion(relative: string, excludes: readonly string[]): boolean {
  return excludes.some((exclude) => relative === exclude || relative.startsWith(`${exclude}/`));
}

/** True where any directory component of a path is a name of state. */
export function hasAStateDirectoryComponent(relative: string): boolean {
  const names: readonly string[] = STATE_DIRECTORY_NAMES;
  return relative
    .split("/")
    .slice(0, -1)
    .some((part) => names.includes(part));
}

/* ------------------------------------------------------------------------- *
 * The root `.gitignore`, as the glob subset of F140-FR-018 (B-1919, B-1920)
 * ------------------------------------------------------------------------- */

/** One rule of the root `.gitignore`, compiled. */
export type IgnoreRule = {
  /** `!pattern` — the rule UN-ignores what it matches. */
  readonly negate: boolean;
  /** A trailing `/` — the rule matches a directory only. */
  readonly directoryOnly: boolean;
  /** The pattern held a `/` — it is anchored to the source-relative path. */
  readonly anchored: boolean;
  /** The pattern as a regular expression over one path or one base name. */
  readonly test: RegExp;
  /** The line the rule was read from, for a message. */
  readonly pattern: string;
};

/**
 * The glob subset: `*` matches anything but `/`, `?` one character but `/`,
 * `[...]` a class, everything else is literal. `**\/` is REMOVED from the
 * pattern and a trailing `/**` is read as `/*` before the translation
 * (F140-FR-018, B-1919).
 */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i] as string;
    if (ch === "*") source += "[^/]*";
    else if (ch === "?") source += "[^/]";
    else if (ch === "[") {
      const end = glob.indexOf("]", i + 1);
      if (end < 0) source += "\\[";
      else {
        source += `[${glob.slice(i + 1, end).replace(/\\/g, "\\\\")}]`;
        i = end;
      }
    } else source += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

/** Compile the lines of the root `.gitignore` into rules, in file order. */
export function compileIgnoreRules(text: string): readonly IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "" || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    let pattern = negate ? line.slice(1) : line;
    const directoryOnly = pattern.endsWith("/");
    if (directoryOnly) pattern = pattern.slice(0, -1);
    pattern = pattern.replace(/\*\*\//g, "").replace(/\/\*\*$/, "/*");
    const anchored = pattern.includes("/");
    const bare = anchored && pattern.startsWith("/") ? pattern.slice(1) : pattern;
    if (bare === "") continue;
    rules.push(
      Object.freeze({
        negate,
        directoryOnly,
        anchored,
        test: globToRegExp(bare),
        pattern: line,
      }),
    );
  }
  return Object.freeze(rules);
}

/**
 * Whether the root `.gitignore` ignores a source-relative path. The LAST
 * matching rule wins (F140-FR-018, B-1920); an anchored pattern is matched
 * against the whole relative path, an unanchored one against the base name or
 * the path.
 */
export function isIgnored(
  rules: readonly IgnoreRule[],
  relative: string,
  isDirectory: boolean,
): boolean {
  const base = relative.slice(relative.lastIndexOf("/") + 1);
  let ignored = false;
  for (const rule of rules) {
    if (rule.directoryOnly && !isDirectory) continue;
    const hit = rule.anchored
      ? rule.test.test(relative)
      : rule.test.test(base) || rule.test.test(relative);
    if (hit) ignored = !rule.negate;
  }
  return ignored;
}

/** The rules of the source's root `.gitignore`; empty where it has none. */
export function rootIgnoreRules(src: string): readonly IgnoreRule[] {
  try {
    const path = join(src, ROOT_IGNORE_FILE);
    if (!lstatSync(path).isFile()) return Object.freeze([]);
    return compileIgnoreRules(readFileSync(path, "utf8"));
  } catch {
    return Object.freeze([]);
  }
}

/* ------------------------------------------------------------------------- *
 * One entry of the re-walk
 * ------------------------------------------------------------------------- */

/**
 * What the guard compares: the source-relative path, the size and the content
 * hash. The hash is the canonical one of annex X §X.5 (F108-FR-027).
 */
export type WalkedEntry = {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  /** True where the path is a link; it was never followed (F108-FR-032). */
  readonly symlink: boolean;
};

/**
 * Read the bytes of a REGULAR file without following a link: the descriptor is
 * opened with `O_NOFOLLOW` where the platform offers it, the content is read in
 * 64 KiB chunks (B-1915), and the bytes are handed to the canonical hasher,
 * which opens nothing itself (`HASHER_READS_A_FILE` is false).
 */
export function readRegularFileWithoutFollowing(path: string): Buffer {
  const flags =
    constants.O_RDONLY | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0);
  const fd = openSync(path, flags);
  try {
    const chunks: Buffer[] = [];
    for (;;) {
      const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES);
      const read = readSync(fd, chunk, 0, READ_CHUNK_BYTES, null);
      if (read <= 0) break;
      chunks.push(chunk.subarray(0, read));
    }
    return Buffer.concat(chunks);
  } finally {
    closeSync(fd);
  }
}

/**
 * The entry of one source-relative path, or `undefined` where the path is
 * neither a regular file nor a link (a directory, a socket, a device, or a
 * path that vanished between the listing and the read).
 *
 * F108-FR-032 — `lstatSync` first, always. A link contributes the size and the
 * hash of its TARGET STRING and is never opened (F140-FR-020), so a link
 * swapped in after the inventory cannot make the guard read outside the source.
 */
export function entryOf(src: string, relative: string): WalkedEntry | undefined {
  const path = join(src, relative);
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return undefined;
  }
  if (stat.isSymbolicLink()) {
    let target: string;
    try {
      target = readlinkSync(path);
    } catch {
      return undefined;
    }
    return Object.freeze({
      path: relative,
      bytes: Buffer.byteLength(target),
      sha256: contentHash(target),
      symlink: true,
    });
  }
  if (!stat.isFile()) return undefined;
  try {
    const bytes = readRegularFileWithoutFollowing(path);
    return Object.freeze({
      path: relative,
      bytes: bytes.length,
      sha256: contentHash(bytes),
      symlink: false,
    });
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------------- *
 * The candidate paths
 * ------------------------------------------------------------------------- */

/**
 * The candidate paths of the FILE-SYSTEM walk: every path under the source
 * except a denied directory, a name of state, a path under an exclusion and a
 * path the root `.gitignore` ignores. No link is followed: a linked directory
 * is ONE candidate and is not entered (B-1923).
 */
export function fileSystemCandidates(src: string, excludes: readonly string[]): readonly string[] {
  const rules = rootIgnoreRules(src);
  const denied: readonly string[] = DENY_DIRECTORIES;
  const state: readonly string[] = STATE_DIRECTORY_NAMES;
  const found: string[] = [];
  const stack: string[] = [""];
  while (stack.length > 0) {
    const directory = stack.pop() as string;
    let listing;
    try {
      listing = readdirSync(join(src, directory), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of listing) {
      const relative = directory === "" ? child.name : `${directory}/${child.name}`;
      if (isUnderAnExclusion(relative, excludes)) continue;
      // A link is never followed, so it is judged as an entry and never entered.
      const isDirectory = child.isDirectory() && !child.isSymbolicLink();
      if (isDirectory) {
        if (denied.includes(child.name) || state.includes(child.name)) continue;
        if (isIgnored(rules, relative, true)) continue;
        stack.push(relative);
        continue;
      }
      if (state.includes(child.name)) continue;
      if (isIgnored(rules, relative, false)) continue;
      found.push(relative);
    }
  }
  return Object.freeze(found.sort(byCodePoint));
}

/**
 * The candidate paths of GIT mode, out of the listing of
 * `git ls-files -co --exclude-standard -z`: a path with a state-directory
 * component and a path under an exclusion are dropped, and the deny list is
 * NOT applied (F140-FR-017, B-1922). A path git lists that the work tree lacks
 * is dropped silently (B-1931) — `entryOf` returns `undefined` for it.
 */
export function gitCandidates(
  listing: readonly string[],
  excludes: readonly string[],
): readonly string[] {
  const kept = new Set<string>();
  for (const raw of listing) {
    const relative = raw.replace(/^\/+/, "");
    if (relative === "") continue;
    if (hasAStateDirectoryComponent(relative)) continue;
    const names: readonly string[] = STATE_DIRECTORY_NAMES;
    if (names.includes(relative)) continue;
    if (isUnderAnExclusion(relative, excludes)) continue;
    kept.add(relative);
  }
  return Object.freeze([...kept].sort(byCodePoint));
}

/* ------------------------------------------------------------------------- *
 * The fingerprint (F140-FR-021)
 * ------------------------------------------------------------------------- */

/**
 * The baseline's serialization of the triples: compact JSON — `,` and `:` with
 * no space — with every non-ASCII character escaped, as Python's
 * `json.dumps(..., separators=(",", ":"))` writes it with its default
 * `ensure_ascii=True`. F140-FR-021: the fingerprint is taken "including the
 * escaping of non-ASCII characters", unlike the document itself, which keeps
 * them as they are.
 */
export function compactAsciiJson(value: unknown): string {
  const text = JSON.stringify(value);
  let out = "";
  // Written as a scan over the code points rather than as a regular
  // expression: a character class over a Unicode range would be reported by
  // the static check of F104-SC-001 as a reader of the spec grammar, which it
  // is not. The scan says the same thing and says it only once.
  for (const character of text) {
    if ((character.codePointAt(0) ?? 0) < 0x7f) {
      out += character;
      continue;
    }
    // A character outside ASCII is written as its UTF-16 escapes — one for a
    // character of the basic plane, two for a surrogate pair — which is what
    // Python's `ensure_ascii=True` writes.
    for (let i = 0; i < character.length; i += 1) {
      out += `\\u${character.charCodeAt(i).toString(16).padStart(4, "0")}`;
    }
  }
  return out;
}

/**
 * F140-FR-021 — the fingerprint: the SHA-256 of the compact JSON list of the
 * sorted triples `(path, bytes, sha256)` over the walked and the skipped
 * entries. The field `schema` is no part of it.
 */
export function fingerprintOfEntries(
  entries: readonly { readonly path: string; readonly bytes: number; readonly sha256: string }[],
): string {
  const triples = [...entries]
    .sort((a, b) => byCodePoint(a.path, b.path))
    .map((entry) => [entry.path, entry.bytes, entry.sha256]);
  return contentHash(compactAsciiJson(triples));
}

/* ------------------------------------------------------------------------- *
 * The re-walk
 * ------------------------------------------------------------------------- */

/** What the re-walk was asked for. */
export type ReWalkInput = {
  /** The real path of the source (B-1616). */
  readonly src: string;
  /** The mode the BASELINE was walked in; the re-walk repeats it. */
  readonly mode: "git" | "walk";
  /** The baseline's exclusions plus the output directory, normalised. */
  readonly excludes: readonly string[];
  /** The listing of `git ls-files`, for git mode. */
  readonly listing?: readonly string[];
};

/** What the re-walk found. */
export type ReWalk = {
  readonly mode: "git" | "walk";
  readonly entries: readonly WalkedEntry[];
  readonly fingerprint: string;
};

/**
 * The re-walk: the candidate paths of the baseline's mode, each turned into an
 * entry through `entryOf` (so nothing is followed), and the fingerprint over
 * them.
 */
export function reWalk(input: ReWalkInput): ReWalk {
  const candidates =
    input.mode === "git"
      ? gitCandidates(input.listing ?? [], input.excludes)
      : fileSystemCandidates(input.src, input.excludes);
  const entries: WalkedEntry[] = [];
  for (const relative of candidates) {
    const entry = entryOf(input.src, relative);
    if (entry !== undefined) entries.push(entry);
  }
  return Object.freeze({
    mode: input.mode,
    entries: Object.freeze(entries),
    fingerprint: fingerprintOfEntries(entries),
  });
}
