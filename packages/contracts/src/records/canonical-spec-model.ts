/**
 * T103 — the type and the validator of the canonical spec model from
 * `schemas/canonical-spec-model.schema.json` (annex C, §C.7, the field table;
 * F100-FR-095).
 *
 * Schema id `specstride.spec-format/1:model`. The model is the output of
 * `parse` of EP-03 and the one thing every component that reads a
 * specification reads; a second parser does not exist. It carries no field
 * `schema`: it is not a record of the control plane but the value the port
 * returns, so it is validated by schema id and not through a logical name.
 *
 * The four-field view of a phase that the oracle pins (number, title,
 * section, criteria) is a projection of the model.
 */
import type { CanonicalSpecModel as Generated } from "./generated/canonical-spec-model.ts";
import { validate, type SchemaError } from "./compile.ts";

/** The schema id against which the model is validated (F100-FR-048). */
export const SCHEMA_ID = "specstride.spec-format/1:model" as const;

/** The section of annex C that owns the field list. */
export const ANNEX_SECTION = "annex C, §C.7" as const;

/** The kinds of source the field table names; `other` is any further kind. */
export const SOURCE_KINDS = ["spec", "plan", "tasks"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number] | (string & {});

/** One source file of the model, with its kind and its hashes. */
export type SpecSource = {
  readonly kind: SourceKind;
  readonly path: string;
  /** The content hash from the canonical hasher of annex X §X.5. */
  readonly contentHash: string;
  /** For a task list, the hash that ignores checkboxes. */
  readonly hashIgnoringCheckboxes?: string;
};

/** One task of a phase: id, markers, text, whether ticked, line. */
export type SpecTask = {
  readonly id: string;
  /** For example `[P]` and story tags. */
  readonly markers: readonly string[];
  readonly text: string;
  readonly ticked: boolean;
  readonly line: number;
};

/** One phase: number, title, section, acceptance criteria, and its tasks. */
export type SpecPhase = {
  readonly number: number;
  readonly title: string;
  readonly section: string;
  readonly criteria: readonly string[];
  /** Required; it may be empty. */
  readonly tasks: readonly SpecTask[];
};

/** The canonical spec model (annex C, §C.7). */
export type CanonicalSpecModel = Omit<Generated, "sources" | "phases"> & {
  readonly format: string;
  readonly feature: string;
  readonly sources: readonly SpecSource[];
  readonly phases: readonly SpecPhase[];
};

/** The fields the field table of §C.7 marks required. */
export const REQUIRED_FIELDS = ["format", "feature", "sources", "phases"] as const;

/** The four fields of the phase view the oracle pins (§C.7). */
export const PHASE_VIEW_FIELDS = ["number", "title", "section", "criteria"] as const;

/** A model that does not validate against `specstride.spec-format/1:model`. */
export class CanonicalSpecModelRefusedError extends Error {
  readonly errors: readonly SchemaError[];
  constructor(errors: readonly SchemaError[]) {
    super(
      `refused: the value is no canonical spec model of \`${SCHEMA_ID}\` ` +
        `(${errors.map((e) => `${e.path} ${e.message}`).join("; ")}) (annex C, §C.7)`,
    );
    this.name = "CanonicalSpecModelRefusedError";
    this.errors = Object.freeze([...errors]);
  }
}

/** Read the model: every required field of §C.7 is required. */
export function readCanonicalSpecModel(value: unknown): CanonicalSpecModel {
  const result = validate<CanonicalSpecModel>(SCHEMA_ID, value);
  if (!result.ok) throw new CanonicalSpecModelRefusedError(result.errors);
  return result.record;
}

/** `readCanonicalSpecModel` that returns a result instead of throwing. */
export function tryReadCanonicalSpecModel(
  value: unknown,
): { ok: true; model: CanonicalSpecModel } | { ok: false; error: CanonicalSpecModelRefusedError } {
  const result = validate<CanonicalSpecModel>(SCHEMA_ID, value);
  if (result.ok) return { ok: true, model: result.record };
  return { ok: false, error: new CanonicalSpecModelRefusedError(result.errors) };
}

/** True when the value validates against the schema of the model. */
export function isCanonicalSpecModel(value: unknown): value is CanonicalSpecModel {
  return validate<CanonicalSpecModel>(SCHEMA_ID, value).ok;
}

/** The projection of a phase the oracle pins (§C.7). */
export type PhaseView = {
  readonly number: number;
  readonly title: string;
  readonly section: string;
  readonly criteria: readonly string[];
};

/** The four-field view of every phase of a model, in order. */
export function phaseViews(model: CanonicalSpecModel): readonly PhaseView[] {
  return Object.freeze(
    model.phases.map((p) =>
      Object.freeze({ number: p.number, title: p.title, section: p.section, criteria: p.criteria }),
    ),
  );
}

/** The source of a declared kind, where the model holds one. */
export function sourceOfKind(model: CanonicalSpecModel, kind: SourceKind): SpecSource | undefined {
  return model.sources.find((s) => s.kind === kind);
}

/** An unknown field is ignored by a reader (annex B, §B.4; `x-unknown-field`). */
export const UNKNOWN_FIELD_IS_IGNORED = true as const;
