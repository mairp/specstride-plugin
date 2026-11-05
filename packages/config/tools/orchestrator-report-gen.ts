#!/usr/bin/env node
/**
 * T043 — the generator of `specs/110-config-and-terms/orchestrator-report.md`:
 * what this feature sends the orchestrator, being the keys and rows that other
 * features and annex X §X.7 need (spec "Assumptions").
 *
 * Nothing in part A of the report is written by hand. It is derived from:
 *
 *   - `specs/110-config-and-terms/contracts/config-keys.tsv` — the catalogue of
 *     259 keys with the owner of each, the feature that proposed it and the old
 *     spelling of every correction (§K.9);
 *   - `packages/contracts/data/parity-profile.json` — the rows of annex X §X.7
 *     that feature 100 ships, so that the rows §X.7 still needs are computed and
 *     not asserted;
 *   - `packages/contracts/data/closed-sets.json` — the rows of annex X §X.6;
 *   - `specs/100-specstride/annexes/X-cross-layer.md` — the text of §X.2 and the
 *     alias rows of §X.8, for the four gaps the spec's "Assumptions" names.
 *
 * Part B — the requests this feature raised in phases 1 to 5, which no file can
 * derive — is held as `REQUESTS` below, so that the whole report has one source
 * and `--check` covers all of it.
 *
 *   node packages/config/tools/orchestrator-report-gen.ts            # writes
 *   node packages/config/tools/orchestrator-report-gen.ts --check    # compares
 *
 * It writes nothing but `specs/110-config-and-terms/orchestrator-report.md`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { EXCLUDED_KEYS } from "./config-keys-gen.ts";

/** The date this report carries; the campaign's day, not a clock reading. */
export const REPORT_DATE = "2026-10-01";

/** One request to the orchestrator that no file derives. */
export interface Request {
  /** `R-110-01` and upward, stable once written. */
  readonly id: string;
  /** What the orchestrator or the owner must decide or write. */
  readonly ask: string;
  /** The file and the place that shows the need. */
  readonly citation: string;
  /** The phase that raised it. */
  readonly raisedIn: string;
}

/**
 * The requests of phases 1 to 5, each as its "Reported to the orchestrator —
 * not repaired here" entry of
 * `.specstride/features/110-config-and-terms/PROGRESS.md` states it.
 */
