/**
 * The writers of the mirrors (T290; the part of `build()` of
 * `specs/100-specstride/contracts/tools/generate.py` that writes
 * `annex-tables/` and `requirements.json`, and `dump`; F100-FR-030).
 *
 * `annex-tables/<annex>.json` holds every table of one annex by section and
 * sub-heading; `requirements.json` holds every requirement of every annex with
 * its fields. `dump` is the one serializer of the generator: the same two-space
 * indent, key order as built, non-ASCII kept, one closing line end — so that a
 * generated file can be compared with the committed one byte for byte.
 */
import { ANNEXES, NOTE } from "./paths.ts";
import { parseAnnex, type AnnexTable, type EpBody, type Requirement } from "./markdown.ts";

/** `json.dumps(obj, indent=2, ensure_ascii=False, sort_keys=False) + '\n'`. */
export function dump(obj: unknown): string {
  return JSON.stringify(obj, null, 2) + "\n";
}

/** Everything the nine annexes hold, read once. */
export interface AnnexCorpus {
  /** Every table of every annex, in annex order. */
  readonly tables: AnnexTable[];
  /** The thirteen sub-sections of every extension point, by annex section. */
  readonly eps: Record<string, EpBody>;
  /** Every requirement of every annex, in annex order. */
  readonly reqs: Requirement[];
  /** `annex-tables/<stem>.json` for each of the nine annexes. */
  readonly annexTables: Map<string, unknown>;
}

/** Read the nine annexes and build the nine files of `annex-tables/`. */
export function readAnnexes(annexDir: string): AnnexCorpus {
  const tables: AnnexTable[] = [];
  const eps: Record<string, EpBody> = {};
  const reqs: Requirement[] = [];
  const annexTables = new Map<string, unknown>();
  for (const [letter, stem] of ANNEXES) {
    const parsed = parseAnnex(letter, stem, annexDir);
    tables.push(...parsed.tables);
    for (const [section, body] of Object.entries(parsed.eps)) eps[section] = body;
    reqs.push(...parsed.reqs);
    annexTables.set(`annex-tables/${stem}.json`, {
      note: NOTE,
      annex: letter,
      tables: parsed.tables.map((x) => ({
        section: x.section,
        heading: x.heading,
        subheading: x.subheading,
        header: x.header,
        rows: x.rows,
      })),
    });
  }
  return { tables, eps, reqs, annexTables };
}

/**
 * `requirements.json`: every requirement with its fields, and the two checks
 * of the index — the ids 001 to 226 are sequential in annex order, and the
 * whole set is unique and without a gap.
 */
export function requirementsIndex(reqs: readonly Requirement[]): unknown {
  const ids = reqs.map((r) => String(r["id"]));
  const first = ids.filter((i) => Number(i.slice(-3)) <= 226);
  const expectedFirst = Array.from({ length: 226 }, (_, n) => pad(n + 1));
  if (first.join("\u0000") !== expectedFirst.join("\u0000")) {
    throw new Error("the requirement ids 001 to 226 are not sequential in annex order");
  }
  const expectedAll = Array.from({ length: ids.length }, (_, n) => pad(n + 1));
  if ([...ids].sort().join("\u0000") !== expectedAll.join("\u0000")) {
    throw new Error("the requirement ids are not unique and without a gap");
  }
  return { note: NOTE, count: reqs.length, requirements: reqs };
}

/** `F100-FR-<nnn>` for a number. */
function pad(n: number): string {
  return "F100-FR-" + String(n).padStart(3, "0");
}
