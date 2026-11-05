// @specstride/adapter-codex: the Codex harness adapter (feature 131).
//
// Phase 1 (setup) creates the package directories of `specs/131-adapter-codex/
// plan.md` and this entry module. The data modules (`data/descriptor.json`,
// `data/argument-table.json`, `data/stream-mapping.json`, `data/classifier.json`,
// `data/terms-rows.json`, `data/window-table.json`) and the code modules
// (`detect.ts`, `preflight.ts`, `arguments.ts`, `critic-readonly.ts`,
// `login-text.ts`, `doctor.ts`, `environment.ts`, `session.ts`, `identity.ts`)
// are written by the later phases of `specs/131-adapter-codex/tasks.md`; the
// recorded fixtures live under `fixtures/` (captures 1 to 5, each with its
// harness version).

/** The registry id of the adapter (F131-FR-001). */
export const ADAPTER_ID = "codex" as const;

/** The kind of the harness descriptor (F131-FR-001). */
export const DESCRIPTOR_KIND = "cli" as const;

/** The provider of the harness (F131-FR-001; form (b) rides `openai-chat`). */
export const PROVIDER_ID = "openai" as const;

/**
 * The harness version the recorded facts of this feature are pinned to, read
 * with a read-only `codex --version` (first read 2026-09-29, re-read
 * 2026-10-26); F131-FR-007, Principle X.
 */
export const HARNESS_PIN = "codex-cli 0.153.4" as const;

/** The date of the read behind `HARNESS_PIN` (F131-FR-007). */
export const PIN_VERIFIED_ON = "2026-09-29" as const;

/**
 * The containment ceiling of the adapter (F131-FR-011): the sandbox modes
 * `read-only` and `workspace-write`; never `danger-full-access`.
 */
export const CONTAINMENT_CEILING = "C2" as const;