export const REQUESTS: readonly Request[] = Object.freeze([
  {
    id: "R-110-01",
    ask:
      "Widen CT-100-322's inventory of filled packages of the graph to carry `@specstride/config`, " +
      "so that `packages/config/package.json` can drop `specstride.skeleton: true`. The marker is " +
      "inaccurate today — `src/schema/`, `src/load/`, `src/secrets/` and `src/cli/` are full — and " +
      "it stays only because that test reads the field to decide the inventory. This feature does " +
      "not edit feature 100's test.",
    citation:
      "packages/testkit/test/acceptance-core.test.ts (`packagesUnderTest`); packages/config/package.json (`specstride.skeletonNote`)",
    raisedIn: "phases 1 to 5",
  },
  {
    id: "R-110-02",
    ask:
      "Rule on the count difference: the tables of §K.3 to §K.6b hold 263 keys and the catalogue " +
      "carries 259, because T004's acceptance fixes the count at 259 and the four keys of feature " +
      "107 that §K.6 also lists belong to feature 107's own contract. They are named in " +
      "`EXCLUDED_KEYS` of the generator with that reason, and the exclusion is checked in both " +
      "directions. The register rows W-ORC-01 to W-ORC-03 carry the difference.",
    citation:
      "packages/config/tools/config-keys-gen.ts (`EXCLUDED_KEYS`, `CATALOGUE_KEY_COUNT`); specs/110-config-and-terms/contracts/README.md",
    raisedIn: "phase 1",
  },
  {
    id: "R-110-03",
    ask:
      "Give annex B §B.20 a row for the `--json` output of `config show` and of `config schema`. " +
      "Both records carry a schema id of the internal form today " +
      "(`urn:specstride:schema:internal:110:config-show/1`, `…:config-schema/1`), which §B.20's " +
      "note says is no contract of the `contracts` package.",
    citation: "packages/config/src/cli/show.ts; packages/config/src/cli/schema.ts",
    raisedIn: "phase 3",
  },
  {
    id: "R-110-04",
    ask:
      "Derive the per-command share of the §G.5 token budget, or confirm the share this feature " +
      "chose: one quarter of the 8,000-token budget of the host skill `specstride-run` (2,000 " +
      "tokens, 5,600 bytes) for one host-facing configuration command. F100-FR-187 puts the " +
      "derivation on the owner and §G.5 gives no per-command figure. One constant moves if the " +
      "owner wants another share.",
    citation: "packages/config/src/cli/budget.ts",
    raisedIn: "phase 3",
  },
  {
    id: "R-110-05",
    ask:
      "Decide whether a configuration FILE may spell the two literals of a key whose type is " +
      "`on, off`. YAML 1.2's core schema reads only `true`/`false` as booleans, so " +
      "`loop.escalation: off` in a file is refused as a type error, while `--set " +
      "loop.escalation=off` and the environment both work (those paths coerce text).",
    citation:
      "packages/config/src/load/files.ts (`YAML_PARSE_OPTIONS`); packages/config/src/schema/validate.ts",
    raisedIn: "phase 3",
  },
  {
    id: "R-110-06",
    ask:
      "State the proposer's alias order in annex X §X.8 or §K.8 as the critic's is stated. The row " +
      "of `SPECSTRIDE_DSH_MODEL` orders it for the critic only, so `roles.proposer.model` resolves " +
      "as a conflict when `SPECSTRIDE_DSH_PROPOSER_MODEL` and `SPECSTRIDE_DSH_MODEL` disagree, and " +
      "the launch is refused with both names. Nothing was invented for the proposer.",
    citation:
      "specs/110-config-and-terms/contracts/alias-table.tsv; packages/config/src/load/alias.ts",
    raisedIn: "phase 4",
  },
  {
    id: "R-110-07",
    ask:
      "Decide what a shell export of `SPECSTRIDE_LEARNING_THROUGH` does. The name reaches " +
      "`learning.through` as F110-FR-020 requires, and the layer check then refuses the value with " +
      "`layer-not-allowed`, because the key is `C only`. The alternative is to ignore it with one " +
      "launch message, as F110-FR-019 does for the five user-file-only keys.",
    citation:
      "specs/110-config-and-terms/contracts/alias-table.tsv; packages/config/tests/parity/alias.test.ts",
    raisedIn: "phase 4",
  },
  {
    id: "R-110-08",
    ask:
      "Say which key each of `SPECSTRIDE_DIAGNOSTICIAN`, `SPECSTRIDE_ACCELERATOR` and " +
      "`SPECSTRIDE_ACCELERATOR_BACKEND` sets (feature 101 owns the keys). The variable tail is not " +
      "the key tail and the catalogue holds `.enabled`, `.harness` and `.model` for each role, so " +
      "the port resolves them to no key and names them unresolved rather than picking a field. The " +
      "catch-all row `loop.yield.<key>` of §K.8 has the same shape.",
    citation: "packages/config/src/load/alias.ts (`unresolvedFamilyNames`)",
    raisedIn: "phase 4",
  },
  {
    id: "R-110-09",
    ask:
      "Correct one of the two citations of the canary test: annex C §C.11 and F110-FR-032 cite " +
      '"the canary test of annex X §X.10", while the canary harness of feature 100 is §X.9 ' +
      "(F100-FR-219) and §X.10 is the integration-acceptance section.",
    citation: "packages/config/tests/conformance/canary.test.ts (CT-110-127)",
    raisedIn: "phase 5",
  },
  {
    id: "R-110-10",
    ask:
      "Decide where the pair a bound host needs is built. `boundHostOfDeclaration` needs the " +
      "harness kind and the endpoint of the same entry; `harnesses.<id>.auth.credential` is a key " +
      "of this catalogue, while the `kind` and `endpoint` of that entry belong to the harness " +
      "descriptor (features 109 and 131). The port therefore takes the declarations as an input " +
      "and the composition root of feature 122 must build them.",
    citation: "packages/config/src/secrets/binding.ts (`createSecretBindings`)",
    raisedIn: "phase 5",
  },
  {
    id: "R-110-11",
    ask:
      "Rule on `observability.captureContent`, which appears as a switch label of the sink context " +
      "of feature 100's EP-08 conformance sample and is in no table of §K.3 to §K.6b and in no row " +
      "of annex X §X.7. If it is a configuration key that a package reads, its owning feature must " +
      "propose it (F110-FR-009); this feature neither carries nor edits it.",
    citation:
      "packages/testkit/src/canary/scan.ts; packages/config/tests/unit/catalogue.test.ts (`NOT_A_CONFIGURATION_KEY`)",
    raisedIn: "phase 2",
  },
  {
    id: "R-110-12",
    ask:
      "Note that `plan.md` names the licence of the YAML parser as MIT and the package is ISC — " +
      "permissive and compatible with MIT, which is what F100-FR-029 asks for. Recorded in " +
      "`research.md` §T044 and in `DEPENDENCIES.md`; no specification was edited for it.",
    citation: "specs/110-config-and-terms/research.md (§T044); packages/config/DEPENDENCIES.md",
    raisedIn: "phase 6 (T044)",
  },
  {
    id: "R-110-13",
    ask:
      "Three lines of `docs/ecosystem/feature-briefs.md` still give the terms gate, the audience " +
      "and its config keys to this feature, which the split of 2026-09-29 moved to " +
      "147-terms-gate. `check-traceability.py` does not read that file, so it passes; the lines are " +
      "reported and not edited, because the file belongs to the orchestrator.",
    citation: "docs/ecosystem/feature-briefs.md lines 80, 3423, 3976",
    raisedIn: "phase 6 (T042)",
  },
]);

