/**
 * T001 of feature 103 — the module group `carry` of `@specstride/core`
 * (`specs/103-proposer-pass/plan.md`, "Source Code (repository root)").
 *
 * Carry-over between the passes of a phase attempt and across a resume: the
 * ledger records of the namespace `core`, the counters, the writer of the
 * handoff, the index of verification obligations, and the session directive
 * with its drop rules.
 *
 * The files `plan.md` assigns to this directory are listed in `FILES` below;
 * the phases after Setup write them. `index.ts` of this directory is the
 * index of verification obligations, not a re-export barrel.
 *
 * Boundary: `@specstride/contracts` and `@specstride/kernel` only
 * (F100-FR-012), and no writer of the phase gate (F103-FR-028). The handoff
 * is the one carry-over file with a schema in `@specstride/contracts`
 * (`handoff.schema.json`, T003), because it crosses a FILE boundary
 * (F103-FR-041); the ledger record is feature 100's `specstride.ledger/1`.
 */
import {
  CORE_LEDGER_KINDS,
  FRESH_SESSION_REASONS,
  SESSION_DIRECTIVES,
} from "@specstride/contracts/enums/pass-loop";

/** The directory this module group occupies, relative to the repository root. */
export const DIRECTORY = "packages/core/src/carry" as const;

/** The feature that owns the module group. */
export const OWNER = "103" as const;

/** The files `plan.md` assigns to the directory, in the order it lists them. */
export const FILES = [
  "ledger-core.ts",
  "counters.ts",
  "handoff.ts",
  "index.ts",
  "session-directive.ts",
] as const;

/**
 * The files of this directory that `plan.md` does NOT list, each with the
 * task that added it and why. They are kept apart from `FILES` so that the
 * list above stays a faithful reading of the plan.
 */
export const FILES_ADDED_AFTER_THE_PLAN: Readonly<Record<string, string>> = Object.freeze({
  "fresh-session-reasons.json":
    "T076 — the eleven drop rules, a byte-identical copy of " +
    "specs/103-proposer-pass/contracts/fresh-session-reasons.json, which F103-FR-042 " +
    "requires the session directive to read rather than restate.",
  "switches.ts":
    "T081 (F103-SC-001) — the seam that names the three carry-over switches, the module " +
    "that reads each one, and the fields of `prompt.built` the experiments X3, X4, X9 and " +
    "X11 are measured from. No experiment is run here.",
});

/** The record kinds of the ledger namespace `core` (F103-FR-039). */
export const LEDGER_KINDS = CORE_LEDGER_KINDS;

/** The reasons a session is fresh (F103-FR-042). */
export const FRESH_REASONS = FRESH_SESSION_REASONS;

/** The two values of the session directive (F103-FR-042). */
export const DIRECTIVE_VALUES = SESSION_DIRECTIVES;

/** The logical name of the handoff; the engine regenerates it every pass. */
export const HANDOFF_LOGICAL_NAME = "feature:<slug>:handoff" as const;
