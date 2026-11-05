/**
 * T021 — the roots of state and the worker root, as data and types read from
 * `data/layout.json` (annex B, §B.1; F100-FR-032, F100-FR-033, F100-FR-034).
 *
 * The product keeps state in exactly three roots — user-level state, the
 * control plane of the workspace, the workspace part — and, with parallel
 * units on, in the worker root. Three further places appear in the table of
 * §B.5 and are not roots of state: `temp`, `package` and `harness-home`.
 *
 * The physical paths behind the logical roots are the `roots` key of
 * `data/layout.json` (plan.md, "Physical paths behind the logical names",
 * the first table). This module reads them; it invents none.
 */
import layout from "../../data/layout.json" with { type: "json" };

/** The four roots of state (annex B, §B.1). */
export const STATE_ROOTS = ["user", "control", "workspace", "worker-root"] as const;
export type StateRoot = (typeof STATE_ROOTS)[number];

/** The three places of the table of §B.5 that are not roots of state. */
export const NON_STATE_PLACES = ["temp", "package", "harness-home"] as const;
export type NonStatePlace = (typeof NON_STATE_PLACES)[number];

/** Anything the `Root` column of the table of §B.5 may name. */
export type RootName = StateRoot | NonStatePlace;

/** Every name the `Root` column may hold, roots of state first. */
export const ROOT_NAMES: readonly RootName[] = [...STATE_ROOTS, ...NON_STATE_PLACES];

/**
 * The physical placeholder of every root, verbatim from the `roots` key of
 * `data/layout.json`. The keys are the placeholders (`<control>`,
 * `<workspace-part>`, …); the values say where the placeholder points.
 */
export const rootPlaceholders: Readonly<Record<string, string>> = Object.freeze({
  ...(layout as { roots: Record<string, string> }).roots,
});

/** The layout version of the table this module reads (annex B, §B.2, SL-4). */
export const layoutVersion: string = (layout as { layoutVersion: string }).layoutVersion;

/** One row of the table of locations of §B.1. */
export type LocationRow = {
  readonly location: string;
  readonly root: StateRoot;
  readonly what: string;
  readonly writer: string;
  readonly readers: string;
};

const RAW_LOCATIONS = (layout as { locations: Record<string, string>[] }).locations;