/** The four things the spec's "Assumptions" says feature 100 lacked. */
export interface Gap {
  readonly id: string;
  readonly whatWasAsked: string;
  /** How the state of the gap is read today. */
  check(places: Places): { readonly supplied: boolean; readonly evidence: string };
}

export const GAPS: readonly Gap[] = Object.freeze([
  {
    id: "G-1",
    whatWasAsked:
      'Row 44 onward in annex X §X.7 for the keys named under "Rows of the `parity` profile"',
    check(places) {
      const rows = parityRowNumbers(places);
      const highest = rows.at(-1) ?? 0;
      const gaps = [];
      for (let n = 1; n <= highest; n += 1) if (!rows.includes(n)) gaps.push(n);
      return {
        supplied: highest >= 131 && gaps.length === 0,
        evidence:
          `packages/contracts/data/parity-profile.json carries the rows 1 to ${highest} of §X.7 ` +
          `with no gap (${rows.length} rows), and the catalogue's \`profile_row\` column reaches ` +
          `row ${highestProfileRow(places)}`,
      };
    },
  },
  {
    id: "G-2",
    whatWasAsked:
      "An alias row for `SPECSTRIDE_CONTEXT_BUDGET`, `SPECSTRIDE_DSH_PLUGIN_ALLOWLIST`, " +
      "`SPECSTRIDE_DSH_PLUGIN_TIMEOUT` and the others of §K.8",
    check(places) {
      const annex = readFileSync(places.annexXPath, "utf8");
      const names = [
        "SPECSTRIDE_CONTEXT_BUDGET",
        "SPECSTRIDE_DSH_PLUGIN_ALLOWLIST",
        "SPECSTRIDE_DSH_PLUGIN_TIMEOUT",
      ];
      const missing = names.filter((name) => !annex.includes(name));
      return {
        supplied: missing.length === 0,
        evidence:
          missing.length === 0
            ? `all three names have a row in annex X §X.8 (specs/100-specstride/annexes/X-cross-layer.md), and \`packages/contracts/data/normalization.json\` ships them`
            : `annex X §X.8 still has no row for ${missing.join(", ")}`,
      };
    },
  },
  {
    id: "G-3",
    whatWasAsked: "A closed-set row for the check points of staleness",
    check(places) {
      const sets = JSON.parse(readFileSync(places.closedSetsPath, "utf8")) as {
        closedSets: { number: number; name: string }[];
      };
      const row = sets.closedSets.find((entry) => entry.number === 238);
      return {
        supplied: row !== undefined,
        evidence: row
          ? `annex X §X.6 row 238, "${row.name}", is shipped in packages/contracts/data/closed-sets.json`
          : "annex X §X.6 still has no row for the check points of staleness",
      };
    },
  },
  {
    id: "G-4",
    whatWasAsked:
      "A statement in annex X §X.2 on where the declared per-phase value of the " +
      "verification-commands document stands",
    check(places) {
      const annex = readFileSync(places.annexXPath, "utf8");
      const sentence =
        /A per-phase time limit that the verification-commands document\s+declares is the default of the per-phase key, at rank 8/;
      return {
        supplied: sentence.test(annex),
        evidence: sentence.test(annex)
          ? 'annex X §X.2 states it: "A per-phase time limit that the verification-commands document declares is the default of the per-phase key, at rank 8 (CQ-158)"'
          : "annex X §X.2 is still silent on it (CQ-158)",
      };
    },
  },
]);

