/**
 * The ENTRY POINTS, the WORKSPACES and the UNITS of the inventory
 * (F140-FR-023), and the `project` record that holds them together with the
 * manifests of `./project.ts`.
 *
 * T030 of feature 140 names this file; it is written here, in the phase of
 * the inventory document, because `./document.ts` (T024) cannot build
 * `project` or `units` without it and the parity test of T020 measures both.
 *
 * Three things are decided here, and each is decided WITHOUT reading a file
 * twice where the walk already read it:
 *
 *  * **Entry points** of the seven kinds `bin`, `console-script`, `export`,
 *    `container-entrypoint`, `python-main`, `go-main` and `script`. The first
 *    four come off the manifests; the last three come off a file's first
 *    256 KiB. They are sorted by their SORTED-KEY JSON TEXT, which is a
 *    deliberate order and not path order — see `pythonJsonSortKey`.
 *  * **Workspaces**: the directories that hold a `package.json` or a
 *    `Cargo.toml` and that a ROOT workspace glob matches, where `**` is read
 *    as `*` and a `!` glob excludes.
 *  * **Units**: the workspace packages plus `.` for the rest where there are
 *    workspaces, else the top-level directories plus `.` for the root files.
 */
import { join } from "node:path";

import type { FileEntry } from "./entries.ts";
import { baseNameOf } from "./entries.ts";
import type { ManifestSweep } from "./project.ts";
import {
  ENTRY_POINT_READ_LIMIT,
  frameworksOf,
  languagesOf,
  readJson,
  readText,
} from "./project.ts";
import { fnmatchToRegExp } from "./walk.ts";
import type { JsonValue } from "./serialize.ts";
import { compareCodePoint, pythonJsonSortKey, sortByCodePoint } from "./serialize.ts";

/** The seven kinds of entry point (F140-FR-023, a closed set). */
export const ENTRY_POINT_KINDS = Object.freeze([
  "bin",
  "console-script",
  "export",
  "container-entrypoint",
  "python-main",
  "go-main",
  "script",
] as const);

/** One kind of entry point. */
export type EntryPointKind = (typeof ENTRY_POINT_KINDS)[number];

/** One entry point. Which keys it carries depends on its kind. */
export type EntryPoint = {
  readonly kind: EntryPointKind;
  readonly target: string;
  readonly name?: string;
  readonly manifest?: string;
  /** Only on `export`: the manifest-relative target, normalised. */
  readonly resolved?: string;
};

/** One workspace package (F140-FR-023). */
export type Workspace = {
  readonly kind: "js" | "cargo";
  readonly path: string;
  readonly name: string;
};

/** One investigation unit (F140-FR-023). */
export type Unit = {
  readonly path: string;
  readonly files: number;
  readonly bytes: number;
};

/** The `project` record of the inventory document (F140-FR-021). */
export type ProjectFacts = {
  readonly manifests: readonly Readonly<Record<string, JsonValue>>[];
  readonly languages: Readonly<Record<string, number>>;
  readonly frameworks: readonly string[];
  readonly entry_points: readonly EntryPoint[];
  readonly workspaces: readonly Workspace[];
};

/* ------------------------------------------------------------------------- *
 * `os.path.normpath`, which the `export` entry point resolves through
 * ------------------------------------------------------------------------- */

/**
 * `posixpath.normpath`: `.` components and empty components are dropped, a
 * `..` pops the component before it, a `..` that cannot pop is kept, and the
 * empty result is `.`. A leading `/` is kept, and exactly two leading slashes
 * stay two, as Python keeps them.
 */
export function normalizePath(path: string): string {
  if (path === "") return ".";
  let leading = 0;
  if (path.startsWith("/")) leading = path.startsWith("//") && !path.startsWith("///") ? 2 : 1;
  const parts: string[] = [];
  for (const component of path.split("/")) {
    if (component === "" || component === ".") continue;
    if (
      component !== ".." ||
      (leading === 0 && parts.length === 0) ||
      (parts.length > 0 && parts[parts.length - 1] === "..")
    ) {
      parts.push(component);
      continue;
    }
    if (parts.length > 0) parts.pop();
  }
  const joined = "/".repeat(leading) + parts.join("/");
  return joined === "" ? "." : joined;
}

/* ------------------------------------------------------------------------- *
 * Entry points (F140-FR-023)
 * ------------------------------------------------------------------------- */

/** The map a manifest's `bin` or `scripts` is, with its keys sorted. */
function sortedPairs(value: JsonValue | undefined): readonly [string, string][] {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const record = value as Record<string, JsonValue>;
  return sortByCodePoint(Object.keys(record)).map(
    (key) => [key, String(record[key])] as [string, string],
  );
}

