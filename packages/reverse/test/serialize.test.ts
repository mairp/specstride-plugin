/**
 * CT-140-4 — the byte-exact helpers (task T004; proves F140-FR-021).
 *
 * Every expected string below was PRODUCED BY PYTHON, by running the
 * baseline's own calls (`lib/reverse_inventory.py` at `9cab15d`:
 * `json.dumps(inventory, sort_keys=True, indent=1, ensure_ascii=False) + "\n"`
 * for the document and `json.dumps(entries, separators=(",", ":"))` for the
 * fingerprint input) and escaping the result into a JavaScript literal. They
 * are literals here on purpose: a test that re-derived them from the
 * implementation would prove nothing, and Python is not on the test path.
 *
 * The three things under test (F140-FR-021):
 *  - sorting is by CODE POINT, "never by locale and never by UTF-16 unit";
 *  - the document keeps non-ASCII characters, sorts its keys and indents by
 *    one space, and ends with a line end;
 *  - the fingerprint input is compact and ESCAPES non-ASCII, an astral
 *    character as a surrogate pair — "including the escaping of non-ASCII
 *    characters".
 *
 * The non-ASCII cases are the point of the whole file: with one serializer
 * instead of two (decision D-1 of `research.md`) the fingerprint of every
 * source holding a non-ASCII path would differ from the baseline's.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  compareCodePoint,
  serializeDocument,
  serializeFingerprintInput,
  serializeJson,
  sortByCodePoint,
} from "../src/inventory/serialize.ts";

/* ------------------------------------------------------------------------- *
 * The code-point comparator
 * ------------------------------------------------------------------------- */

describe("CT-140-4 — the comparator sorts by code point, as Python does", () => {
  /** `sorted(...)` in Python 3.13.5 over the same list, joined by U+001F. */
  const INPUT =
    "zz.txt\u001fa.txt\u001fZ.txt\u001fé.txt\u001fe.txt\u001fö.txt\u001f�.txt\u001f😀.txt\u001fé\u001fab\u001fa";
  const SORTED =
    "Z.txt\u001fa\u001fa.txt\u001fab\u001fe.txt\u001fzz.txt\u001fé\u001fé.txt\u001fö.txt\u001f�.txt\u001f😀.txt";

  it("orders a mixed list exactly as Python's `sorted`", () => {
    assert.equal(sortByCodePoint(INPUT.split("\u001f")).join("\u001f"), SORTED);
  });

  it("disagrees with the JavaScript default where the default is UTF-16 order", () => {
    // U+FFFD is 0xFFFD; U+1F600 is 0x1F600, so by CODE POINT U+FFFD is first.
    // By UTF-16 unit the astral character begins with the high surrogate
    // 0xD83D, which is BELOW 0xFFFD, so the platform default inverts the two.
    // This is the case decision D-2 of `research.md` exists for.
    const pair = ["😀", "�"];
    assert.deepEqual(sortByCodePoint(pair), ["�", "😀"]);
    assert.deepEqual([...pair].sort(), ["😀", "�"]);
    assert.ok(compareCodePoint("�", "😀") < 0);
    assert.ok(compareCodePoint("😀", "�") > 0);
  });

  it("is a total order: antisymmetric, zero only on equality, prefix first", () => {
    assert.equal(compareCodePoint("a", "a"), 0);
    assert.equal(compareCodePoint("😀", "😀"), 0);
    assert.ok(compareCodePoint("a", "ab") < 0, "a prefix sorts first");
    assert.ok(compareCodePoint("ab", "a") > 0);
    assert.ok(compareCodePoint("Z", "a") < 0, "upper case before lower, as by code point");
    assert.ok(compareCodePoint("e", "é") < 0, "never a locale collation");
  });

  it("does not consult a locale", () => {
    // Under a locale collation "é" would sort next to "e", before "f".
    assert.deepEqual(sortByCodePoint(["f", "é", "e"]), ["e", "f", "é"]);
  });
});

/* ------------------------------------------------------------------------- *
 * The document serializer
 * ------------------------------------------------------------------------- */