export interface Places {
  cataloguePath: string;
  parityProfilePath: string;
  closedSetsPath: string;
  annexXPath: string;
  reportPath: string;
}

export function defaultPlaces(): Places {
  const here = dirname(fileURLToPath(import.meta.url)); // packages/config/tools
  const root = join(here, "..", "..", "..");
  return {
    cataloguePath: join(root, "specs", "110-config-and-terms", "contracts", "config-keys.tsv"),
    parityProfilePath: join(root, "packages", "contracts", "data", "parity-profile.json"),
    closedSetsPath: join(root, "packages", "contracts", "data", "closed-sets.json"),
    annexXPath: join(root, "specs", "100-specstride", "annexes", "X-cross-layer.md"),
    reportPath: join(root, "specs", "110-config-and-terms", "orchestrator-report.md"),
  };
}

/** A row of the catalogue, by the columns `contracts/README.md` names. */
export interface Row {
  key: string;
  typeAndRange: string;
  default: string;
  valueUnderParity: string;
  trustClass: string;
  ownerFeature: string;
  proposedBy: string;
  confirmedOrCorrected: string;
  layers: string;
  profileRow: string;
}

export function readCatalogue(places: Places): readonly Row[] {
  const lines = readFileSync(places.cataloguePath, "utf8").trimEnd().split("\n");
  return Object.freeze(
    lines.slice(1).map((line) => {
      const c = line.split("\t");
      return {
        key: c[0],
        typeAndRange: c[1],
        default: c[2],
        valueUnderParity: c[3],
        trustClass: c[4],
        ownerFeature: c[5],
        proposedBy: c[6],
        confirmedOrCorrected: c[7],
        layers: c[8],
        profileRow: c[9] ?? "",
      };
    }),
  );
}

/** The feature numbers of a cell like `110, 124`. */
function features(cell: string): readonly string[] {
  return [...new Set(cell.match(/\d{3}/g) ?? [])].sort();
}

function parityRowNumbers(places: Places): readonly number[] {
  const data = JSON.parse(readFileSync(places.parityProfilePath, "utf8")) as {
    switches: { number: number }[];
  };
  return Object.freeze(
    [...new Set(data.switches.map((entry) => entry.number))].sort((a, b) => a - b),
  );
}

function highestProfileRow(places: Places): number {
  return Math.max(
    ...readCatalogue(places)
      .flatMap((row) => (row.profileRow.match(/\d+/g) ?? []).map(Number))
      .concat(0),
  );
}

/** The keys a feature owns, one line per feature, in feature order. */
export function keysByOwner(rows: readonly Row[]): readonly { feature: string; keys: string[] }[] {
  const by = new Map<string, string[]>();
  for (const row of rows) {
    for (const feature of features(row.ownerFeature)) {
      const list = by.get(feature) ?? [];
      list.push(row.key);
      by.set(feature, list);
    }
  }
  return Object.freeze(
    [...by.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([feature, keys]) => ({ feature, keys: [...new Set(keys)].sort() })),
  );
}

