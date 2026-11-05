/**
 * T083 — the build of an overlay tree, the marker and the environment record
 * (F109-FR-032).
 *
 * The tree is built in the temporary directory of the system, under a
 * generated name, in this order: first the marker, written atomically; then
 * one directory per declared variable, readable by the owner only, and the
 * variable is set to that path for the harness; then the seeds, each created
 * exclusively, readable and writable by the owner only, with parent
 * directories readable by the owner only — a seed whose real path leaves the
 * directory of its variable is refused. Base directory variables that the
 * declaration does not overlay are unset for the harness. The variable for
 * the global git configuration is always set to a file inside the tree. The
 * git identity is resolved in the real environment, the specific key first
 * and the general key second, and handed over as the author and committer
 * variables; an identity is never invented, and an already exported variable
 * is left as it is. The environment record holds, in this order: every
 * unset, one set per declared variable, the global git configuration, the
 * git identity. A reader of the record accepts the two kinds `unset` and
 * `set` and treats every other kind as an error.
 */
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  DIRECTORY_PERMISSIONS,
  OVERLAY_TMP_PREFIX,
  MARKER_FILE,
  SEED_PERMISSIONS,
  type OverlayMarker,
} from "./sweep.ts";
import { seedPathEscapes, type AcceptedDeclaration } from "./declaration.ts";

/** The base directory variables the home overlay may unset (F109-FR-032). */
export const BASE_DIRECTORY_VARIABLES = [
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
] as const;

/** The variable for the global git configuration; always set inside the tree. */
export const GIT_CONFIG_GLOBAL_VARIABLE = "GIT_CONFIG_GLOBAL";

/** The name of the global git configuration file inside the tree. */
export const GIT_CONFIG_GLOBAL_FILE = "gitconfig";

/** The identity variables the tree hands over, in record order. */
export const IDENTITY_VARIABLES = [
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
] as const;

/** The general key each identity variable falls back to. */
export const GENERAL_IDENTITY_KEYS: Readonly<Record<string, string>> = {
  GIT_AUTHOR_NAME: "GIT_NAME",
  GIT_COMMITTER_NAME: "GIT_NAME",
  GIT_AUTHOR_EMAIL: "GIT_EMAIL",
  GIT_COMMITTER_EMAIL: "GIT_EMAIL",
};

/** One row of the environment record of a tree. */
export type EnvironmentRecordEntry =
  | { readonly kind: "unset"; readonly name: string }
  | { readonly kind: "set"; readonly name: string; readonly value: string };

/** The environment record of one overlay tree, in the as-is order. */
export type EnvironmentRecord = readonly EnvironmentRecordEntry[];

/**
 * F109-FR-032 — a reader of the record accepts the two kinds `unset` and
 * `set` and treats every other kind as an error.
 */
export function readEnvironmentRecord(
  record: readonly Record<string, unknown>[],
): EnvironmentRecord {
  return record.map((entry) => {
    if (entry.kind === "unset" && typeof entry.name === "string") {
      return { kind: "unset" as const, name: entry.name };
    }
    if (entry.kind === "set" && typeof entry.name === "string" && typeof entry.value === "string") {
      return { kind: "set" as const, name: entry.name, value: entry.value };
    }
    throw new Error(`overlay environment record: unknown kind '${String(entry.kind)}'`);
  });
}

/** The record of a built tree. */
export type BuiltOverlay = {
  readonly root: string;
  readonly marker: OverlayMarker;
  readonly record: EnvironmentRecord;
  /** The environment the harness receives (the record, applied). */
  readonly env: Record<string, string>;
};

/** The failure of a build: the pass fails, the harness is not started. */
export type BuildFailure = {
  readonly ok: false;
  readonly exit_code: 1 | 3;
  readonly message: string;
  /** Set when the half-made tree was removed again. */
  readonly removed?: true;
};

export type BuildOutcome = ({ readonly ok: true } & BuiltOverlay) | BuildFailure;

/** The as-is message of a failed populate (F109-FR-034). */
export function populateFailureMessage(
  component: string,
  id: string,
  dir: string,
  cause: string,
): string {
  return `${component}: could not create overlay for backend '${id}' in ${dir}: ${cause}`;
}

/** Resolves the git identity in the real environment; never invents one. */
export function resolveGitIdentity(
  env: Readonly<Record<string, string | undefined>>,
): readonly { name: string; value: string }[] {
  const resolved: { name: string; value: string }[] = [];
  for (const name of IDENTITY_VARIABLES) {
    const already = env[name];
    if (already !== undefined && already !== "") {
      // An already exported variable is left as it is (specific key first).
      resolved.push({ name, value: already });
      continue;
    }
    const general = env[GENERAL_IDENTITY_KEYS[name]];
    if (general !== undefined && general !== "") {
      resolved.push({ name, value: general });
    }
    // Neither key: no identity is invented.
  }
  return resolved;
}