describe("CT-140-4 — the document serializer equals Python's `dumps`", () => {
  it("renders an inventory-shaped document byte for byte", () => {
    const document = {
      schema: "specstride.reverse-inventory/1",
      schema_version: 1,
      files: [
        {
          path: "src/é.ts",
          bytes: 12,
          lines: 2,
          sha256: "ab",
          language: "ts",
          role: "src",
        },
      ],
      skipped: [],
      project: {},
      oversize: false,
      git_head: null,
      units: [{ path: "😀", files: 1, bytes: 3 }],
      excludes: ["ö", "a"],
      limits: { max_file_bytes: 1048576, max_total_bytes: 20971520 },
    };
    // json.dumps(doc, sort_keys=True, indent=1, ensure_ascii=False) + "\n"
    const EXPECTED =
      '{\n "excludes": [\n  "ö",\n  "a"\n ],\n "files": [\n  {\n   "bytes": 12,\n   "language": "ts",\n   "lines": 2,\n   "path": "src/é.ts",\n   "role": "src",\n   "sha256": "ab"\n  }\n ],\n "git_head": null,\n "limits": {\n  "max_file_bytes": 1048576,\n  "max_total_bytes": 20971520\n },\n "oversize": false,\n "project": {},\n "schema": "specstride.reverse-inventory/1",\n "schema_version": 1,\n "skipped": [],\n "units": [\n  {\n   "bytes": 3,\n   "files": 1,\n   "path": "😀"\n  }\n ]\n}\n';
    assert.equal(serializeDocument(document), EXPECTED);
  });

  it("sorts keys by code point, indents by one space and ends with a line end", () => {
    const text = serializeDocument({ b: 1, a: 2 });
    assert.equal(text, '{\n "a": 2,\n "b": 1\n}\n');
    assert.ok(text.endsWith("\n"), "the final line end of `dumps`");
    assert.equal(text.split("\n")[1], ' "a": 2,', "one space of indentation, `: ` after the key");
  });

  it("keeps non-ASCII characters as they are", () => {
    assert.equal(serializeDocument("é😀"), '"é😀"\n');
    assert.ok(!serializeDocument({ ö: "é" }).includes("\\u"));
  });

  it("writes an empty object and an empty list on one line, as Python does", () => {
    const EXPECTED = '{\n "a": {},\n "b": [],\n "c": [\n  []\n ],\n "d": {\n  "e": {}\n }\n}';
    assert.equal(
      serializeJson({ a: {}, b: [], c: [[]], d: { e: {} } }, { indent: 1, sortKeys: true }),
      EXPECTED,
    );
  });

  it("indents nested containers as Python does", () => {
    const EXPECTED =
      '{\n "a": 0,\n "b": [\n  1,\n  {\n   "a": [\n    true,\n    false\n   ],\n   "k": null\n  }\n ]\n}\n';
    assert.equal(serializeDocument({ b: [1, { k: null, a: [true, false] }], a: 0 }), EXPECTED);
  });

  it("is reproducible: the same tree gives the same bytes twice", () => {
    const document = { files: [{ path: "é", bytes: 1 }], fingerprint: "ab" };
    assert.equal(serializeDocument(document), serializeDocument(document));
  });

  it("escapes the control characters Python escapes, and leaves `/` and U+007F alone", () => {
    const sample = '"\\/\b\f\n\r\t\u0000\u0001\u001f\u007fé\u0080߿ࠀ￿😀';
    // json.dumps(sample, ensure_ascii=False, separators=(",", ":"))
    const EXPECTED = '"\\"\\\\/\\b\\f\\n\\r\\t\\u0000\\u0001\\u001f\u007fé\u0080߿ࠀ￿😀"';
    assert.equal(serializeJson(sample, {}), EXPECTED);
  });
});

/* ------------------------------------------------------------------------- *
 * The fingerprint serializer
 * ------------------------------------------------------------------------- */

