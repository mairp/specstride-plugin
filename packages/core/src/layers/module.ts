/**
 * T001 of feature 103 — the module group `layers` of `@specstride/core`
 * (`specs/103-proposer-pass/plan.md`, "Source Code (repository root)").
 *
 * The core side of the loop-layer interface: the eight call points in their
 * fixed order, the built-in layer `none`, registration with negotiation and
 * stacking, the eleven directives, and the read-only view of the phase
 * attempt. The interface itself and its closed sets are
 * `@specstride/contracts`; this directory holds the engine's side of it.
 *
 * The files `plan.md` assigns to this directory are listed in `FILES` below;
 * the phases after Setup write them.
 *
 * Boundary (F103-FR-028): a file of this directory may import
 * `@specstride/contracts` and `@specstride/kernel` and nothing else from the
 * product (F100-FR-012), and may not import a writer of the phase gate — the
 * rule `core-modules-103` of `tools/import-boundary/rules/` fails the build
 * on such an import. What is withheld from every layer by construction is
 * `WITHHELD_FROM_EVERY_LAYER` of `@specstride/contracts`. The layer
 * implementations of Wave 1 are other features' packages and are named in no
 * file of this directory (F100-FR-018).
 */
import {
  CALL_POINTS,
  DIRECTIVES,
  MAX_STACK_DEPTH,
  WITHHELD_FROM_EVERY_LAYER,
} from "@specstride/contracts/ep/loop-layer";

/** The directory this module group occupies, relative to the repository root. */
export const DIRECTORY = "packages/core/src/layers" as const;

/** The feature that owns the module group. */
export const OWNER = "103" as const;

/** The files `plan.md` assigns to the directory, in the order it lists them. */
export const FILES = [
  "call-points.ts",
  "none.ts",
  "registry.ts",
  "directives.ts",
  "attempt-view.ts",
] as const;

/** The eight call points, in the fixed order of annex D §D.1. */
export const THE_CALL_POINTS = CALL_POINTS;

/** The eleven directives a layer may declare at registration. */
export const THE_DIRECTIVES = DIRECTIVES;

/** Layers stack to a depth of at most two in Wave 1. */
export const STACK_DEPTH = MAX_STACK_DEPTH;

/** What no layer is given, whatever it declares (F103-FR-028). */
export const WITHHELD = WITHHELD_FROM_EVERY_LAYER;
