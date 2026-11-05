/**
 * T266 — the layout table of the old side, the environment alias table and
 * the component-name table as versioned data with a loader (annex X, §X.8;
 * annex B, §B.5; F100-FR-214, F100-FR-056).
 *
 * `data/layout-old-side.json` is joined to the new side by logical name: an
 * item with a logical name resolves through the resolver of T034; an item
 * with a rule reports the rule. The as-is approval marker maps to
 * `gate:<N>:approved`. A baseline registry entry the port does not carry is
 * left without a logical name and handled by rule N-15.
 */
import oldSide from "../../data/layout-old-side.json" with { type: "json" };
import normalization from "../../data/normalization.json" with { type: "json" };
import {
  holdsLogicalName,
  resolve,
  type NameParameters,
  type RootPaths,
} from "../ids/logical-names.ts";
import { rule } from "./normalization.ts";

/** One item of the old side of the layout table (§X.8). */
export type OldSideItem = {
  /** The behaviour item, `B-0156`. */
  readonly item: string;
  /** The baseline the item belongs to: `SS` or `MOL`. */
  readonly system: string;
  /** How the item was disposed of. */
  readonly disposition: string;
  /** The feature that owns it. */
  readonly feature: string;
  /** The as-is paths of the item. */
  readonly asIsPaths: readonly string[];
  /** The logical names the item maps to, where it maps to any. */
  readonly logicalNames: readonly string[];
  /** The rule that stands where the item maps to no logical name. */
  readonly rule: string;
  /** What kind of thing the item is. */
  readonly what: string;
};

type RawItem = {
  item: string;
  system: string;
  disposition: string;
  feature: string;
  asIsPaths: string[];
  logicalNames: string[];
  rule: string;
  what: string;
};

/** The count the annex states (§X.8). */
export const ITEM_COUNT: number = (oldSide as { count: number }).count;

/**
 * The placeholders of the old side: the as-is directory names of the three
 * as-is systems. No package of the graph, no schema and no data file names one
 * outside this file (annex A §A.5, F100-FR-026; the check is T240).
 */
export const placeholders: Readonly<Record<string, string>> = Object.freeze({
  ...(oldSide as { placeholders: Record<string, string> }).placeholders,
});

/** Every as-is directory placeholder, split from the keys of the table. */
export const AS_IS_DIRECTORY_PLACEHOLDERS: readonly string[] = Object.freeze([
  ...new Set(
    Object.keys(placeholders)
      .flatMap((key) => key.split(","))
      .map((k) => k.trim())
      .filter((k) => k !== ""),
  ),
]);

/** Load the items of the old side (F100-FR-214). */
export function loadOldSide(): readonly OldSideItem[] {
  return Object.freeze(
    (oldSide as { items: RawItem[] }).items.map((row) =>
      Object.freeze({
        item: row.item,
        system: row.system,
        disposition: row.disposition,
        feature: row.feature,
        asIsPaths: Object.freeze([...row.asIsPaths]),
        logicalNames: Object.freeze([...row.logicalNames]),
        rule: row.rule,
        what: row.what,
      }),
    ),
  );
}

/** Every item of the old side, in the order of the annex. */
export const oldSideItems: readonly OldSideItem[] = loadOldSide();

/** One compared row of the old side (`As-is path` to `Logical name`). */
export type ComparedRow = {
  readonly asIsPath: string;
  /** The logical name of the new side, without the note the cell may carry. */
  readonly logicalName: string;
  /** The cell verbatim: some rows qualify the name ("existence only"). */
  readonly cell: string;
};

const unbacktickList = (cell: string): string[] =>
  cell
    .split(",")
    .map((p) => p.trim())
    .map((p) => (p.startsWith("`") && p.endsWith("`") ? p.slice(1, -1) : p))
    .filter((p) => p !== "" && p !== "—");

