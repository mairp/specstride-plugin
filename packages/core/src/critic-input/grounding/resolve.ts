// Feature 117 (T036) — the resolver of the grounding pass (F117-FR-005,
// F117-FR-006, F117-FR-018).
//
// The as-is order of resolution: the exact path under the workspace root;
// then each member of the project's package workspace, the preferred member
// first; then the whole relative path under each search directory; then the
// base name under each search directory. A placeholder (`<...>` of 1 to 40
// characters without a slash) resolves as the pattern in which only it is a
// wildcard, first match in sorted order. A relative citation that leaves the
// workspace root after normalization NEVER resolves; an absolute citation is
// honoured as it is, outside the workspace included (F117-FR-006). EVERY
// result passes the refusal guard of `refuse.ts` by real path (F117-FR-018):
// a refused citation is returned AS refused and never as a grounded path.
//
// Every file-system call goes through the file-reading port of `ports.ts`.

import { basename, isAbsolute, join, relative, sep } from "node:path";
import type { FileReadingPort } from "../ports.ts";
import { refusalVerdict, type RefusedRoot, type RefusalVerdict } from "./refuse.ts";

/** How a citation resolved (the data model, field `how`). */
export type ResolutionHow =
  "exact" | "member" | "search-dir" | "basename" | "placeholder" | "wildcard" | "absolute";

/** The outcome of the resolution of one citation. */
export type ResolutionKind = "resolved" | "missing" | "build-export" | "refused";

/** One resolved path, as the data model of the plan describes it. */
export interface ResolvedPath {
  /** The citation the resolution started from. */
  readonly citation: string;
  /** The outcome. */
  readonly kind: ResolutionKind;
  /** The real path, when one resolved (already refusal-tested). */
  readonly realPath?: string;
  /** The path relative to the workspace root that the presence line shows. */
  readonly label?: string;
  /** How it resolved. */
  readonly how?: ResolutionHow;
  /** A member of the closed set of refused roots, or none. NEVER printed. */
  readonly refusedRoot?: string;
}

/** A placeholder citation `<...>` of 1 to 40 characters without a slash. */
export const PLACEHOLDER_RE = /^<[^<>/\n]{1,40}>$/;

/** True when a relative path leaves the workspace root after normalization. */
export function escapesWorkspace(path: string, workdir: string): boolean {
  const rel = relative(workdir, join(workdir, path));
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

/**
 * The members of the project's package workspace (F117-FR-005): the
 * `workspaces` patterns of the root manifest, with only a trailing `*` or
 * `**` segment expanded, negations skipped, and a member counted only when
 * it holds a package manifest.
 */
export function workspaceMembers(
  rootManifestText: string | undefined,
  workdir: string,
  io: FileReadingPort,
): string[] {
  if (rootManifestText === undefined) return [];
  let declared: unknown;
  try {
    declared = (JSON.parse(rootManifestText) as { workspaces?: unknown }).workspaces;
  } catch {
    return [];
  }
  const patterns: readonly unknown[] = Array.isArray(declared)
    ? declared
    : Array.isArray((declared as { packages?: unknown } | null)?.packages)
      ? (declared as { packages: unknown[] }).packages
      : [];
  const members: string[] = [];
  for (const pattern of patterns) {
    if (typeof pattern !== "string" || pattern.startsWith("!")) continue;
    const parts = pattern.split("/");
    const last = parts[parts.length - 1]!;
    let expanded: string[];
    if (last === "*" || last === "**") {
      const parent = join(workdir, ...parts.slice(0, -1));
      const entries = io.listDirectory(parent);
      if (entries === undefined) continue;
      expanded = [...entries].sort().map((name) => [...parts.slice(0, -1), name].join("/"));
    } else {
      expanded = [pattern];
    }
    for (const member of expanded) {
      if (members.includes(member)) continue;
      // A member counts only when it holds a package manifest.
      if (io.stat(join(workdir, member, "package.json"))?.isFile !== true) continue;
      members.push(member);
    }
  }
  return members;
}

/**
 * The preferred member (F117-FR-005): the one whose directory base name
 * appears in the hint text (the section or the phase evidence), the LONGEST
 * name first.
 */
export function preferredMemberFirst(members: readonly string[], hintText: string): string[] {
  return [...members].sort((a, b) => {
    const aHit = hintText.includes(basename(a)) ? 1 : 0;
    const bHit = hintText.includes(basename(b)) ? 1 : 0;
    if (aHit !== bHit) return bHit - aHit;
    return b.length - a.length;
  });
}

/**
 * The declared build exports of one member's package manifest (F117-FR-005):
 * the `exports`, `main`, `module` and `types` targets, without targets that
 * hold `*`.
 */
export function buildExports(manifestText: string | undefined): string[] {
  if (manifestText === undefined) return [];
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(manifestText) as Record<string, unknown>;
  } catch {
    return [];
  }
  const out: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value !== "string") return;
    if (value.includes("*")) return;
    if (!out.includes(value)) out.push(value);
  };
  add(manifest.main);
  add(manifest.module);
  add(manifest.types);
  const exportsField = manifest.exports;
  if (typeof exportsField === "string") add(exportsField);
  else if (exportsField !== null && typeof exportsField === "object") {
    for (const value of Object.values(exportsField as Record<string, unknown>)) {
      if (typeof value === "string") add(value);
      else if (value !== null && typeof value === "object") {
        for (const inner of Object.values(value as Record<string, unknown>)) add(inner);
      }
    }
  }
  return out;
}

