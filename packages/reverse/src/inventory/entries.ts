/**
 * T023 of feature 140 — the ENTRIES of the inventory: a file entry, the
 * classification of its language and its role, its hash through the kernel
 * hasher, links, and the three skip reasons (F140-FR-019, F140-FR-020).
 *
 * `./walk.ts` (T022) decides which paths exist; this module decides what each
 * one IS. Three shapes come out of it, and the fingerprint covers all three,
 * because the point of recording a skipped file is that a change to it is
 * still caught (F140-FR-020):
 *
 *  * a FILE entry — `path`, `bytes`, `lines`, `sha256`, `language`, `role`;
 *  * a LINK that resolves INSIDE the source — a file entry with
 *    `symlink: true`, `target`, the length and hash OF THE TARGET STRING,
 *    `lines` 0, language `symlink` and role `other`;
 *  * a SKIPPED entry — `path`, `bytes`, `sha256`, `reason`, and `limit` for
 *    the reason `oversize`.
 *
 * The order of the two size tests is fixed and observable: the NUL sniff comes
 * BEFORE the size limit (F140-FR-020), so a large binary is `binary` and never
 * `oversize`.
 *
 * Classification tables and patterns are the baseline's at `9cab15d`. The
 * regular expressions are transcribed with the case-insensitive flag Python's
 * `re.I` gave them, and `re.search` is `RegExp.prototype.test` of an
 * unanchored pattern while `re.match` is an anchored one — `DOC_NAMES` is the
 * only `match` and already carries its own `^`.
 */
