/**
 * CT-140-3, task T021 of feature 140 — DETERMINISM (F140-SC-003).
 *
 *   "Two plans over the same source tree give byte-identical inventories, and
 *    the fingerprint equals the baseline's on every fixture of FX-30."
 *
 * Both halves are measured here, and neither is argued:
 *
 *  * **Byte-identical.** The verb `reverse inventory` is run TWICE over one
 *    tree, into two different files, and the two files are compared as BYTES.
 *    A timestamp, a locale-dependent sort or an iteration order that the
 *    platform chooses would show up as a difference; nothing else would.
 *  * **The fingerprint equals the baseline's.** The expected value is not a
 *    constant this feature invented: `test/140/data/baseline-reference.json`
 *    was produced by RUNNING `lib/reverse_inventory.py` of the Specstride
 *    baseline at `9cab15d` over the tree `test/140/reference-tree.ts` writes
 *    (the generator is
 *    `.specstride/features/140-reverse-inventory-and-lint/gates/proofs/phase4-baseline-golden.py`).
 *    The whole DOCUMENT is compared against those bytes too, after the key
 *    `schema` is removed — the one difference of this document from the
 *    baseline's (DV-116).
 *
 * The record holds six cases, so the comparison covers the exclusions, each
 * size limit at a value that bites, a subdirectory, and a summary budget small
 * enough to drop file rows.
 */
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { runInventory } from "../src/inventory/cli.ts";
import { buildInventory, withoutTheSchemaKey } from "../src/inventory/document.ts";
import { serializeDocument } from "../src/inventory/serialize.ts";
import { renderSummary } from "../src/inventory/summary.ts";
import { REFERENCE_TREE_NAME, buildReferenceTree } from "./140/reference-tree.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The golden record the Specstride baseline produced. */
type Case = {
  readonly source: string;
  readonly excludes: readonly string[];
  readonly environ: Readonly<Record<string, string>>;
  readonly budget: number;
  readonly walk: string;
  readonly fingerprint: string;
  readonly totals: { readonly files: number; readonly skipped: number };
  readonly oversize: boolean;
  readonly documentText: string;
  readonly summary: string;
};

type Golden = {
  readonly producedBy: string;
  readonly python: string;
  readonly tomlReader: boolean;
  readonly summaryJsonPath: string;
  readonly cases: Readonly<Record<string, Case>>;
  readonly tomlCost: { readonly fingerprint: string; readonly documentText: string };
};

const GOLDEN = JSON.parse(
  readFileSync(join(HERE, "140", "data", "baseline-reference.json"), "utf8"),
) as Golden;

let root = "";
let tree = "";

before(() => {
  root = mkdtempSync(join(tmpdir(), "ct-140-3-"));
  // The base name must be the generator's: the summary's title holds it.
  tree = buildReferenceTree(join(root, REFERENCE_TREE_NAME));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("CT-140-3 — two runs over one tree give byte-identical inventories", () => {
  it("the two documents are equal as bytes", () => {
    const first = runInventory([tree, "--out", join(root, "a.json")], { environ: {} });
    const second = runInventory([tree, "--out", join(root, "b.json")], { environ: {} });
    assert.equal(first.exit, 0, first.stderr);
    assert.equal(second.exit, 0, second.stderr);
    const a = readFileSync(join(root, "a.json"));
    const b = readFileSync(join(root, "b.json"));
    assert.ok(a.equals(b), "two runs over one tree must give byte-identical inventories");
    assert.ok(a.length > 1000, "the document is not empty");
  });

  it("the two summaries are equal as bytes", () => {
    // The same `--out` for both: the summary names the inventory it belongs to
    // (F140-FR-025), so two different `--out` paths SHOULD give two different
    // summaries, and comparing them would prove nothing about determinism.
    const out = join(root, "c.json");
    runInventory([tree, "--out", out, "--md", join(root, "c.md")], { environ: {} });
    runInventory([tree, "--out", out, "--md", join(root, "d.md")], { environ: {} });
    const a = readFileSync(join(root, "c.md"));
    const b = readFileSync(join(root, "d.md"));
    assert.ok(a.equals(b), "two runs over one tree must give byte-identical summaries");
    assert.ok(a.includes("# Inventory —"), "the summary was rendered");
  });

  it("the document carries no timestamp and no date", () => {
    const text = readFileSync(join(root, "a.json"), "utf8");
    assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:/.test(text), "no ISO timestamp");
    assert.ok(!/"(timestamp|generated_at|created|date)"/.test(text), "no field of a clock");
  });

  it("the order of the files is by code point, not by UTF-16 unit", () => {
    const inventory = buildInventory({ src: tree, environ: {} });
    const paths = inventory.files.map((entry) => entry.path);
    const byCodePoint = [...paths].sort((a, b) => {
      const left = [...a];
      const right = [...b];
      for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
        const x = (left[i] as string).codePointAt(0) as number;
        const y = (right[i] as string).codePointAt(0) as number;
        if (x !== y) return x - y;
      }
      return left.length - right.length;
    });
    assert.deepEqual(paths, byCodePoint);
    assert.ok(
      paths.some((path) => path.includes("😀")),
      "the reference tree holds an astral character, so the two orders can differ",
    );
  });
});

describe("CT-140-3 — the fingerprint equals the baseline's", () => {
  it("the golden record was produced by the baseline itself", () => {
    assert.match(GOLDEN.producedBy, /reverse_inventory\.py of the Specstride baseline at 9cab15d/);
    assert.equal(GOLDEN.tomlReader, false, "F140-FR-022: no TOML reader is bundled");
    assert.ok(Object.keys(GOLDEN.cases).length >= 6, "six cases at least");
  });

  for (const name of Object.keys(JSON.parse(JSON.stringify(GOLDEN.cases)) as object)) {
    it(`case ${name}: the fingerprint, the document and the summary equal the baseline's`, () => {
      const one = GOLDEN.cases[name] as Case;
      const source = one.source === "" ? tree : join(tree, one.source);
      const inventory = buildInventory({
        src: source,
        excludes: one.excludes,
        environ: one.environ,
      });
      const real = realpathSync(source);
      assert.equal(inventory.fingerprint, one.fingerprint, "the fingerprint is the baseline's");
      assert.equal(inventory.walk, one.walk);
      assert.equal(inventory.totals.files, one.totals.files);
      assert.equal(inventory.totals.skipped, one.totals.skipped);
      assert.equal(inventory.oversize, one.oversize);
      const document = serializeDocument(withoutTheSchemaKey(inventory)).split(real).join("<SRC>");
      assert.equal(document, one.documentText, "the document bytes are the baseline's");
      const summary = renderSummary(inventory, GOLDEN.summaryJsonPath, one.budget)
        .text.split(real)
        .join("<SRC>");
      assert.equal(summary, one.summary, "the summary bytes are the baseline's");
    });
  }

  it("a bundled TOML reader would not change the fingerprint", () => {
    // F140-FR-022's divergence is measured, not assumed: the record holds the
    // document of an interpreter that HAS `tomllib`, and its fingerprint is
    // the same, because the fingerprint covers the triples alone.
    assert.equal(
      GOLDEN.tomlCost.fingerprint,
      (GOLDEN.cases["default"] as Case).fingerprint,
      "the TOML reader changes manifest facts, never the fingerprint",
    );
    assert.notEqual(
      GOLDEN.tomlCost.documentText,
      (GOLDEN.cases["default"] as Case).documentText,
      "it does change the manifest records, which is the declared divergence",
    );
  });
});
