#!/usr/bin/env node
/**
 * T005 — the coverage check of `contracts/alias-table.tsv` against the 226
 * items of kind `env` of `docs/ecosystem/research/R18-behaviour-inventory.tsv`
 * (F110-FR-020).
 *
 *     node packages/config/tools/alias-coverage.ts          report
 *     node packages/config/tools/alias-coverage.ts --check   exit 1 on a gap
 *
 * Every as-is variable that the baseline reads must be in the alias table —
 * with the key or keys it reaches, or in a row that says it is not carried.
 * The variables of a locally registered backend are omitted (DV-064): the
 * closed registry becomes the open harness registry and a consumer declares
 * such a harness itself, so its variables reach no key of this product.
 *
 * It reads only; it writes nothing.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The nine items of kind `env` that DV-064 removes from the port. */
export const DV_064_ITEMS: readonly string[] = [
  "B-0519",
  "B-0520",
  "B-0815",
  "B-0816",
  "B-0834",
  "B-0835",
  "B-0836",
  "B-0837",
  "B-0838",
];

/** A row of `contracts/alias-table.tsv`. */
export interface AliasRow {
  variable: string;
  key: string;
  note: string;
}

/** An item of kind `env` of the behaviour inventory. */
export interface EnvItem {
  bItem: string;
  item: string;
  evidence: string;
  /** Every as-is variable name the item names. */
  variables: string[];
}

/**
 * A name the inventory writes in backticks: every as-is variable it names is
 * written that way, with or without a `<PLACEHOLDER>` segment.
 */
const BACKTICKED = /`([A-Z][A-Z0-9_]*(?:<[A-Z_]+>[A-Z0-9_]*)?|<[A-Z_]+>[A-Z0-9_]*)`/g;
/** The families the inventory also writes unquoted in prose. */
const PREFIXED =
  /\b((?:SPECSTRIDE|RALPH|WIGGUM|OPENAI|ANTHROPIC|DSH|PI|PRIME_AGENT|MOL|IS)_[A-Z0-9_]*[A-Z0-9])\b/g;

/**
 * Tokens the inventory writes in backticks that are not environment variable
 * names. Each is named here so that the check stays exhaustive: nothing is
 * dropped silently.
 */
export const NOT_A_VARIABLE: ReadonlyMap<string, string> = new Map([
  ["SPECSTRIDE_", "the prefix itself, in the sentence about the legacy rename (B-1995)"],
  [
    "SPECSTRIDE_<X>",
    "the target of the legacy rename rule, covered by the WIGGUM_<X> row (B-0346)",
  ],
  ["GIT_COMMITS", "a key of the `resume` conf file, not a variable (B-1473)"],
  ["MALFORMED", "a verdict"],
  ["APPROVED", "a verdict"],
  ["REJECTED", "a verdict"],
  ["OK", "a verdict"],
  ["TRUE", "a literal"],
  ["FALSE", "a literal"],
  ["HTTP", "a word"],
  ["URL", "a word"],
  ["CLI", "a word"],
  ["TTY", "a word"],
  ["EUID", "a word"],
  ["OTLP", "a word"],
  ["ID", "a word"],
  ["SH", "a file extension"],
  ["JSON", "a format"],
  ["JSONL", "a format"],
  ["N", "a placeholder"],
  ["A", "a placeholder"],
  ["X", "a placeholder"],
]);

/** Every item of kind `env`, with the variables it names. */
export function readEnvItems(tsvText: string): EnvItem[] {
  const lines = tsvText.replace(/\n$/, "").split("\n");
  const header = lines[0].split("\t");
  const iItem = header.indexOf("b_item");
  const iKind = header.indexOf("kind");
  const iText = header.indexOf("item");
  const iEvid = header.indexOf("evidence");
  const out: EnvItem[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split("\t");
    if (c[iKind] !== "env") continue;
    const text = `${c[iText] ?? ""} ${c[iEvid] ?? ""}`;
    const variables = new Set<string>();
    for (const m of text.matchAll(BACKTICKED)) {
      const name = m[1].split("=")[0];
      if (name.length >= 2 && !NOT_A_VARIABLE.has(name)) variables.add(name);
    }
    for (const m of text.matchAll(PREFIXED)) {
      if (!NOT_A_VARIABLE.has(m[1])) variables.add(m[1]);
    }
    out.push({
      bItem: c[iItem],
      item: c[iText] ?? "",
      evidence: c[iEvid] ?? "",
      variables: [...variables].sort(),
    });
  }
  return out;
}