import {
  closeSync,
  constants,
  lstatSync,
  openSync,
  readSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";

import { contentHash } from "@specstride/kernel/hasher";

import { READ_CHUNK_BYTES, SNIFF_BYTES } from "./limits.ts";

/* ------------------------------------------------------------------------- *
 * The shapes (F140-FR-020)
 * ------------------------------------------------------------------------- */

/** The nine roles of the closed set (F140-FR-019, `contracts/`). */
export const ROLES = Object.freeze([
  "ci",
  "test",
  "schema",
  "template",
  "doc",
  "script",
  "source",
  "config",
  "other",
] as const);

/** One role. */
export type Role = (typeof ROLES)[number];

/** The three reasons a file is skipped (F140-FR-020). */
export const SKIP_REASONS = Object.freeze(["binary", "oversize", "symlink-escape"] as const);

/** One skip reason. */
export type SkipReason = (typeof SKIP_REASONS)[number];

/** A file of the inventory, a link inside the source included. */
export type FileEntry = {
  readonly path: string;
  readonly bytes: number;
  readonly lines: number;
  readonly sha256: string;
  readonly language: string;
  readonly role: Role;
  /** Only on a link that resolves inside the source. */
  readonly symlink?: true;
  /** Only on a link: the target string, as `readlink` gave it. */
  readonly target?: string;
};

/** A file the inventory recorded but did not read as text (F140-FR-020). */
export type SkippedEntry = {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly reason: SkipReason;
  /** Only for `oversize`: the limit the file was over. */
  readonly limit?: number;
  /** Only for `symlink-escape`: the target string. */
  readonly target?: string;
};

/** What one candidate path turned out to be. */
export type Classified =
  | { readonly kind: "file"; readonly entry: FileEntry }
  | { readonly kind: "skipped"; readonly entry: SkippedEntry }
  | { readonly kind: "absent" };

/* ------------------------------------------------------------------------- *
 * The language tables (F140-FR-019)
 * ------------------------------------------------------------------------- */

/** Language by lower-cased extension. */
export const LANGUAGES: Readonly<Record<string, string>> = Object.freeze({
  ".py": "python",
  ".pyi": "python",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".scala": "scala",
  ".rb": "ruby",
  ".php": "php",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".swift": "swift",
  ".lua": "lua",
  ".pl": "perl",
  ".r": "r",
  ".sql": "sql",
  ".proto": "protobuf",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "css",
  ".vue": "vue",
  ".svelte": "svelte",
  ".md": "markdown",
  ".rst": "rst",
  ".txt": "text",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".ini": "ini",
  ".cfg": "ini",
  ".xml": "xml",
  ".gradle": "groovy",
  ".tf": "terraform",
  ".nix": "nix",
  ".j2": "jinja",
  ".jinja": "jinja",
  ".tmpl": "template",
  ".hbs": "handlebars",
  ".ejs": "ejs",
  ".mk": "make",
});

/** Language by exact file name — the first rule of the precedence. */
export const FILENAME_LANGUAGES: Readonly<Record<string, string>> = Object.freeze({
  Makefile: "make",
  GNUmakefile: "make",
  Dockerfile: "dockerfile",
  Containerfile: "dockerfile",
  Jenkinsfile: "groovy",
  Gemfile: "ruby",
  Rakefile: "ruby",
  Vagrantfile: "ruby",
  Justfile: "just",
  justfile: "just",
});

/** Language by a needle of the shebang line, in order. */
export const SHEBANG_LANGUAGES = Object.freeze([
  ["python", "python"],
  ["bash", "shell"],
  ["/sh", "shell"],
  ["zsh", "shell"],
  ["node", "javascript"],
  ["deno", "typescript"],
  ["ruby", "ruby"],
  ["perl", "perl"],
] as const);

/** The languages whose files are role `source` when nothing earlier claims them. */
export const CODE_LANGUAGES: ReadonlySet<string> = Object.freeze(
  new Set([
    "python",
    "shell",
    "javascript",
    "typescript",
    "go",
    "rust",
    "java",
    "kotlin",
    "scala",
    "ruby",
    "php",
    "c",
    "cpp",
    "csharp",
    "swift",
    "lua",
    "perl",
    "r",
    "vue",
    "svelte",
    "html",
    "css",
    "groovy",
  ]),
);

/** The languages whose files are role `config`. */
export const CONFIG_LANGUAGES: ReadonlySet<string> = Object.freeze(
  new Set(["json", "yaml", "toml", "ini", "xml", "make", "dockerfile", "terraform", "nix", "just"]),
);

/** The extensions that make a file role `template` whatever its language. */
export const TEMPLATE_EXTENSIONS: ReadonlySet<string> = Object.freeze(
  new Set([".j2", ".jinja", ".tmpl", ".hbs", ".ejs", ".mustache", ".tpl"]),
);

/** The `schema` role (F140-FR-019). */
export const SCHEMA_RE =
  /(\.schema\.json|\.proto|\.graphql|\.gql|\.avsc|\.xsd|\.sql)$|(^|\/)(openapi|swagger|asyncapi)[^/]*\.(ya?ml|json)$|(^|\/)(schemas?|migrations)\//i;

/** The `test` role, decided by path patterns (F140-FR-019). */
export const TEST_RE =
  /(^|\/)(tests?|__tests__|spec|specs?_?tests?|testing)\/|(^|\/)test_[^/]*\.py$|_test\.(py|go|rb|exs?)$|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)conftest\.py$/i;

/** The `ci` role, the first of the precedence (F140-FR-019). */
export const CI_RE =
  /^\.github\/workflows\/|^\.gitlab-ci\.ya?ml$|^\.circleci\/|^Jenkinsfile$|^\.travis\.ya?ml$|^azure-pipelines\.ya?ml$|^\.buildkite\/|^\.drone\.ya?ml$|^\.woodpecker/i;

/** The document names of the `doc` role; matched against the BASE NAME. */
export const DOC_NAMES_RE =
  /^(README|CHANGELOG|CONTRIBUTING|LICENSE|COPYING|NOTICE|AUTHORS|CODE_OF_CONDUCT|SECURITY|AGENTS|CLAUDE)(\.[A-Za-z]+)?$/i;

/* ------------------------------------------------------------------------- *
 * The two path helpers Python's `os.path` gave the baseline
 * ------------------------------------------------------------------------- */

