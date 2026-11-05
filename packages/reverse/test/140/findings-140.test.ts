/**
 * T006 — the finding type and its two printers (F140-FR-003), and the fact
 * that `src/codes.ts` really is `contracts/finding-codes.json`.
 *
 * The two expected output strings were produced by the baseline's own
 * `_print_findings` (`lib/reverse.py` at `9cab15d`) over the same findings:
 * the text form by its `print` loop and the JSON form by
 * `json.dumps(result, indent=1, sort_keys=True)`.
 *
 * This file lives in `test/140/` rather than flat in `packages/reverse/test/`
 * because `tests/characterization/108/records.test.ts` enumerates the flat
 * directory and demands a row per file in feature 108's macOS record. Only
 * `serialize.test.ts`, whose flat path task T004 names literally, is placed
 * there (and given its row).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  FINDING_CODES,
  FINDING_CODE_COUNT,
  FINDING_CODES_SCHEMA,
  isFindingCode,
  severityOf,
} from "../../src/codes.ts";
import {
  compareFindings,
  finding,
  findingLine,
  Findings,
  findingToJson,
  findingWhere,
  printFindingsJson,
  printFindingsText,
} from "../../src/lint/findings.ts";

/* ------------------------------------------------------------------------- *
 * `src/codes.ts` comes from the contract
 * ------------------------------------------------------------------------- */

describe("T006 — `src/codes.ts` is `contracts/finding-codes.json`", () => {
  it("holds the same 38 rows, in the same order, with the same severities", () => {
    const contract = JSON.parse(
      readFileSync(new URL("../../data/finding-codes.json", import.meta.url), "utf8"),
    ) as { schema: string; codes: { code: string; severity: string; levels: string }[] };
    assert.equal(contract.schema, FINDING_CODES_SCHEMA);
    assert.equal(contract.codes.length, FINDING_CODE_COUNT);
    assert.equal(FINDING_CODES.length, FINDING_CODE_COUNT);
    assert.deepEqual(
      FINDING_CODES.map((row) => ({ ...row })),
      contract.codes,
    );
  });
});

/* ------------------------------------------------------------------------- *
 * The finding record
 * ------------------------------------------------------------------------- */

describe("T006 — the finding carries a code of the closed family", () => {
  it("takes its severity from the contract, never from the caller", () => {
    assert.equal(finding("placeholder", "spec.md", 3, "m").severity, "error");
    assert.equal(finding("evidence.skipped", null, null, "m").severity, "warning");
    for (const row of FINDING_CODES) {
      assert.equal(finding(row.code, null, null, "m").severity, severityOf(row.code));
    }
  });

  it("refuses a code outside the closed family", () => {
    assert.throws(() => finding("placeholders", null, null, "m"), RangeError);
    assert.throws(() => finding("", null, null, "m"), RangeError);
    assert.ok(!isFindingCode("placeholders"));
  });

  it("refuses a severity that disagrees with the contract", () => {
    const found = new Findings();
    assert.throws(() => found.error("evidence.skipped", null, null, "m"), RangeError);
    assert.throws(() => found.warn("placeholder", null, null, "m"), RangeError);
  });

  it("carries an optional file and an optional line", () => {
    assert.equal(findingWhere(finding("placeholder", "spec.md", 3, "m")), "spec.md:3");
    assert.equal(findingWhere(finding("placeholder", "spec.md", null, "m")), "spec.md");
    assert.equal(findingWhere(finding("placeholder", null, null, "m")), "-");
    // The baseline tests the line with `if f["line"]`, so 0 is no line.
    assert.equal(findingWhere(finding("placeholder", "spec.md", 0, "m")), "spec.md");
  });
});

/* ------------------------------------------------------------------------- *
 * The order
 * ------------------------------------------------------------------------- */

describe("T006 — findings sort by file, line, code and message", () => {
  it("uses the baseline's key, with a missing file as `` and a missing line as 0", () => {
    const a = finding("coverage.fr", null, null, "x");
    const b = finding("placeholder", "spec.md", 3, "m");
    assert.ok(compareFindings(a, b) < 0, "no file sorts before any file");
    const c = finding("placeholder", "spec.md", 2, "m");
    assert.ok(compareFindings(c, b) < 0, "the smaller line first");
    const d = finding("structure.required", "spec.md", 3, "m");
    assert.ok(compareFindings(b, d) < 0, "then the code");
    const e = finding("placeholder", "spec.md", 3, "n");
    assert.ok(compareFindings(b, e) < 0, "then the message");
    assert.equal(compareFindings(b, finding("placeholder", "spec.md", 3, "m")), 0);
  });

  it("sorts lines as numbers, not as text", () => {
    const nine = finding("placeholder", "spec.md", 9, "m");
    const ten = finding("placeholder", "spec.md", 10, "m");
    assert.ok(compareFindings(nine, ten) < 0, "9 before 10, not '10' before '9'");
  });

  it("keeps every error before every warning", () => {
    const found = new Findings();
    found.warn("evidence.skipped", "a.md", 1, "w");
    found.error("placeholder", "z.md", 9, "e");
    const report = found.report();
    assert.deepEqual(
      report.errors.map((f) => f.code),
      ["placeholder"],
    );
    assert.deepEqual(
      report.warnings.map((f) => f.code),
      ["evidence.skipped"],
    );
  });
});