const unbacktick = (cell: string): string => cell.replace(/`/g, "").trim();

/** The four rows of the table of §B.1, in the order of the annex. */
export const locations: readonly LocationRow[] = Object.freeze(
  RAW_LOCATIONS.map((row) =>
    Object.freeze({
      location: row["Location"] ?? "",
      root: unbacktick(row["Logical root"] ?? "") as StateRoot,
      what: row["What it is"] ?? "",
      writer: row["Who writes"] ?? "",
      readers: row["Who reads"] ?? "",
    }),
  ),
);

/**
 * The `Root` column of the table of §B.5 carries prose on some rows
 * (`user (cache)`, `workspace (the working tree, outside the workspace
 * part)`, `control or a location the sandbox lets the harness write; …`).
 * This returns the root the cell names, which is its first word.
 */
export function normaliseRoot(cell: string): RootName {
  const first = unbacktick(cell).split(/[\s(]/, 1)[0] ?? "";
  if ((ROOT_NAMES as readonly string[]).includes(first)) return first as RootName;
  throw new Error(`the root "${cell}" is not one of ${ROOT_NAMES.join(", ")} (annex B, §B.5)`);
}

/** True for the four roots of state, false for `temp`, `package`, `harness-home`. */
export function isStateRoot(name: string): name is StateRoot {
  return (STATE_ROOTS as readonly string[]).includes(name);
}

/** What a caller knows about the machine when it resolves a root. */
export type RootEnvironment = {
  readonly home: string;
  readonly xdgConfigHome?: string | undefined;
  readonly xdgStateHome?: string | undefined;
  readonly xdgCacheHome?: string | undefined;
  /** The control root the consumer set in user configuration, the environment or a flag. */
  readonly controlRootOverride?: string | undefined;
  /** The real path of the root of the working tree. */
  readonly workspaceRealPath: string;
  /** The identifier of §B.3. */
  readonly workspaceId: string;
  /** True when the harness adapter confirmed that the sandbox denies writes to the control plane. */
  readonly sandboxDeniesControlPlane?: boolean | undefined;
};

const join = (...parts: string[]): string =>
  parts
    .filter((p) => p !== "")
    .join("/")
    .replace(/\/{2,}/g, "/");

/** `$XDG_CONFIG_HOME/specstride`, default `~/.config/specstride`. */
export function userConfigRoot(env: RootEnvironment): string {
  return join(env.xdgConfigHome ?? join(env.home, ".config"), "specstride");
}

/** `$XDG_STATE_HOME/specstride/user`, default `~/.local/state/specstride/user`. */
export function userStateRoot(env: RootEnvironment): string {
  return join(env.xdgStateHome ?? join(env.home, ".local/state"), "specstride", "user");
}

/** `$XDG_CACHE_HOME/specstride`, default `~/.cache/specstride`. */
export function userCacheRoot(env: RootEnvironment): string {
  return join(env.xdgCacheHome ?? join(env.home, ".cache"), "specstride");
}

/** The result of resolving the control root, with the fallback of F100-FR-034. */
export type ControlRootResolution = {
  readonly path: string;
  /** `default` for the state directory, `override` for the root the consumer set. */
  readonly source: "default" | "override";
  /** True when the resolved root lies inside the working tree (F100-FR-034). */
  readonly insideWorkingTree: boolean;
  /**
   * `prevent` only where the root lies outside the working tree, or the
   * harness adapter confirmed the denial; else `detect` (annex B, §B.2, SL-6).
   */
  readonly protection: "prevent" | "detect";
  /**
   * Set where the root lies inside the working tree: a control root inside
   * the working tree is accepted only together with a deny rule for the
   * proposer's harness (F100-FR-034).
   */
  readonly requiresDenyRule: boolean;
};

/**
 * The control root of a workspace: `$XDG_STATE_HOME/specstride/workspaces/<workspaceId>`,
 * or the control root the consumer set in user configuration, the environment
 * or a flag (F100-FR-034). The control plane lies outside the working tree
 * (F100-FR-032); where the consumer's root lies inside it, the run records
 * `protection=detect` unless the harness adapter confirmed the denial.
 */
export function controlRoot(env: RootEnvironment): ControlRootResolution {
  const fallback = env.controlRootOverride;
  const path =
    fallback !== undefined && fallback !== ""
      ? fallback
      : join(
          env.xdgStateHome ?? join(env.home, ".local/state"),
          "specstride",
          "workspaces",
          env.workspaceId,
        );
  const inside = isInside(path, env.workspaceRealPath);
  return Object.freeze({
    path,
    source:
      fallback !== undefined && fallback !== "" ? ("override" as const) : ("default" as const),
    insideWorkingTree: inside,
    protection: !inside || env.sandboxDeniesControlPlane === true ? "prevent" : "detect",
    requiresDenyRule: inside,
  });
}

/**
 * The worker root: `$XDG_CACHE_HOME/specstride/workers`. It lies outside the
 * workspace and outside the control plane (F100-FR-033); it exists only with
 * parallel units on, and is removed when the run ends.
 */
export function workerRoot(env: RootEnvironment): string {
  return join(userCacheRoot(env), "workers");
}

/** The workspace part, `<workspace>/.specstride` — inside the working tree. */
export function workspacePart(env: RootEnvironment): string {
  return join(env.workspaceRealPath, ".specstride");
}

/** True when `path` is `root` or lies under it, compared by path segment. */
export function isInside(path: string, root: string): boolean {
  const p = path.replace(/\/+$/, "");
  const r = root.replace(/\/+$/, "");
  return p === r || p.startsWith(r + "/");
}

/**
 * F100-FR-032: a mutable file MUST NOT be shared between two workspaces.
 * Two control roots of two workspaces are disjoint when neither lies inside
 * the other.
 */
export function rootsAreDisjoint(a: string, b: string): boolean {
  return !isInside(a, b) && !isInside(b, a);
}
