#!/usr/bin/env node
/**
 * T004 — the generator and the check of `contracts/config-keys.tsv`
 * (F110-FR-001, F110-FR-009).
 *
 *     node packages/config/tools/config-keys-gen.ts            write the file
 *     node packages/config/tools/config-keys-gen.ts --check     compare with it
 *
 * The tables of `spec.md` §K.3 to §K.6b are the authority
 * (`specs/110-config-and-terms/contracts/README.md`: "The tables in `spec.md`
 * stand where the two differ"). This tool derives every column the tables
 * carry — the key, its type and range, its default, its value under `parity`,
 * its trust class with the snapshot class, its owner, its layers and its row
 * of annex X §X.7 — and joins the two columns the tables do NOT carry,
 * `proposed_by` and `confirmed_or_corrected`, from the hand-written source
 * `packages/config/data/config-keys-sources.json`.
 *
 * `--check` prints every difference and exits 1 when any exists, so a key
 * added to, removed from or re-typed in §K.3 to §K.6b without the catalogue
 * following it fails the build.
 *
 * The catalogue holds exactly the 259 keys of this feature. The four keys of
 * feature 107 that the tables also list are named in `EXCLUDED_KEYS` with the
 * reason, and the check fails when one of them is in the file or gains a source
 * row, so the count cannot drift in either direction.
 *
 * It also enforces the rule of §K.9: the old spelling of every correction and
 * every withdrawal lives in the `confirmed_or_corrected` column of the
 * standing key, never as a row of its own.
 *
 * It writes nothing outside `specs/110-config-and-terms/contracts/`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The ten columns of `contracts/config-keys.tsv`, in order. */
export const COLUMNS = [
  "key",
  "type_and_range",
  "default",
  "value_under_parity",
  "trust_class",
  "owner_feature",
  "proposed_by",
  "confirmed_or_corrected",
  "layers",
  "profile_row",
] as const;

/** The five sections of `spec.md` that hold the catalogue. */
export const CATALOGUE_SECTIONS = [
  "### §K.3 ",
  "### §K.4 ",
  "### §K.5 ",
  "### §K.6 ",
  "### §K.6b ",
] as const;

/**
 * The keys that §K.3 to §K.6b list but the catalogue of this feature does NOT
 * carry: the four keys of feature 107 that the tables gained in the second pass
 * of the cross-feature review. Task T004 fixes the catalogue at exactly the 259
 * keys of this feature (`specs/110-config-and-terms/tasks.md`: "the file holds
 * exactly those 259 keys"), and no owner ruling amends that count, so these four
 * stay in feature 107's own contract and out of `contracts/config-keys.tsv`.
 *
 * The exclusion cannot go stale: the check reports a problem when a name here is
 * in no table of §K.3 to §K.6b, and another when such a key is nonetheless given
 * a source row. Every other column of every carried key still comes from the
 * tables, which remain the authority.
 */
export const EXCLUDED_KEYS: readonly string[] = [
  "derive.stageTimeoutSec",
  "verification.scopes.<commandId>.reads",
  "verification.scopes.<commandId>.writes",
  "verification.scopes.<commandId>.sideEffects",
];

/** The number of keys `contracts/config-keys.tsv` holds, per T004. */
export const CATALOGUE_KEY_COUNT = 259;

/** A row of `contracts/config-keys.tsv`. */
export interface CatalogueRow {
  key: string;
  type_and_range: string;
  default: string;
  value_under_parity: string;
  trust_class: string;
  owner_feature: string;
  proposed_by: string;
  confirmed_or_corrected: string;
  layers: string;
  profile_row: string;
}

/** What the hand-written source adds to a key the tables already describe. */
export interface SourceRow {
  proposed_by: string;
  /** `confirmed`, or `corrected (old: …)` — the rule of §K.9. */
  confirmed_or_corrected: string;
  /**
   * The value under `parity` for a key that has no row of annex X §X.7 and
   * that the profile still names (only `toolchains.<id>` and
   * `harnesses.prime.tools`). Empty means "the tables decide".
   */
  value_under_parity: string;
  note: string;
}

/** A correction or a withdrawal of §K.9. */
export interface Correction {
  /** The spelling that no longer stands. */
  oldSpelling: string;
  /** `corrected`, `withdrawn`, or `not-a-key` (no standing key at all). */
  kind: "corrected" | "withdrawn" | "not-a-key";
  /** Where in §K.9 it was read. */
  source: string;
}