/**
 * The search directories in the as-is order (F117-FR-005): the workspace
 * root, the proofs directory beside the phase evidence, the directory of the
 * phase evidence, `out`, every immediate subdirectory of the directory of
 * the phase evidence and of its proofs directory, and the directory of the
 * spec file where it lies inside the workspace.
 */
export function searchDirectories(
  workdir: string,
  io: FileReadingPort,
  proofsDir?: string,
  evidenceDir?: string,
  specDir?: string,
): string[] {
  const dirs: string[] = [];
  const push = (dir: string | undefined): void => {
    if (dir === undefined) return;
    const full = join(workdir, dir);
    if (!insideWorkspace(full, workdir)) return;
    if (io.stat(full)?.isDirectory !== true) return;
    if (!dirs.includes(dir)) dirs.push(dir);
  };
  const subdirectoriesOf = (dir: string | undefined): void => {
    if (dir === undefined) return;
    const entries = io.listDirectory(join(workdir, dir));
    if (entries === undefined) return;
    for (const name of [...entries].sort()) push(join(dir, name));
  };
  push("");
  push(proofsDir);
  push(evidenceDir);
  push("out");
  subdirectoriesOf(proofsDir);
  subdirectoriesOf(evidenceDir);
  push(specDir);
  return dirs;
}

