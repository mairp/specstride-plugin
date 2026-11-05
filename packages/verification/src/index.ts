/**
 * `@specstride/verification` (layer L1, owner 105): a consumer declares how
 * their project is verified — commands that build, check types, lint and
 * test. This package finds those declarations, freezes them at launch as a
 * verification plan and one check manifest per phase, and runs them as the
 * verification gate of every phase attempt, BEFORE the critic is called. A
 * failed command rejects the attempt with no critic call; the proposer's
 * claim and the critic's judgment never stand in for it.
 *
 * It owns the content of EP-07, the verification-plan source, and the public
 * verb `verify`. Every command runs through the check runner of feature 100,
 * annex C §C.8 — this package starts no process of its own, except a detached
 * command staged before, through the process primitive of the kernel
 * (`research.md` D-17).
 *
 * The folders of `plan.md`, "Project Structure", each carry one concern:
 *
 * | Folder | Concern |
 * |---|---|
 * | `mode/` | the modes `off`, `plan`, `required`; the settings; their errors |
 * | `plan/` | the plan record, the ids, the hashes, validation, obligations, suites, gates |
 * | `sources/` | the EP-07 registry; the commands document, the literal source, discovery |
 * | `manifest/` | the derivation of a check manifest, its hash, its comparison on a relaunch |
 * | `render/` | the plan for people, the phase context, the scaffolds, the safe writes |
 * | `gate/` | the verification gate, release verification, the feedback |
 * | `prestage/` | the staged commands, the detached ones, the reuse rules |
 * | `summary/` | the failure summary |
 * | `staleness/` | the check at critic start, under the `parity` profile only |
 * | `cli/` | the sub-commands of `verify` |
 *
 * Phase 1 creates the folders, writes the data files of discovery and of the
 * contracts, and extracts the hash, the renderer, the store and discovery of
 * Lisa's verification package as source (T006, `research.md` D-1, recorded in
 * `../EXTRACTED.md`). The later phases fill the rest; this index names what is
 * built.
 */
export * from "./plan/index.ts";
export * from "./sources/index.ts";
export * from "./render/index.ts";
export * from "./mode/index.ts";
export * from "./manifest/index.ts";
export * from "./gate/index.ts";
export * from "./prestage/index.ts";
export * from "./summary/index.ts";
export * from "./staleness/index.ts";
export * from "./cli/index.ts";