/** The base name of a source-relative path (`a/b/c.ts` is `c.ts`). */
export function baseNameOf(relative: string): string {
  return relative.slice(relative.lastIndexOf("/") + 1);
}

/**
 * The extension of a file name as `os.path.splitext` gives it: the text from
 * the LAST dot on, and the empty string where every character before that dot
 * is itself a dot. So `.gitignore` has NO extension, `a.b.c` has `.c`, and
 * `..x` has none — which is why a dot-file is never classified by extension.
 */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  for (let index = 0; index < dot; index += 1) {
    if (name[index] !== ".") return name.slice(dot);
  }
  return "";
}

/* ------------------------------------------------------------------------- *
 * Classification (F140-FR-019)
 * ------------------------------------------------------------------------- */

/**
 * The language of a file: by exact file name, then `Dockerfile*` and
 * `*.dockerfile`, then the lower-cased extension, then the shebang, else
 * `unknown` (F140-FR-019). `head` is the first `SNIFF_BYTES` bytes.
 */
export function languageOf(relative: string, head: Uint8Array): string {
  const name = baseNameOf(relative);
  const byName = FILENAME_LANGUAGES[name];
  if (byName !== undefined) return byName;
  if (name.startsWith("Dockerfile") || name.endsWith(".dockerfile")) return "dockerfile";
  const extension = extensionOf(name).toLowerCase();
  const byExtension = LANGUAGES[extension];
  if (byExtension !== undefined) return byExtension;
  if (startsWithShebang(head)) {
    const buffer = Buffer.from(head);
    const end = buffer.indexOf(0x0a);
    const first = (end < 0 ? buffer : buffer.subarray(0, end)).toString("utf8");
    for (const [needle, language] of SHEBANG_LANGUAGES) {
      if (first.includes(needle)) return language;
    }
  }
  return "unknown";
}

/** Whether the first bytes of a file are `#!`. */
export function startsWithShebang(head: Uint8Array): boolean {
  return head.length >= 2 && head[0] === 0x23 && head[1] === 0x21;
}

/**
 * The role of a file, in the precedence of F140-FR-019: `ci`, `test`,
 * `schema`, `template`, `doc`, `script`, `source`, `config`, else `other`.
 *
 * `script` deliberately comes BEFORE `source`, so an executable entry script
 * — any file that starts with a shebang — is `script` and not `source`.
 */
export function roleOf(relative: string, language: string, head: Uint8Array): Role {
  const name = baseNameOf(relative);
  const extension = extensionOf(name).toLowerCase();
  if (CI_RE.test(relative)) return "ci";
  if (TEST_RE.test(relative)) return "test";
  if (SCHEMA_RE.test(relative)) return "schema";
  if (TEMPLATE_EXTENSIONS.has(extension) || `/${relative}`.includes("/templates/")) {
    return "template";
  }
  if (
    DOC_NAMES_RE.test(name) ||
    language === "markdown" ||
    language === "rst" ||
    language === "text" ||
    relative.startsWith("docs/")
  ) {
    return "doc";
  }
  if (
    language === "shell" ||
    relative.startsWith("scripts/") ||
    relative.startsWith("bin/") ||
    startsWithShebang(head)
  ) {
    return "script";
  }
  if (CODE_LANGUAGES.has(language)) return "source";
  if (
    CONFIG_LANGUAGES.has(language) ||
    name.startsWith(".env") ||
    name.startsWith(".editorconfig") ||
    name.startsWith(".git") ||
    name.startsWith("compose") ||
    name.startsWith("docker-compose")
  ) {
    return "config";
  }
  return "other";
}

/**
 * The number of lines of a file's bytes: the newline bytes, plus one when the
 * file is non-empty and does not end with a newline (F140-FR-020).
 */
export function lineCountOf(bytes: Uint8Array): number {
  let newlines = 0;
  for (const byte of bytes) if (byte === 0x0a) newlines += 1;
  if (bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a) newlines += 1;
  return newlines;
}