const unbacktick = (s: string): string => s.replace(/`/g, "").trim();

/** The cells of a markdown table row, or `null` when the line is not one. */
function cellsOf(line: string): string[] | null {
  if (!line.startsWith("|")) return null;
  const cells = line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());
  if (cells.length === 0) return null;
  if (cells.every((c) => /^:?-+:?$/.test(c))) return null;
  return cells;
}

/**
 * The owner cell of §K.3 to §K.6b, which packs three facts: the owning
 * feature or features, the rows of annex X §X.7 that name the key, and the
 * value the `parity` profile gives it.
 *
 * `110, 124. Row 36; (fixture)` → `110, 124`, rows `36`, parity `(fixture)`.
 * `126. Row 79; on. Row 86 names the same switch` → rows `79, 86`, parity `on`.
 * `147` → owner `147`, no row, parity `as default`.
 */
export function parseOwnerCell(owner: string): {
  ownerFeature: string;
  profileRow: string;
  valueUnderParity: string;
} {
  const head = owner.match(/^((?:\d+)(?:\s*,\s*\d+)*)\s*[.;]?\s*([\s\S]*)$/);
  const ownerFeature = head ? head[1].replace(/\s*,\s*/g, ", ") : owner.trim();
  const rest = head ? head[2] : "";
  const rows = [...rest.matchAll(/Rows?\s+(\d+)/g)].map((m) => m[1]);
  const first = rest.match(/Rows?\s+(\d+)\s*;\s*([\s\S]*)$/);
  const valueUnderParity = first
    ? unbacktick(first[2].split(". ")[0]).replace(/\.$/, "")
    : "as default";
  return {
    ownerFeature,
    profileRow: [...new Set(rows)].join(", "),
    valueUnderParity,
  };
}

/** Every key row of §K.3 to §K.6b, in the order the spec writes them. */
export function parseSpecTables(
  specText: string,
): Omit<CatalogueRow, "proposed_by" | "confirmed_or_corrected">[] {
  const out: Omit<CatalogueRow, "proposed_by" | "confirmed_or_corrected">[] = [];
  let inCatalogue = false;
  for (const line of specText.split("\n")) {
    if (line.startsWith("### ")) {
      inCatalogue = CATALOGUE_SECTIONS.some((s) => line.startsWith(s));
      continue;
    }
    if (!inCatalogue) continue;
    const cells = cellsOf(line);
    if (!cells || cells.length !== 7) continue;
    if (cells[0] === "Key") continue;
    const { ownerFeature, profileRow, valueUnderParity } = parseOwnerCell(cells[6]);
    out.push({
      key: unbacktick(cells[0]),
      type_and_range: unbacktick(cells[1]),
      default: unbacktick(cells[2]),
      layers: unbacktick(cells[3]),
      trust_class: `${unbacktick(cells[4])} (snap ${unbacktick(cells[5])})`,
      owner_feature: ownerFeature,
      value_under_parity: valueUnderParity,
      profile_row: profileRow,
    });
  }
  return out;
}

/**
 * The corrections and the withdrawals of §K.9: its first table (the 43 rows of
 * annex X §X.7, where row 42 is corrected) and its second table (the keys that
 * other features proposed).
 */
export function parseCorrections(specText: string): Correction[] {
  const lines = specText.split("\n");
  const out: Correction[] = [];
  let section: string | null = null;
  for (const line of lines) {
    if (line.startsWith("### ")) {
      section = line.startsWith("### §K.9 ") ? line : null;
      continue;
    }
    if (!section) continue;
    const cells = cellsOf(line);
    if (!cells) continue;

    // First table: | Row | Key of annex X | Decision |
    if (cells.length === 3 && /^\d+( to \d+|(, \d+)*)$/.test(cells[0])) {
      if (!/\*\*Corrected\*\*/.test(cells[2])) continue;
      for (const m of cells[1].matchAll(/`([^`]+)`/g)) {
        out.push({ oldSpelling: m[1], kind: "corrected", source: `§K.9 row ${cells[0]}` });
      }
      continue;
    }

    // Second table: | Old spelling | Decision | Reason |
    if (cells.length !== 3 || cells[0] === "Old spelling" || cells[0] === "Row") continue;
    const decision = cells[1];
    const kind: Correction["kind"] = /^Not a key/.test(decision)
      ? "not-a-key"
      : /Withdrawn/.test(decision)
        ? "withdrawn"
        : "corrected";
    const tokens = [...cells[0].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    // A cell may list a full key and then bare last segments of the same
    // parent ("`loop.micro.caps.escalations_per_task`, `escalations_per_attempt`, …").
    const parent = tokens[0]?.includes(".") ? tokens[0].slice(0, tokens[0].lastIndexOf(".")) : "";
    for (const t of tokens) {
      out.push({
        oldSpelling: t.includes(".") || !parent ? t : `${parent}.${t}`,
        kind,
        source: "§K.9 proposed keys",
      });
    }
  }
  return out;
}

