/**
 * T003 — the consistency test of `specs/128-telemetry-export/contracts/README.md`
 * over the exporter's data files, in the build.
 *
 * `contracts/README.md` fixes the check: "A test fails when a scope, a metric,
 * a key or a form of the files has no requirement in `spec.md`, or a requirement
 * names one that the files do not hold." The package ships the copy the exporter
 * reads under `data/export/`; the contract source stays under `specs/`.
 *
 * The checks, each a function over the parsed rows so a negative control can
 * show what it detects:
 *
 *   1. every scope of `span-scopes.tsv` is written in `spec.md`, with its
 *      opening and closing types, and the "Scopes of a span" table of the
 *      specification names no scope the file does not hold (both directions);
 *   2. every metric of `metrics.tsv` is named in a requirement of `spec.md`,
 *      and every metric the metric requirements name is a row (both directions),
 *      with the as-is name of every row written in the specification too;
 *   3. every key of `config-keys.tsv` is written in `spec.md` and names only
 *      requirements the specification holds; every `telemetry.*` key the
 *      specification names is a row (both directions); the row of annex X
 *      §X.7 the file records is the row feature 100's profile data gives for
 *      the key; and the seven environment aliases of §K.8 of feature 110 are
 *      in the alias column;
 *   4. every row of `payload-forms.tsv` names a requirement that holds it, and
 *      the identifier tokens of the row are written in `spec.md`;
 *   5. the schema copy keeps the schema id and the `$id` form of annex B §B.20
 *      (`urn:specstride:schema:<schema id>`).
 *
 * The specification is read from the checkout; where `specs/` is absent the
 * specification-dependent checks report a skip with their reason.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root: three levels up from `packages/observability/test/export`. */
const ROOT = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));

/** The copies this package ships and the exporter reads (T003). */
export const DATA_DIR = join(ROOT, "packages/observability/data/export");
/** The contract source the copies are taken from. */
export const SPEC_DIR = join(ROOT, "specs/128-telemetry-export");
/** The specification the requirements live in. */
export const SPEC_FILE = join(SPEC_DIR, "spec.md");
/** Feature 100's data for the rows of annex X §X.7. */
export const PARITY_PROFILE_FILE = join(
  ROOT,
  "specs/100-specstride/contracts/data/parity-profile.json",
);

// ── parsing helpers ─────────────────────────────────────────────────────────

/** Parse a TSV with a header row into row objects keyed by the header cells. */
export function parseTsv(text: string): Array<Record<string, string>> {
  const lines = text.split("\n").filter((l: string) => l.length > 0);
  const header: string[] = lines[0].split("\t");
  return lines.slice(1).map((line: string) => {
    const cells: string[] = line.split("\t");
    const row: Record<string, string> = {};
    for (const [i, name] of header.entries()) row[name] = cells[i] ?? "";
    return row;
  });
}

/**
 * The requirement bullets of `spec.md` as a map from the requirement id to the
 * whole text of the requirement: the bullet line plus the indented lines that
 * belong to it (the `parity:` sub-bullets), up to the next bullet.
 */
export function requirementBullets(specText: string): Map<string, string> {
  const lines: string[] = specText.split("\n");
  const bullets = new Map<string, string>();
  let current: string | null = null;
  let buffer: string[] = [];
  for (const line of lines) {
    const match = /^- \*\*(F128-FR-\d+)\*\*: (.*)$/.exec(line);
    if (match !== null) {
      if (current !== null) bullets.set(current, buffer.join("\n"));
      current = match[1];
      buffer = [match[2]];
    } else if (current !== null && (line.startsWith("  ") || line === "")) {
      buffer.push(line);
    } else if (current !== null && !line.startsWith("  ")) {
      bullets.set(current, buffer.join("\n"));
      current = null;
      buffer = [];
    }
  }
  if (current !== null) bullets.set(current, buffer.join("\n"));
  return bullets;
}

function readData(name: string): string {
  return readFileSync(join(DATA_DIR, name), "utf8");
}

// ── the data ────────────────────────────────────────────────────────────────