/** Every key whose spelling was corrected, with the old spelling and the owner. */
export function corrections(
  rows: readonly Row[],
): readonly { key: string; owner: string; proposedBy: string; old: string }[] {
  return Object.freeze(
    rows
      .filter((row) => /^corrected/i.test(row.confirmedOrCorrected))
      .map((row) => ({
        key: row.key,
        owner: row.ownerFeature,
        proposedBy: row.proposedBy,
        old: row.confirmedOrCorrected.replace(/^corrected\s*\(old:\s*/i, "").replace(/\)$/, ""),
      })),
  );
}

/** Every switch of the schema that annex X §X.7 has no row for (F110-FR-008). */
export function rowsAnnexNeeds(
  rows: readonly Row[],
): readonly { key: string; owner: string; valueUnderParity: string }[] {
  return Object.freeze(
    rows
      .filter((row) => row.valueUnderParity !== "as default" && row.profileRow.trim() === "")
      .map((row) => ({
        key: row.key,
        owner: row.ownerFeature,
        valueUnderParity: row.valueUnderParity,
      })),
  );
}

function table(header: readonly string[], body: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...body.map(line)].join("\n");
}

export function render(places: Places = defaultPlaces()): string {
  const rows = readCatalogue(places);
  const owners = keysByOwner(rows);
  const corrected = corrections(rows);
  const needed = rowsAnnexNeeds(rows);
  const gaps = GAPS.map((gap) => ({ gap, ...gap.check(places) }));

  const out: string[] = [];
  out.push("# What feature 110 sends the orchestrator");
  out.push("");
  out.push(
    `**Task**: T043. **Date**: ${REPORT_DATE}. **Generated** by ` +
      "`packages/config/tools/orchestrator-report-gen.ts` (`--check` compares, no argument writes); " +
      "every table of part A is derived from the files it names and nothing in it is written by hand.",
  );
  out.push("");
  out.push(
    'This is the report the spec\'s "Assumptions" asks for: the keys and rows that other features ' +
      "and annex X §X.7 need. It is a report and never a repair — this feature edits no file of " +
      'another feature (`specs/110-config-and-terms/spec.md`, "Feature 100 is never edited by this ' +
      'feature").',
  );
  out.push("");
  out.push("## Part A.1 — the four things the spec says feature 100 lacked");
  out.push("");
  out.push(
    "Each row is read from the shipped contract data or from the annex text today, by the `check` " +
      "of `GAPS` in the generator, so this table can never go stale in silence.",
  );
  out.push("");
  out.push(
    table(
      ["Id", "What this feature asked for", "State", "Read from"],
      gaps.map(({ gap, supplied, evidence }) => [
        gap.id,
        gap.whatWasAsked,
        supplied ? "**supplied**" : "**still needed**",
        evidence,
      ]),
    ),
  );
  out.push("");
  out.push(
    `${gaps.filter((entry) => entry.supplied).length} of ${gaps.length} are supplied. ` +
      "Nothing further is asked for the supplied ones; they are listed so that the owner can close " +
      'the "Assumptions" bullet of `spec.md` with a reading of the files rather than a memory.',
  );
  out.push("");
  out.push("## Part A.2 — the rows annex X §X.7 still needs");
  out.push("");
  out.push(
    'A switch of the schema is a key whose cell "Under `parity`" is not `as default` ' +
      "(F110-FR-008). Every one of them needs a row of §X.7. These are the ones the catalogue " +
      "carries with no row number:",
  );
  out.push("");
  out.push(
    needed.length === 0
      ? "None: every switch of the catalogue has a row."
      : table(
          ["Key", "Owner feature", "Value under `parity`", "What is asked"],
          needed.map((row) => [
            `\`${row.key}\``,
            row.owner,
            row.valueUnderParity === "" ? "—" : `\`${row.valueUnderParity}\``,
            "a row of annex X §X.7 with the key, the owner and the value under `parity`",
          ]),
        ),
  );
  out.push("");
  out.push("## Part A.3 — the keys this catalogue spells for every other feature");
  out.push("");
  out.push(
    `The catalogue holds ${rows.length} keys and names ${owners.length} owner features. The spelling, ` +
      "the type, the class and the layers of every key are decided here (§K.9); the meaning of a key " +
      "belongs to its owner. A feature that reads a key not in its row below is reading a key no " +
      "catalogue carries (F110-FR-009).",
  );
  out.push("");
  out.push(
    table(
      ["Owner feature", "Keys", "Spellings"],
      owners.map((entry) => [
        entry.feature,
        String(entry.keys.length),
        entry.keys.map((key) => `\`${key}\``).join(", "),
      ]),
    ),
  );
  out.push("");
  out.push(
    "Four keys of §K.6 are **not** in the catalogue and belong to feature 107's own contract: " +
      `${EXCLUDED_KEYS.map((key) => `\`${key}\``).join(", ")}. T004's acceptance fixes the count at ` +
      `${rows.length}; the difference is the register rows W-ORC-01 to W-ORC-03 (R-110-02 below).`,
  );
  out.push("");
  out.push("## Part A.4 — the spellings other features must correct in their own specifications");
  out.push("");
  out.push(
    `${corrected.length} keys were corrected under the rule of §K.2. The standing spelling is the ` +
      "one this catalogue carries; the old spelling lives in the `confirmed_or_corrected` column of " +
      "the standing key and never as a row of its own. Each owner feature below carries the old " +
      "spelling somewhere in its own specification and must move to the new one.",
  );
  out.push("");
  out.push(
    table(
      ["Standing key", "Old spelling", "Owner feature", "Proposed by"],
      corrected.map((row) => [
        `\`${row.key}\``,
        row.old
          .split(";")
          .map((old) => `\`${old.trim()}\``)
          .join(", "),
        row.owner,
        row.proposedBy,
      ]),
    ),
  );
  out.push("");
  out.push("## Part B — the requests of phases 1 to 5");
  out.push("");
  out.push(
    'Each is an entry of "Reported to the orchestrator — not repaired here" of ' +
      "`.specstride/features/110-config-and-terms/PROGRESS.md`, with the file that shows the need. " +
      "None of them is repaired by this feature.",
  );
  out.push("");
  out.push(
    table(
      ["Id", "What the orchestrator or the owner must do", "Where it shows", "Raised in"],
      REQUESTS.map((request) => [request.id, request.ask, request.citation, request.raisedIn]),
    ),
  );
  out.push("");
  return `${out.join("\n")}`;
}

