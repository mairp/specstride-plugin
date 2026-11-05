/**
 * T002 — the layout of `@specstride/host-claude-code`, as plan.md gives it
 * ("Source Code (repository root)"), declared as data so that a test can hold
 * the directory tree on disk against it.
 *
 * The package is layer L7, owner 113, and holds no product logic: every fact
 * the plugin needs is a line of the CLI (spec.md, "Scope"). It may import
 * `@specstride/contracts` at BUILD time only, which the package graph records
 * as `"@specstride/contracts (at build time only)"`; the module-level half of
 * that rule — the shim, which runs on the consumer's machine, imports nothing
 * — is the rule file
 * `tools/import-boundary/rules/113-host-claude-code-build-time-only.json`.
 */

/** The name of this package, as the package graph and `package.json` write it. */
export const PACKAGE_NAME = "@specstride/host-claude-code" as const;

/** The layer of the package in the graph of annex A §A.1 (F100-FR-002). */
export const PACKAGE_LAYER = "L7" as const;

/** The feature that owns the package. */
export const PACKAGE_OWNER = "113" as const;

/** The path of the package from the root of the repository. */
export const PACKAGE_DIRECTORY = "packages/host-claude-code" as const;

/** One directory of the layout: its path in the package and what it holds. */
export type LayoutDirectory = {
  /** The path inside the package, with `/` as the separator. */
  readonly path: string;
  /** What the directory holds, as plan.md writes it. */
  readonly holds: string;
  /** The task of `tasks.md` that fills it. */
  readonly filledBy: string;
  /** True where the directory is built into the published package. */
  readonly shipped: boolean;
};

/**
 * The layout of plan.md, in the order plan.md draws it. A test holds the tree
 * on disk against this list, so the declaration and the directories cannot
 * drift apart.
 */
export const PACKAGE_LAYOUT: readonly LayoutDirectory[] = Object.freeze([
  Object.freeze({
    path: "src/describe",
    holds: "capabilities and fallbacks (EP-01)",
    filledBy: "T005",
    shipped: false,
  }),
  Object.freeze({
    path: "src/render",
    holds: "renderSkill, renderEntry, renderStatusHooks; budget check",
    filledBy: "T006",
    shipped: false,
  }),
  Object.freeze({
    path: "src/shim",
    holds: "bin shim: resolve CLI, protocol check",
    filledBy: "T007",
    shipped: true,
  }),
  Object.freeze({
    path: "src/evals",
    holds: "eval driver over the host's suite runner; static check of suite files",
    filledBy: "T033",
    shipped: false,
  }),
  Object.freeze({
    path: "plugin/.claude-plugin",
    holds: "manifest, marketplace entry",
    filledBy: "T021",
    shipped: true,
  }),
  Object.freeze({
    path: "plugin/skills",
    holds: "specstride-run, specstride-reverse, doctor (SKILL.md + references)",
    filledBy: "T008, T009, T010",
    shipped: true,
  }),
  Object.freeze({
    path: "plugin/hooks",
    holds: "host hook configuration and thin shell shims",
    filledBy: "T016",
    shipped: true,
  }),
  Object.freeze({
    path: "plugin/bin",
    holds: "the shim",
    filledBy: "T007",
    shipped: true,
  }),
  Object.freeze({
    path: "evals",
    holds: "trigger cases and graders (not shipped); no model id",
    filledBy: "T027",
    shipped: false,
  }),
  Object.freeze({
    path: "tests/ci-checks",
    holds: "the seven checks; static check of the suite files",
    filledBy: "T025",
    shipped: false,
  }),
]);

/** The paths of the layout, in the order plan.md draws them. */
export const LAYOUT_PATHS: readonly string[] = Object.freeze(PACKAGE_LAYOUT.map((d) => d.path));

/**
 * The directories plan.md draws only as BRANCHES of the tree: they carry no
 * content of their own, every file lies in one of `PACKAGE_LAYOUT` below them.
 * `test/`, which holds the tests of the package, is not part of the layout
 * plan.md draws and is not one of these.
 */
export const CONTAINER_DIRECTORIES: readonly string[] = Object.freeze(["src", "plugin", "tests"]);

/** Every directory of the layout, branches included, as the tree on disk holds them. */
export const EVERY_DIRECTORY: readonly string[] = Object.freeze(
  [...CONTAINER_DIRECTORIES, ...PACKAGE_LAYOUT.map((d) => d.path)].sort(),
);

/** The one directory of `src/` whose modules ship and therefore import nothing. */
export const SHIM_DIRECTORY = "src/shim" as const;

/** The directory of the layout at a path, or `undefined`. */
export function directoryAt(path: string): LayoutDirectory | undefined {
  return PACKAGE_LAYOUT.find((d) => d.path === path);
}