export const comparedRows: readonly ComparedRow[] = Object.freeze(
  (
    oldSide as { comparedRows: { "As-is path": string; "Logical name": string }[] }
  ).comparedRows.map((row) =>
    Object.freeze({
      asIsPath: row["As-is path"],
      // The cell names the logical name first and may qualify it after
      // ("`gate:<N>:approved` (existence only)").
      logicalName: /`([^`]+)`/.exec(row["Logical name"])?.[1] ?? "",
      cell: row["Logical name"],
    }),
  ),
);

/**
 * F100-FR-056 — the old side maps the as-is approval marker to
 * `gate:<N>:approved`.
 */
export const APPROVAL_MARKER_LOGICAL_NAME = "gate:<N>:approved" as const;

/** The join of one item to the new side (F100-FR-214). */
export type Join =
  | {
      readonly item: string;
      readonly kind: "logical-name";
      readonly logicalName: string;
      /** The path of the new side, where the caller gave the roots. */
      readonly path?: string | undefined;
    }
  | {
      readonly item: string;
      readonly kind: "rule";
      /** The rule that stands in place of a logical name. */
      readonly rule: string;
      /** The normalization rule the text names, where it names one. */
      readonly normalizationRule?: string | undefined;
    };

/** The rule of a baseline registry entry the port does not carry (F100-FR-214). */
export const RULE_FOR_A_REGISTRY_ENTRY_NOT_CARRIED = "N-15" as const;

const NORMALIZATION_ID = /\bN-\d{2}\b/;

/**
 * Join one item of the old side to the new side (F100-FR-214). An item with a
 * logical name resolves through the resolver of T034; an item with a rule
 * reports the rule.
 */
export function join(
  item: OldSideItem,
  parameters: NameParameters = {},
  roots: RootPaths = {},
): Join {
  const name = item.logicalNames.find((n) => holdsLogicalName(n));
  if (name !== undefined) {
    let path: string | undefined;
    try {
      path = resolve(name, parameters, roots);
    } catch {
      path = undefined;
    }
    return Object.freeze({
      item: item.item,
      kind: "logical-name" as const,
      logicalName: name,
      path,
    });
  }
  const named = NORMALIZATION_ID.exec(item.rule)?.[0];
  const normalizationRule = named !== undefined && rule(named) !== undefined ? named : undefined;
  return Object.freeze({
    item: item.item,
    kind: "rule" as const,
    rule: item.rule,
    normalizationRule,
  });
}

/** Join every item of the old side to the new side (F100-FR-214). */
export function joinAll(parameters: NameParameters = {}, roots: RootPaths = {}): readonly Join[] {
  return Object.freeze(oldSideItems.map((item) => join(item, parameters, roots)));
}

/** The items that map to no logical name: rule N-15 and its kin handle them. */
export function itemsHandledByARule(): readonly OldSideItem[] {
  return Object.freeze(
    oldSideItems.filter((i) => !i.logicalNames.some((n) => holdsLogicalName(n))),
  );
}

/* ------------------------------------------------------------------ *
 * The environment alias table and the component-name table of §X.8.
 * ------------------------------------------------------------------ */

/** One row of the environment alias table. */
export type EnvironmentAliasRow = {
  readonly asIsVariables: readonly string[];
  readonly keys: readonly string[];
  readonly asIs: string;
  readonly key: string;
};

export const environmentAliases: readonly EnvironmentAliasRow[] = Object.freeze(
  (
    normalization as { environmentAliases: { "As-is variable": string; Key: string }[] }
  ).environmentAliases.map((row) =>
    Object.freeze({
      asIsVariables: Object.freeze(unbacktickList(row["As-is variable"])),
      keys: Object.freeze(unbacktickList(row.Key)),
      asIs: row["As-is variable"],
      key: row.Key,
    }),
  ),
);

/** One row of the component-name table (§X.8, rule N-15). */
export type ComponentNameRow = {
  /** The as-is implementation file, as the annex writes it. */
  readonly asIsFile: string;
  /** The logical component name it maps to. */
  readonly componentName: string;
};

export const componentNames: readonly ComponentNameRow[] = Object.freeze(
  (
    normalization as {
      componentNames: { "As-is implementation file": string; "Logical component name": string }[];
    }
  ).componentNames.map((row) =>
    Object.freeze({
      asIsFile: row["As-is implementation file"],
      componentName: unbacktickList(row["Logical component name"])[0] ?? "",
    }),
  ),
);

/** The logical component name of an as-is implementation file (rule N-15). */
export function componentNameOf(asIsFile: string): string | undefined {
  return componentNames.find((r) => r.asIsFile === asIsFile)?.componentName;
}
