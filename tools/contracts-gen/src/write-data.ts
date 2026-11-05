/**
 * The writers of the data files (T292; the part of `build()` of
 * `specs/100-specstride/contracts/tools/generate.py` from its inner function
 * `data` to the end of `build()`; contracts/README.md, "Data" and
 * "Hand-written sources"; F100-FR-030).
 *
 * Twenty-two files of `data/`, the thirty files of `schemas/` through the
 * builder of T289, and the checks of the three hand-written sources:
 * `sources/physical-paths.json` against the table of annex B §B.5,
 * `sources/old-side.json` against the behaviour inventory and the
 * traceability items, and `sources/package-graph.json`, which is copied
 * unchecked.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { asDicts, findTable, profileKeys, ticks, type AnnexTable } from "./markdown.ts";
import { NOTE, type Places } from "./paths.ts";
import { RECORDS, recordSchema } from "./schema.ts";

/** One file of `data/`: the schema id, the note, the annex, then its payload. */
export function data(
  out: Map<string, unknown>,
  name: string,
  sid: string,
  annex: string,
  section: string,
  payload: Record<string, unknown>,
): void {
  out.set(`data/${name}.json`, {
    schema: sid,
    note: NOTE,
    annex: `annex ${annex}, ${section}`,
    ...payload,
  });
}

/** `csv.DictReader(f, delimiter='\t', quoting=csv.QUOTE_NONE)`: no quote is special. */
export function readTsv(path: string): Record<string, string>[] {
  const lines = readFileSync(path, "utf8").split(/\r\n|\r|\n/);
  const header = lines[0].split("\t");
  const out: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    if (line === "") continue; // csv.DictReader skips a blank row
    const fields = line.split("\t");
    const row: Record<string, string> = {};
    for (let k = 0; k < header.length; k++) row[header[k]] = fields[k] ?? "";
    out.push(row);
  }
  return out;
}

/** Read one hand-written source of `contracts/sources/`. */
function source<T>(places: Places, name: string): T {
  return JSON.parse(readFileSync(join(places.contractsDir, "sources", name), "utf8")) as T;
}

/** The thirty record schemas of `schemas/`, built from the annex field tables. */
export function writeSchemas(out: Map<string, unknown>, tables: readonly AnnexTable[]): void {
  for (const spec of RECORDS) {
    out.set(`schemas/${spec.stem}.schema.json`, recordSchema(tables, spec));
  }
}