export function write(places: Places = defaultPlaces()): string {
  const text = render(places);
  writeFileSync(places.reportPath, text, "utf8");
  return text;
}

/** The differences between the generated report and the committed one. */
export function check(places: Places = defaultPlaces()): readonly string[] {
  const generated = render(places).split("\n");
  let committed: string[];
  try {
    committed = readFileSync(places.reportPath, "utf8").split("\n");
  } catch {
    return [`${places.reportPath} does not exist`];
  }
  const problems: string[] = [];
  for (let i = 0; i < Math.max(generated.length, committed.length); i += 1) {
    if (generated[i] !== committed[i]) {
      problems.push(
        `line ${i + 1}: generated ${JSON.stringify(generated[i] ?? null)}, ` +
          `committed ${JSON.stringify(committed[i] ?? null)}`,
      );
      if (problems.length >= 5) break;
    }
  }
  return Object.freeze(problems);
}

function main(argv: string[]): number {
  const places = defaultPlaces();
  if (argv.includes("--check")) {
    const problems = check(places);
    for (const problem of problems) process.stdout.write(`differs: ${problem}\n`);
    process.stdout.write(
      problems.length === 0
        ? `${places.reportPath} is the generated report\n`
        : `${problems.length} difference(s)\n`,
    );
    return problems.length === 0 ? 0 : 1;
  }
  const text = write(places);
  process.stdout.write(`wrote ${text.split("\n").length} lines to ${places.reportPath}\n`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