/**
 * F109-FR-032 — build the tree. Everything is created under a generated
 * name in the system temporary directory, in the as-is order; any failure
 * removes the half-made tree and fails the pass without starting the
 * harness.
 */
export function buildOverlay(input: {
  readonly declaration: AcceptedDeclaration;
  readonly scopeWord: string;
  readonly ownerPid: number;
  readonly ownerStart: string | number | null;
  readonly component?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly overlaysHome?: boolean;
  /** Injectable temporary root, for tests. */
  readonly tmpRoot?: string;
}): BuildOutcome {
  const component = input.component ?? "specstride";
  let root: string | null = null;
  try {
    root = input.tmpRoot
      ? mkdtempSync(join(input.tmpRoot, `${OVERLAY_TMP_PREFIX}`))
      : mkdtempSync(join(tmpdir(), OVERLAY_TMP_PREFIX));
  } catch (cause) {
    return {
      ok: false,
      exit_code: 1,
      message: populateFailureMessage(
        component,
        input.declaration.key,
        input.tmpRoot ?? tmpdir(),
        `mktemp failed: ${String((cause as NodeJS.ErrnoException).code ?? cause)}`,
      ),
    };
  }
  try {
    // 1. The marker, written atomically (tmp + rename inside the tree).
    const marker: OverlayMarker = {
      contract: "specstride-overlay/v1",
      key: input.declaration.key,
      scope: input.scopeWord,
      vars: input.declaration.vars,
      ownerPid: input.ownerPid,
      ownerStart: input.ownerStart,
      createdAt: new Date().toISOString(),
    };
    const markerPath = join(root, MARKER_FILE);
    const tmpPath = `${markerPath}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(marker, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(tmpPath, markerPath);
    // 2. One directory per declared variable, readable by the owner only.
    const record: EnvironmentRecordEntry[] = [];
    const env: Record<string, string> = {};
    const varDirs = new Map<string, string>();
    for (const name of input.declaration.vars) {
      const dir = join(root, name);
      mkdirSync(dir, { mode: DIRECTORY_PERMISSIONS });
      varDirs.set(name, dir);
      record.push({ kind: "set", name, value: dir });
      env[name] = dir;
    }
    // 3. The seeds, exclusively, with parent directories for the owner only.
    for (const seed of input.declaration.seeds) {
      if (seedPathEscapes(seed.path)) {
        throw new Error(`seed path '${seed.path}' leaves the directory of '${seed.var}'`);
      }
      const parent = join(varDirs.get(seed.var) ?? root, dirname(seed.path));
      mkdirSync(parent, { recursive: true, mode: DIRECTORY_PERMISSIONS });
      const file = join(varDirs.get(seed.var) ?? root, seed.path);
      const fd = openSync(file, "wx", SEED_PERMISSIONS);
      try {
        writeFileSync(fd, seed.content);
      } finally {
        closeSync(fd);
      }
    }
    // The base directories the declaration does not overlay are unset.
    if (input.overlaysHome !== false) {
      for (const name of BASE_DIRECTORY_VARIABLES) {
        if (!input.declaration.vars.includes(name)) {
          record.push({ kind: "unset", name });
        }
      }
    }
    // The global git configuration is always a file inside the tree.
    const gitGlobal = join(root, GIT_CONFIG_GLOBAL_FILE);
    writeFileSync(gitGlobal, "", { flag: "wx", mode: 0o600 });
    record.push({ kind: "set", name: GIT_CONFIG_GLOBAL_VARIABLE, value: gitGlobal });
    env[GIT_CONFIG_GLOBAL_VARIABLE] = gitGlobal;
    // The git identity, specific key first and general key second.
    for (const identity of resolveGitIdentity(input.env ?? {})) {
      record.push({ kind: "set", name: identity.name, value: identity.value });
      env[identity.name] = identity.value;
    }
    // The record order is fixed: every unset first, then the sets in the
    // order they were declared and resolved (F109-FR-032).
    const ordered = reorderRecord(record);
    return { ok: true, root, marker, record: ordered, env };
  } catch (cause) {
    const causeText = String((cause as NodeJS.ErrnoException).message ?? cause);
    try {
      rmSyncNoRaise(root);
    } catch {
      /* never raise on the clean-up */
    }
    return {
      ok: false,
      exit_code: 1,
      removed: true,
      message: populateFailureMessage(component, input.declaration.key, root, causeText),
    };
  }
}

/** The record order of F109-FR-032: unset first, then the sets in order. */
function reorderRecord(record: EnvironmentRecord): EnvironmentRecord {
  const unsets = record.filter((one) => one.kind === "unset");
  const sets = record.filter((one) => one.kind === "set");
  return [...unsets, ...sets];
}

/** A removal that never raises (the clean-up of a failed build). */
function rmSyncNoRaise(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* the warning of F109-FR-035 is the sweep's business, not the build's */
  }
}