/** The shape of `packages/config/data/config-keys-sources.json`. */
interface SourcesFile {
  note?: string;
  columns?: string[];
  rows: {
    key: string;
    proposed_by?: string;
    confirmed_or_corrected?: string;
    value_under_parity_override?: string;
    note?: string;
  }[];
}

/** The hand-written source of the two columns the tables do not carry. */
export function parseSources(jsonText: string): Map<string, SourceRow> {
  const out = new Map<string, SourceRow>();
  const file = JSON.parse(jsonText) as SourcesFile;
  for (const r of file.rows) {
    out.set(r.key, {
      proposed_by: r.proposed_by ?? "",
      confirmed_or_corrected: r.confirmed_or_corrected ?? "",
      value_under_parity: r.value_under_parity_override ?? "",
      note: r.note ?? "",
    });
  }
  return out;
}

/** The catalogue: the spec tables joined with the hand-written source. */
export function buildCatalogue(
  specText: string,
  sourcesText: string,
): { rows: CatalogueRow[]; problems: string[] } {
  const problems: string[] = [];
  const tableRows = parseSpecTables(specText);
  const sources = parseSources(sourcesText);

  const excluded = new Set(EXCLUDED_KEYS);
  const inTables = new Set(tableRows.map((r) => r.key));
  for (const key of EXCLUDED_KEYS) {
    if (!inTables.has(key)) {
      problems.push(`EXCLUDED_KEYS names ${key}, which no table of §K.3 to §K.6b has`);
    }
  }
  const specRows = tableRows.filter((r) => !excluded.has(r.key));

  const seen = new Set<string>();
  for (const r of specRows) {
    if (seen.has(r.key)) problems.push(`§K.3 to §K.6b name the key twice: ${r.key}`);
    seen.add(r.key);
  }
  for (const key of sources.keys()) {
    if (excluded.has(key)) {
      problems.push(
        `config-keys-sources.json names ${key}, which T004 leaves out of the catalogue ` +
          `(feature 107 owns it)`,
      );
      continue;
    }
    if (!seen.has(key)) {
      problems.push(`config-keys-sources.json names ${key}, which no table of §K.3 to §K.6b has`);
    }
  }

  const rows: CatalogueRow[] = specRows.map((r) => {
    const s = sources.get(r.key);
    if (!s) problems.push(`no source row for ${r.key} (proposed_by, confirmed_or_corrected)`);
    const override = s?.value_under_parity ?? "";
    if (override && r.value_under_parity !== "as default") {
      problems.push(
        `config-keys-sources.json overrides the value under parity of ${r.key}, ` +
          `but §K.3 to §K.6b already give it one (${r.value_under_parity})`,
      );
    }
    return {
      key: r.key,
      type_and_range: r.type_and_range,
      default: r.default,
      value_under_parity: override || r.value_under_parity,
      trust_class: r.trust_class,
      owner_feature: r.owner_feature,
      proposed_by: s?.proposed_by ?? "",
      confirmed_or_corrected: s?.confirmed_or_corrected ?? "",
      layers: r.layers,
      profile_row: r.profile_row,
    };
  });
  return { rows, problems };
}

/**
 * The rule of §K.9: the old spelling of every correction and every withdrawal
 * lives in the `confirmed_or_corrected` column of the standing key, and never
 * as a row of its own.
 */
export function checkCorrections(corrections: Correction[], rows: CatalogueRow[]): string[] {
  const problems: string[] = [];
  const keys = new Set(rows.map((r) => r.key));
  const recorded = rows.map((r) => r.confirmed_or_corrected).join("\n");
  for (const c of corrections) {
    if (keys.has(c.oldSpelling)) {
      problems.push(
        `${c.source}: the withdrawn spelling ${c.oldSpelling} still has a row of its own`,
      );
    }
    if (c.kind === "not-a-key") continue;
    if (!recorded.includes(c.oldSpelling)) {
      problems.push(
        `${c.source}: the old spelling ${c.oldSpelling} is in no ` +
          `confirmed_or_corrected column of a standing key`,
      );
    }
  }
  return problems;
}

/** The text of `contracts/config-keys.tsv`. */
export function renderTsv(rows: CatalogueRow[]): string {
  const lines = [COLUMNS.join("\t")];
  for (const r of rows) lines.push(COLUMNS.map((c) => r[c]).join("\t"));
  return `${lines.join("\n")}\n`;
}

