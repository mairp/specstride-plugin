/**
 * T088 — the binding of the plan to the hashes of its sources, and the
 * projection `tasks-v2` (F105-FR-012).
 *
 * The hash of the spec is taken over a PROJECTION, not over the file: the
 * format, the phase numbers and titles in order, and the text of each
 * criterion without its checkbox. Ticking a task or editing the prose around
 * it therefore does not move the hash, while a changed, added, removed,
 * renamed or reordered criterion does.
 *
 * The projection is built FROM THE CANONICAL SPEC MODEL (EP-03, feature 100,
 * annex C §C.7) and from no reading of a specification of this feature's own:
 * `specProjection` takes the model and never a text. The one text it takes is
 * the one the OLDER rule of the baseline hashes, for a plan that names no
 * projection (`specSourceText`), and that rule reads no grammar — it replaces
 * a ticked checkbox and hashes the rest.
 */
import type {
  CanonicalSpecModel,
  SpecPhase,
} from "@specstride/contracts/records/canonical-spec-model";
import { taskListHashIgnoringCheckboxes } from "@specstride/kernel/hasher";
import { canonicalJson, sha256Text } from "./hash.ts";

/** The name of the projection in `source.projection` (F105-FR-012). */
export const SPEC_PROJECTION = "tasks-v2" as const;

/** The refusal of a projection this build cannot reproduce (F105-FR-012). */
export const UNSUPPORTED_PROJECTION_MESSAGE = "unsupported source projection" as const;

/* ------------------------------------------------------------------ *
 * THE GRAMMAR IS NOT HERE.
 *
 * F104-SC-001 gives the grammar of a phase heading and of a task line to ONE
 * package, `@specstride/spec-formats` (EP-03), with ONE named exception: the
 * mark rule of F104-FR-022 inside `@specstride/kernel/hasher`. This package
 * may import neither the grammar owner nor anything else of the product but
 * the contracts and the kernel, and it holds no reader of the grammar:
 *
 *  - the TEXT OF A CRITERION arrives from the canonical spec model, whose
 *    `criteria` are already the text after the checkbox (annex C §C.7). What
 *    this module does with it is TRIM it, which is the rest of the baseline's
 *    `_criterion_text` (`lib/verification_plan.py`:675). A caller that hands
 *    a RAW line — only a test does, to measure the baseline's own defensive
 *    half — injects the grammar owner's reader as `CriterionNormalizer`;
 *  - the OLDER raw-text rule of F105-FR-012, for a plan with no
 *    `source.projection`, compares the hash of the task list THAT IGNORES
 *    CHECKBOXES. That hash is a field of the canonical spec model
 *    (`SpecSource.hashIgnoringCheckboxes`, §C.7) and an operation of the
 *    canonical hasher (annex X §X.5, `taskListHashIgnoringCheckboxes`), which
 *    is the one named exception. This module computes neither.
 * ------------------------------------------------------------------ */

/**
 * How the text of a criterion is read. The DEFAULT is the trim of the
 * baseline's `_criterion_text`; the stripping of a checkbox belongs to the
 * grammar owner and is injected where a caller hands a raw line.
 */
export type CriterionNormalizer = (criterion: string) => string;

/** The default: the trim, and no reading of the grammar. */
export const TRIM_ONLY: CriterionNormalizer = (criterion) => criterion.trim();

/**
 * The text of a criterion as the plan records it (F105-FR-012). `normalize`
 * is `TRIM_ONLY` unless a caller injects the grammar owner's reader.
 */
export function criterionText(
  criterion: string,
  normalize: CriterionNormalizer = TRIM_ONLY,
): string {
  return normalize(criterion).trim();
}

/**
 * The hash the OLDER rule of F105-FR-012 compares: the hash of the task list
 * that ignores checkboxes, from the canonical hasher of annex X §X.5 — the
 * one module F104-SC-001 permits to hold the mark rule.
 *
 * The baseline's own `spec_source_text` (`lib/verification_plan.py`:665)
 * unticks EVERY `- [x]` at the head of a line; the mark rule of F104-FR-022
 * unticks a task line that carries a task id. Over a task list whose ticked
 * lines carry ids — which is every Spec Kit task list, and every fixture of
 * the parity rows of this feature — the two give the SAME hash, and
 * `PT-105-C-080-source-binding` runs that against the baseline. Where they
 * could differ, the hash of the model is the product's rule, and this feature
 * does not keep a second one.
 */