/** The twenty-two files of `data/`, in the order the Python script writes them. */
export function writeData(
  out: Map<string, unknown>,
  tables: readonly AnnexTable[],
  places: Places,
): void {
  // closed sets
  data(out, "closed-sets", "specstride.closed-sets/1", "X", "§X.6", {
    closedSets: asDicts(findTable(tables, "X", "§X.6", "#")).map((d) => ({
      number: Number(d["#"]),
      name: d["Closed set"],
      members: d["Members, or where the list is"],
      literals: ticks(d["Members, or where the list is"]),
      owner: d["Owner"],
      closedBy: d["Closed by"],
      unknownValue: d["Unknown value"],
    })),
  });
  // parity profile
  const prof = asDicts(findTable(tables, "X", "§X.7", "#"));
  data(out, "parity-profile", "specstride.profile/1", "X", "§X.7", {
    profile: "parity",
    switches: prof.map((d) => {
      const keys = profileKeys(d["Key"]);
      return {
        number: Number(d["#"]),
        switch: d["Switch"],
        key: keys.length > 0 ? keys[0] : null,
        keys,
        keyNote: d["Key"],
        default: d["Default"],
        parity: d["Under `parity`"],
        owner: d["Owner"],
        registerRows: [...d["Register row"].matchAll(/DV-\d{3}/g)].map((m) => m[0]),
      };
    }),
  });
  // stop reasons
  data(out, "stop-reasons", "specstride.stop-reason/1", "E", "§E.3", {
    stopReasons: asDicts(findTable(tables, "E", "§E.3", "#")).map((d) => ({
      number: Number(d["#"]),
      literal: d["Stop reason"].replace(/^`+|`+$/g, ""),
      writtenBy: d["Written by"],
      engineExit: Number(d["Engine exit"]),
      transient: d["Transient"].toLowerCase().startsWith("yes"),
      transientNote: d["Transient"],
      retryable: d["`retryable` in the terminal record"],
      matchedByStringAtBaseline: d["Matched by string at the baseline"],
    })),
  });
  // run-state machine
  data(out, "run-state-machine", "specstride.run-state/1", "E", "§E.2", {
    states: asDicts(findTable(tables, "E", "§E.2", "State")),
    transitions: asDicts(findTable(tables, "E", "§E.2", "#")),
    blockedReasons: asDicts(findTable(tables, "E", "§E.2", "Blocked reason")),
  });
  // exit codes
  const e4 = tables.filter((t) => t.annex === "E" && t.section === "§E.4");
  data(out, "exit-codes", "specstride.exit-codes/1", "E", "§E.4; annex F, §F.8; annex G, §G.4", {
    engine: e4.map((t) => ({ process: t.subheading, rows: asDicts(t) })),
    runtimeRootAndPipelineEntry: asDicts(findTable(tables, "F", "§F.8", "Code")),
    perCommand: asDicts(findTable(tables, "G", "§G.4", "Command")),
    collisions: asDicts(findTable(tables, "G", "§G.4", "Value")),
    handshake: asDicts(findTable(tables, "F", "§F.3", "Outcome")),
  });
  // cli protocol
  data(out, "cli-protocol", "specstride.cli-protocol/1", "G", "§G.1, §G.2, §G.5", {
    protocol: 1,
    commands: asDicts(findTable(tables, "G", "§G.1", "Command")),
    outputModes: asDicts(findTable(tables, "G", "§G.2", "Mode")),
    budgets: asDicts(findTable(tables, "G", "§G.5", "Subject")),
    judgmentExchange: asDicts(findTable(tables, "G", "§G.9", "Step")),
  });
  (out.get("data/cli-protocol.json") as Record<string, unknown>)["judgmentSchema"] =
    "specstride.judgment/1";
  // line grammar
  data(out, "line-grammar", "specstride.line-grammar/1", "G", "§G.3", {
    form: "opening square bracket, label, closing square bracket, one space, body, end of line",
    label: "^[A-Z0-9-]+$",
    families: asDicts(findTable(tables, "G", "§G.3", "Family")),
    supervisorLines: asDicts(findTable(tables, "G", "§G.3", "Line")),
    productLines: asDicts(findTable(tables, "G", "§G.3", "Line", null, 1)),
    digestStates: ["completed", "failed", "stopped", "dry-run"],
  });
  // threat model
  data(out, "threat-model", "specstride.threat-model/1", "X", "§X.9", {
    controls: asDicts(findTable(tables, "X", "§X.9", "Control")),
    threats: asDicts(findTable(tables, "X", "§X.9", "Id")),
  });
  data(out, "further-schema-ids", "specstride.layout/1", "B", "§B.20", {
    schemaIds: asDicts(findTable(tables, "B", "§B.20", "Schema id")),
  });
  data(out, "presenter-interface", "specstride.presenter/1", "G", "§G.10", {
    interface: asDicts(findTable(tables, "G", "§G.10", "Subject")),
  });
  // identifiers
  data(out, "identifiers", "specstride.identifiers/1", "B", "§B.3", {
    identifiers: asDicts(findTable(tables, "B", "§B.3", "Identifier")),
  });
  // harness tables
  data(out, "harness-tables", "specstride.harness/1", "C", "§C.3, §C.6, §C.15", {
    completionForms: asDicts(findTable(tables, "C", "§C.3", "Form")),
    criticOrder: asDicts(findTable(tables, "C", "§C.6", "Step")),
    containmentLevels: asDicts(findTable(tables, "C", "§C.15", "Level")),
    placeholders: [
      "{prompt}",
      "{promptFile}",
      "{workdir}",
      "{emptyTmp}",
      "{model}",
      "{sessionId}",
      "{file:<name>}",
    ],
    normalizedStreamRecords: ["init", "text", "tool", "usage", "error", "terminal"],
  });
  // loop layer tables
  data(out, "loop-layer-tables", "specstride.loop-layer/1", "D", "§D.1, §D.2, §D.4", {
    callPoints: asDicts(findTable(tables, "D", "§D.1", "#")),
    directives: asDicts(findTable(tables, "D", "§D.1", "Directive")),
    treeStoreOperations: asDicts(findTable(tables, "D", "§D.2", "Operation")),
    routerDecisionPoints: asDicts(findTable(tables, "D", "§D.4", "Decision point")),
  });
  // process model
  data(out, "process-model", "specstride.process-model/1", "F", "§F.1, §F.2, §F.4", {
    processes: asDicts(findTable(tables, "F", "§F.1", "Process")),
    runRequests: asDicts(findTable(tables, "F", "§F.2", "Kind")),
    relaunchOwner: asDicts(findTable(tables, "F", "§F.4", "`relaunch.owner`")),
  });
  // config
  data(out, "config-ranks", "specstride.config/1", "X", "§X.2", {
    ranks: asDicts(findTable(tables, "X", "§X.2", "Rank")),
    trustClasses: asDicts(findTable(tables, "X", "§X.2", "Class")),
  });
  // layers and extension point map
  data(out, "layers", "specstride.layers/1", "A", "§A.1, §A.4", {
    layers: asDicts(findTable(tables, "A", "§A.1", "Layer")),
    extensionPoints: asDicts(findTable(tables, "A", "§A.4", "EP")),
  });
  // hasher and redactor operations
  data(out, "kernel-operations", "specstride.kernel/1", "X", "§X.4, §X.5", {
    redactor: asDicts(findTable(tables, "X", "§X.4", "Operation")),
    hasher: asDicts(findTable(tables, "X", "§X.5", "Operation")),
  });
  // host capabilities
  data(out, "host-capabilities", "specstride.host/1", "H", "§H.1", {
    capabilities: asDicts(findTable(tables, "H", "§H.1", "Capability")),
  });

  // layout: the new side, with the physical paths of the plan
  const names = asDicts(findTable(tables, "B", "§B.5", "Logical name"));
  const phys = source<{
    layoutVersion: string;
    roots: Record<string, string>;
    paths: Record<string, string>;
  }>(places, "physical-paths.json");
  const rows: unknown[] = [];
  const missing: string[] = [];
  for (const d of names) {
    const ln = d["Logical name"].replace(/^`+|`+$/g, "");
    if (!Object.prototype.hasOwnProperty.call(phys.paths, ln)) {
      missing.push(ln);
      continue;
    }
    rows.push({
      logicalName: ln,
      root: d["Root"],
      writer: d["Writer"],
      readers: d["Readers"],
      content: d["Schema or content"],
      path: phys.paths[ln],
    });
  }
  const annexNames = names.map((d) => d["Logical name"].replace(/^`+|`+$/g, ""));
  const extra = Object.keys(phys.paths).filter((k) => !annexNames.includes(k));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `physical-paths.json: missing ${JSON.stringify(missing)}; ` +
        `not in annex B: ${JSON.stringify(extra)}`,
    );
  }
  data(out, "layout", "specstride.layout/1", "B", "§B.1, §B.5", {
    layoutVersion: phys.layoutVersion,
    roots: phys.roots,
    locations: asDicts(findTable(tables, "B", "§B.1", "Location")),
    logicalNames: rows,
  });

  // layout: the old side, one row per `file` item of the behaviour inventory
  const old = source<{
    placeholders: Record<string, string>;
    items: Record<string, { what?: string; rule?: string; logicalNames?: string[] }>;
  }>(places, "old-side.json");
  const inv = new Map<string, Record<string, string>>();
  for (const r of readTsv(
    join(places.repoDir, "docs/ecosystem/research/R18-behaviour-inventory.tsv"),
  )) {
    if (r["kind"] === "file") inv.set(r["b_item"], r);
  }
  const disp = new Map<string, Record<string, string>>();
  for (const r of readTsv(join(places.repoDir, "docs/ecosystem/traceability-items.tsv"))) {
    disp.set(r["b_id"], r);
  }
  const known = new Set(annexNames);
  const orow: unknown[] = [];
  const bad: string[] = [];
  for (const b of [...inv.keys()].sort()) {
    if (!Object.prototype.hasOwnProperty.call(old.items, b)) {
      bad.push("no row for " + b);
      continue;
    }
    const m = old.items[b];
    const d = disp.get(b);
    if (d === undefined) throw new Error(`${b} is not an item of traceability-items.tsv`);
    const kept = ["ported", "translated", "merged-with"].includes(d["disposition"].split(/\s+/)[0]);
    for (const ln of m.logicalNames ?? []) {
      if (!known.has(ln)) bad.push(`${b}: ${ln} is not in annex B`);
    }
    if (kept && !(m.logicalNames ?? []).length && !m.rule) {
      bad.push(`${b} is kept and has neither a logical name nor a rule`);
    }
    const item = inv.get(b) as Record<string, string>;
    orow.push({
      item: b,
      system: item["system"],
      disposition: d["disposition"],
      feature: d["feature"],
      asIsPaths: ticks(item["item"]).filter((p) => /[/<.]/.test(p) && !p.trim().includes(" ")),
      logicalNames: m.logicalNames ?? [],
      rule: m.rule ?? null,
      what: m.what ?? "location",
    });
  }
  for (const b of Object.keys(old.items)) {
    if (!inv.has(b)) bad.push(`${b} is not a file item of the inventory`);
  }
  if (bad.length > 0) throw new Error("old-side.json:\n  " + bad.join("\n  "));
  data(out, "layout-old-side", "specstride.oracle-normalization/1", "X", "§X.8", {
    count: orow.length,
    placeholders: old.placeholders,
    items: orow,
    comparedRows: asDicts(findTable(tables, "X", "§X.8", "As-is path")),
  });
  // normalization
  data(out, "normalization", "specstride.oracle-normalization/1", "X", "§X.8", {
    rules: asDicts(findTable(tables, "X", "§X.8", "Id")),
    environmentAliases: asDicts(findTable(tables, "X", "§X.8", "As-is variable")),
    componentNames: asDicts(findTable(tables, "X", "§X.8", "As-is implementation file")),
    modeMap: { generate: "dry-run", run: "run", auto: "run" },
    resumeExitCodeMap: [
      { asIs: 1, cause: "lock held", new: 5 },
      { asIs: 1, cause: "nothing to resume", new: 3 },
    ],
    launchContractKeyMap: {
      "configuration.auto": "configuration.relaunch",
      schema_version: "schema",
    },
    layoutOldSide: "data/layout-old-side.json",
    layoutNewSide: "data/layout.json",
  });
  // package graph: copied unchecked
  const graph = source<Record<string, unknown>>(places, "package-graph.json");
  data(out, "package-graph", "specstride.package-graph/1", "A", "§A.1, §A.2, §A.3", graph);
}