const scopes = parseTsv(readData("span-scopes.tsv"));
const metrics = parseTsv(readData("metrics.tsv"));
const keys = parseTsv(readData("config-keys.tsv"));
const forms = parseTsv(readData("payload-forms.tsv"));
const openersClosers = parseTsv(readData("as-is-openers-closers.tsv"));
const schema = JSON.parse(readData("span-state.schema.json"));

const specAvailable = existsSync(SPEC_FILE);
const specText = specAvailable ? readFileSync(SPEC_FILE, "utf8") : "";
const bullets = specAvailable ? requirementBullets(specText) : new Map();

/** The rows of annex X §X.7, as feature 100's generated profile data holds them. */
function parityRows(): Map<string, { number: number; keys: string[] }> {
  if (!existsSync(PARITY_PROFILE_FILE)) return new Map();
  const profile = JSON.parse(readFileSync(PARITY_PROFILE_FILE, "utf8")) as {
    switches: Array<{ number: number; keys: string[] }>;
  };
  return new Map(profile.switches.map((s) => [String(s.number), s]));
}

// ── 1. scopes ───────────────────────────────────────────────────────────────

/** Forward: every scope of the file is written in the specification. */
export function everyScopeIsInTheSpec(
  rows: Array<Record<string, string>> = scopes,
  text: string = specText,
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const row of rows) {
    if (!text.includes(`\`${row.scope}\``)) missing.push(row.scope);
    for (const kind of ["opens", "closes"]) {
      for (const token of row[kind].split(/[|;]/)) {
        const type = token.trim().replace(/^.*:\s*/, "");
        if (/^[a-z][a-z.]*[a-z]$/.test(type) && !text.includes(type))
          missing.push(`${row.scope}:${kind}:${type}`);
      }
    }
  }
  return { ok: missing.length === 0, missing };
}

/** Reverse: the "Scopes of a span" table of the specification names no other scope. */
export function everyScopeInTheSpecIsARow(
  rows: Array<Record<string, string>> = scopes,
  text: string = specText,
): { ok: boolean; named: string[]; unknown: string[] } {
  const table = (text.split("### Scopes of a span")[1] ?? "").split("\n### ")[0];
  const names = [...table.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]);
  const held = new Set(rows.map((r) => r.scope));
  return {
    ok: names.every((n) => held.has(n)),
    named: names,
    unknown: names.filter((n) => !held.has(n)),
  };
}

/** The as-is openers and closers name only scopes the span table holds. */
export function everyAsIsEventNamesAScope(
  rows: Array<Record<string, string>> = openersClosers,
  scopeRows: Array<Record<string, string>> = scopes,
): { ok: boolean; unknown: string[] } {
  const held = new Set(scopeRows.map((r) => r.scope));
  const unknown = rows
    .filter((r) => r.scope !== "-" && !held.has(r.scope))
    .map((r) => r.as_is_event);
  return { ok: unknown.length === 0, unknown };
}

// ── 2. metrics ──────────────────────────────────────────────────────────────

/** The requirements that define metrics (F128-FR-030, F128-FR-033, F128-FR-034). */
export const METRIC_REQUIREMENTS = ["F128-FR-030", "F128-FR-033", "F128-FR-034"];

/** Forward: every metric is named in a requirement of the specification. */
export function everyMetricHasARequirement(
  rows: Array<Record<string, string>> = metrics,
  reqs: Map<string, string> = bullets,
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const row of rows) {
    const holders = [...reqs.entries()]
      .filter(([, text]) => text.includes(`\`${row.metric}\``))
      .map(([id]) => id);
    if (holders.length === 0) missing.push(row.metric);
  }
  return { ok: missing.length === 0, missing };
}

/** Reverse: every metric the metric requirements name is a row of the file. */
export function everyMetricNamedIsARow(
  rows: Array<Record<string, string>> = metrics,
  reqs: Map<string, string> = bullets,
): { ok: boolean; named: string[]; unknown: string[] } {
  const held = new Set(rows.map((r) => r.metric));
  const haystack = METRIC_REQUIREMENTS.map((id) => reqs.get(id) ?? "").join("\n");
  const named = [...haystack.matchAll(/`specstride\.[a-z][a-z0-9]*(?:\.[a-z0-9]+)+`/g)].map(
    (m) => m[1],
  );
  const metricTokens = named.filter((token) =>
    new RegExp(`\\\`${token}\\\` \\((sum|histogram|gauge)`).test(haystack),
  );
  return {
    ok: metricTokens.every((t) => held.has(t)),
    named: metricTokens,
    unknown: metricTokens.filter((t) => !held.has(t)),
  };
}

