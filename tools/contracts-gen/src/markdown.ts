/**
 * The markdown readers of the generator (T288; the part "markdown" of
 * `specs/100-specstride/contracts/tools/generate.py`; F100-FR-030).
 *
 * The annexes are the authority. This module reads them and nothing else: the
 * cell splitter `cells`, the annex parser `parseAnnex` (headings, requirement
 * blocks with their fields, tables by section and sub-heading, the thirteen
 * sub-sections of an extension point), the tick stripper `ticks`, the
 * profile-key reader `profileKeys` and the table finder `findTable` with
 * `asDicts`.
 *
 * No function here decides what a generated file holds: the Python script is
 * the oracle of every slice until T207 retires it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The thirteen sub-sections that every extension point of annex C to H holds. */
export const EP_SUBHEADS: readonly string[] = [
  "Id and version",
  "Purpose",
  "Caller and time",
  "Inputs",
  "Outputs",
  "Errors",
  "Guarantees of the core",
  "Guarantees of an implementation",
  "Failure of an implementation",
  "Unknown-value rule",
  "Wave 1 implementations",
  "Content owner",
  "Proving test",
];

/** One table of an annex, by section and sub-heading. */
export interface AnnexTable {
  readonly annex: string;
  readonly section: string | null;
  readonly heading: string | null;
  readonly subheading: string | null;
  readonly header: string[];
  readonly rows: string[][];
}

/** A table as it is carried inside the body of an extension-point sub-section. */
export interface EmbeddedTable {
  readonly table: { readonly header: string[]; readonly rows: string[][] };
}

/** The body of one sub-section of an extension point: prose lines and tables, in order. */
export type EpSection = (string | EmbeddedTable)[];

/** The thirteen sub-sections of one extension point, by sub-heading. */
export type EpBody = Record<string, EpSection>;

/** One requirement block: `id`, `annex`, `section`, `text`, then its fields in order. */
export type Requirement = Record<string, string | null>;

/** What one annex holds. */
export interface ParsedAnnex {
  readonly tables: AnnexTable[];
  readonly eps: Record<string, EpBody>;
  readonly reqs: Requirement[];
}

/**
 * The cells of one markdown table line. A pipe inside backticks is content,
 * not a separator; the leading and the trailing pipe are dropped and every
 * cell is trimmed.
 */
export function cells(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|")) text = text.slice(0, -1);
  const out: string[] = [];
  let cur = "";
  let tick = false;
  for (const ch of text) {
    if (ch === "`") tick = !tick;
    if (ch === "|" && !tick) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

/** The names in backticks of a cell, in order. */
export function ticks(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/`([^`]+)`/g)) out.push(m[1]);
  return out;
}

/** The form of a configuration key: a dotted name, a segment in angle brackets allowed. */
const KEY = /^[A-Za-z][\w-]*(\.(<[\w-]+>|[\w-]+))+$/;

/**
 * The configuration keys that a cell of the key column of annex X §X.7 names.
 *
 * A cell that starts with a dash names no key. Text in parentheses is a remark
 * and names no key. A short form (`.tokens`) takes the place of the last
 * segment of the last full key. A name in backticks that is not a key (a flag,
 * a verb) is left out.
 */
export function profileKeys(cell: string): string[] {
  let text = cell.trim();
  if (text.startsWith("—") || text.startsWith("-")) return [];
  text = text.replace(/\([^()]*\)/g, "");
  const keys: string[] = [];
  let last: string | null = null;
  for (const raw of ticks(text)) {
    let name = raw.trim();
    if (name.startsWith(".") && last) {
      const cut = last.lastIndexOf(".");
      name = (cut === -1 ? last : last.slice(0, cut)) + name;
    } else if (KEY.test(name)) {
      last = name;
    }
    if (KEY.test(name) && !keys.includes(name)) keys.push(name);
  }
  return keys;
}

/** Return the tables, the extension-point sub-sections and the requirements of one annex. */
export function parseAnnex(letter: string, stem: string, annexDir: string): ParsedAnnex {
  const text = readFileSync(join(annexDir, stem + ".md"), "utf8");
  const lines = text.split("\n");
  let section: string | null = null;
  let heading: string | null = null;
  let sub: string | null = null;
  const tables: AnnexTable[] = [];
  const eps: Record<string, EpBody> = {};
  const reqs: Requirement[] = [];
  let bufKey: [string | null, string] | null = null;
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    const sectionMatch = /^## (§[A-Z]\.\d+) (.*)$/.exec(ln);
    if (sectionMatch) {
      section = sectionMatch[1];
      heading = sectionMatch[2].trim();
      sub = null;
      bufKey = null;
      i += 1;
      continue;
    }
    const subMatch = /^(###|####) (.*)$/.exec(ln);
    if (subMatch) {
      sub = subMatch[2].trim();
      bufKey = null;
      if (subMatch[1] === "####" && EP_SUBHEADS.includes(sub)) {
        bufKey = [section, sub];
        const key = String(section);
        if (eps[key] === undefined) eps[key] = {};
        eps[key][sub] = [];
      }
      i += 1;
      continue;
    }
    const reqMatch = /^- \*\*(F100-FR-\d{3})\*\*: (.*)$/.exec(ln);
    if (reqMatch) {
      bufKey = null;
      const req: Requirement = {
        id: reqMatch[1],
        annex: letter,
        section,
        text: reqMatch[2].trim(),
      };
      i += 1;
      while (i < lines.length && /^ {2}- [a-z]+: /.test(lines[i])) {
        const rest = lines[i].slice(4);
        const cut = rest.indexOf(": ");
        req[rest.slice(0, cut)] = rest.slice(cut + 2).trim();
        i += 1;
      }
      reqs.push(req);
      continue;
    }
    if (ln.startsWith("|") && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      const header = cells(ln);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].startsWith("|")) {
        rows.push(cells(lines[i]));
        i += 1;
      }
      tables.push({ annex: letter, section, heading, subheading: sub, header, rows });
      if (bufKey) eps[String(bufKey[0])][bufKey[1]].push({ table: { header, rows } });
      continue;
    }
    if (bufKey && ln.trim()) eps[String(bufKey[0])][bufKey[1]].push(ln.replace(/\s+$/, ""));
    i += 1;
  }
  return { tables, eps, reqs };
}

/**
 * The one table of an annex section whose first header cell is `first`, and
 * whose sub-heading is `sub` when one is given. `nth` picks among several.
 * A missing table is a fault of the generator, not of the annex: it exits.
 */
export function findTable(
  tables: readonly AnnexTable[],
  annex: string,
  section: string,
  first: string,
  sub?: string | null,
  nth = 0,
): AnnexTable {
  const hits = tables.filter(
    (t) =>
      t.annex === annex &&
      t.section === section &&
      t.header[0] === first &&
      (sub === undefined || sub === null || t.subheading === sub),
  );
  if (hits.length <= nth) {
    throw new Error(
      `no table ${annex} ${section} ${JSON.stringify(first)} ${JSON.stringify(sub ?? null)}`,
    );
  }
  return hits[nth];
}

/** The rows of a table as records, keyed by the header cell of each column. */
export function asDicts(table: AnnexTable): Record<string, string>[] {
  return table.rows.map((row) => {
    const out: Record<string, string> = {};
    const n = Math.min(table.header.length, row.length);
    for (let k = 0; k < n; k++) out[table.header[k]] = row[k];
    return out;
  });
}