/**
 * The entry points of the MANIFESTS (F140-FR-023): `bin` from a package `bin`
 * and a Cargo `[[bin]]`, `console-script` from the scripts of a manifest that
 * is NOT a `package.json` (an npm script is a task, not an entry point),
 * `export` with its manifest-relative `resolved` path, and
 * `container-entrypoint` from a Dockerfile `ENTRYPOINT`.
 */
export function manifestEntryPoints(sweep: ManifestSweep): readonly EntryPoint[] {
  const found: EntryPoint[] = [];
  for (const manifest of sweep.manifests) {
    const relative = manifest.relative;
    const facts = manifest.facts;
    const base = relative.includes("/") ? `${relative.slice(0, relative.lastIndexOf("/"))}/` : "";
    for (const [name, target] of sortedPairs(facts["bin"])) {
      found.push(Object.freeze({ kind: "bin" as const, name, target, manifest: relative }));
    }
    for (const [name, target] of sortedPairs(facts["scripts"])) {
      if (facts["kind"] === "package.json") continue;
      found.push(
        Object.freeze({ kind: "console-script" as const, name, target, manifest: relative }),
      );
    }
    const exports = facts["exports"];
    if (Array.isArray(exports)) {
      for (const target of exports) {
        found.push(
          Object.freeze({
            kind: "export" as const,
            target: String(target),
            manifest: relative,
            resolved: normalizePath(base + String(target)),
          }),
        );
      }
    }
    const entrypoint = facts["entrypoint"];
    if (Array.isArray(entrypoint)) {
      for (const value of entrypoint) {
        found.push(
          Object.freeze({
            kind: "container-entrypoint" as const,
            target: String(value),
            manifest: relative,
          }),
        );
      }
    }
  }
  return Object.freeze(found);
}

/**
 * The entry points read off the FILES (F140-FR-023): a Python file with an
 * `if __name__ == "__main__":` line, a Go file with both `package main` and
 * `func main()`, and a role-`script` file that starts with a shebang. Only a
 * file of role `source` or `script` is read, never a link, and only its first
 * 256 KiB.
 *
 * The three tests are a CHAIN and not three independent rules: a Python file
 * that is role `script` is `python-main` and never also `script`.
 */