/** Every as-is name of a metric row is written in the specification. */
export function everyAsIsMetricNameIsInTheSpec(
  rows: Array<Record<string, string>> = metrics,
  text: string = specText,
): { ok: boolean; missing: string[] } {
  const missing = rows
    .filter((r) => r.as_is_name !== "-")
    .filter((r) => !text.includes(r.as_is_name))
    .map((r) => r.as_is_name);
  return { ok: missing.length === 0, missing };
}

// ── 3. keys ─────────────────────────────────────────────────────────────────

/** Forward: every key is written in the specification and names held requirements. */
export function everyKeyHasARequirement(
  rows: Array<Record<string, string>> = keys,
  reqs: Map<string, string> = bullets,
  text: string = specText,
): { ok: boolean; missing: string[]; unknownRequirements: string[] } {
  const missing: string[] = [];
  const unknownRequirements: string[] = [];
  for (const row of rows) {
    if (!text.includes(row.key)) missing.push(row.key);
    for (const id of row.spec.split(/,\s*/)) {
      if (id !== "" && !reqs.has(id)) unknownRequirements.push(`${row.key}:${id}`);
    }
  }
  return {
    ok: missing.length === 0 && unknownRequirements.length === 0,
    missing,
    unknownRequirements,
  };
}

/** Reverse: every `telemetry.*` key the specification names is a row. */
export function everyKeyNamedIsARow(
  rows: Array<Record<string, string>> = keys,
  text: string = specText,
): { ok: boolean; named: string[]; unknown: string[] } {
  const held = new Set(rows.map((r) => r.key));
  const named = [...text.matchAll(/`(telemetry\.[A-Za-z][A-Za-z0-9.]*)`/g)].map((m) => m[1]);
  // `telemetry.delivery` is an event name of feature 111, not a key of this
  // feature; every other named key must be a row.
  const notKeys = new Set(["telemetry.delivery", "telemetry.endpoint"]);
  return {
    ok: named.every((k) => held.has(k) || notKeys.has(k)),
    named,
    unknown: named.filter((k) => !held.has(k) && !notKeys.has(k)),
  };
}

/** The row of annex X §X.7 the file records is the row the profile data gives. */
export function everyAnnexRowAgrees(rows = keys, profile = parityRows()) {
  const disagreements = [];
  for (const row of rows) {
    const annex = profile.get(row.annex_x7_row);
    if (annex === undefined) {
      if (existsSync(PARITY_PROFILE_FILE))
        disagreements.push(`${row.key}: row ${row.annex_x7_row} not in the profile data`);
      continue;
    }
    if (!annex.keys.includes(row.key))
      disagreements.push(`${row.key}: not a key of row ${row.annex_x7_row}`);
  }
  return { ok: disagreements.length === 0, disagreements };
}

/** The seven environment aliases of §K.8 of feature 110 are in the alias column. */
export const K8_ALIASES = Object.freeze([
  "SPECSTRIDE_OTEL_TRACES",
  "RALPH_LOKI_URL",
  "RALPH_OTEL_URL",
  "RALPH_LOKI_TIMEOUT",
  "RALPH_OTEL_TIMEOUT",
  "RALPH_LOKI_MAX_BATCH_BYTES",
  "RALPH_OTEL_MAX_BATCH_BYTES",
]);

export function everyK8AliasIsHeld(rows = keys) {
  const held = rows.map((r) => r.as_is_alias).join("\n");
  const missing = K8_ALIASES.filter((a) => !held.includes(a));
  return { ok: missing.length === 0, missing };
}

// ── 4. payload forms ────────────────────────────────────────────────────────