describe("CT-140-4 — the fingerprint serializer equals Python's compact `dumps`", () => {
  it("renders the sorted triples compactly, with non-ASCII escaped", () => {
    // The baseline: sorted((e["path"], e["bytes"], e["sha256"]) for e in files + skipped)
    const entries = [
      ["a.txt", 1, "cc"],
      ["big.bin", 99, "dd"],
      ["src/é.ts", 12, "aa"],
      ["😀.bin", 3, "bb"],
    ];
    // json.dumps(entries, separators=(",", ":"))
    const EXPECTED =
      '[["a.txt",1,"cc"],["big.bin",99,"dd"],["src/\\u00e9.ts",12,"aa"],["\\ud83d\\ude00.bin",3,"bb"]]';
    assert.equal(serializeFingerprintInput(entries), EXPECTED);
  });

  it("gives the SHA-256 Python gave over those bytes", () => {
    const entries = [
      ["a.txt", 1, "cc"],
      ["big.bin", 99, "dd"],
      ["src/é.ts", 12, "aa"],
      ["😀.bin", 3, "bb"],
    ];
    const digest = createHash("sha256")
      .update(serializeFingerprintInput(entries), "utf8")
      .digest("hex");
    assert.equal(digest, "171a31c3d05060fe6a84fbe4b10b1ed2cc5ba22445a3ad684a4fba50101d5c77");
  });

  it("escapes an astral character as a SURROGATE PAIR, not as one `\\U` escape", () => {
    assert.equal(serializeFingerprintInput("😀"), '"\\ud83d\\ude00"');
    assert.equal(serializeFingerprintInput("é"), '"\\u00e9"');
    assert.equal(serializeFingerprintInput("\u007f"), '"\\u007f"', "U+007F is escaped here");
    assert.equal(serializeFingerprintInput("￿"), '"\\uffff"');
  });

  it("escapes exactly what Python's `ensure_ascii=True` escapes", () => {
    const sample = '"\\/\b\f\n\r\t\u0000\u0001\u001f\u007fé\u0080߿ࠀ￿😀';
    // json.dumps(sample, separators=(",", ":"))
    const EXPECTED =
      '"\\"\\\\/\\b\\f\\n\\r\\t\\u0000\\u0001\\u001f\\u007f\\u00e9\\u0080\\u07ff\\u0800\\uffff\\ud83d\\ude00"';
    assert.equal(serializeFingerprintInput(sample), EXPECTED);
  });

  it("is compact: no space after `,` or `:`, and no trailing line end", () => {
    assert.equal(serializeFingerprintInput({ a: 1, b: [2, 3] }), '{"a":1,"b":[2,3]}');
    assert.ok(!serializeFingerprintInput([1, 2]).endsWith("\n"));
  });

  it("does NOT sort keys: the baseline's compact call leaves `sort_keys` false", () => {
    assert.equal(serializeFingerprintInput({ b: 1, a: 2 }), '{"b":1,"a":2}');
  });

  it("differs from the document serializer exactly where a non-ASCII path appears", () => {
    const entry = [["é", 1, "aa"]];
    assert.notEqual(serializeFingerprintInput(entry), serializeJson(entry, {}));
    const ascii = [["a", 1, "aa"]];
    assert.equal(serializeFingerprintInput(ascii), serializeJson(ascii, {}));
  });
});

/* ------------------------------------------------------------------------- *
 * Numbers: a silent divergence is refused
 * ------------------------------------------------------------------------- */

describe("CT-140-4 — a number Python would write differently is refused", () => {
  it("accepts integers, including large and negative ones", () => {
    assert.equal(serializeFingerprintInput([0, -1, 20971520]), "[0,-1,20971520]");
  });

  it("refuses a non-integer, because `repr(1.0)` is `1.0` and `String(1)` is `1`", () => {
    assert.throws(() => serializeFingerprintInput(1.5), TypeError);
  });

  it("refuses a non-finite number, which Python writes as `NaN`/`Infinity`", () => {
    assert.throws(() => serializeDocument(Number.NaN), TypeError);
    assert.throws(() => serializeDocument(Number.POSITIVE_INFINITY), TypeError);
  });
});
