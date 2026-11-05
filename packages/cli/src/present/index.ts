/**
 * The presenter module of feature 145 (presenter, banner, theme).
 *
 * F145-FR-001: the presenter is a pure consumer of one run's event stream and
 * never affects the control flow of a run. This module is loaded lazily: a
 * read command never pays for it, because the only entry is
 * `loadPresentModule`, which dynamic-imports the requested submodule at call
 * time. No file under this directory is reachable through a static import
 * from `src/index.ts` or the router, and the module carries no native binary
 * addon of any kind — plan.md, Constraints.
 *
 * The submodules themselves are filled by the later tasks of
 * `specs/145-presenter/tasks.md` (T002 tables.ts, T003 follow.ts, T011
 * theme.ts, T012 banner.ts, T013 presenter.ts); this file is the setup
 * deliverable of T001.
 */

/** The repo-relative path of this module entry (the witness of T001). */
export const PRESENT_MODULE_PATH = "packages/cli/src/present/index.ts";

/** The submodules the tasks of the feature fill, in task order. */
export const PRESENT_SUBMODULES = Object.freeze([
  "tables",
  "follow",
  "theme",
  "banner",
  "presenter",
] as const);

/** One submodule name of the presenter module. */
export type PresentSubmodule = (typeof PRESENT_SUBMODULES)[number];

/**
 * The lazy entry of the module: resolves one submodule at call time. A caller
 * that never calls it never loads any file of the directory, so a read
 * command pays nothing for the presenter (plan.md, Project Type).
 */
export function loadPresentModule(name: PresentSubmodule): Promise<unknown> {
  return import(`./${name}.ts`);
}
