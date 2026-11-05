/**
 * T009 — the types of the configuration schema (F110-FR-001, F110-FR-009,
 * F110-FR-010).
 *
 * §K.1 of `spec.md` names the seven columns a key has: the exact spelling, the
 * type and range, the default, the layers that may set it, its trust class of
 * annex X §X.2, its class in the run snapshot, and the feature that owns its
 * meaning. A key exists in the schema only with all of them (F110-FR-001), and
 * the build fails for a key without a class, a snapshot class, an owner, or a
 * type that cannot hold its default (F110-FR-010).
 */

/** The layers that may set a key (§K.1, column "Layers"). */
export const LAYER_CODES = ["F", "E", "P", "U", "C"] as const;
/** `F` flag, `E` environment, `P` project file, `U` user file, `C` contract pin. */
export type LayerCode = (typeof LAYER_CODES)[number];

/** The rank layer of `@specstride/contracts` that each code stands for. */
export const LAYER_OF_CODE = Object.freeze({
  F: "flag",
  E: "environment",
  P: "project-configuration",
  U: "user-configuration",
  C: "launch-contract-pin",
} as const);

/** The trust class of a key, as §K.1 writes it: `W`, `N` or `-`. */
export const TRUST_CODES = ["W", "N", "-"] as const;
export type TrustCode = (typeof TRUST_CODES)[number];

/**
 * What "stricter" means for a narrowing key (§K.1, column "Class"):
 * `lo` lower is stricter, `lo0` lower is stricter and 0 means unlimited,
 * `on` or `off` the stricter value, `sub` a subset. A key whose rule the
 * annex writes in prose carries `prose` with the text.
 */
export const NARROWING_DIRECTIONS = ["lo", "lo0", "on", "off", "sub", "prose"] as const;
export type NarrowingDirection = (typeof NARROWING_DIRECTIONS)[number];

/** The class of a key in the run snapshot (annex B §B.12): `p` pinned, `t` tunable. */
export const SNAPSHOT_CODES = ["p", "t", "-"] as const;
export type SnapshotCode = (typeof SNAPSHOT_CODES)[number];

/** The kinds of value a key can hold, read from the column "Type and range". */
export const VALUE_KINDS = [
  "integer",
  "number",
  "boolean",
  "text",
  "enum",
  "list",
  "table",
  "secret-ref",
] as const;
export type ValueKind = (typeof VALUE_KINDS)[number];

/** The parsed column "Type and range" of one key. */
export interface ValueSpec {
  /** What the key holds. */
  readonly kind: ValueKind;
  /** The cell as the table writes it, for the message of a type error. */
  readonly text: string;
  /** The unit of a number, where the cell names one: `Sec`, `Ms`, and so on. */
  readonly unit?: string | undefined;
  /** The smallest accepted value of a number, where the cell names one. */
  readonly min?: number | undefined;
  /** The largest accepted value of a number, where the cell names one. */
  readonly max?: number | undefined;
  /** True where 0 means "disabled" or "unlimited" and so escapes `min`. */
  readonly zeroEscapes?: boolean | undefined;
  /** The members of a closed set, where the cell names them. */
  readonly members?: readonly string[] | undefined;
  /** For `boolean`: the two literals the cell uses (`on, off` or `true, false`). */
  readonly booleanLiterals?: readonly [string, string] | undefined;
  /** For `list`: the members of the element set, where the cell names them. */
  readonly elementMembers?: readonly string[] | undefined;
  /** For `list`: what one element holds (`list of percent` holds integers). */
  readonly elementKind?: ValueKind | undefined;
  /** True where the cell states the range only in prose, so no bound is checked. */
  readonly rangeIsProse?: boolean | undefined;
}

/** The parsed column "Default" of one key. */
export type DefaultSpec =
  /** The table states a value of the key's own type. */
  | { readonly kind: "value"; readonly value: unknown; readonly text: string }
  /** The table states that the key holds nothing (`none`, `unset`, `empty`). */
  | {
      readonly kind: "absent";
      readonly value: null | readonly never[];
      readonly text: string;
    }
  /**
   * The table states where the default comes from instead of naming it — the
   * harness, the descriptor, the platform, the owning feature. The owner of the
   * key supplies it; no type check applies, and the text is carried so that
   * `config show` and `config schema` can print it.
   */
  | { readonly kind: "deferred"; readonly text: string };

/** The parsed column "Under `parity`" of one key. */
export type ParitySpec =
  /** The key keeps its default under the profile (the cell `as default`). */
  | { readonly kind: "as-default"; readonly text: string }
  /** The cell names a value of the key's own type. */
  | { readonly kind: "value"; readonly value: unknown; readonly text: string }
  /** The cell carries a reserved literal of §K.7 (closed set, annex X §X.6 row 239). */
  | { readonly kind: "literal"; readonly literal: ReservedLiteral; readonly text: string };

