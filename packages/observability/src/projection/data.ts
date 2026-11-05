/**
 * T001, T002 — the data the compatibility projection is built on, and the
 * parsers that read it (feature 144, F144-FR-001, F144-FR-002).
 *
 * This folder, `packages/observability/src/projection/`, is the projection of
 * feature 144 inside the package `@specstride/observability` (layer L1, owners
 * 111, 128 and 144 in the package graph of feature 100). The package may import
 * `@specstride/contracts` and `@specstride/kernel` and no core package; this
 * module imports neither, only Node built-ins, so the setup carries no new
 * edge in the package graph.
 *
 * The projection is table-driven (F144-FR-002). Its table is a COPY, held in
 * this package's own `data/` folder, and the names of the event types come from
 * the COPY of the event catalogue in the same folder — the one source of the
 * type names. Nothing here reads `specs/`: the specification tree is the
 * contract the copies were taken from, never an input of the build.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The root of the package: two levels up from `src/projection`. */
const PACKAGE_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** The root of the repository: `packages/observability` is two levels down. */
const REPOSITORY_ROOT = dirname(dirname(PACKAGE_ROOT));

/** This package's own data folder. Never `specs/`. */
export const OBSERVABILITY_DATA_DIRECTORY = join(PACKAGE_ROOT, "data");

/** The folder of the projection's data: the copy of the contract table. */
export const PROJECTION_DATA_DIRECTORY = join(OBSERVABILITY_DATA_DIRECTORY, "projection");

/** The copy of `contracts/projection-table.tsv` the projection is driven by. */
export const PROJECTION_TABLE_FILE = join(PROJECTION_DATA_DIRECTORY, "projection-table.tsv");

/**
 * The copy of the event catalogue (annex X §X.6, row 73) in this package's
 * `data/` folder: the ONE source of the type names for the check of T002.
 */
export const EVENT_CATALOGUE_FILE = join(OBSERVABILITY_DATA_DIRECTORY, "event-catalogue.tsv");

/**
 * The behaviour inventory of research R18: the independent oracle for the old
 * names. It is research data under `docs/`, not a copy this feature wrote, and
 * not `specs/`.
 */
export const BEHAVIOUR_INVENTORY_FILE = join(
  REPOSITORY_ROOT,
  "docs/ecosystem/research/R18-behaviour-inventory.tsv",
);

/**
 * The four names of kind `event` in the inventory that are the events of no
 * file: the follower's synthetic marker, and three the exporter or a caller
 * makes (spec.md F144-FR-002; research R14 open question 12).
 */
export const NAMES_OF_NO_FILE = Object.freeze(["_reopen", "gate", "tool_use", "api_request"]);

/** The one name of a file that is NOT carried over (DV-037). */
export const NAMES_NOT_CARRIED = Object.freeze(["gates_migrated"]);

/** The three names of the learning stream (F144-FR-002). */
export const LEARNING_STREAM_NAMES = Object.freeze([
  "knob_adjusted",
  "knob_auto_reverted",
  "knob_evaluated",
]);

/**
 * The fields of a projected event that the old vocabulary lacks and that a
 * field map must therefore never name (F144-FR-009).
 */
export const FIELDS_NEVER_PROJECTED = Object.freeze(["seq", "passId", "category", "strategy"]);

/** One row of the projection table. */
export type ProjectionTableRow = {
  /** The event type of the catalogue the row is about. */
  readonly type: string;
  /** The condition on `data` that selects the row; empty for the only row. */
  readonly condition: string;
  /** The old name the row renders, or `-` where it writes nothing. */
  readonly legacyTarget: string;
  /** `bash`, `python`, `learning` or `none`. */
  readonly shape: string;
  /** `engine`, `stream-tap`, `critic` or `learning`. */
  readonly writerClass: string;
  /** The field map and the notes, verbatim. */
  readonly fieldMap: string;
  /** The line of the file the row is on, 1-indexed, for a readable failure. */
  readonly line: number;
};

/** The non-empty lines of a TSV, and its header split on tabs. */
function tsv(file: string): {
  readonly header: readonly string[];
  readonly rows: readonly string[][];
} {
  const lines = readFileSync(file, "utf8").split("\n");
  const kept: string[][] = [];
  let header: readonly string[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.length === 0) continue;
    const cells = line.split("\t");
    if (header.length === 0) {
      header = Object.freeze(cells);
      continue;
    }
    kept.push([...cells, String(index + 1)]);
  }
  return { header, rows: Object.freeze(kept) };
}