/* ------------------------------------------------------------------------- *
 * The two printers
 * ------------------------------------------------------------------------- */

/** The five findings both golden strings were produced from. */
function sample(): Findings {
  const found = new Findings();
  found.add("placeholder", "spec.md", 3, "\u00e9 marker");
  found.add("coverage.fr", null, null, "x");
  found.add("structure.required", "spec.md", 3, "a");
  found.add("evidence.skipped", null, null, "no --src: evidence citations were not checked");
  found.add("template.expected", "\ud83d\ude00.md", 7, "\u00f6");
  return found;
}

describe("T006 — the text printer", () => {
  it("equals the baseline's `_print_findings` byte for byte", () => {
    const EXPECTED =
      "ERROR - [coverage.fr] x\n" +
      "ERROR spec.md:3 [placeholder] \u00e9 marker\n" +
      "ERROR spec.md:3 [structure.required] a\n" +
      "warn  - [evidence.skipped] no --src: evidence citations were not checked\n" +
      "warn  \ud83d\ude00.md:7 [template.expected] \u00f6\n" +
      "3 error(s), 2 warning(s)\n";
    assert.equal(printFindingsText(sample().report()), EXPECTED);
  });

  it("writes `ERROR ` for an error and `warn  ` — two spaces — for a warning", () => {
    assert.equal(findingLine(finding("placeholder", "a", 1, "m")), "ERROR a:1 [placeholder] m");
    assert.equal(
      findingLine(finding("evidence.skipped", "a", 1, "m")),
      "warn  a:1 [evidence.skipped] m",
    );
  });

  it("prints the summary line even when nothing was found", () => {
    assert.equal(printFindingsText(new Findings().report()), "0 error(s), 0 warning(s)\n");
  });
});

describe("T006 — the JSON printer", () => {
  it("equals the baseline's `json.dumps(result, indent=1, sort_keys=True)`", () => {
    const EXPECTED =
      '{\n "errors": [\n  {\n   "file": null,\n   "line": null,\n   "message": "x",\n   "rule": "coverage.fr"\n  },\n  {\n   "file": "spec.md",\n   "line": 3,\n   "message": "\\u00e9 marker",\n   "rule": "placeholder"\n  },\n  {\n   "file": "spec.md",\n   "line": 3,\n   "message": "a",\n   "rule": "structure.required"\n  }\n ],\n "warnings": [\n  {\n   "file": null,\n   "line": null,\n   "message": "no --src: evidence citations were not checked",\n   "rule": "evidence.skipped"\n  },\n  {\n   "file": "\\ud83d\\ude00.md",\n   "line": 7,\n   "message": "\\u00f6",\n   "rule": "template.expected"\n  }\n ]\n}\n';
    assert.equal(printFindingsJson(sample().report()), EXPECTED);
  });

  it("is one object with the two lists and NO summary line", () => {
    const text = printFindingsJson(new Findings().report());
    assert.equal(text, '{\n "errors": [],\n "warnings": []\n}\n');
    assert.ok(!text.includes("error(s)"), "the summary line belongs to the text form only");
    const parsed = JSON.parse(text) as Record<string, unknown>;
    assert.deepEqual(Object.keys(parsed), ["errors", "warnings"]);
  });

  it("names the code `rule`, as the compatibility output of the baseline does", () => {
    assert.deepEqual(findingToJson(finding("placeholder", "spec.md", 3, "m")), {
      rule: "placeholder",
      file: "spec.md",
      line: 3,
      message: "m",
    });
    const text = printFindingsJson(sample().report());
    assert.ok(text.includes('"rule": "placeholder"'));
    assert.ok(!text.includes('"code":'), "`code` is the internal name, `rule` the printed one");
    assert.ok(!text.includes('"severity":'), "the severity is the list, not a key");
  });

  it("escapes non-ASCII, because `ensure_ascii` is left at Python's default", () => {
    const text = printFindingsJson(sample().report());
    assert.ok(text.includes('"\\ud83d\\ude00.md"'), "a surrogate pair, as Python writes it");
    assert.ok(!text.includes("\ud83d\ude00"), "and the raw character does not appear");
  });

  it("counts the findings it was given", () => {
    const found = sample();
    assert.equal(found.errorCount, 3);
    assert.equal(found.warningCount, 2);
  });
});
