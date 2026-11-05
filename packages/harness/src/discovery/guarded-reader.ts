/**
 * T006 — the guarded reader of discovery (F146-FR-004; D-3 of the plan).
 *
 * Discovery reads presence and never values. This module is the ONLY way
 * discovery touches the machine. It offers exactly three operations, and
 * each answers a question of presence or existence:
 *
 *   - `isVariableSet` — is the name of a variable set? The question goes to
 *     the secret resolver, and to the operation `exists` of the resolver
 *     ONLY (§C.11): never `resolve`, never `boundHost`, never `handles`.
 *   - `directoryExists` — does this directory exist? The module holds no
 *     operation that opens a file: it stats the named path and nothing
 *     inside it.
 *   - `executableOnSearchPath` — is this name on the search path, as an
 *     executable? It names the first directory that holds one. It never
 *     starts what it finds.
 *
 * A deny-list in this module enforces the rule that no credential store, no
 * token file and no state file of a host is ever touched: every operation
 * that takes a path refuses a path the deny-list matches, whether or not
 * the path exists. Every call is recorded in a trace, so a test can prove
 * what the reader asked and what it refused (F146-SC-002).
 */
import { statSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import type { Existence, SecretResolver } from "@specstride/contracts/ep/secret-resolver";

/** The requirement this module carries. */
export const GUARDED_READER_REQUIREMENT = "F146-FR-004" as const;

/**
 * The deny-list of the reader. An entry without `/` matches a single path
 * segment of that name; an entry with `/` matches a path whose end is that
 * sequence of segments. Matching is case-insensitive, on the segments of
 * the path, so `~/.ssh/known_hosts` and `C:\Users\a\.AWS` are both caught.
 * The list is data, in one place, and a test refuses every entry of it.
 */
export const DENY_LIST: readonly string[] = Object.freeze([
  // Credential stores and agents of a host.
  ".ssh",
  ".gnupg",
  ".gnome/keyrings",
  "keychains",
  ".password-store",
  ".pki",
  // Cloud provider credential directories and files.
  ".aws",
  ".azure",
  ".config/gcloud",
  ".kube",
  ".docker",
  ".oraclebmcs",
  // Token, credential and state files that hold values.
  "credentials",
  "credential",
  ".netrc",
  ".git-credentials",
  ".npmrc",
  ".pypirc",
  ".hgrc",
  ".wgetrc",
  ".curlrc",
  ".vault-token",
  ".kube/config",
  "accessTokens",
  "auth.json",
  "credentials.json",
  "sqlite.db",
]);

/**
 * The rule of the deny-list a path matches, or `null` where it matches
 * none. Segments are compared case-insensitively; a multi-segment entry
 * matches the end of the path.
 */
export function deniedRuleOf(path: string): string | null {
  const segments = path.split(/[\\/]+/).map((s) => s.toLowerCase());
  for (const entry of DENY_LIST) {
    const parts = entry.split("/").map((p) => p.toLowerCase());
    // A single-segment entry refuses a path that holds that segment
    // anywhere in it: a credential directory below an unrelated name is
    // still a credential directory. An entry with `/` matches the end.
    if (parts.length === 1) {
      if (segments.includes(parts[0]!)) return entry;
      continue;
    }
    const last = segments.slice(-parts.length);
    if (last.length === parts.length && last.every((s, i) => s === parts[i])) {
      return entry;
    }
  }
  return null;
}

/** One recorded call of the reader. */
export type GuardedReaderTraceEntry = {
  /** Which operation ran. */
  readonly op: "variable-presence" | "directory-existence" | "search-path";
  /** The variable name or path it was asked about. */
  readonly target: string;
  /** What the reader answered. */
  readonly outcome: string;
  /** The deny-list entry, where the call was refused. */
  readonly refusedBy?: string;
  /** The directory that holds the executable, for the search path. */
  readonly directory?: string;
};

/** The outcomes of `isVariableSet`. */
export type VariablePresence = {
  readonly outcome: "present" | "absent" | "unprobed";
};

/** The outcomes of `directoryExists`. */
export type DirectoryExistence = {
  readonly outcome: "exists" | "absent" | "refused";
  /** The deny-list entry, where the outcome is `refused`. */
  readonly refusedBy?: string;
};

/** The outcomes of `executableOnSearchPath`. */
export type SearchPathPresence = {
  readonly outcome: "on-path" | "not-on-path" | "refused";
  /** The first directory that holds the executable, where it is on the path. */
  readonly directory?: string;
  /** The deny-list entry, where the outcome is `refused`. */
  readonly refusedBy?: string;
};

/**
 * The guarded reader. The secret resolver is handed in by the composition
 * root as the interface of `@specstride/contracts` (EP-10); the reader asks
 * it for `exists` and for nothing else.
 */
export class GuardedReader {
  readonly #secretResolver: SecretResolver;
  readonly #searchPath: () => string;
  #trace: GuardedReaderTraceEntry[] = [];

  constructor(deps: {
    /** The secret resolver of the run (EP-10). */
    readonly secretResolver: SecretResolver;
    /** Where the search path is read from; the environment, by default. */
    readonly readSearchPath?: () => string;
  }) {
    this.#secretResolver = deps.secretResolver;
    this.#searchPath = deps.readSearchPath ?? (() => process.env.PATH ?? "");
  }

  /** The trace of every call this reader answered or refused. */
  get trace(): readonly GuardedReaderTraceEntry[] {
    return this.#trace;
  }

  /**
   * Is the name of a variable set? The question goes to the secret resolver
   * as the reference `env:<name>`, and to the operation `exists` only: the
   * reader never holds the value, and there is no value to hold (§C.11).
   */
  async isVariableSet(name: string): Promise<VariablePresence> {
    const existence: Existence = await this.#secretResolver.exists(`env:${name}`);
    const outcome = existence === "yes" ? "present" : existence === "no" ? "absent" : "unprobed";
    this.#trace.push({ op: "variable-presence", target: name, outcome });
    return { outcome };
  }

  /**
   * Does this directory exist? The reader stats the path named — never
   * anything inside it — and refuses every path the deny-list matches
   * before it looks.
   */
  directoryExists(path: string): DirectoryExistence {
    const refusedBy = deniedRuleOf(path);
    if (refusedBy !== null) {
      this.#trace.push({
        op: "directory-existence",
        target: path,
        outcome: "refused",
        refusedBy,
      });
      return { outcome: "refused", refusedBy };
    }
    let outcome: DirectoryExistence["outcome"];
    try {
      outcome = statSync(path).isDirectory() ? "exists" : "absent";
    } catch {
      outcome = "absent";
    }
    this.#trace.push({ op: "directory-existence", target: path, outcome });
    return { outcome };
  }

  /**
   * Is this name on the search path, as an executable? The reader walks the
   * directories of the search path in order and stats one candidate per
   * directory; it names the first directory that holds an executable file,
   * and starts nothing. A name the deny-list matches is refused.
   */
  executableOnSearchPath(name: string): SearchPathPresence {
    const refusedBy = deniedRuleOf(name);
    if (refusedBy !== null) {
      this.#trace.push({ op: "search-path", target: name, outcome: "refused", refusedBy });
      return { outcome: "refused", refusedBy };
    }
    const directories = this.#searchPath()
      .split(delimiter)
      .filter((d) => d.length > 0);
    for (const directory of directories) {
      const candidate = resolve(isAbsolute(name) ? name : join(directory, name));
      if (deniedRuleOf(candidate) !== null) continue;
      try {
        const stats = statSync(candidate);
        if (stats.isFile() && (stats.mode & 0o111) !== 0) {
          this.#trace.push({
            op: "search-path",
            target: name,
            outcome: "on-path",
            directory: resolve(directory),
          });
          return { outcome: "on-path", directory: resolve(directory) };
        }
      } catch {
        // Not there: go on to the next directory of the search path.
      }
    }
    this.#trace.push({ op: "search-path", target: name, outcome: "not-on-path" });
    return { outcome: "not-on-path" };
  }
}