/** The rows of the alias table. */
export function readAliasTable(tsvText: string): AliasRow[] {
  return tsvText
    .replace(/\n$/, "")
    .split("\n")
    .slice(1)
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      const c = l.split("\t");
      return { variable: c[0] ?? "", key: c[1] ?? "", note: c[2] ?? "" };
    });
}

/**
 * Whether a row of the alias table covers an as-is variable. A row covers it
 * exactly, or as a family (`SPECSTRIDE_REVERSE_*`, `WIGGUM_*`), or through a
 * placeholder segment (`SPECSTRIDE_<HARNESS>_PROPOSER_MODEL`).
 */
export function rowCovers(rowVariable: string, variable: string): boolean {
  if (rowVariable === variable) return true;
  if (!/[*<]/.test(rowVariable)) return false;
  const pattern = rowVariable
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/<[A-Z_]+>/g, "[A-Z0-9_]+")
    .replace(/\*/g, "[A-Z0-9_]*");
  // The inventory writes some names with a placeholder segment of its own
  // (`SPECSTRIDE_<BACKEND>_OVERLAY`). A family row covers such a name.
  const subject = variable.replace(/<[A-Z_]+>/g, "PLACEHOLDER");
  return new RegExp(`^${pattern}$`).test(subject);
}

/** What the coverage check found. */
export interface CoverageReport {
  envItemCount: number;
  /** Every distinct as-is variable the 226 items name, after DV-064. */
  variables: string[];
  /** The variables DV-064 removes, which the table rightly omits. */
  omittedByDv064: string[];
  /** A variable of an item that no row of the alias table covers. */
  uncovered: { variable: string; items: string[] }[];
  /** A row of the alias table that no item of kind `env` names. */
  unusedRows: string[];
}

/** Compare the alias table with the items of kind `env`. */
export function coverage(inventoryText: string, aliasText: string): CoverageReport {
  const items = readEnvItems(inventoryText);
  const rows = readAliasTable(aliasText);
  const dv064 = new Set(DV_064_ITEMS);

  const byVariable = new Map<string, string[]>();
  const omitted = new Set<string>();
  for (const it of items) {
    for (const v of it.variables) {
      if (dv064.has(it.bItem)) {
        omitted.add(v);
        continue;
      }
      byVariable.set(v, [...(byVariable.get(v) ?? []), it.bItem]);
    }
  }
  // A variable that only the DV-064 items name is omitted; one that another
  // item also names stays in the table.
  for (const v of [...omitted]) if (byVariable.has(v)) omitted.delete(v);

  const uncovered: CoverageReport["uncovered"] = [];
  const used = new Set<string>();
  for (const [v, its] of byVariable) {
    const row = rows.find((r) => rowCovers(r.variable, v));
    if (row) used.add(row.variable);
    else uncovered.push({ variable: v, items: its });
  }
  uncovered.sort((a, b) => a.variable.localeCompare(b.variable));

  return {
    envItemCount: items.length,
    variables: [...byVariable.keys()].sort(),
    omittedByDv064: [...omitted].sort(),
    uncovered,
    unusedRows: rows
      .map((r) => r.variable)
      .filter((v) => !used.has(v) && !v.startsWith("("))
      .sort(),
  };
}

/** The places of this repository. */
export function defaultPlaces(): { inventoryPath: string; aliasPath: string } {
  const here = dirname(fileURLToPath(import.meta.url)); // packages/config/tools
  const root = join(here, "..", "..", "..");
  return {
    inventoryPath: join(root, "docs", "ecosystem", "research", "R18-behaviour-inventory.tsv"),
    aliasPath: join(root, "specs", "110-config-and-terms", "contracts", "alias-table.tsv"),
  };
}

/** Run the check against this repository. */
export function run(): CoverageReport {
  const places = defaultPlaces();
  return coverage(
    readFileSync(places.inventoryPath, "utf8"),
    readFileSync(places.aliasPath, "utf8"),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = run();
  process.stdout.write(`items of kind env: ${r.envItemCount}\n`);
  process.stdout.write(`as-is variables to place: ${r.variables.length}\n`);
  process.stdout.write(`omitted by DV-064: ${r.omittedByDv064.join(", ") || "(none)"}\n`);
  for (const u of r.uncovered) {
    process.stdout.write(`uncovered: ${u.variable} (${u.items.slice(0, 4).join(", ")})\n`);
  }
  for (const u of r.unusedRows) process.stdout.write(`row named by no env item: ${u}\n`);
  process.exit(process.argv.includes("--check") && r.uncovered.length > 0 ? 1 : 0);
}
