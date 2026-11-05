/**
 * `@specstride/policy` — the quota half of feature 127 (classifier, pause,
 * fallback). Created by T002; the modules of `plan.md`, **Source Code** land
 * here as the later phases implement them:
 *
 * | Module | Content | Requirements | Task |
 * |---|---|---|---|
 * | `classify.ts` | the table evaluation, the pattern signals, the rule id | F127-FR-001 to F127-FR-003 | T010 |
 * | `actions.ts` | the action per class of §Q.1, the error counter | F127-FR-004, F127-FR-005 | T011 |
 * | `events.ts` | the events of this feature through the event port | F127-FR-040 | T012 |
 * | `probe.ts` | the confirming probe | F127-FR-006 | T018 |
 * | `host.ts` | the source `host` and the window-use estimate | F127-FR-007 | T020 |
 * | `windows.ts` | the limit-window state and its query | F127-FR-009 | T022 |
 * | `pause.ts` | the pause as a run state and its record | F127-FR-010, F127-FR-011 | T024 |
 * | `clocks.ts` | the pause clocks and `pausedMs` | F127-FR-012 | T027 |
 * | `resume.ts` | the resume time, the probe schedule, the resume | F127-FR-013 | T029 |
 * | `ceiling.ts` | the pause episode and its ceiling | F127-FR-014 | T031 |
 * | `recover.ts` | wake, crash, reboot, and the stop read during a pause | F127-FR-015, F127-FR-016 | T033 |
 * | `blocked.ts` | the blocked cases and their terminal records | F127-FR-017 | T036 |
 *
 * Phase 2 (T005, T010, T011, T012) added `table.ts` — the load and the
 * validation of the two data files of `../../data/` — and `classify.ts`,
 * `actions.ts` and `events.ts`. Phase 3 (T018, T020, T022, T024, T027, T029,
 * T031, T033, T036) added the nine modules of user story 1: `probe.ts`,
 * `host.ts`, `windows.ts`, `pause.ts`, `clocks.ts`, `resume.ts`,
 * `ceiling.ts`, `recover.ts` and `blocked.ts`.
 *
 * The modules of phase 3 are exported as NAMESPACES, because several of them
 * hold a name of the same shape (`CEILING_*`, `STOP_*`, a `note` field, and
 * both `./resume.ts` and `./recover.ts` speak of a remaining wait). A caller
 * writes `quota.pause.enterPause(...)` and `quota.resume.resumeTimeFor(...)`,
 * which also keeps the two apart for a reader.
 */
export * from "./ports.ts";
export * from "./table.ts";
export * from "./classify.ts";
export * from "./actions.ts";
export * from "./events.ts";

export * as probe from "./probe.ts";
export * as host from "./host.ts";
export * as windows from "./windows.ts";
export * as pause from "./pause.ts";
export * as clocks from "./clocks.ts";
export * as resume from "./resume.ts";
export * as ceiling from "./ceiling.ts";
export * as recover from "./recover.ts";
export * as blocked from "./blocked.ts";