/** Every line on which the generated text and the committed file differ. */
export function diffTsv(generated: string, committed: string): string[] {
  const g = generated.replace(/\n$/, "").split("\n");
  const c = committed.replace(/\n$/, "").split("\n");
  const gKeys = new Map(g.slice(1).map((l) => [l.split("\t")[0], l]));
  const cKeys = new Map(c.slice(1).map((l) => [l.split("\t")[0], l]));
  const out: string[] = [];
  if (g[0] !== c[0]) out.push(`header: spec gives "${g[0]}", the file has "${c[0]}"`);
  for (const [k, line] of gKeys) {
    if (!cKeys.has(k)) {
      out.push(`${k}: in §K.3 to §K.6b, missing from contracts/config-keys.tsv`);
      continue;
    }
    const other = cKeys.get(k) as string;
    if (line === other) continue;
    const a = line.split("\t");
    const b = other.split("\t");
    for (let i = 0; i < COLUMNS.length; i++) {
      if ((a[i] ?? "") !== (b[i] ?? "")) {
        out.push(`${k} [${COLUMNS[i]}]: spec gives "${a[i] ?? ""}", the file has "${b[i] ?? ""}"`);
      }
    }
  }
  const excluded = new Set(EXCLUDED_KEYS);
  for (const k of cKeys.keys()) {
    if (gKeys.has(k)) continue;
    out.push(
      excluded.has(k)
        ? `${k}: in contracts/config-keys.tsv, but T004 leaves it to feature 107`
        : `${k}: in contracts/config-keys.tsv, in no table of §K.3 to §K.6b`,
    );
  }
  const gOrder = [...gKeys.keys()];
  const cOrder = [...cKeys.keys()].filter((k) => gKeys.has(k));
  const gFiltered = gOrder.filter((k) => cKeys.has(k));
  for (let i = 0; i < Math.min(gFiltered.length, cOrder.length); i++) {
    if (gFiltered[i] !== cOrder[i]) {
      out.push(
        `order: row ${i + 1} is ${cOrder[i]} in the file and ${gFiltered[i]} in §K.3 to §K.6b`,
      );
      break;
    }
  }
  return out;
}

/** Where the generator reads and writes. */
export interface Places {
  specPath: string;
  sourcesPath: string;
  cataloguePath: string;
}

/** The places of this repository. */
export function defaultPlaces(): Places {
  const here = dirname(fileURLToPath(import.meta.url)); // packages/config/tools
  const root = join(here, "..", "..", "..");
  return {
    specPath: join(root, "specs", "110-config-and-terms", "spec.md"),
    sourcesPath: join(here, "..", "data", "config-keys-sources.json"),
    cataloguePath: join(root, "specs", "110-config-and-terms", "contracts", "config-keys.tsv"),
  };
}

/** What `--check` found. */
export interface CheckReport {
  rows: CatalogueRow[];
  /** Differences between the spec tables and the committed catalogue. */
  differences: string[];
  /** Everything else that is wrong: duplicates, missing sources, §K.9. */
  problems: string[];
}

/** Build the catalogue and compare it with the committed file. */
export function check(places: Places = defaultPlaces()): CheckReport {
  const specText = readFileSync(places.specPath, "utf8");
  const sourcesText = readFileSync(places.sourcesPath, "utf8");
  const { rows, problems } = buildCatalogue(specText, sourcesText);
  problems.push(...checkCorrections(parseCorrections(specText), rows));
  const committed = readFileSync(places.cataloguePath, "utf8");
  return { rows, differences: diffTsv(renderTsv(rows), committed), problems };
}

/** Write `contracts/config-keys.tsv` from the spec tables. */
export function write(places: Places = defaultPlaces()): CatalogueRow[] {
  const specText = readFileSync(places.specPath, "utf8");
  const sourcesText = readFileSync(places.sourcesPath, "utf8");
  const { rows, problems } = buildCatalogue(specText, sourcesText);
  if (problems.length > 0) {
    for (const p of problems) process.stderr.write(`${p}\n`);
    throw new Error(`${problems.length} problem(s) in the sources; nothing written`);
  }
  writeFileSync(places.cataloguePath, renderTsv(rows), "utf8");
  return rows;
}

function main(argv: string[]): number {
  const places = defaultPlaces();
  if (argv.includes("--check")) {
    const report = check(places);
    for (const p of report.problems) process.stdout.write(`problem: ${p}\n`);
    for (const d of report.differences) process.stdout.write(`differs: ${d}\n`);
    process.stdout.write(
      `checked ${report.rows.length} keys of §K.3 to §K.6b, ` +
        `${report.differences.length} differ, ${report.problems.length} problem(s)\n`,
    );
    return report.differences.length + report.problems.length > 0 ? 1 : 0;
  }
  const rows = write(places);
  process.stdout.write(`wrote ${rows.length} keys to ${places.cataloguePath}\n`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
