/**
 * The outputs for people and for prompts: the plan for people, the phase
 * context, the scaffolds, and the safe writes that guard them (`plan.md`,
 * "Project Structure"; F105-FR-022 to F105-FR-025).
 *
 * Phase 1 extracted the renderer and the store of Lisa's verification package
 * here as source (T006, `research.md` D-1, recorded in `../../EXTRACTED.md`):
 * the store is the safe-write path of the renderer's output. Phase 4 writes
 * the four outputs of the Specstride baseline beside them — the plan for
 * people (T098), the safe writes (T099), the scaffolds (T100) and the phase
 * context (T101).
 *
 * The two renderers and the two write paths keep their own names: the
 * extracted ones write Lisa's marker and Lisa's headings and are pinned as
 * they were extracted, and the ones this feature writes are the Specstride
 * baseline's (`EXTRACTED.md`, "What a later phase changes on purpose").
 */
export * as lisaRender from "./lisa-render.ts";
export * as lisaStore from "./lisa-store.ts";
export * from "./plan-for-people.ts";
export * from "./safe-writes.ts";
export * from "./scaffolds.ts";
export * from "./phase-context.ts";
