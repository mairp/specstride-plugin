/**
 * `@specstride/host-claude-code` — the Claude Code plugin of Specstride as a
 * thin layer over the published package (layer L7, owner 113).
 *
 * The package holds no product logic: every fact the plugin needs is a line of
 * the CLI (spec.md, "Scope"). Phase 1 of
 * `specs/113-host-claude-code/tasks.md` put the layout of plan.md (T002) and
 * the verification record of the host facts (T001, hermetic part) here; phase
 * 2 adds the three operations of EP-01 the host package offers at build time
 * and the shim that ships to the consumer:
 *
 *  - T005 `./describe/` — the six capabilities with their values and the
 *    declared fallback of each absent one (F113-FR-028, F113-FR-029);
 *  - T006 `./render/` — `renderSkill`, `renderEntry`, `renderStatusHooks` and
 *    the budget check (F113-FR-029, F113-FR-036);
 *  - T007 `./shim/` — the resolution order of the CLI, `--protocol` and the
 *    one refusal line (F113-FR-018, F113-FR-019).
 *
 * Phase 3 adds the three skill sources and the build step that renders them:
 *
 *  - T008 `./skill-run.ts` — `specstride-run`: the order of the steps, the
 *    outcome lines, the modes, the comment, the judgment, the audience notice
 *    and the data framing (F113-FR-002 to F113-FR-008, F113-FR-011,
 *    F113-FR-016, F113-FR-017);
 *  - T009 `./skill-reverse.ts` — `specstride-reverse` (F113-FR-014);
 *  - T010 `./skill-doctor.ts` — the doctor skill (F113-FR-015);
 *  - `./skill-common.ts` — what the three share: the prohibitions, the
 *    supervision cycle, the audience notice, the data framing;
 *  - `./skills.ts` — the three sources together, and `writePluginSkills`.
 *
 * Phase 4 adds the host hooks of User Story 2:
 *
 *  - T016, T017, T018 `./hooks.ts` — the host hook configuration, the four
 *    thin shell shims, the push-alert way with the monitor as the primary way,
 *    and the silence inside a child of a run (F113-FR-020 to F113-FR-027).
 *
 * The three skill modules are reached by their own sub-paths of the package:
 * each declares names of its own (`INVOCATION_IS_CONSENT` stands in two of
 * them), so they are not re-exported from here.
 */
export * from "./layout.ts";
export * from "./host-facts.ts";
export * from "./describe/index.ts";
export * from "./hooks.ts";
export * from "./render/index.ts";
export * from "./shim/index.ts";
export * from "./skills.ts";