export function specSourceTextHash(taskList: string): string {
  return taskListHashIgnoringCheckboxes(taskList);
}

/** One phase of the projection: `n`, `title`, `criteria` (F105-FR-012). */
export type ProjectedPhase = {
  readonly n: number;
  readonly title: string;
  readonly criteria: readonly string[];
};

/** The record of the projection: `projection`, `format`, `phases`. */
export type SpecProjectionDocument = {
  readonly projection: typeof SPEC_PROJECTION;
  readonly format: string;
  readonly phases: readonly ProjectedPhase[];
};

/** The phase view the projection reads out of the canonical spec model. */
export type ProjectionPhaseInput = Pick<SpecPhase, "number" | "title" | "criteria">;

/**
 * The baseline's `_spec_projection_document` (:687), built from the phases of
 * the canonical spec model: the model's `number` is the baseline's `n`, and
 * the title is trimmed as the baseline trims it.
 */
export function projectedPhases(
  phases: readonly ProjectionPhaseInput[],
  normalize: CriterionNormalizer = TRIM_ONLY,
): readonly ProjectedPhase[] {
  return Object.freeze(
    phases.map((phase) =>
      Object.freeze({
        n: phase.number,
        title: (phase.title ?? "").trim(),
        criteria: Object.freeze((phase.criteria ?? []).map((one) => criterionText(one, normalize))),
      }),
    ),
  );
}

/** The record of the projection of a canonical spec model (F105-FR-012). */
export function specProjectionDocument(input: {
  readonly format: string;
  readonly phases: readonly ProjectionPhaseInput[];
  readonly criterionText?: CriterionNormalizer | undefined;
}): SpecProjectionDocument {
  return Object.freeze({
    projection: SPEC_PROJECTION,
    format: input.format,
    phases: projectedPhases(input.phases, input.criterionText ?? TRIM_ONLY),
  });
}

/** The baseline's `spec_projection` (:704): the projection as canonical text. */
export function specProjection(input: {
  readonly format: string;
  readonly phases: readonly ProjectionPhaseInput[];
  readonly criterionText?: CriterionNormalizer | undefined;
}): string {
  return canonicalJson(specProjectionDocument(input));
}

/**
 * The baseline's `spec_projection_hash` (:726): the content hash of the text
 * form of the projection (F105-FR-011, F105-FR-012).
 */
export function specProjectionHash(input: {
  readonly format: string;
  readonly phases: readonly ProjectionPhaseInput[];
  readonly criterionText?: CriterionNormalizer | undefined;
}): string {
  return sha256Text(specProjection(input));
}

/** The projection of a whole canonical spec model (EP-03). */
export function specProjectionOfModel(model: CanonicalSpecModel): SpecProjectionDocument {
  return specProjectionDocument({ format: model.format, phases: model.phases });
}

/** The hash of the projection of a whole canonical spec model (EP-03). */
export function specProjectionHashOfModel(model: CanonicalSpecModel): string {
  return specProjectionHash({ format: model.format, phases: model.phases });
}

/**
 * `source` of the plan (F105-FR-012): the binding to the source hashes, frozen
 * at launch. `specPath` is the real path of the specification, `format` the
 * adapter that read it — the adapter is PART of the projection, so a document
 * a different adapter now reads hashes differently and refuses, as it should.
 */
export type SourceBinding = {
  readonly bundleId: string;
  readonly contentHash: string;
  readonly projection: typeof SPEC_PROJECTION;
  readonly specPath: string;
};

/**
 * The record of `declaredCommands` (F105-FR-012): the place, the content hash,
 * the schema version, the number of commands and the phases of the
 * verification-commands document, INSIDE the hashed body of the plan, so that
 * a change of the document invalidates the plan.
 */
export type DeclaredCommandsBinding = {
  readonly path: string;
  readonly contentHash: string;
  readonly schemaVersion: unknown;
  readonly count: number;
  readonly phases: readonly number[];
  readonly discovery?: string;
};

/** The five fields of `declaredCommands` that are inside the hashed body. */
export const DECLARED_COMMANDS_FIELDS = [
  "path",
  "contentHash",
  "schemaVersion",
  "count",
  "phases",
] as const;