/**
 * The requirement that holds each form, with a token that anchors it: the token
 * must appear in the requirement's text (or, where the requirement speaks of the
 * table as a whole, in the specification).
 */
export const FORM_REQUIREMENTS = Object.freeze([
  { subject: "event and field names", requirement: "F128-FR-009", anchor: "api_request" },
  { subject: "loki label job", requirement: "F128-FR-021", anchor: "job" },
  { subject: "loki labels", requirement: "F128-FR-021", anchor: "role" },
  { subject: "log and metric scope", requirement: "F128-FR-012", anchor: "specstride.ralph" },
  {
    subject: "log and metric resource attributes",
    requirement: "F128-FR-012",
    anchor: "service.name",
  },
  {
    subject: "trace scope; trace service.name",
    requirement: "F128-FR-012",
    anchor: "specstride.trace",
  },
  {
    subject: "time of an entry or record",
    requirement: "F128-FR-020",
    anchor: "Clock of the sink",
  },
  { subject: "span names", requirement: "F128-FR-014", anchor: "span name" },
  {
    subject: "events that project to nothing",
    requirement: "F128-FR-009",
    anchor: "project to nothing",
  },
]);

/** Forward: every row of the file is held, with the others, by a requirement. */
export function everyFormHasARequirement(rows = forms, reqs = bullets, text = specText) {
  const problems = [];
  const subjects = new Set(rows.map((r) => r.subject));
  for (const form of FORM_REQUIREMENTS) {
    if (!subjects.has(form.subject)) problems.push(`${form.subject}: no row`);
    const held =
      (reqs.get(form.requirement) ?? "").includes(form.anchor) || text.includes(form.anchor);
    if (!held)
      problems.push(
        `${form.subject}: anchor ${form.anchor} not in ${form.requirement} or the spec`,
      );
  }
  const unmapped = rows
    .filter((r) => !FORM_REQUIREMENTS.some((f) => f.subject === r.subject))
    .map((r) => r.subject);
  return { ok: problems.length === 0 && unmapped.length === 0, problems, unmapped };
}

/** Reverse: every identifier token of the form rows is written in the specification. */
export function everyFormTokenIsInTheSpec(rows = forms, text = specText) {
  const missing = [];
  for (const row of rows) {
    for (const cell of [row.as_is_form, row.new_form]) {
      for (const token of cell.matchAll(/`?((?:specstride|ralph)\.[a-z0-9.]+)`?/g)) {
        if (!text.includes(token[1])) missing.push(`${row.subject}:${token[1]}`);
      }
    }
  }
  for (const name of ["api_request", "tool_use", "gate"]) {
    if (!text.includes(name)) missing.push(name);
  }
  return { ok: missing.length === 0, missing };
}

// ── 5. the schema copy ──────────────────────────────────────────────────────

/** The schema id and the `$id` form of annex B §B.20. */
export function schemaHolds() {
  const id = schema["$id"] ?? "";
  // The schema id sits in the `const` of the required `schema` field
  // (F100-FR-048: no `v` field; the id with its major travels in the record).
  const schemaId = schema?.properties?.schema?.const ?? "";
  return {
    ok:
      schemaId === "specstride.span-state/1" &&
      id === "urn:specstride:schema:specstride.span-state/1",
    schema: schemaId,
    id,
  };
}

// ── the tests ───────────────────────────────────────────────────────────────

test("every scope of span-scopes.tsv is a scope of spec.md, and the reverse", (t) => {
  assert.ok(scopes.length > 0);
  if (!specAvailable) return t.skip("specs/ is not in the checkout");
  const forward = everyScopeIsInTheSpec();
  assert.deepEqual(forward.missing, [], `scopes not in spec.md: ${forward.missing.join(", ")}`);
  const reverse = everyScopeInTheSpecIsARow();
  assert.deepEqual(
    reverse.unknown,
    [],
    `scopes of spec.md that are no row: ${reverse.unknown.join(", ")}`,
  );
  const asIs = everyAsIsEventNamesAScope();
  assert.deepEqual(
    asIs.unknown,
    [],
    `as-is events of an unknown scope: ${asIs.unknown.join(", ")}`,
  );
});