function insideWorkspace(path: string, workdir: string): boolean {
  const rel = relative(workdir, path);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

/** Apply the refusal guard to a resolved real path; a refusal never resolves (F117-FR-018). */
function withRefusalGuard(
  result: ResolvedPath,
  roots: readonly RefusedRoot[],
  io: FileReadingPort,
): ResolvedPath {
  if (result.realPath === undefined) return result;
  const verdict: RefusalVerdict = refusalVerdict(result.realPath, roots, io);
  if (verdict.refused) {
    return {
      citation: result.citation,
      kind: "refused",
      refusedRoot: verdict.refusedRoot,
      label: result.citation,
      how: result.how,
    };
  }
  return result;
}

export interface ResolveContext {
  /** The workspace root. */
  readonly workdir: string;
  readonly io: FileReadingPort;
  /** The resolved refused roots (F117-FR-018); an empty list skips the guard. */
  readonly refusedRoots?: readonly RefusedRoot[];
  /** The search directories, in the as-is order (`searchDirectories`). */
  readonly searchDirs?: readonly string[];
  /** The workspace members, the preferred member first (`preferredMemberFirst`). */
  readonly members?: readonly string[];
  /** The declared build exports of the members (`buildExports`), member-relative. */
  readonly buildExports?: readonly { member: string; targets: string[] }[];
}

/** Read a small text file through the port, or `undefined`. */
function readText(io: FileReadingPort, path: string, limit = 262144): string | undefined {
  const bytes = io.read(path, 0, limit);
  if (bytes === undefined) return undefined;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/**
 * Resolve one citation in the as-is order (F117-FR-005, F117-FR-006); every
 * grounded result passes the refusal guard (F117-FR-018).
 */
export function resolveCitation(token: string, context: ResolveContext): ResolvedPath {
  const { workdir, io } = context;
  const roots = context.refusedRoots ?? [];
  const guard = (result: ResolvedPath): ResolvedPath => withRefusalGuard(result, roots, io);
  const label = (realPath: string): string => relative(workdir, realPath);
  const exists = (path: string): string | undefined => {
    const st = io.stat(path);
    if (st === undefined) return undefined;
    const real = io.realpath(path);
    return real ?? path;
  };

  // An absolute citation is honoured as it is, outside the workspace included
  // (F117-FR-006); the refusal guard decides whether it is grounded.
  if (isAbsolute(token)) {
    const real = exists(token);
    if (real !== undefined) {
      return guard({
        citation: token,
        kind: "resolved",
        realPath: real,
        label: token,
        how: "absolute",
      });
    }
    return guard({ citation: token, kind: "missing", label: token, how: "absolute" });
  }

  // A relative citation that leaves the workspace root never resolves (F117-FR-005).
  if (escapesWorkspace(token, workdir)) {
    return { citation: token, kind: "missing", label: token };
  }

  // 1. The exact path under the workspace root.
  const exact = exists(join(workdir, token));
  if (exact !== undefined) {
    return guard({
      citation: token,
      kind: "resolved",
      realPath: exact,
      label: label(exact),
      how: "exact",
    });
  }

  // A placeholder citation is the pattern in which only it is a wildcard;
  // the first match in sorted order wins (F117-FR-005).
  if (PLACEHOLDER_RE.test(token)) {
    const pattern = token
      .slice(1, -1)
      .replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === "*" ? ".*" : `\\${ch}`));
    const re = new RegExp(`^${pattern}$`);
    const entries = io.listDirectory(workdir) ?? [];
    for (const name of [...entries].sort()) {
      if (!re.test(name)) continue;
      const real = exists(join(workdir, name));
      if (real === undefined) continue;
      return guard({
        citation: token,
        kind: "resolved",
        realPath: real,
        label: name,
        how: "placeholder",
      });
    }
    return { citation: token, kind: "missing", label: token };
  }

  // 2. Each member of the package workspace, the preferred member first.
  for (const member of context.members ?? []) {
    const under = exists(join(workdir, member, token));
    if (under !== undefined) {
      return guard({
        citation: token,
        kind: "resolved",
        realPath: under,
        label: label(under),
        how: "member",
      });
    }
  }

  // A declared build export that is not on disk is a NEEDS-GROUNDING path,
  // not a missing one (F117-FR-007): the build likely did not run.
  for (const { member, targets } of context.buildExports ?? []) {
    for (const target of targets) {
      const candidate =
        token === target || token === `${member}/${target}` ? `${member}/${target}` : undefined;
      if (candidate === undefined) continue;
      const real = io.realpath(join(workdir, candidate));
      return guard({
        citation: token,
        kind: real === undefined ? "build-export" : "resolved",
        realPath: real,
        label: candidate,
        how: "member",
      });
    }
  }

  // 3. The whole relative path under each search directory.
  const base = basename(token.replace(/\/+$/, ""));
  for (const dir of context.searchDirs ?? []) {
    const under = exists(join(workdir, dir, token));
    if (under !== undefined) {
      return guard({
        citation: token,
        kind: "resolved",
        realPath: under,
        label: label(under),
        how: "search-dir",
      });
    }
  }

  // 4. The base name under each search directory.
  if (!token.includes("/")) {
    for (const dir of context.searchDirs ?? []) {
      const under = exists(join(workdir, dir, base));
      if (under !== undefined) {
        return guard({
          citation: token,
          kind: "resolved",
          realPath: under,
          label: label(under),
          how: "basename",
        });
      }
    }
  }

  return { citation: token, kind: "missing", label: token };
}

/** Convenience: resolve the manifests of the members and build the context. */
export function resolveContextWithManifests(
  context: ResolveContext & { readonly hintText?: string },
): ResolveContext {
  const rootManifest = readText(context.io, join(context.workdir, "package.json"));
  const members = preferredMemberFirst(
    workspaceMembers(rootManifest, context.workdir, context.io),
    context.hintText ?? "",
  );
  const buildExportsOf = members.map((member) => ({
    member,
    targets: buildExports(readText(context.io, join(context.workdir, member, "package.json"))),
  }));
  return { ...context, members, buildExports: [...buildExportsOf] };
}