export function fileEntryPoints(src: string, files: readonly FileEntry[]): readonly EntryPoint[] {
  const found: EntryPoint[] = [];
  for (const entry of files) {
    if (entry.symlink === true) continue;
    if (entry.role !== "source" && entry.role !== "script") continue;
    const text = readText(join(src, entry.path), ENTRY_POINT_READ_LIMIT) ?? "";
    if (entry.language === "python" && /^if __name__ == ['"]__main__['"]\s*:/m.test(text)) {
      found.push(Object.freeze({ kind: "python-main" as const, target: entry.path }));
      continue;
    }
    if (entry.language === "go" && /^package main\b/m.test(text) && /^func main\(\)/m.test(text)) {
      found.push(Object.freeze({ kind: "go-main" as const, target: entry.path }));
      continue;
    }
    if (entry.role === "script" && text.startsWith("#!")) {
      found.push(Object.freeze({ kind: "script" as const, target: entry.path }));
    }
  }
  return Object.freeze(found);
}

/**
 * Every entry point of a source, SORTED BY ITS SORTED-KEY JSON TEXT
 * (F140-FR-023). The order is therefore by `kind` first — the key `kind` sorts
 * before `manifest`, `name`, `resolved` and `target` — and a reader who
 * expects path order will not find it.
 */
export function entryPointsOf(
  src: string,
  sweep: ManifestSweep,
  files: readonly FileEntry[],
): readonly EntryPoint[] {
  const all = [...manifestEntryPoints(sweep), ...fileEntryPoints(src, files)];
  const keyed = all.map((entry) => ({ entry, key: pythonJsonSortKey(entry as JsonValue) }));
  keyed.sort((a, b) => compareCodePoint(a.key, b.key));
  return Object.freeze(keyed.map((one) => one.entry));
}

/* ------------------------------------------------------------------------- *
 * Workspaces (F140-FR-023)
 * ------------------------------------------------------------------------- */

/** Strip the `.` and `/` characters Python's `strip("./")` strips. */
function stripDotsAndSlashes(glob: string): string {
  return glob.replace(/^[./]+/, "").replace(/[./]+$/, "");
}

/** Whether a glob of a workspace list matches a directory (`**` is `*`). */
export function workspaceGlobMatches(glob: string, directory: string): boolean {
  return fnmatchToRegExp(glob.split("**").join("*")).test(directory);
}

/**
 * The workspace packages of a source (F140-FR-023): every directory that
 * holds a `package.json` (for the JS globs) or a `Cargo.toml` (for the Cargo
 * members), that a POSITIVE glob matches and that no `!` glob excludes. The
 * root itself is never a workspace — the manifest must lie in a subdirectory.
 */
export function detectWorkspaces(
  src: string,
  files: readonly FileEntry[],
  jsGlobs: readonly string[],
  cargoMembers: readonly string[],
): readonly Workspace[] {
  const found: Workspace[] = [];
  const directoriesOf = new Map<string, Set<string>>();
  for (const entry of files) {
    const name = baseNameOf(entry.path);
    if ((name === "package.json" || name === "Cargo.toml") && entry.path.includes("/")) {
      const directory = entry.path.slice(0, entry.path.lastIndexOf("/"));
      const bucket = directoriesOf.get(name) ?? new Set<string>();
      bucket.add(directory);
      directoriesOf.set(name, bucket);
    }
  }
  const rounds = [
    { kind: "js" as const, globs: jsGlobs, manifest: "package.json" },
    { kind: "cargo" as const, globs: cargoMembers, manifest: "Cargo.toml" },
  ];
  for (const round of rounds) {
    const positive = round.globs
      .filter((glob) => !glob.startsWith("!"))
      .map((glob) => stripDotsAndSlashes(glob).replace(/\/+$/, ""));
    const negative = round.globs
      .filter((glob) => glob.startsWith("!"))
      .map((glob) => stripDotsAndSlashes(glob.slice(1)).replace(/\/+$/, ""));
    for (const directory of sortByCodePoint(directoriesOf.get(round.manifest) ?? [])) {
      const hit = positive.some((glob) => workspaceGlobMatches(glob, directory));
      if (!hit) continue;
      if (negative.some((glob) => workspaceGlobMatches(glob, directory))) continue;
      let name: string | null = null;
      if (round.manifest === "package.json") {
        const data = readJson(join(src, directory, round.manifest));
        if (
          data !== null &&
          data !== undefined &&
          typeof data === "object" &&
          !Array.isArray(data)
        ) {
          const found_name = (data as Record<string, unknown>)["name"];
          if (typeof found_name === "string" && found_name !== "") name = found_name;
        }
      }
      found.push(Object.freeze({ kind: round.kind, path: directory, name: name ?? directory }));
    }
  }
  return Object.freeze(found);
}

/* ------------------------------------------------------------------------- *
 * Units (F140-FR-023)
 * ------------------------------------------------------------------------- */

/**
 * The units of a source, each with `path`, `files` and `bytes`, sorted by path
 * (F140-FR-023). With workspaces the units are the workspace packages, the
 * LONGEST prefix winning, plus `.` for everything they do not own; without
 * them the units are the top-level directories plus `.` for the root files.
 */
export function unitsOf(
  files: readonly FileEntry[],
  workspaces: readonly Workspace[],
): readonly Unit[] {
  const counted = new Map<string, { path: string; files: number; bytes: number }>();
  const add = (owner: string, entry: FileEntry): void => {
    const unit = counted.get(owner) ?? { path: owner, files: 0, bytes: 0 };
    unit.files += 1;
    unit.bytes += entry.bytes;
    counted.set(owner, unit);
  };
  if (workspaces.length > 0) {
    const prefixes = workspaces.map((one) => one.path).sort((a, b) => b.length - a.length);
    for (const entry of files) {
      const owner = prefixes.find((prefix) => entry.path.startsWith(`${prefix}/`)) ?? ".";
      add(owner, entry);
    }
  } else {
    for (const entry of files) {
      add(entry.path.includes("/") ? (entry.path.split("/")[0] as string) : ".", entry);
    }
  }
  return Object.freeze(
    sortByCodePoint(counted.keys()).map((path) => Object.freeze(counted.get(path) as Unit)),
  );
}

/**
 * The whole `project` record of the inventory document (F140-FR-021,
 * F140-FR-022, F140-FR-023): the manifest records, the language counts, the
 * frameworks, the entry points and the workspaces.
 */
export function projectFactsOf(
  src: string,
  files: readonly FileEntry[],
  sweep: ManifestSweep,
): ProjectFacts {
  const workspaces = detectWorkspaces(src, files, sweep.jsWorkspaceGlobs, sweep.cargoMembers);
  return Object.freeze({
    manifests: Object.freeze(sweep.manifests.map((one) => Object.freeze(one.record))),
    languages: languagesOf(files),
    frameworks: frameworksOf(sweep.dependencies),
    entry_points: entryPointsOf(src, sweep, files),
    workspaces,
  });
}
