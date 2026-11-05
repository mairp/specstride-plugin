#!/usr/bin/env node
/**
 * The generator of the machine-readable form of the annexes of feature 100
 * (T207; the port of `specs/100-specstride/contracts/tools/generate.py`;
 * F100-FR-030).
 *
 *     node tools/contracts-gen/src/main.ts            write the 82 files
 *     node tools/contracts-gen/src/main.ts --check    compare with the files on disk
 *
 * The annexes are the authority. `build()` reads their tables and returns the
 * text of every file of `specs/100-specstride/contracts/`, so that a schema
 * file cannot differ from its annex section. Besides the annexes it reads the
 * three hand-written sources of `contracts/sources/`, which it checks against
 * the annexes and the behaviour inventory (T292).
 *
 * `--check` compares every generated file with the committed one, names every
 * file that differs and every file of a generated directory that the generator
 * does not produce, prints `checked <n> files, <m> differ` and exits 1 when any
 * differ (T293; quickstart.md, scenario 1).
 *
 * It writes nothing outside `contracts/`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultPlaces, type Places } from "./paths.ts";
import { dump, readAnnexes, requirementsIndex } from "./write-tables.ts";
import { writeExtensionPoints } from "./write-extension-points.ts";
import { writeData, writeSchemas } from "./write-data.ts";

/** The four directories of `contracts/` that the generator owns. */
export const GENERATED_DIRECTORIES: readonly string[] = [
  "annex-tables",
  "schemas",
  "extension-points",
  "data",
];

/**
 * Every file of `contracts/` that the annexes produce, as a map from the path
 * relative to `contracts/` to the text of the file.
 */
export function build(places: Places = defaultPlaces()): Map<string, string> {
  const out = new Map<string, unknown>();
  const corpus = readAnnexes(places.annexDir);
  for (const [rel, value] of corpus.annexTables) out.set(rel, value);
  out.set("requirements.json", requirementsIndex(corpus.reqs));
  writeSchemas(out, corpus.tables);
  writeExtensionPoints(out, corpus.eps, corpus.reqs);
  writeData(out, corpus.tables, places);
  const text = new Map<string, string>();
  for (const [rel, value] of out) text.set(rel, dump(value));
  return text;
}

/** What `--check` found. */
export interface CheckReport {
  /** The files of `contracts/` that differ from the annexes. */
  readonly differs: string[];
  /** The files of a generated directory that the generator does not produce. */
  readonly notGenerated: string[];
  /** How many files the generator produced. */
  readonly checked: number;
  /** The lines the tool printed, in order. */
  readonly lines: string[];
}

/**
 * Compare every generated file with the committed one (T293). A file that is
 * absent or whose text differs is named; so is every `.json` of a generated
 * directory that the generator does not produce.
 */
export function check(places: Places = defaultPlaces()): CheckReport {
  const files = build(places);
  const differs: string[] = [];
  const notGenerated: string[] = [];
  const lines: string[] = [];
  for (const rel of [...files.keys()].sort()) {
    const path = join(places.contractsDir, rel);
    if (!existsSync(path) || readFileSync(path, "utf8") !== files.get(rel)) {
      lines.push("differs from the annexes: " + rel);
      differs.push(rel);
    }
  }
  for (const d of GENERATED_DIRECTORIES) {
    let entries: string[];
    try {
      entries = readdirSync(join(places.contractsDir, d));
    } catch {
      continue;
    }
    for (const name of entries.filter((n) => n.endsWith(".json")).sort()) {
      const rel = `${d}/${name}`;
      if (!files.has(rel) && rel !== "requirements.json") {
        lines.push("not generated: " + rel);
        notGenerated.push(rel);
      }
    }
  }
  const bad = differs.length + notGenerated.length;
  lines.push(`checked ${files.size} files, ${bad} differ`);
  return { differs, notGenerated, checked: files.size, lines };
}

/** Write the 82 files into `places.contractsDir`. Returns how many were written. */
export function write(places: Places = defaultPlaces()): number {
  const files = build(places);
  for (const [rel, text] of files) {
    const path = join(places.contractsDir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return files.size;
}

/** The command line: `--check` compares, anything else writes. */
export function main(argv: readonly string[] = process.argv.slice(2)): number {
  if (argv.includes("--check")) {
    const report = check();
    for (const line of report.lines) console.log(line);
    return report.differs.length + report.notGenerated.length > 0 ? 1 : 0;
  }
  console.log(`wrote ${write()} files`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
