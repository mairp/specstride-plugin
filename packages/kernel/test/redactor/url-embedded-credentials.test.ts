/**
 * The narrowing of `url-embedded-credentials` — owner ruling 2026-11-04
 * (commit-gate false positive), part A item 1.
 *
 * The pattern of the widened set (`data/patterns/widened-v1.json`) was
 * `\b[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]+@`, whose user part matched any run
 * of non-whitespace that is not `/`, `:` or `@`. On the step-5 long drive it
 * matched `https://example.com>\n<mailto:a@b.example` in
 * `test/extract.test.js:60` — the user part `example.com>\n<mailto` — and the
 * plain loop's ingress commit gate blocked six phase commits over an ordinary
 * URL test fixture (the `results/parallel-loop.md` finding 2).
 *
 * RFC 3986 §3.2.1: user-info is `*( unreserved / pct-encoded / sub-delims )`,
 * none of which is an unencoded `<`, `>`, `"`, `'`, a backquote, or, for the
 * user part, whitespace, `/`, `:` or `@`. BOTH character classes now exclude
 * exactly those and nothing else, so the false positive above is no longer a
 * hit and every ordinary address with embedded credentials still is.
 *
 * The version of the set carries the digest of its content and changes with
 * every change of the set (F111-FR-029): the file now wears
 * `specstride-redaction/widened-1+57db06d30c8b607f`, and the loader's own
 * version check is the pin that the version travelled with the pattern.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compilePattern,
  expectedVersionOf,
  loadWidenedPatternSet,
  type PatternEntry,
} from "../../src/redactor/patterns.ts";
import { scanCommitFiles } from "../../src/redactor/scan.ts";
import { createRedactor } from "../../src/redactor/redactor.ts";

/** The false positive of the step-5 long drive, byte for byte (see header). */
const FALSE_POSITIVE = "https://example.com>\\n<mailto:a@b.example";

/** The addresses the ruling pins as hits: credentials a URL may really carry. */
const STILL_HITS: readonly string[] = Object.freeze([
  "https://user:pass@host",
  "postgres://u:p@h:5432/db",
  "ftp://a:b@c",
]);

/** The entry of the widened set this ruling narrowed, compiled for a scan. */
function narrowed(): { readonly entry: PatternEntry; readonly every: RegExp } {
  const loaded = loadWidenedPatternSet();
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.reason);
  const entry = loaded.loaded.values.find((value) => value.name === "url-embedded-credentials");
  assert.ok(entry !== undefined, "the widened set holds url-embedded-credentials");
  return { entry, every: compilePattern(entry, true) };
}

test("the narrowed set loads, and its version is the digest of its content (F111-FR-029)", () => {
  const loaded = loadWidenedPatternSet();
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.reason);
  const set = loaded.loaded.set as { version: string; keyNames: unknown; values: unknown };
  assert.equal(set.version, expectedVersionOf(set));
  assert.match(set.version, /^specstride-redaction\/widened-1\+/);
});

test("the ruling's false positive is NOT a hit, in either writing of its newline", () => {
  const { every } = narrowed();
  // The two-character escape `\n` as the file held it, and a real newline —
  // whitespace was never in the class, the escape sequence is what matched.
  for (const text of [
    `const u = "${FALSE_POSITIVE}";`,
    `const u = "https://example.com>\n<mailto:a@b.example";`,
    FALSE_POSITIVE,
  ]) {
    every.lastIndex = 0;
    assert.equal(every.test(text), false, text);
  }
});

test("each character the ruling excludes breaks the match where it once matched", () => {
  const { every } = narrowed();
  for (const char of ["<", ">", '"', "'", "`"]) {
    const text = `https://example.com${char}\n<mailto:a@b.example`;
    every.lastIndex = 0;
    assert.equal(every.test(text), false, `user part holding ${JSON.stringify(char)}: ${text}`);
    const asPassword = `https://name:pass${char}word@host`;
    every.lastIndex = 0;
    assert.equal(
      every.test(asPassword),
      false,
      `password part holding ${JSON.stringify(char)}: ${asPassword}`,
    );
  }
});

test("the addresses of the ruling ARE hits, named url-embedded-credentials", () => {
  const { entry, every } = narrowed();
  for (const text of STILL_HITS) {
    every.lastIndex = 0;
    assert.equal(every.test(text), true, text);
    // And through the scan, the hit carries the pattern's own name.
    const dir = mkdtempSync(join(tmpdir(), "ct-url-cred-"));
    try {
      writeFileSync(join(dir, "fixture.txt"), `${text}\n`);
      const result = scanCommitFiles(["fixture.txt"], { root: dir, redactor: createRedactor() });
      assert.equal(result.blocked, true, text);
      assert.ok(
        result.hits.every((hit) => hit.pattern === entry.name),
        JSON.stringify(result.hits),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("a commit file holding only the false positive is NOT blocked", () => {
  const dir = mkdtempSync(join(tmpdir(), "ct-url-cred-"));
  try {
    writeFileSync(
      join(dir, "extract.test.js"),
      `// a test fixture of an ordinary URL, as the drive's file held it\n` +
        `const expected = "${FALSE_POSITIVE}";\n` +
        `const other = "mailto:a@b.example";\n`,
    );
    const result = scanCommitFiles(["extract.test.js"], { root: dir, redactor: createRedactor() });
    assert.equal(result.blocked, false, JSON.stringify(result.hits));
    assert.deepEqual([...result.files], []);
    assert.equal(result.event, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("one file with the false positive and one with a real hit: only the real one is named", () => {
  const dir = mkdtempSync(join(tmpdir(), "ct-url-cred-"));
  try {
    writeFileSync(join(dir, "plain.test.js"), `const expected = "${FALSE_POSITIVE}";\n`);
    writeFileSync(join(dir, "real.txt"), "deploy to postgres://u:p@h:5432/db\n");
    const result = scanCommitFiles(["plain.test.js", "real.txt"], {
      root: dir,
      redactor: createRedactor(),
    });
    assert.equal(result.blocked, true);
    assert.deepEqual([...result.files], ["real.txt"]);
    assert.deepEqual([...result.counts], [1]);
    assert.ok(!JSON.stringify(result).includes("plain.test.js"), JSON.stringify(result));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