/** Read the copy of the projection table. */
export function readProjectionTable(
  file: string = PROJECTION_TABLE_FILE,
): readonly ProjectionTableRow[] {
  const { header, rows } = tsv(file);
  const at = (name: string): number => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`${file} has no column "${name}"`);
    return index;
  };
  const [typeAt, conditionAt, targetAt, shapeAt, classAt, mapAt] = [
    at("type"),
    at("condition"),
    at("legacy_target"),
    at("shape"),
    at("writer_class"),
    at("field_map_and_notes"),
  ];
  return Object.freeze(
    rows.map((cells) =>
      Object.freeze({
        type: cells[typeAt] ?? "",
        condition: cells[conditionAt] ?? "",
        legacyTarget: cells[targetAt] ?? "",
        shape: cells[shapeAt] ?? "",
        writerClass: cells[classAt] ?? "",
        fieldMap: cells[mapAt] ?? "",
        line: Number(cells[cells.length - 1] ?? "0"),
      }),
    ),
  );
}

/**
 * The event types of the catalogue, read from the COPY in this package's
 * `data/` folder — the one source of the type names (F144-FR-002).
 */
export function readCatalogueTypes(file: string = EVENT_CATALOGUE_FILE): readonly string[] {
  const { header, rows } = tsv(file);
  const typeAt = header.indexOf("type");
  if (typeAt < 0) throw new Error(`${file} has no column "type"`);
  return Object.freeze([...new Set(rows.map((cells) => cells[typeAt] ?? ""))].sort());
}

/**
 * The names of kind `event` the behaviour inventory holds: 70 of them. An item
 * of kind `event` names its event first, either as the first token or after
 * "Event" / "The event"; that is the inventory's own convention.
 */
export function readInventoryEventNames(
  file: string = BEHAVIOUR_INVENTORY_FILE,
): readonly string[] {
  const { header, rows } = tsv(file);
  const kindAt = header.indexOf("kind");
  const itemAt = header.indexOf("item");
  if (kindAt < 0 || itemAt < 0) throw new Error(`${file} has no "kind" and "item" column`);
  const names = new Set<string>();
  for (const cells of rows) {
    if ((cells[kindAt] ?? "") !== "event") continue;
    const hit = /^(?:(?:[Tt]he )?[Ee]vents? )?`(_?[a-z][a-z0-9_]*)`/.exec(
      (cells[itemAt] ?? "").trim(),
    );
    if (hit?.[1] !== undefined) names.add(hit[1]);
  }
  return Object.freeze([...names].sort());
}

/**
 * The 65 carried names: the names of the inventory, less the four that are the
 * events of no file and less `gates_migrated` (F144-FR-002; research D-6).
 */
export function carriedLegacyNames(file: string = BEHAVIOUR_INVENTORY_FILE): readonly string[] {
  const dropped = new Set<string>([...NAMES_OF_NO_FILE, ...NAMES_NOT_CARRIED]);
  return Object.freeze(readInventoryEventNames(file).filter((name) => !dropped.has(name)));
}

/**
 * The old names a row targets. `-` is nothing; a target that holds a space is
 * the NAME OF A FILE, not a name of the old vocabulary (`pipeline launcher
 * log`), and is not one of the 65.
 */
export function legacyNamesOf(row: ProjectionTableRow): readonly string[] {
  if (row.legacyTarget === "-") return Object.freeze([]);
  return Object.freeze(
    row.legacyTarget
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "" && !/\s/.test(name)),
  );
}

/**
 * The keys a field map NAMES — the keys of the as-is line the row writes.
 *
 * The cell is a key list with notes. The notes are what is dropped here:
 * every parenthesised group (they hold the conditions and the provenance), and
 * every `;`-separated clause that deliberately names the fields of the
 * catalogue type instead of the keys of the line ("filled from ...", "through
 * the accessor", "... are not projected"). What is left is split on `,` and
 * `/`, and a token that holds a space or an `=` is prose or a condition, not a
 * key.
 */
export function fieldMapKeys(fieldMap: string): readonly string[] {
  let text = fieldMap;
  for (let round = 0; round < 8; round += 1) {
    const stripped = text.replace(/\([^()]*\)/g, " ");
    if (stripped === text) break;
    text = stripped;
  }
  const keys: string[] = [];
  for (const clause of text.split(";")) {
    if (/filled from|through the accessor|not projected/i.test(clause)) continue;
    for (const raw of clause.split(/[,/]/)) {
      const token = raw
        .trim()
        .replace(/^(?:plus per reason:|plus extras|plus|as-is keys|then proposer:|ambient)\s*/i, "")
        .trim();
      if (token === "" || /\s/.test(token) || token.includes("=")) continue;
      keys.push(token);
    }
  }
  return Object.freeze(keys);
}