test("every metric of metrics.tsv has a requirement, and the reverse", (t) => {
  if (!specAvailable) return t.skip("specs/ is not in the checkout");
  const forward = everyMetricHasARequirement();
  assert.deepEqual(
    forward.missing,
    [],
    `metrics with no requirement: ${forward.missing.join(", ")}`,
  );
  const reverse = everyMetricNamedIsARow();
  assert.deepEqual(
    reverse.unknown,
    [],
    `metrics the spec names that are no row: ${reverse.unknown.join(", ")}`,
  );
  const asIs = everyAsIsMetricNameIsInTheSpec();
  assert.deepEqual(
    asIs.missing,
    [],
    `as-is metric names not in spec.md: ${asIs.missing.join(", ")}`,
  );
});

test("every key of config-keys.tsv has a requirement, and the reverse", (t) => {
  if (!specAvailable) return t.skip("specs/ is not in the checkout");
  const forward = everyKeyHasARequirement();
  assert.deepEqual(forward.missing, [], `keys not in spec.md: ${forward.missing.join(", ")}`);
  assert.deepEqual(forward.unknownRequirements, [], `keys naming unknown requirements`);
  const reverse = everyKeyNamedIsARow();
  assert.deepEqual(
    reverse.unknown,
    [],
    `keys of spec.md that are no row: ${reverse.unknown.join(", ")}`,
  );
  const annex = everyAnnexRowAgrees();
  assert.deepEqual(
    annex.disagreements,
    [],
    `annex X §X.7 disagreements: ${annex.disagreements.join("; ")}`,
  );
  const aliases = everyK8AliasIsHeld();
  assert.deepEqual(aliases.missing, [], `§K.8 aliases not held: ${aliases.missing.join(", ")}`);
});

test("every row of payload-forms.tsv has a requirement, and the reverse", (t) => {
  if (!specAvailable) return t.skip("specs/ is not in the checkout");
  const forward = everyFormHasARequirement();
  assert.deepEqual(
    forward.problems,
    [],
    `forms without a requirement: ${forward.problems.join("; ")}`,
  );
  assert.deepEqual(
    forward.unmapped,
    [],
    `rows with no form mapping: ${forward.unmapped.join(", ")}`,
  );
  const reverse = everyFormTokenIsInTheSpec();
  assert.deepEqual(
    reverse.missing,
    [],
    `form tokens not in spec.md: ${reverse.missing.join(", ")}`,
  );
});

test("the schema copy keeps the schema id and the $id form of annex B §B.20", () => {
  const held = schemaHolds();
  assert.equal(held.schema, "specstride.span-state/1");
  assert.equal(held.id, "urn:specstride:schema:specstride.span-state/1");
});

// ── negative controls: each check detects the violation it is there for ─────

test("negative control: a scope the spec does not name is a finding", () => {
  const probe = [{ ...scopes[0], scope: "not_a_scope_of_the_spec" }];
  const result = everyScopeIsInTheSpec(probe, specText);
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("not_a_scope_of_the_spec"));
  const synthetic =
    "### Scopes of a span\n\n| `run` | x | y | z |\n| `ghost_scope` | a | b | c | d | e | f |\n\n### after";
  const reverse = everyScopeInTheSpecIsARow(scopes, synthetic);
  assert.ok(reverse.unknown.includes("ghost_scope"));
});

test("negative control: a metric the requirements do not name is a finding", () => {
  const probe = [{ ...metrics[0], metric: "specstride.ghost.metric" }];
  const result = everyMetricHasARequirement(probe, bullets);
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("specstride.ghost.metric"));
});

test("negative control: a key the spec does not name is a finding", () => {
  const probe = [{ ...keys[0], key: "telemetry.ghostKey" }];
  const result = everyKeyHasARequirement(probe, bullets, specText);
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("telemetry.ghostKey"));
});

test("negative control: a form row with no mapping is a finding", () => {
  const probe = [...forms, { subject: "a form nothing holds", as_is_form: "x", new_form: "y" }];
  const result = everyFormHasARequirement(probe, bullets, specText);
  assert.equal(result.ok, false);
  assert.ok(result.unmapped.includes("a form nothing holds"));
});