/**
 * The five reserved literals of the column "Under `parity`" (F110-FR-008;
 * closed set 239 of annex X §X.6). They are the only non-value entries.
 */
export const RESERVED_PARITY_LITERALS = [
  "off",
  "not used",
  "baseline",
  "as-is",
  "(fixture)",
] as const;
export type ReservedLiteral = (typeof RESERVED_PARITY_LITERALS)[number];

/** One key of the catalogue, with every column of §K.1 read (F110-FR-001). */
export interface KeyEntry {
  /** The exact spelling (§K.2 rule 1). */
  readonly key: string;
  /** The parsed type and range. */
  readonly type: ValueSpec;
  /** The parsed default. */
  readonly default: DefaultSpec;
  /** The parsed value under the `parity` profile. */
  readonly parity: ParitySpec;
  /** The layers that may set the key; a layer not listed is refused. */
  readonly layers: readonly LayerCode[];
  /** The note the column "Layers" adds, where it has one. */
  readonly layerNote: string;
  /** The trust class of annex X §X.2. */
  readonly trust: TrustCode;
  /** What "stricter" means, for a narrowing key. */
  readonly narrowing?: NarrowingDirection | undefined;
  /** The rule of a narrowing key that the annex writes in prose. */
  readonly narrowingNote?: string | undefined;
  /** The class of the key in the run snapshot. */
  readonly snapshot: SnapshotCode;
  /** The features that own the meaning of the key (F110-FR-009). */
  readonly owners: readonly string[];
  /**
   * The rows of annex X §X.7 the key belongs to. Most switches have one; a key
   * that two rows name (`stream.tap`, rows 79 and 86) has both.
   */
  readonly profileRows: readonly number[];
  /** True where the key is a template: it carries `<N>`, `<id>`, `<role>`, … */
  readonly isTemplate: boolean;
  /** The parameters of a template key, in the order they appear. */
  readonly parameters: readonly string[];
  /** The cells of the contract, verbatim, for `config schema`. */
  readonly cells: {
    readonly typeAndRange: string;
    readonly default: string;
    readonly valueUnderParity: string;
    readonly trustClass: string;
    readonly layers: string;
    readonly ownerFeature: string;
  };
}

/** The reason a value was refused (F110-FR-001). */
export const CONFIG_ERROR_REASONS = [
  "unknown-key",
  "type",
  "range",
  "layer-not-allowed",
  "schema-major",
  "inline-secret",
] as const;
export type ConfigErrorReason = (typeof CONFIG_ERROR_REASONS)[number];

/**
 * A value the schema refuses. F110-FR-001: the message names the key, the
 * value, the layer and the range. Every field is also a property, so that a
 * caller can build its own message without parsing this one.
 */
export class ConfigValueError extends Error {
  readonly reason: ConfigErrorReason;
  readonly key: string;
  /** The value as it was offered, never a secret value (F110-FR-027). */
  readonly value: unknown;
  /** The layer that offered it, as the column "Layers" names it. */
  readonly layer: string;
  /** The type and range of the key, as §K.1 writes it. */
  readonly range: string;
  constructor(fields: {
    reason: ConfigErrorReason;
    key: string;
    value: unknown;
    layer: string;
    range: string;
    message: string;
  }) {
    super(fields.message);
    this.name = "ConfigValueError";
    this.reason = fields.reason;
    this.key = fields.key;
    this.value = fields.value;
    this.layer = fields.layer;
    this.range = fields.range;
  }
}

/**
 * A key the schema does not know (F110-FR-002, §K.2 rule 2). The message names
 * the file, the key and the nearest known key, found ignoring case and
 * underscores.
 */
export class UnknownKeyError extends Error {
  readonly reason = "unknown-key" as const;
  readonly key: string;
  /** The file or layer the key was found in. */
  readonly file: string;
  /** The nearest known key, or `undefined` when nothing is near enough. */
  readonly nearest: string | undefined;
  constructor(fields: { key: string; file: string; nearest: string | undefined }) {
    super(
      `${fields.file}: the key \`${fields.key}\` is not in the configuration schema` +
        (fields.nearest === undefined
          ? ". The schema is a closed list of exact spellings (§K.2 rule 1)"
          : `. The nearest known key is \`${fields.nearest}\``),
    );
    this.name = "UnknownKeyError";
    this.key = fields.key;
    this.file = fields.file;
    this.nearest = fields.nearest;
  }
}