/* ------------------------------------------------------------------------- *
 * Reading, without ever following a link
 * ------------------------------------------------------------------------- */

/**
 * The bytes of a REGULAR file, read in 64 KiB chunks and handed to the
 * canonical hasher of annex X §X.5, which opens nothing itself
 * (F140-FR-019: "read in 64 KiB chunks, through the canonical hasher").
 *
 * The descriptor is opened with `O_NOFOLLOW` where the platform offers it: a
 * link is classified by its TARGET STRING and must never be opened, so a link
 * swapped in between the listing and the read cannot make the inventory read
 * outside the source.
 */
export function readWithoutFollowing(path: string): Buffer {
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
 * The length of a link target as Python's `len(str)` counts it: CODE POINTS,
 * not UTF-16 units and not UTF-8 bytes. A target with an astral character
 * would otherwise be two longer than the baseline recorded and would change
 * the fingerprint.
 */
export function codePointLength(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

/**
 * `os.path.realpath`, which is what the baseline resolved a link with — and
 * which differs from Node's `realpathSync` in the one case that decides a skip
 * reason: a BROKEN link. Node throws `ENOENT`; Python resolves as far as it
 * can and appends the rest, so `x -> /etc/nope` resolves to `/etc/nope`,
 * lands OUTSIDE the source, and is skipped `symlink-escape`. Treating it as
 * unresolvable would make it a link entry inside the source instead.
 *
 * The walk is component by component: `.` is dropped, `..` pops the part
 * already resolved, a component that is itself a link is replaced by its
 * target (absolute targets restart at the root), and a component that cannot
 * be read is appended as it stands. A link loop stops at the link that closes
 * it, as Python's non-strict resolution does.
 */
export function pythonRealpath(path: string): string {
  const resolved: string[] = [];
  let pending = path.split("/").filter((part) => part !== "");
  const seen = new Set<string>();
  let steps = 0;
  while (pending.length > 0) {
    if (steps > 4096) break;
    steps += 1;
    const name = pending.shift() as string;
    if (name === ".") continue;
    if (name === "..") {
      resolved.pop();
      continue;
    }
    const candidate = `/${[...resolved, name].join("/")}`;
    let target: string;
    try {
      target = readlinkSync(candidate);
    } catch {
      resolved.push(name);
      continue;
    }
    if (seen.has(candidate)) {
      resolved.push(name);
      continue;
    }
    seen.add(candidate);
    const parts = target.split("/").filter((part) => part !== "");
    if (target.startsWith("/")) resolved.length = 0;
    pending = [...parts, ...pending];
  }
  return `/${resolved.join("/")}`;
}

/** Whether a resolved path is the source or lies under it. */
export function isInside(resolved: string, root: string): boolean {
  return resolved === root || resolved.startsWith(`${root.replace(/\/+$/, "")}/`);
}

/* ------------------------------------------------------------------------- *
 * One candidate path
 * ------------------------------------------------------------------------- */

/** What `classifyPath` needs beyond the path itself. */
export type ClassifyInput = {
  /** The real path of the source. */
  readonly src: string;
  /** The source-relative path of the candidate. */
  readonly relative: string;
  /** The per-file text limit (F140-FR-016). */
  readonly maxFileBytes: number;
  /** Resolve a link's target; `realpathSync` by default. */
  readonly resolve?: ((path: string) => string) | undefined;
};

/**
 * Classify ONE candidate path (F140-FR-019, F140-FR-020).
 *
 * The order of the tests is the baseline's and is observable:
 *
 *  1. a LINK — never opened. Outside the source it is skipped
 *     `symlink-escape`, fingerprinted BY ITS TARGET; inside, it is a file
 *     entry with `symlink: true`.
 *  2. not a regular file — `absent`. This is the tracked-but-deleted path of
 *     git mode, and also a socket or a device.
 *  3. a NUL byte in the first 8192 bytes — `binary`, BEFORE the size test.
 *  4. larger than the per-file limit — `oversize`, recording `limit`.
 *  5. otherwise a text file entry.
 */
export function classifyPath(input: ClassifyInput): Classified {
  const { src, relative, maxFileBytes } = input;
  const full = join(src, relative);
  let stat;
  try {
    stat = lstatSync(full);
  } catch {
    return Object.freeze({ kind: "absent" as const });
  }
  if (stat.isSymbolicLink()) {
    let target: string;
    try {
      target = readlinkSync(full);
    } catch {
      return Object.freeze({ kind: "absent" as const });
    }
    const resolve = input.resolve;
    let resolved: string;
    try {
      resolved = resolve === undefined ? realpathSync(full) : resolve(full);
    } catch {
      // A BROKEN link: Node throws where Python resolves. `pythonRealpath` is
      // the baseline's answer, and it is what decides `symlink-escape`.
      resolved = pythonRealpath(full);
    }
    const bytes = codePointLength(target);
    const sha256 = contentHash(target);
    if (!isInside(resolved, src)) {
      return Object.freeze({
        kind: "skipped" as const,
        entry: Object.freeze({
          path: relative,
          reason: "symlink-escape" as const,
          target,
          bytes,
          sha256,
        }),
      });
    }
    return Object.freeze({
      kind: "file" as const,
      entry: Object.freeze({
        path: relative,
        symlink: true as const,
        target,
        bytes,
        sha256,
        lines: 0,
        language: "symlink",
        role: "other" as const,
      }),
    });
  }
  if (!stat.isFile()) return Object.freeze({ kind: "absent" as const });
  let data: Buffer;
  try {
    data = readWithoutFollowing(full);
  } catch {
    return Object.freeze({ kind: "absent" as const });
  }
  const size = stat.size;
  const sha256 = contentHash(data);
  const head = data.subarray(0, SNIFF_BYTES);
  if (head.includes(0)) {
    return Object.freeze({
      kind: "skipped" as const,
      entry: Object.freeze({ path: relative, reason: "binary" as const, bytes: size, sha256 }),
    });
  }
  if (size > maxFileBytes) {
    return Object.freeze({
      kind: "skipped" as const,
      entry: Object.freeze({
        path: relative,
        reason: "oversize" as const,
        bytes: size,
        sha256,
        limit: maxFileBytes,
      }),
    });
  }
  const language = languageOf(relative, head);
  return Object.freeze({
    kind: "file" as const,
    entry: Object.freeze({
      path: relative,
      bytes: size,
      lines: lineCountOf(data),
      sha256,
      language,
      role: roleOf(relative, language, head),
    }),
  });
}

/** What a walk of a whole source produced (F140-FR-020, F140-FR-021). */
export type WalkedTree = {
  /** The text files and the links inside the source, sorted by code point. */
  readonly files: readonly FileEntry[];
  /** The skipped entries, in the same order as the candidates. */
  readonly skipped: readonly SkippedEntry[];
  /**
   * The sum of the sizes of the TEXT files only: a link and a skipped entry do
   * not count towards the total limit (F140-FR-020).
   */
  readonly textBytes: number;
};

/** Classify every candidate path of a source, in order. */
export function classifyAll(
  src: string,
  paths: readonly string[],
  maxFileBytes: number,
): WalkedTree {
  const files: FileEntry[] = [];
  const skipped: SkippedEntry[] = [];
  let textBytes = 0;
  for (const relative of paths) {
    const found = classifyPath({ src, relative, maxFileBytes });
    if (found.kind === "absent") continue;
    if (found.kind === "skipped") {
      skipped.push(found.entry);
      continue;
    }
    files.push(found.entry);
    if (found.entry.symlink !== true) textBytes += found.entry.bytes;
  }
  return Object.freeze({
    files: Object.freeze(files),
    skipped: Object.freeze(skipped),
    textBytes,
  });
}
