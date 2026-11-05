/**
 * T025 — the shape of a `data` schema of this folder.
 *
 * The catalogue (T004) derives a schema from a ROW: the properties are the
 * `data` fields of the row, nothing is required, and a field that holds a
 * member of a closed set carries that set as an `enum`. That is as much as a
 * row can say.
 *
 * The REQUIREMENTS F111-FR-006 to F111-FR-015 say more. They say which fields
 * a record MUST carry, what kind of value each holds, and which pairs of
 * fields have to agree. A refinement is that extra, written once per type, in
 * the file of the requirement that asks for it, so a reader of the spec finds
 * the schema where the requirement is.
 *
 * A refinement never contradicts the row: `index.ts` merges the two and the
 * consistency test reports a refinement that names a field the row does not
 * have, or an `enum` that differs from the closed set of the catalogue. The
 * row is the list of fields; the refinement is the obligation on them.
 */

/** The value one `data` field may hold. */
export type FieldRefinement = {
  /** The JSON types the value may have: `string`, `integer`, `null`, … */
  readonly type?: readonly string[];
  /** For an array, the shape of each member. */
  readonly items?: ObjectShape | { readonly type: string };
  /** For a record, the shape of the record. */
  readonly shape?: ObjectShape;
  /** The closed set the value is a member of. */
  readonly enum?: readonly string[];
  readonly note?: string;
};

/** The shape of a record a field holds: its fields, and whether more are allowed. */
export type ObjectShape = {
  readonly required: readonly string[];
  readonly optional?: readonly string[];
  /** False where a field the shape does not name makes the value wrong. */
  readonly additional?: boolean;
};

/** A cross-field rule: what one field's value says about another's. */
export type FieldRule = {
  readonly name: string;
  /** The message where the rule is broken, or null where it holds. */
  readonly check: (data: Readonly<Record<string, unknown>>) => string | null;
};

/** What one requirement asks of one event type, beyond its row. */
export type TypeRefinement = {
  /** The requirement that asks for it: `F111-FR-006` … `F111-FR-015`. */
  readonly requirement: string;
  readonly type: string;
  /** The fields the requirement says the record MUST carry. */
  readonly required: readonly string[];
  readonly fields: Readonly<Record<string, FieldRefinement>>;
  readonly rules?: readonly FieldRule[];
  readonly note?: string;
};

/** A content reference: a logical name, a hash and a size, and never a body. */
export const CONTENT_REFERENCE: ObjectShape = Object.freeze({
  required: Object.freeze(["logicalName", "hash", "size"]),
  additional: false,
});

/** A field that holds a content reference, or null where there is none. */
export const CONTENT_REFERENCE_FIELD: FieldRefinement = Object.freeze({
  type: Object.freeze(["object", "null"]),
  shape: CONTENT_REFERENCE,
  note: "content is referred to by logical name, hash and size (F111-FR-016)",
});

/** A whole number, or null where the value is unknown. */
export const COUNT_OR_NULL: FieldRefinement = Object.freeze({
  type: Object.freeze(["integer", "null"]),
});

/** A number, or null where the value is unknown. */
export const NUMBER_OR_NULL: FieldRefinement = Object.freeze({
  type: Object.freeze(["number", "integer", "null"]),
});

/** Text, or null where the value is unknown. */
export const TEXT_OR_NULL: FieldRefinement = Object.freeze({
  type: Object.freeze(["string", "null"]),
});

/** Text. */
export const TEXT: FieldRefinement = Object.freeze({ type: Object.freeze(["string"]) });

/** A whole number. */
export const COUNT: FieldRefinement = Object.freeze({ type: Object.freeze(["integer"]) });

/** True or false. */
export const FLAG: FieldRefinement = Object.freeze({ type: Object.freeze(["boolean"]) });

/** A time, UTC to the millisecond, or null. */
export const TIME_OR_NULL: FieldRefinement = Object.freeze({
  type: Object.freeze(["string", "null"]),
});

/** Build one refinement, frozen. */
export function refine(refinement: TypeRefinement): TypeRefinement {
  return Object.freeze({
    ...refinement,
    required: Object.freeze([...refinement.required]),
    fields: Object.freeze({ ...refinement.fields }),
    rules: refinement.rules === undefined ? undefined : Object.freeze([...refinement.rules]),
  });
}
