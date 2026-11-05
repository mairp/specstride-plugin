/**
 * The verification plan: its record, its ids, its hashes, its validation, the
 * verification obligations, the suites and the verification gates
 * (`plan.md`, "Project Structure"; F105-FR-011 to F105-FR-014,
 * F105-FR-018, F105-FR-019).
 *
 * Phase 1 extracted the hash of Lisa's verification package here as source
 * (T006, `research.md` D-1, recorded in `../../EXTRACTED.md`) together with
 * the plan shapes the extracted modules read; phase 4 writes the PLANNER new
 * on the canonical spec model beside them (T087 to T090, T094, T095).
 *
 * The extracted hash of Lisa (`./lisa-hash.ts`) and the hash of this feature
 * (`./hash.ts`) are two modules on purpose: the extracted one is pinned as it
 * was extracted and takes the FIRST 20 characters of a digest over
 * `JSON.stringify` with its default separators, and the one this feature uses
 * is the canonical hasher of annex X §X.5 over the baseline's text form. The
 * names `canonicalJson`, `sha256` and `stableId` would collide, so the
 * extracted module is re-exported UNDER ITS OWN NAMES and the planner's are
 * the folder's.
 */
export * as lisaHash from "./lisa-hash.ts";
export type * from "./lisa-plan.ts";
export * from "./hash.ts";
export * from "./projection.ts";
export * from "./record.ts";
export * from "./obligations.ts";
export * from "./suites.ts";
export * from "./validate.ts";
export * from "./required.ts";
export * from "./source-revision.ts";
export * from "./create.ts";
